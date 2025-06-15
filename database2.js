const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

class DatabaseManager {
    constructor() {
        this.db = null;
    }

    async initialize() {
        try {
            this.db = await open({
                filename: './bot_database.db',
                driver: sqlite3.Database
            });

            await this.db.exec('PRAGMA foreign_keys = ON');
            await this.createTables();
            console.log('✅ Enhanced database initialized successfully');
            return true;
        } catch (error) {
            console.error('❌ Database initialization failed:', error);
            throw error;
        }
    }

    async createTables() {
        // Enhanced users table with quality ratings
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                total_feedback_all_time INTEGER DEFAULT 0,
                current_credits INTEGER DEFAULT 0,
                chapter_leases INTEGER DEFAULT 0,
                bookshelf_posts INTEGER DEFAULT 0,
                quality_ratings TEXT DEFAULT '{"total": 0, "sum": 0, "average": 2.0}',
                last_active INTEGER DEFAULT 0,
                join_date INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // Enhanced monthly feedback with separate tracking
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS monthly_feedback (
                user_id TEXT,
                month_key TEXT,
                doc_feedback_count INTEGER DEFAULT 0,
                comment_feedback_count INTEGER DEFAULT 0,
                PRIMARY KEY (user_id, month_key),
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            )
        `);

        // Enhanced logged feedback with more details
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS logged_feedback (
                message_id TEXT,
                user_id TEXT,
                feedback_type TEXT,
                chapter_number INTEGER,
                credits_earned INTEGER,
                logged_at INTEGER DEFAULT (strftime('%s', 'now')),
                PRIMARY KEY (message_id, user_id),
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            )
        `);

        // Quality ratings system
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS quality_ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                rated_user_id TEXT,
                rater_id TEXT,
                rating INTEGER CHECK (rating >= 1 AND rating <= 4),
                feedback_message_id TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (rated_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
                FOREIGN KEY (rater_id) REFERENCES users(user_id) ON DELETE CASCADE,
                UNIQUE(rated_user_id, rater_id, feedback_message_id)
            )
        `);

        // User purchases
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS user_purchases (
                user_id TEXT,
                item TEXT,
                purchased_at INTEGER DEFAULT (strftime('%s', 'now')),
                PRIMARY KEY (user_id, item),
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            )
        `);

        // Pardons system
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS pardons (
                user_id TEXT,
                month_key TEXT,
                reason TEXT DEFAULT 'staff_discretion',
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                PRIMARY KEY (user_id, month_key),
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            )
        `);

        // Work of the week nominations
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS work_spotlights (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nominator_id TEXT,
                thread_id TEXT,
                thread_name TEXT,
                author_id TEXT,
                week_key TEXT,
                votes INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (nominator_id) REFERENCES users(user_id) ON DELETE CASCADE,
                FOREIGN KEY (author_id) REFERENCES users(user_id) ON DELETE CASCADE
            )
        `);

        // Cooldowns for faceless and shame commands
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS user_cooldowns (
                user_id TEXT,
                command_type TEXT,
                last_used INTEGER,
                PRIMARY KEY (user_id, command_type),
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            )
        `);

        console.log('📋 All database tables created/verified');
    }

    async testConnection() {
        try {
            const result = await this.db.get('SELECT 1 as test');
            return result && result.test === 1;
        } catch (error) {
            console.error('Database connection test failed:', error);
            return false;
        }
    }

    // ===== MONTHLY FEEDBACK METHODS =====
    async getMonthlyFeedback(userId, monthKey) {
        try {
            const result = await this.db.get(
                'SELECT doc_feedback_count, comment_feedback_count FROM monthly_feedback WHERE user_id = ? AND month_key = ?',
                [userId, monthKey]
            );
            
            if (!result) {
                return { docs: 0, comments: 0 };
            }
            
            return {
                docs: result.doc_feedback_count || 0,
                comments: result.comment_feedback_count || 0
            };
        } catch (error) {
            console.error('Error getting monthly feedback:', error);
            return { docs: 0, comments: 0 };
        }
    }

    async setMonthlyFeedback(userId, monthKey, feedbackType, count) {
        try {
            const field = feedbackType === 'document' ? 'doc_feedback_count' : 'comment_feedback_count';
            
            const existing = await this.db.get(
                'SELECT * FROM monthly_feedback WHERE user_id = ? AND month_key = ?',
                [userId, monthKey]
            );
            
            if (existing) {
                await this.db.run(
                    `UPDATE monthly_feedback SET ${field} = ? WHERE user_id = ? AND month_key = ?`,
                    [count, userId, monthKey]
                );
            } else {
                const docCount = feedbackType === 'document' ? count : 0;
                const commentCount = feedbackType === 'comment' ? count : 0;
                
                await this.db.run(
                    'INSERT INTO monthly_feedback (user_id, month_key, doc_feedback_count, comment_feedback_count) VALUES (?, ?, ?, ?)',
                    [userId, monthKey, docCount, commentCount]
                );
            }
        } catch (error) {
            console.error('Error setting monthly feedback:', error);
        }
    }

    // ===== PARDON SYSTEM METHODS =====
    async isUserPardoned(userId, monthKey) {
        try {
            const result = await this.db.get(
                'SELECT 1 FROM pardons WHERE user_id = ? AND month_key = ?',
                [userId, monthKey]
            );
            return !!result;
        } catch (error) {
            console.error('Error checking pardon status:', error);
            return false;
        }
    }

    async pardonUser(userId, monthKey, reason = 'staff_discretion') {
        try {
            await this.db.run(
                'INSERT OR REPLACE INTO pardons (user_id, month_key, reason) VALUES (?, ?, ?)',
                [userId, monthKey, reason]
            );
        } catch (error) {
            console.error('Error pardoning user:', error);
            throw error;
        }
    }

    async removePardon(userId, monthKey) {
        try {
            const result = await this.db.run(
                'DELETE FROM pardons WHERE user_id = ? AND month_key = ?',
                [userId, monthKey]
            );
            return result.changes > 0;
        } catch (error) {
            console.error('Error removing pardon:', error);
            return false;
        }
    }

    async getUserPardonReason(userId, monthKey) {
        try {
            const result = await this.db.get(
                'SELECT reason FROM pardons WHERE user_id = ? AND month_key = ?',
                [userId, monthKey]
            );
            return result ? result.reason : null;
        } catch (error) {
            console.error('Error getting pardon reason:', error);
            return null;
        }
    }

    async getPardonedUsersForMonth(monthKey) {
        try {
            return await this.db.all(
                'SELECT user_id, reason FROM pardons WHERE month_key = ?',
                [monthKey]
            );
        } catch (error) {
            console.error('Error getting pardoned users:', error);
            return [];
        }
    }

    // ===== LEADERBOARD METHODS =====
    async getTopContributors(limit = 10) {
        try {
            return await this.db.all(
                'SELECT user_id, total_feedback_all_time FROM users WHERE total_feedback_all_time > 0 ORDER BY total_feedback_all_time DESC LIMIT ?',
                [limit]
            );
        } catch (error) {
            console.error('Error getting top contributors:', error);
            return [];
        }
    }

    async getMonthlyLeaderboard(monthKey, limit = 10) {
        try {
            return await this.db.all(`
                SELECT 
                    user_id, 
                    (doc_feedback_count * 3 + comment_feedback_count) as weighted_score,
                    doc_feedback_count,
                    comment_feedback_count
                FROM monthly_feedback 
                WHERE month_key = ? AND weighted_score > 0
                ORDER BY weighted_score DESC 
                LIMIT ?
            `, [monthKey, limit]);
        } catch (error) {
            console.error('Error getting monthly leaderboard:', error);
            return [];
        }
    }

    async getQualityLeaderboard(limit = 10) {
        try {
            return await this.db.all(`
                SELECT 
                    u.user_id, 
                    u.total_feedback_all_time,
                    json_extract(u.quality_ratings, '$.average') as avg_quality,
                    json_extract(u.quality_ratings, '$.total') as total_ratings
                FROM users u
                WHERE u.total_feedback_all_time > 0 
                AND json_extract(u.quality_ratings, '$.total') >= 3
                ORDER BY json_extract(u.quality_ratings, '$.average') DESC
                LIMIT ?
            `, [limit]);
        } catch (error) {
            console.error('Error getting quality leaderboard:', error);
            return [];
        }
    }

    // ===== COOLDOWN METHODS =====
    async getFacelessCooldown(userId) {
        try {
            const result = await this.db.get(
                'SELECT last_used FROM user_cooldowns WHERE user_id = ? AND command_type = ?',
                [userId, 'faceless']
            );
            return result ? result.last_used : 0;
        } catch (error) {
            console.error('Error getting faceless cooldown:', error);
            return 0;
        }
    }

    async setFacelessCooldown(userId) {
        try {
            await this.db.run(
                'INSERT OR REPLACE INTO user_cooldowns (user_id, command_type, last_used) VALUES (?, ?, ?)',
                [userId, 'faceless', Date.now()]
            );
        } catch (error) {
            console.error('Error setting faceless cooldown:', error);
        }
    }

    async getShameCooldown(userId) {
        try {
            const result = await this.db.get(
                'SELECT last_used FROM user_cooldowns WHERE user_id = ? AND command_type = ?',
                [userId, 'shame']
            );
            return result ? result.last_used : 0;
        } catch (error) {
            console.error('Error getting shame cooldown:', error);
            return 0;
        }
    }

    async setShameCooldown(userId) {
        try {
            await this.db.run(
                'INSERT OR REPLACE INTO user_cooldowns (user_id, command_type, last_used) VALUES (?, ?, ?)',
                [userId, 'shame', Date.now()]
            );
        } catch (error) {
            console.error('Error setting shame cooldown:', error);
        }
    }

    async cleanupOldCooldowns() {
        try {
            const oneHour = 60 * 60 * 1000;
            const cutoff = Date.now() - oneHour;
            
            await this.db.run(
                'DELETE FROM user_cooldowns WHERE last_used < ?',
                [cutoff]
            );
        } catch (error) {
            console.error('Error cleaning up old cooldowns:', error);
        }
    }

    async cleanupOldShameCooldowns() {
        try {
            const oneHour = 60 * 60 * 1000;
            const cutoff = Date.now() - oneHour;
            
            await this.db.run(
                'DELETE FROM user_cooldowns WHERE command_type = ? AND last_used < ?',
                ['shame', cutoff]
            );
        } catch (error) {
            console.error('Error cleaning up old shame cooldowns:', error);
        }
    }

    // ===== UTILITY METHODS =====
    async clearUserLoggedFeedback(userId) {
        try {
            await this.db.run('DELETE FROM logged_feedback WHERE user_id = ?', [userId]);
        } catch (error) {
            console.error('Error clearing user logged feedback:', error);
        }
    }

    async deleteUser(userId) {
        try {
            // CASCADE will handle related data
            await this.db.run('DELETE FROM users WHERE user_id = ?', [userId]);
        } catch (error) {
            console.error('Error deleting user:', error);
        }
    }

    async addPurchase(userId, item) {
        try {
            await this.db.run(
                'INSERT OR REPLACE INTO user_purchases (user_id, item) VALUES (?, ?)',
                [userId, item]
            );
        } catch (error) {
            console.error('Error adding purchase:', error);
        }
    }

    // ===== ANALYTICS METHODS =====
    async getServerStats() {
        try {
            const stats = await this.db.get(`
                SELECT 
                    COUNT(*) as total_users,
                    SUM(total_feedback_all_time) as total_feedback,
                    SUM(current_credits) as total_credits,
                    SUM(chapter_leases) as total_leases,
                    AVG(total_feedback_all_time) as avg_feedback_per_user,
                    AVG(current_credits) as avg_credits_per_user
                FROM users
            `);

            const activeThisMonth = await this.db.get(`
                SELECT COUNT(DISTINCT user_id) as active_users
                FROM monthly_feedback 
                WHERE month_key = ?
            `, [this.getCurrentMonthKey()]);

            return {
                ...stats,
                active_this_month: activeThisMonth.active_users || 0
            };
        } catch (error) {
            console.error('Error getting server stats:', error);
            return {};
        }
    }

    getCurrentMonthKey() {
        const now = new Date();
        const adjustedDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
        return `${adjustedDate.getFullYear()}-${adjustedDate.getMonth()}`;
    }

    async close() {
        if (this.db) {
            try {
                await this.db.close();
                console.log('✅ Database connection closed');
            } catch (error) {
                console.error('❌ Error closing database:', error);
            }
        }
    }
}

module.exports = DatabaseManager;
