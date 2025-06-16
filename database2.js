const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class DatabaseManager {
    constructor(dbPath = './typeAndDraft.db') {
        this.dbPath = dbPath;
        this.db = null;
    }

    async initialize() {
        try {
            this.db = new sqlite3.Database(this.dbPath);
            console.log('📊 Database connection established');
            
            await this.createTables();
            await this.runMigrations();
            
            console.log('✅ Database initialized successfully');
            return true;
        } catch (error) {
            console.error('❌ Database initialization failed:', error);
            throw error;
        }
    }

    async createTables() {
        const tables = [
            // Users table - main user data
            `CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                current_credits INTEGER DEFAULT 0,
                total_feedback_all_time INTEGER DEFAULT 0,
                chapter_leases INTEGER DEFAULT 0,
                bookshelf_posts INTEGER DEFAULT 0,
                demo_posts INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Validated feedback - new system
            `CREATE TABLE IF NOT EXISTS validated_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                feedback_type TEXT NOT NULL CHECK (feedback_type IN ('doc', 'comment')),
                validator_id TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                validated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )`,

            // Pending feedback - awaiting validation
            `CREATE TABLE IF NOT EXISTS pending_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                feedback_type TEXT NOT NULL CHECK (feedback_type IN ('doc', 'comment')),
                message_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, thread_id),
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )`,

            // Monthly feedback tracking
            `CREATE TABLE IF NOT EXISTS monthly_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                month_key TEXT NOT NULL,
                docs INTEGER DEFAULT 0,
                comments INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, month_key),
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )`,

            // User purchases
            `CREATE TABLE IF NOT EXISTS user_purchases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                item TEXT NOT NULL,
                purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )`,

            // Pardons system
            `CREATE TABLE IF NOT EXISTS pardons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                month_key TEXT NOT NULL,
                reason TEXT DEFAULT 'staff_discretion',
                pardoned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, month_key),
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )`,

            // Faceless command cooldowns
            `CREATE TABLE IF NOT EXISTS faceless_cooldowns (
                user_id TEXT PRIMARY KEY,
                last_used INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )`,

            // Citadel channels
            `CREATE TABLE IF NOT EXISTS citadel_channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT UNIQUE NOT NULL,
                channel_id TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )`
        ];

        for (const table of tables) {
            await this.runQuery(table);
        }

        // Create indexes for better performance
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_validated_feedback_user_id ON validated_feedback(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_validated_feedback_type ON validated_feedback(feedback_type)',
            'CREATE INDEX IF NOT EXISTS idx_monthly_feedback_user_month ON monthly_feedback(user_id, month_key)',
            'CREATE INDEX IF NOT EXISTS idx_pending_feedback_user_thread ON pending_feedback(user_id, thread_id)',
            'CREATE INDEX IF NOT EXISTS idx_pardons_user_month ON pardons(user_id, month_key)'
        ];

        for (const index of indexes) {
            await this.runQuery(index);
        }
    }

    async runMigrations() {
        // Add any necessary migrations here
        try {
            // Check if demo_posts column exists, add if not
            const tableInfo = await this.runQuery("PRAGMA table_info(users)");
            const hasDemoPosts = tableInfo.some(column => column.name === 'demo_posts');
            
            if (!hasDemoPosts) {
                await this.runQuery('ALTER TABLE users ADD COLUMN demo_posts INTEGER DEFAULT 0');
                console.log('✅ Added demo_posts column to users table');
            }
        } catch (error) {
            console.log('Migration completed or not needed:', error.message);
        }
    }

    // Helper method to run queries
    runQuery(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Helper method to run single operations
    runSingle(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }

    // Helper method to get single row
    getRow(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // ===== USER MANAGEMENT =====
    async getUserData(userId) {
        let user = await this.getRow('SELECT * FROM users WHERE user_id = ?', [userId]);
        
        if (!user) {
            await this.runSingle(
                'INSERT INTO users (user_id, current_credits, total_feedback_all_time, chapter_leases, bookshelf_posts, demo_posts) VALUES (?, 0, 0, 0, 0, 0)',
                [userId]
            );
            user = await this.getRow('SELECT * FROM users WHERE user_id = ?', [userId]);
        }
        
        return user;
    }

    async updateUserData(userId, updates) {
        const validFields = ['current_credits', 'total_feedback_all_time', 'chapter_leases', 'bookshelf_posts', 'demo_posts'];
        const setClause = [];
        const values = [];

        for (const [field, value] of Object.entries(updates)) {
            if (validFields.includes(field)) {
                setClause.push(`${field} = ?`);
                values.push(value);
            }
        }

        if (setClause.length === 0) return;

        values.push(userId);
        const sql = `UPDATE users SET ${setClause.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`;
        
        await this.runSingle(sql, values);
    }

    async deleteUser(userId) {
        await this.runSingle('DELETE FROM validated_feedback WHERE user_id = ?', [userId]);
        await this.runSingle('DELETE FROM pending_feedback WHERE user_id = ?', [userId]);
        await this.runSingle('DELETE FROM monthly_feedback WHERE user_id = ?', [userId]);
        await this.runSingle('DELETE FROM user_purchases WHERE user_id = ?', [userId]);
        await this.runSingle('DELETE FROM faceless_cooldowns WHERE user_id = ?', [userId]);
        await this.runSingle('DELETE FROM citadel_channels WHERE user_id = ?', [userId]);
        await this.runSingle('DELETE FROM users WHERE user_id = ?', [userId]);
    }

    // ===== VALIDATED FEEDBACK SYSTEM =====
    async addValidatedFeedback(userId, feedbackType, validatorId, threadId) {
        await this.runSingle(
            'INSERT INTO validated_feedback (user_id, feedback_type, validator_id, thread_id) VALUES (?, ?, ?, ?)',
            [userId, feedbackType, validatorId, threadId]
        );

        // Update total feedback count
        const userData = await this.getUserData(userId);
        await this.updateUserData(userId, {
            total_feedback_all_time: userData.total_feedback_all_time + 1
        });

        // Update monthly feedback count
        await this.updateMonthlyFeedbackCount(userId, feedbackType);
    }

    async getUserValidatedFeedbacks(userId) {
        const result = await this.getRow(
            'SELECT COUNT(*) as count FROM validated_feedback WHERE user_id = ?',
            [userId]
        );
        return result ? result.count : 0;
    }

    async getUserValidatedFeedbacksByType(userId) {
        const docs = await this.getRow(
            'SELECT COUNT(*) as count FROM validated_feedback WHERE user_id = ? AND feedback_type = "doc"',
            [userId]
        );
        const comments = await this.getRow(
            'SELECT COUNT(*) as count FROM validated_feedback WHERE user_id = ? AND feedback_type = "comment"',
            [userId]
        );

        return {
            docs: docs ? docs.count : 0,
            comments: comments ? comments.count : 0
        };
    }

    // ===== PENDING FEEDBACK SYSTEM =====
    async addPendingFeedback(userId, threadId, feedbackType, messageId) {
        await this.runSingle(
            'INSERT OR REPLACE INTO pending_feedback (user_id, thread_id, feedback_type, message_id) VALUES (?, ?, ?, ?)',
            [userId, threadId, feedbackType, messageId]
        );
    }

    async getPendingFeedback(userId, threadId) {
        return await this.getRow(
            'SELECT * FROM pending_feedback WHERE user_id = ? AND thread_id = ?',
            [userId, threadId]
        );
    }

    async removePendingFeedback(userId, threadId) {
        await this.runSingle(
            'DELETE FROM pending_feedback WHERE user_id = ? AND thread_id = ?',
            [userId, threadId]
        );
    }

    // ===== MONTHLY FEEDBACK TRACKING =====
    getCurrentMonthKey() {
        const now = new Date();
        const adjustedDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
        return `${adjustedDate.getFullYear()}-${adjustedDate.getMonth()}`;
    }

    async updateMonthlyFeedbackCount(userId, feedbackType) {
        const monthKey = this.getCurrentMonthKey();
        
        // Get or create monthly record
        let monthlyRecord = await this.getRow(
            'SELECT * FROM monthly_feedback WHERE user_id = ? AND month_key = ?',
            [userId, monthKey]
        );

        if (!monthlyRecord) {
            await this.runSingle(
                'INSERT INTO monthly_feedback (user_id, month_key, docs, comments) VALUES (?, ?, 0, 0)',
                [userId, monthKey]
            );
            monthlyRecord = { docs: 0, comments: 0 };
        }

        // Update the appropriate count
        const newDocs = feedbackType === 'doc' ? monthlyRecord.docs + 1 : monthlyRecord.docs;
        const newComments = feedbackType === 'comment' ? monthlyRecord.comments + 1 : monthlyRecord.comments;

        await this.runSingle(
            'UPDATE monthly_feedback SET docs = ?, comments = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND month_key = ?',
            [newDocs, newComments, userId, monthKey]
        );
    }

    async getUserMonthlyFeedbackByType(userId) {
        const monthKey = this.getCurrentMonthKey();
        const result = await this.getRow(
            'SELECT docs, comments FROM monthly_feedback WHERE user_id = ? AND month_key = ?',
            [userId, monthKey]
        );

        return result ? { docs: result.docs, comments: result.comments } : { docs: 0, comments: 0 };
    }

    async setUserMonthlyFeedback(userId, monthKey, count) {
        await this.runSingle(
            'INSERT OR REPLACE INTO monthly_feedback (user_id, month_key, docs, comments) VALUES (?, ?, ?, 0)',
            [userId, monthKey, count]
        );
    }

    // ===== CREDITS AND LEASES =====
    async addCredits(userId, amount) {
        const userData = await this.getUserData(userId);
        await this.updateUserData(userId, {
            current_credits: userData.current_credits + amount
        });
    }

    async addLeases(userId, amount) {
        const userData = await this.getUserData(userId);
        await this.updateUserData(userId, {
            chapter_leases: userData.chapter_leases + amount
        });
    }

    async incrementBookshelfDemoPostCount(userId) {
        const userData = await this.getUserData(userId);
        await this.updateUserData(userId, {
            demo_posts: (userData.demo_posts || 0) + 1
        });
    }

    // ===== PURCHASES =====
    async addPurchase(userId, item) {
        await this.runSingle(
            'INSERT INTO user_purchases (user_id, item) VALUES (?, ?)',
            [userId, item]
        );
    }

    // ===== PARDONS SYSTEM =====
    async pardonUser(userId, monthKey, reason = 'staff_discretion') {
        await this.runSingle(
            'INSERT OR REPLACE INTO pardons (user_id, month_key, reason) VALUES (?, ?, ?)',
            [userId, monthKey, reason]
        );
    }

    async isUserPardoned(userId, monthKey) {
        const result = await this.getRow(
            'SELECT id FROM pardons WHERE user_id = ? AND month_key = ?',
            [userId, monthKey]
        );
        return !!result;
    }

    async removePardon(userId, monthKey) {
        const result = await this.runSingle(
            'DELETE FROM pardons WHERE user_id = ? AND month_key = ?',
            [userId, monthKey]
        );
        return result.changes > 0;
    }

    async getPardonedUsersForMonth(monthKey) {
        return await this.runQuery(
            'SELECT user_id, reason FROM pardons WHERE month_key = ?',
            [monthKey]
        );
    }

    // ===== FACELESS COOLDOWNS =====
    async getFacelessCooldown(userId) {
        const result = await this.getRow(
            'SELECT last_used FROM faceless_cooldowns WHERE user_id = ?',
            [userId]
        );
        return result ? result.last_used : 0;
    }

    async setFacelessCooldown(userId) {
        const now = Date.now();
        await this.runSingle(
            'INSERT OR REPLACE INTO faceless_cooldowns (user_id, last_used) VALUES (?, ?)',
            [userId, now]
        );
    }

    // ===== CITADEL CHANNELS =====
    async createCitadelChannel(userId, channelId) {
        await this.runSingle(
            'INSERT INTO citadel_channels (user_id, channel_id) VALUES (?, ?)',
            [userId, channelId]
        );
    }

    async getUserCitadelChannel(userId) {
        const result = await this.getRow(
            'SELECT channel_id FROM citadel_channels WHERE user_id = ?',
            [userId]
        );
        return result ? result.channel_id : null;
    }

    // ===== STATISTICS =====
    async getTopContributors(limit = 10) {
        return await this.runQuery(
            'SELECT user_id, total_feedback_all_time FROM users WHERE total_feedback_all_time > 0 ORDER BY total_feedback_all_time DESC LIMIT ?',
            [limit]
        );
    }

    // ===== CLEANUP FUNCTIONS =====
    async clearUserLoggedFeedback(userId) {
        await this.runSingle('DELETE FROM validated_feedback WHERE user_id = ?', [userId]);
        await this.runSingle('DELETE FROM pending_feedback WHERE user_id = ?', [userId]);
        await this.runSingle('DELETE FROM monthly_feedback WHERE user_id = ?', [userId]);
    }

    // ===== CONNECTION MANAGEMENT =====
    async testConnection() {
        try {
            await this.runQuery('SELECT 1');
            return true;
        } catch (error) {
            console.error('Database connection test failed:', error);
            return false;
        }
    }

    async close() {
        if (this.db) {
            return new Promise((resolve) => {
                this.db.close((err) => {
                    if (err) {
                        console.error('Error closing database:', err);
                    } else {
                        console.log('📊 Database connection closed');
                    }
                    resolve();
                });
            });
        }
    }

    // ===== BACKUP AND MAINTENANCE =====
    async vacuum() {
        await this.runQuery('VACUUM');
        console.log('🧹 Database optimized');
    }

    async getStats() {
        const totalUsers = await this.getRow('SELECT COUNT(*) as count FROM users');
        const totalValidatedFeedback = await this.getRow('SELECT COUNT(*) as count FROM validated_feedback');
        const totalPendingFeedback = await this.getRow('SELECT COUNT(*) as count FROM pending_feedback');
        const totalCitadelChannels = await this.getRow('SELECT COUNT(*) as count FROM citadel_channels');

        return {
            totalUsers: totalUsers.count,
            totalValidatedFeedback: totalValidatedFeedback.count,
            totalPendingFeedback: totalPendingFeedback.count,
            totalCitadelChannels: totalCitadelChannels.count
        };
    }
}

module.exports = DatabaseManager;
