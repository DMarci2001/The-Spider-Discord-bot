const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

class DatabaseManager {
    constructor() {
        this.db = null;
    }

    async initialize() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database('bot_database.db', (err) => {
                if (err) {
                    console.error('❌ Database connection failed:', err);
                    reject(err);
                } else {
                    console.log('📊 Database connected successfully');
                    this.promisifyMethods();
                    this.createTables().then(() => {
                        console.log('✅ Database initialized successfully');
                        resolve();
                    }).catch(reject);
                }
            });
        });
    }

    promisifyMethods() {
        this.db.run = promisify(this.db.run.bind(this.db));
        this.db.get = promisify(this.db.get.bind(this.db));
        this.db.all = promisify(this.db.all.bind(this.db));
        this.db.exec = promisify(this.db.exec.bind(this.db));
    }

    async createTables() {
        const schema = `
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                total_feedback_all_time INTEGER DEFAULT 0,
                current_credits INTEGER DEFAULT 0,
                bookshelf_posts INTEGER DEFAULT 0,
                chapter_leases INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS user_purchases (
                user_id TEXT,
                item TEXT,
                purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, item)
            );
            
            CREATE TABLE IF NOT EXISTS monthly_feedback (
                user_id TEXT,
                month_key TEXT,
                count INTEGER DEFAULT 0,
                PRIMARY KEY (user_id, month_key)
            );
            
            CREATE TABLE IF NOT EXISTS logged_feedback (
                message_id TEXT,
                user_id TEXT,
                logged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (message_id, user_id)
            );
            
            CREATE TABLE IF NOT EXISTS pardoned_users (
                user_id TEXT,
                month_key TEXT,
                pardoned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, month_key)
            );
            
            CREATE TABLE IF NOT EXISTS faceless_cooldowns (
                user_id TEXT PRIMARY KEY,
                last_used INTEGER
            );
        `;
        
        await this.db.exec(schema);
        console.log('📋 Database schema applied successfully');
    }

    async testConnection() {
        try {
            await this.db.get('SELECT 1');
            return true;
        } catch (error) {
            console.error('Database test failed:', error);
            return false;
        }
    }

    async getUser(userId) {
        try {
            const user = await this.db.get('SELECT * FROM users WHERE user_id = ?', [userId]);
            if (!user) {
                return {
                    total_feedback_all_time: 0,
                    current_credits: 0,
                    bookshelf_posts: 0,
                    chapter_leases: 0
                };
            }
            return user;
        } catch (error) {
            console.error('Error getting user:', error);
            return {
                total_feedback_all_time: 0,
                current_credits: 0,
                bookshelf_posts: 0,
                chapter_leases: 0
            };
        }
    }

    async getUserPurchases(userId) {
        try {
            const purchases = await this.db.all('SELECT item FROM user_purchases WHERE user_id = ?', [userId]);
            return purchases ? purchases.map(p => p.item) : [];
        } catch (error) {
            console.error('Error getting purchases:', error);
            return [];
        }
    }

    async updateUser(userId, updates) {
        try {
            const fields = [];
            const values = [];
            
            if (updates.total_feedback_all_time !== undefined) {
                fields.push('total_feedback_all_time = ?');
                values.push(updates.total_feedback_all_time);
            }
            if (updates.current_credits !== undefined) {
                fields.push('current_credits = ?');
                values.push(updates.current_credits);
            }
            if (updates.bookshelf_posts !== undefined) {
                fields.push('bookshelf_posts = ?');
                values.push(updates.bookshelf_posts);
            }
            if (updates.chapter_leases !== undefined) {
                fields.push('chapter_leases = ?');
                values.push(updates.chapter_leases);
            }
            
            if (fields.length > 0) {
                values.push(userId);
                const result = await this.db.run(`UPDATE users SET ${fields.join(', ')} WHERE user_id = ?`, values);
                
                if (result.changes === 0) {
                    await this.db.run(`
                        INSERT INTO users (user_id, total_feedback_all_time, current_credits, bookshelf_posts, chapter_leases)
                        VALUES (?, ?, ?, ?, ?)
                    `, [userId, updates.total_feedback_all_time || 0, updates.current_credits || 0, updates.bookshelf_posts || 0, updates.chapter_leases || 0]);
                }
            }
        } catch (error) {
            console.error('Error updating user:', error);
        }
    }

    async addPurchase(userId, item) {
        try {
            await this.db.run('INSERT OR REPLACE INTO user_purchases (user_id, item) VALUES (?, ?)', [userId, item]);
        } catch (error) {
            console.error('Error adding purchase:', error);
        }
    }

    async getMonthlyFeedback(userId, monthKey) {
        try {
            const result = await this.db.get('SELECT count FROM monthly_feedback WHERE user_id = ? AND month_key = ?', [userId, monthKey]);
            return result ? result.count : 0;
        } catch (error) {
            console.error('Error getting monthly feedback:', error);
            return 0;
        }
    }

    async setMonthlyFeedback(userId, monthKey, count) {
        try {
            await this.db.run('INSERT OR REPLACE INTO monthly_feedback (user_id, month_key, count) VALUES (?, ?, ?)', [userId, monthKey, count]);
        } catch (error) {
            console.error('Error setting monthly feedback:', error);
        }
    }

    async logFeedback(messageId, userId) {
        try {
            await this.db.run('INSERT OR REPLACE INTO logged_feedback (message_id, user_id) VALUES (?, ?)', [messageId, userId]);
        } catch (error) {
            console.error('Error logging feedback:', error);
        }
    }

    async hasLoggedFeedback(messageId, userId) {
        try {
            const result = await this.db.get('SELECT 1 FROM logged_feedback WHERE message_id = ? AND user_id = ?', [messageId, userId]);
            return !!result;
        } catch (error) {
            console.error('Error checking logged feedback:', error);
            return false;
        }
    }

    async getTopContributors(limit = 10) {
        try {
            return await this.db.all('SELECT user_id, total_feedback_all_time FROM users ORDER BY total_feedback_all_time DESC LIMIT ?', [limit]);
        } catch (error) {
            console.error('Error getting top contributors:', error);
            return [];
        }
    }

    async pardonUser(userId, monthKey) {
        try {
            await this.db.run('INSERT OR REPLACE INTO pardoned_users (user_id, month_key) VALUES (?, ?)', [userId, monthKey]);
        } catch (error) {
            console.error('Error pardoning user:', error);
        }
    }

    async isUserPardoned(userId, monthKey) {
        try {
            const result = await this.db.get('SELECT 1 FROM pardoned_users WHERE user_id = ? AND month_key = ?', [userId, monthKey]);
            return !!result;
        } catch (error) {
            console.error('Error checking pardon:', error);
            return false;
        }
    }

    async removePardon(userId, monthKey) {
        try {
            const result = await this.db.run('DELETE FROM pardoned_users WHERE user_id = ? AND month_key = ?', [userId, monthKey]);
            return result.changes > 0;
        } catch (error) {
            console.error('Error removing pardon:', error);
            return false;
        }
    }

    async deleteUser(userId) {
        try {
            await this.db.run('DELETE FROM users WHERE user_id = ?', [userId]);
            await this.db.run('DELETE FROM user_purchases WHERE user_id = ?', [userId]);
            await this.db.run('DELETE FROM monthly_feedback WHERE user_id = ?', [userId]);
            await this.db.run('DELETE FROM logged_feedback WHERE user_id = ?', [userId]);
            await this.db.run('DELETE FROM pardoned_users WHERE user_id = ?', [userId]);
        } catch (error) {
            console.error('Error deleting user:', error);
        }
    }

    async clearUserLoggedFeedback(userId) {
        try {
            await this.db.run('DELETE FROM logged_feedback WHERE user_id = ?', [userId]);
        } catch (error) {
            console.error('Error clearing user logged feedback:', error);
        }
    }

    async getFacelessCooldown(userId) {
        try {
            const result = await this.db.get('SELECT last_used FROM faceless_cooldowns WHERE user_id = ?', [userId]);
            return result ? result.last_used : 0;
        } catch (error) {
            console.error('Error getting faceless cooldown:', error);
            return 0;
        }
    }

    async setFacelessCooldown(userId) {
        try {
            await this.db.run('INSERT OR REPLACE INTO faceless_cooldowns (user_id, last_used) VALUES (?, ?)', [userId, Date.now()]);
        } catch (error) {
            console.error('Error setting faceless cooldown:', error);
        }
    }

    async cleanupOldCooldowns() {
        try {
            const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
            await this.db.run('DELETE FROM faceless_cooldowns WHERE last_used < ?', [cutoff]);
        } catch (error) {
            console.error('Error cleaning up cooldowns:', error);
        }
    }

    async close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) console.error('Error closing database:', err);
                    else console.log('📊 Database connection closed');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = DatabaseManager;
