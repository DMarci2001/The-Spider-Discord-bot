require('dotenv').config();
const DatabaseManager = require('./database');
const fs = require('fs');

// Your JSON data - save the provided JSON as 'migration_data.json' in the same directory
const migrationData = require('./bot_data.json');

async function migrateData() {
    console.log('🔄 Starting data migration...');
    
    try {
        // Initialize database
        const db = new DatabaseManager();
        await db.initialize();
        
        console.log('✅ Database connected');
        
        // 1. Migrate user data
        console.log('📝 Migrating user data...');
        const userCount = Object.keys(migrationData.userData).length;
        let processedUsers = 0;
        
        for (const [userId, userData] of Object.entries(migrationData.userData)) {
            try {
                // Insert/update user data
                await db.updateUser(userId, {
                    total_feedback_all_time: userData.totalFeedbackAllTime || 0,
                    current_credits: userData.currentCredits || 0,
                    bookshelf_posts: userData.bookshelfPosts || 0,
                    chapter_leases: userData.chapterLeases || 0
                });
                
                // Add purchases
                if (userData.purchases && userData.purchases.length > 0) {
                    for (const purchase of userData.purchases) {
                        await db.addPurchase(userId, purchase);
                    }
                }
                
                processedUsers++;
                if (processedUsers % 10 === 0) {
                    console.log(`   ├─ Processed ${processedUsers}/${userCount} users`);
                }
            } catch (error) {
                console.error(`❌ Failed to migrate user ${userId}:`, error.message);
            }
        }
        
        console.log(`✅ Migrated ${processedUsers} users`);
        
        // 2. Migrate monthly feedback data
        console.log('📅 Migrating monthly feedback data...');
        const monthlyCount = Object.keys(migrationData.monthlyFeedback).length;
        let processedMonthly = 0;
        
        for (const [userId, monthlyData] of Object.entries(migrationData.monthlyFeedback)) {
            try {
                for (const [monthKey, count] of Object.entries(monthlyData)) {
                    if (typeof count === 'number') {
                        await db.setMonthlyFeedback(userId, monthKey, count);
                    }
                }
                
                processedMonthly++;
                if (processedMonthly % 10 === 0) {
                    console.log(`   ├─ Processed ${processedMonthly}/${monthlyCount} monthly records`);
                }
            } catch (error) {
                console.error(`❌ Failed to migrate monthly data for user ${userId}:`, error.message);
            }
        }
        
        console.log(`✅ Migrated monthly feedback data for ${processedMonthly} users`);
        
        // 3. Migrate logged feedback messages
        console.log('💬 Migrating logged feedback messages...');
        const messageCount = Object.keys(migrationData.loggedFeedbackMessages).length;
        let processedMessages = 0;
        
        for (const [messageId, userIds] of Object.entries(migrationData.loggedFeedbackMessages)) {
            try {
                if (Array.isArray(userIds)) {
                    for (const userId of userIds) {
                        await db.logFeedback(messageId, userId);
                    }
                }
                
                processedMessages++;
                if (processedMessages % 50 === 0) {
                    console.log(`   ├─ Processed ${processedMessages}/${messageCount} messages`);
                }
            } catch (error) {
                console.error(`❌ Failed to migrate message ${messageId}:`, error.message);
            }
        }
        
        console.log(`✅ Migrated ${processedMessages} logged feedback messages`);
        
        // 4. Migrate pardoned users (if any)
        if (migrationData.pardonedUsers && Object.keys(migrationData.pardonedUsers).length > 0) {
            console.log('🛡️ Migrating pardoned users...');
            for (const [userId, monthData] of Object.entries(migrationData.pardonedUsers)) {
                try {
                    for (const monthKey of Object.keys(monthData)) {
                        await db.pardonUser(userId, monthKey);
                    }
                } catch (error) {
                    console.error(`❌ Failed to migrate pardon for user ${userId}:`, error.message);
                }
            }
            console.log('✅ Migrated pardoned users');
        } else {
            console.log('ℹ️ No pardoned users to migrate');
        }
        
        // 5. Verify migration
        console.log('🔍 Verifying migration...');
        const stats = await db.getTopContributors(5);
        console.log('Top 5 contributors after migration:');
        stats.forEach((user, index) => {
            console.log(`   ${index + 1}. User ${user.user_id}: ${user.total_feedback_all_time} credits`);
        });
        
        await db.close();
        console.log('🎉 Migration completed successfully!');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run the migration
migrateData();
