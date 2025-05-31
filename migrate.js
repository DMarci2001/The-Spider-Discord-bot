const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const migrationData = JSON.parse(fs.readFileSync('./bot_data.json', 'utf8'));

console.log('🔄 FINAL FIX - Importing all data...');

const db = new sqlite3.Database('bot_database.db');

db.serialize(() => {
    // Create tables
    db.run(`CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        total_feedback_all_time INTEGER DEFAULT 0,
        current_credits INTEGER DEFAULT 0,
        bookshelf_posts INTEGER DEFAULT 0,
        chapter_leases INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS user_purchases (
        user_id TEXT,
        item TEXT,
        purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, item)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS monthly_feedback (
        user_id TEXT,
        month_key TEXT,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, month_key)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS logged_feedback (
        message_id TEXT,
        user_id TEXT,
        logged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (message_id, user_id)
    )`);
    
    // Clear and insert data
    db.run('DELETE FROM users');
    db.run('DELETE FROM user_purchases');
    db.run('DELETE FROM monthly_feedback');
    db.run('DELETE FROM logged_feedback');
    
    // Insert users
    const userStmt = db.prepare('INSERT INTO users (user_id, total_feedback_all_time, current_credits, bookshelf_posts, chapter_leases) VALUES (?, ?, ?, ?, ?)');
    const purchaseStmt = db.prepare('INSERT INTO user_purchases (user_id, item) VALUES (?, ?)');
    const monthlyStmt = db.prepare('INSERT INTO monthly_feedback (user_id, month_key, count) VALUES (?, ?, ?)');
    const loggedStmt = db.prepare('INSERT INTO logged_feedback (message_id, user_id) VALUES (?, ?)');
    
    // Users
    for (const [userId, userData] of Object.entries(migrationData.userData)) {
        userStmt.run([
            userId,
            userData.totalFeedbackAllTime || 0,
            userData.currentCredits || 0,
            userData.bookshelfPosts || 0,
            userData.chapterLeases || 0
        ]);
        
        if (userData.purchases) {
            userData.purchases.forEach(purchase => {
                purchaseStmt.run([userId, purchase]);
            });
        }
    }
    
    // Monthly feedback
    for (const [userId, monthlyData] of Object.entries(migrationData.monthlyFeedback)) {
        for (const [monthKey, count] of Object.entries(monthlyData)) {
            if (typeof count === 'number') {
                monthlyStmt.run([userId, monthKey, count]);
            }
        }
    }
    
    // Logged feedback
    for (const [messageId, userIds] of Object.entries(migrationData.loggedFeedbackMessages)) {
        if (Array.isArray(userIds)) {
            userIds.forEach(userId => {
                loggedStmt.run([messageId, userId]);
            });
        }
    }
    
    userStmt.finalize();
    purchaseStmt.finalize();
    monthlyStmt.finalize();
    loggedStmt.finalize();
    
    console.log('✅ All data imported');
});

db.close();
