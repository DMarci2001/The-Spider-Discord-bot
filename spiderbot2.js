require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs').promises;
const DatabaseManager = require('./database');

// ===== MESSAGE DELETION TIMEOUT CONFIGURATION =====
const MESSAGE_DELETE_TIMEOUT = 300000; // 5 minutes

// ===== BOT SETUP =====
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// ===== ENHANCED ECONOMIC CONSTANTS =====
const FEEDBACK_TYPES = {
    comment: {
        name: "Inline Comments",
        description: "Comments within the Google Doc chapter",
        baseCredits: 1,
        emoji: "💬",
        requiresContext: false,
        abbreviation: "COM"
    },
    document: {
        name: "Document Feedback", 
        description: "Comprehensive feedback in separate document",
        baseCredits: 3,
        emoji: "📄",
        requiresContext: true,
        abbreviation: "DOC"
    }
};

const CHAPTER_MULTIPLIERS = {
    early: { range: [1, 2], multiplier: 1.0, name: "Early Chapters" },
    developing: { range: [3, 5], multiplier: 1.25, name: "Developing Story" },
    established: { range: [6, 10], multiplier: 1.5, name: "Established Series" },
    epic: { range: [11, 25], multiplier: 1.75, name: "Epic Saga" },
    maximum: { range: [26, Infinity], multiplier: 1.75, name: "Maximum Reached" }
};

const QUALITY_MULTIPLIERS = {
    1: { multiplier: 0.8, name: "Needs Improvement", emoji: "⭐" },
    2: { multiplier: 1.0, name: "Helpful", emoji: "⭐⭐" },
    3: { multiplier: 1.3, name: "Very Helpful", emoji: "⭐⭐⭐" },
    4: { multiplier: 1.5, name: "Exceptional", emoji: "⭐⭐⭐⭐" }
};

const STORE_ITEMS = {
    shelf: {
        name: "Bookshelf Access",
        description: "Grants access to post in the bookshelf forum",
        price: 15, // CHANGED: From 18 to 15
        role: "Shelf Owner",
        emoji: "📚",
        category: "access"
    },
    lease: {
        name: "Chapter Lease",
        description: "Allows you to post one chapter",
        price: 3,
        emoji: "📝",
        allowQuantity: true,
        category: "utility"
    },
    // REMOVED: word_spotlight, priority_feedback, critique_shield, summary_boost
    
    // Keep color roles as-is
    mocha_mousse: {
        name: "Mocha Mousse",
        description: "Warm brown elegance",
        color: 0xA47864,
        price: 12,
        emoji: "🤎",
        category: "color",
        levelRequired: 15
    },
    peach_fuzz: {
        name: "Peach Fuzz", 
        description: "Soft peach warmth",
        color: 0xFFBE98,
        price: 12,
        emoji: "🍑",
        category: "color",
        levelRequired: 15
    },
    magenta: {
        name: "Magenta",
        description: "Bold purple vigor",
        color: 0xFF00FF,
        price: 12,
        emoji: "🔮",
        category: "color",
        levelRequired: 15
    },
    very_peri: {
        name: "Very Peri",
        description: "Periwinkle blue sophistication", 
        color: 0x6667AB,
        price: 12,
        emoji: "💜",
        category: "color",
        levelRequired: 15
    }
};

const ACCESS_REQUIREMENTS = {
    bookshelf: {
        level: 5,
        credits: 15, // CHANGED: From 18 to 15
        feedbackRequired: 2
    },
    readForRead: {
        totalFeedback: 20,
        level: null
    },
    completeDrafts: {
        level: 35,
        totalFeedback: 20
    }
};

const MONTHLY_REQUIREMENTS = {
    docFeedbacks: 2,
    commentFeedbacks: 6,
    mixedOption: { docs: 1, comments: 3 }
};

const ALLOWED_FEEDBACK_THREADS = ['bookshelf-feedback', 'bookshelf-discussion'];
const MONITORED_FORUMS = ['bookshelf-feedback', 'bookshelf-discussion', 'bookshelf'];
const ACTIVITY_MONITOR_CHANNEL = 'activity-monitor';

// Welcome system configuration
const WELCOME_CONFIG = {
    channelNames: ['welcome', 'general', 'arrivals'],
    categoryNames: ['welcome', 'general'],
    embed: {
        color: 0x5865F2,
        title: 'Welcome to Type&Draft! ☝️',
        thumbnail: true,
        timestamp: true,
        footer: true
    }
};

// ===== UTILITY FUNCTIONS =====
function getCurrentMonthKey() {
    const now = new Date();
    const adjustedDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    return `${adjustedDate.getFullYear()}-${adjustedDate.getMonth()}`;
}

function getLastMonthKey() {
    const now = new Date();
    const adjustedDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    adjustedDate.setMonth(adjustedDate.getMonth() - 1);
    return `${adjustedDate.getFullYear()}-${adjustedDate.getMonth()}`;
}

function calculateChapterMultiplier(chapterNumber) {
    for (const [key, tier] of Object.entries(CHAPTER_MULTIPLIERS)) {
        if (chapterNumber >= tier.range[0] && chapterNumber <= tier.range[1]) {
            return { multiplier: tier.multiplier, tier: tier.name };
        }
    }
    return { multiplier: 1.75, tier: "Maximum Reached" };
}

function calculateFeedbackCredits(feedbackType, chapterNumber = 1, qualityMultiplier = 1.0) {
    const baseCredits = FEEDBACK_TYPES[feedbackType].baseCredits;
    const { multiplier: chapterMultiplier } = calculateChapterMultiplier(chapterNumber);
    
    return Math.ceil(baseCredits * chapterMultiplier * qualityMultiplier);
}

async function getUserData(userId) {
    try {
        const userRecord = await global.db.db.get('SELECT * FROM users WHERE user_id = ?', [userId]);
        const purchaseRecords = await global.db.db.all('SELECT item FROM user_purchases WHERE user_id = ?', [userId]);
        const purchases = purchaseRecords ? purchaseRecords.map(p => p.item) : [];
        
        if (!userRecord) {
            return {
                totalFeedbackAllTime: 0,
                currentCredits: 0,
                chapterLeases: 0,
                purchases: [],
                bookshelfPosts: 0,
                qualityRatings: { total: 0, sum: 0, average: 2.0 },
                lastActive: Date.now(),
                joinDate: Date.now()
            };
        }
        
        return {
            totalFeedbackAllTime: userRecord.total_feedback_all_time || 0,
            currentCredits: userRecord.current_credits || 0,
            chapterLeases: userRecord.chapter_leases || 0,
            purchases: purchases,
            bookshelfPosts: userRecord.bookshelf_posts || 0,
            qualityRatings: userRecord.quality_ratings ? 
                JSON.parse(userRecord.quality_ratings) : { total: 0, sum: 0, average: 2.0 },
            lastActive: userRecord.last_active || Date.now(),
            joinDate: userRecord.join_date || Date.now()
        };
    } catch (error) {
        console.error('Error getting user data:', error);
        return {
            totalFeedbackAllTime: 0,
            currentCredits: 0,
            chapterLeases: 0,
            purchases: [],
            bookshelfPosts: 0,
            qualityRatings: { total: 0, sum: 0, average: 2.0 },
            lastActive: Date.now(),
            joinDate: Date.now()
        };
    }
}

async function updateUserData(userId, updates) {
    const fields = [];
    const values = [];
    
    if (updates.totalFeedbackAllTime !== undefined) {
        fields.push('total_feedback_all_time = ?');
        values.push(updates.totalFeedbackAllTime);
    }
    if (updates.currentCredits !== undefined) {
        fields.push('current_credits = ?');
        values.push(updates.currentCredits);
    }
    if (updates.chapterLeases !== undefined) {
        fields.push('chapter_leases = ?');
        values.push(updates.chapterLeases);
    }
    if (updates.bookshelfPosts !== undefined) {
        fields.push('bookshelf_posts = ?');
        values.push(updates.bookshelfPosts);
    }
    if (updates.qualityRatings !== undefined) {
        fields.push('quality_ratings = ?');
        values.push(JSON.stringify(updates.qualityRatings));
    }
    if (updates.lastActive !== undefined) {
        fields.push('last_active = ?');
        values.push(updates.lastActive);
    }
    if (updates.joinDate !== undefined) {
        fields.push('join_date = ?');
        values.push(updates.joinDate);
    }
    
    if (fields.length > 0) {
        values.push(userId);
        try {
            const result = await global.db.db.run(`UPDATE users SET ${fields.join(', ')} WHERE user_id = ?`, values);
            
            if (!result || result.changes === 0) {
                await global.db.db.run(`
                    INSERT INTO users (user_id, total_feedback_all_time, current_credits, chapter_leases, bookshelf_posts, quality_ratings, last_active, join_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    userId, 
                    updates.totalFeedbackAllTime || 0, 
                    updates.currentCredits || 0, 
                    updates.chapterLeases || 0,
                    updates.bookshelfPosts || 0,
                    JSON.stringify(updates.qualityRatings || { total: 0, sum: 0, average: 2.0 }),
                    updates.lastActive || Date.now(),
                    updates.joinDate || Date.now()
                ]);
            }
        } catch (error) {
            console.error('Error updating user data:', error);
        }
    }
}

async function getUserMonthlyFeedback(userId) {
    const monthKey = getCurrentMonthKey();
    try {
        const record = await global.db.db.get(
            'SELECT doc_feedback_count, comment_feedback_count FROM monthly_feedback WHERE user_id = ? AND month_key = ?',
            [userId, monthKey]
        );
        
        if (!record) {
            return { docs: 0, comments: 0 };
        }
        
        return {
            docs: record.doc_feedback_count || 0,
            comments: record.comment_feedback_count || 0
        };
    } catch (error) {
        return { docs: 0, comments: 0 };
    }
}

async function setUserMonthlyFeedback(userId, feedbackType, count) {
    const monthKey = getCurrentMonthKey();
    const field = feedbackType === 'document' ? 'doc_feedback_count' : 'comment_feedback_count';
    
    try {
        const existing = await global.db.db.get(
            'SELECT * FROM monthly_feedback WHERE user_id = ? AND month_key = ?',
            [userId, monthKey]
        );
        
        if (existing) {
            await global.db.db.run(
                `UPDATE monthly_feedback SET ${field} = ? WHERE user_id = ? AND month_key = ?`,
                [count, userId, monthKey]
            );
        } else {
            const docCount = feedbackType === 'document' ? count : 0;
            const commentCount = feedbackType === 'comment' ? count : 0;
            
            await global.db.db.run(
                'INSERT INTO monthly_feedback (user_id, month_key, doc_feedback_count, comment_feedback_count) VALUES (?, ?, ?, ?)',
                [userId, monthKey, docCount, commentCount]
            );
        }
    } catch (error) {
        console.error('Error setting monthly feedback:', error);
    }
}

function hasLevel5Role(member) {
    if (!member?.roles?.cache) return false;
    
    return member.roles.cache.some(role => {
        if (role.name === 'Level 5') return true;
        if (role.name.startsWith('Level ')) {
            const level = parseInt(role.name.split(' ')[1]);
            return level >= 5;
        }
        return false;
    });
}

function hasLevel15Role(member) {
    if (!member?.roles?.cache) return false;
    
    return member.roles.cache.some(role => {
        if (role.name.startsWith('Level ')) {
            const level = parseInt(role.name.split(' ')[1]);
            return level >= 15;
        }
        return false;
    });
}

function hasLevel35Role(member) {
    if (!member?.roles?.cache) return false;
    
    return member.roles.cache.some(role => {
        if (role.name.startsWith('Level ')) {
            const level = parseInt(role.name.split(' ')[1]);
            return level >= 35;
        }
        return false;
    });
}

function hasShelfRole(member) {
    if (!member?.roles?.cache) return false;
    return member.roles.cache.some(role => role.name === 'Shelf Owner');
}

function hasReaderRole(member) {
    if (!member?.roles?.cache) return false;
    return member.roles.cache.some(role => role.name === 'reader');
}

function canCreateBookshelfThread(member) {
    return hasShelfRole(member) && hasReaderRole(member);
}

function checkMonthlyRequirement(monthlyData) {
    const { docs, comments } = monthlyData;
    
    // Option 1: 2 doc feedbacks
    if (docs >= MONTHLY_REQUIREMENTS.docFeedbacks) return true;
    
    // Option 2: 6 comment feedbacks  
    if (comments >= MONTHLY_REQUIREMENTS.commentFeedbacks) return true;
    
    // Option 3: 1 doc + 3 comments
    if (docs >= MONTHLY_REQUIREMENTS.mixedOption.docs && 
        comments >= MONTHLY_REQUIREMENTS.mixedOption.comments) return true;
    
    return false;
}

async function addCredits(userId, amount) {
    const user = await getUserData(userId);
    const validAmount = Math.max(0, Math.floor(amount));
    const newCredits = user.currentCredits + validAmount;
    
    await updateUserData(userId, { 
        currentCredits: newCredits,
        lastActive: Date.now()
    });
    
    console.log(`Added ${validAmount} credits to ${userId}, new balance: ${newCredits}`);
    return newCredits;
}

async function spendCredits(userId, amount) {
    const user = await getUserData(userId);
    const validAmount = Math.max(0, Math.floor(amount));
    
    if (user.currentCredits >= validAmount) {
        const newCredits = user.currentCredits - validAmount;
        await updateUserData(userId, { 
            currentCredits: newCredits,
            lastActive: Date.now()
        });
        console.log(`Spent ${validAmount} credits for ${userId}, new balance: ${newCredits}`);
        return true;
    }
    
    console.log(`Insufficient credits for ${userId}: has ${user.currentCredits}, needs ${validAmount}`);
    return false;
}

async function addLeases(userId, amount) {
    const user = await getUserData(userId);
    const validAmount = Math.max(0, Math.floor(amount));
    const newLeases = user.chapterLeases + validAmount;
    
    await updateUserData(userId, { 
        chapterLeases: newLeases,
        lastActive: Date.now()
    });
    
    console.log(`Added ${validAmount} leases to ${userId}, new total: ${newLeases}`);
    return newLeases;
}

async function consumeLease(userId) {
    const user = await getUserData(userId);
    
    if (user.chapterLeases > 0) {
        const newLeases = user.chapterLeases - 1;
        const newBookshelfPosts = user.bookshelfPosts + 1;
        
        await updateUserData(userId, { 
            chapterLeases: newLeases,
            bookshelfPosts: newBookshelfPosts,
            lastActive: Date.now()
        });
        
        console.log(`User ${userId} consumed 1 lease. Remaining: ${newLeases}`);
        return true;
    }
    
    console.log(`No leases available for ${userId}`);
    return false;
}

async function closeUserBookshelfThreads(guild, userId) {
    try {
        const bookshelfForum = guild.channels.cache.find(channel => 
            channel.name === 'bookshelf' && channel.type === 15
        );
        
        if (!bookshelfForum) return 0;
        
        const threads = await bookshelfForum.threads.fetch();
        let closedCount = 0;
        
        for (const [threadId, thread] of threads.threads) {
            if (thread.ownerId === userId) {
                try {
                    await thread.setArchived(true);
                    await thread.setLocked(true);
                    closedCount++;
                    console.log(`🔒 Closed thread: ${thread.name}`);
                } catch (error) {
                    console.log(`Failed to close thread ${thread.name}:`, error.message);
                }
            }
        }
        
        return closedCount;
    } catch (error) {
        console.error('Error closing user threads:', error);
        return 0;
    }
}

async function removeUserRoles(member, guild) {
    const rolesToRemove = ['Shelf Owner'];
    
    // Also remove any color roles
    const colorRoleNames = Object.values(STORE_ITEMS)
        .filter(item => item.category === 'color')
        .map(item => item.name);
    
    rolesToRemove.push(...colorRoleNames);
    
    for (const roleName of rolesToRemove) {
        const role = guild.roles.cache.find(r => r.name === roleName);
        if (role && member.roles.cache.has(role.id)) {
            try {
                await member.roles.remove(role);
                console.log(`⚔️ Removed ${roleName} role from ${member.displayName}`);
            } catch (error) {
                console.log(`Failed to remove ${roleName} role:`, error.message);
            }
        }
    }
}

async function resetUserProgress(userId, guild) {
    console.log(`🗡️ Resetting all progress for user ${userId}`);
    
    // Clear user logged feedback
    await global.db.clearUserLoggedFeedback(userId);
    
    // Close user bookshelf threads
    const closedThreads = await closeUserBookshelfThreads(guild, userId);
    
    // Delete user entirely (cascades to all related data)
    await global.db.deleteUser(userId);
    
    console.log(`⚔️ User ${userId} progress completely reset - ${closedThreads} threads closed`);
    return closedThreads;
}

async function processFeedbackContribution(userId, feedbackType, chapterNumber = 1) {
    const monthlyData = await getUserMonthlyFeedback(userId);
    const user = await getUserData(userId);
    
    // Update monthly count
    const newCount = monthlyData[feedbackType === 'document' ? 'docs' : 'comments'] + 1;
    await setUserMonthlyFeedback(userId, feedbackType, newCount);
    
    // Calculate credits with quality multiplier
    const qualityMultiplier = user.qualityRatings.total > 0 ? 
        QUALITY_MULTIPLIERS[Math.round(user.qualityRatings.average)].multiplier : 1.0;
    
    const credits = calculateFeedbackCredits(feedbackType, chapterNumber, qualityMultiplier);
    await addCredits(userId, credits);
    
    // Update total feedback count
    await updateUserData(userId, {
        totalFeedbackAllTime: user.totalFeedbackAllTime + 1,
        lastActive: Date.now()
    });
    
    const updatedMonthlyData = await getUserMonthlyFeedback(userId);
    
    return {
        credits,
        feedbackType,
        chapterNumber,
        monthlyData: updatedMonthlyData,
        totalAllTime: user.totalFeedbackAllTime + 1,
        requirementMet: checkMonthlyRequirement(updatedMonthlyData),
        qualityMultiplier
    };
}

// ===== CHANNEL MENTION HELPER FUNCTIONS =====
function getChannelMention(guild, channelName) {
    const channel = guild.channels.cache.find(ch => ch.name === channelName);
    return channel ? `<#${channel.id}>` : `#${channelName}`;
}

function getClickableChannelMentions(guild) {
    return {
        bookshelfFeedback: getChannelMention(guild, 'bookshelf-feedback'),
        bookshelfDiscussion: getChannelMention(guild, 'bookshelf-discussion'),
        bookshelf: getChannelMention(guild, 'bookshelf'),
        rulesChannel: getChannelMention(guild, '📜╠rules'),
        serverGuideChannel: getChannelMention(guild, '🗺╠server-guide'),
        botStuff: getChannelMention(guild, '🐤╠bot-stuff'),
        reactionRoles: getChannelMention(guild, '👑╠reaction-roles'),
        completeDrafts: getChannelMention(guild, 'complete-drafts'),
        readForReadFinder: getChannelMention(guild, 'read-for-read-finder')
    };
}

function getRoleMention(guild, roleName) {
    const role = guild.roles.cache.find(r => r.name === roleName);
    return role ? `<@&${role.id}>` : `**${roleName}**`;
}

function getClickableRoleMentions(guild) {
    return {
        shelfOwner: getRoleMention(guild, 'Shelf Owner'),
        reader: getRoleMention(guild, 'reader'),
        level5: getRoleMention(guild, 'Level 5')
    };
}

// ===== FEEDBACK PROCESSING =====
function isInAllowedFeedbackThread(channel) {
    if (channel.isThread() && channel.parent) {
        return ALLOWED_FEEDBACK_THREADS.includes(channel.parent.name);
    }
    return ALLOWED_FEEDBACK_THREADS.includes(channel.name);
}

function hasStaffPermissions(member) {
    return member?.permissions?.has(PermissionFlagsBits.ManageMessages);
}

async function hasUserLoggedFeedbackForMessage(messageId, userId) {
    try {
        const result = await global.db.db.get('SELECT 1 FROM logged_feedback WHERE message_id = ? AND user_id = ?', [messageId, userId]);
        return !!result;
    } catch (error) {
        return false;
    }
}

async function logFeedbackForMessage(messageId, userId, feedbackType, chapterNumber, credits) {
    try {
        await global.db.db.run(
            'INSERT OR REPLACE INTO logged_feedback (message_id, user_id, feedback_type, chapter_number, credits_earned, logged_at) VALUES (?, ?, ?, ?, ?, ?)',
            [messageId, userId, feedbackType, chapterNumber, credits, Date.now()]
        );
    } catch (error) {
        console.error('Error logging feedback:', error);
    }
}

async function findUserLatestMessage(channel, userId) {
    try {
        const messages = await channel.messages.fetch({ limit: 50 });
        const userMessages = messages.filter(msg => 
            msg.author.id === userId && 
            !msg.author.bot && 
            !msg.content.startsWith('/') && 
            !msg.content.startsWith('!')
        );
        return userMessages.size > 0 ? userMessages.first() : null;
    } catch (error) {
        console.error('Error fetching user messages:', error);
        return null;
    }
}

// ===== QUALITY RATING SYSTEM =====
async function addQualityRating(ratedUserId, rating, raterId, messageId) {
    try {
        // Check if this rater has already rated this specific feedback
        const existing = await global.db.db.get(
            'SELECT 1 FROM quality_ratings WHERE rated_user_id = ? AND rater_id = ? AND feedback_message_id = ?',
            [ratedUserId, raterId, messageId]
        );
        
        if (existing) {
            return { success: false, reason: 'already_rated' };
        }
        
        // Add the rating
        await global.db.db.run(
            'INSERT INTO quality_ratings (rated_user_id, rater_id, rating, feedback_message_id, created_at) VALUES (?, ?, ?, ?, ?)',
            [ratedUserId, raterId, rating, messageId, Date.now()]
        );
        
        // Update user's quality average
        const ratings = await global.db.db.all(
            'SELECT rating FROM quality_ratings WHERE rated_user_id = ?',
            [ratedUserId]
        );
        
        const total = ratings.length;
        const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
        const average = total > 0 ? sum / total : 2.0;
        
        const user = await getUserData(ratedUserId);
        await updateUserData(ratedUserId, {
            qualityRatings: { total, sum, average }
        });
        
        return { success: true, newAverage: average, totalRatings: total };
    } catch (error) {
        console.error('Error adding quality rating:', error);
        return { success: false, reason: 'database_error' };
    }
}

// ===== ACCESS CONTROL FUNCTIONS =====
async function getBookshelfAccessStatus(userId, member = null, guild = null) {
    const user = await getUserData(userId);
    const roles = guild ? getClickableRoleMentions(guild) : { reader: '**reader**', shelfOwner: '**Shelf Owner**' };
    
    if (user.purchases.includes('shelf')) {
        if (member && hasReaderRole(member)) {
            return '✅ Full access granted';
        } else {
            return `✅ ${roles.shelfOwner} role acquired - ${roles.reader} role needed from staff`;
        }
    } else if (user.totalFeedbackAllTime < ACCESS_REQUIREMENTS.bookshelf.feedbackRequired) {
        const needed = ACCESS_REQUIREMENTS.bookshelf.feedbackRequired - user.totalFeedbackAllTime;
        return `📝 Need ${needed} more feedback to qualify for purchase`;
    } else if (user.currentCredits < ACCESS_REQUIREMENTS.bookshelf.credits) {
        const needed = ACCESS_REQUIREMENTS.bookshelf.credits - user.currentCredits;
        return `💰 Need ${needed} more credits to purchase (${user.currentCredits}/${ACCESS_REQUIREMENTS.bookshelf.credits})`;
    } else {
        return '💰 Ready to purchase shelf access!';
    }
}

async function getReadForReadAccess(userId) {
    const user = await getUserData(userId);
    
    if (user.totalFeedbackAllTime >= ACCESS_REQUIREMENTS.readForRead.totalFeedback) {
        return '✅ Access granted to read-for-read finder';
    } else {
        const needed = ACCESS_REQUIREMENTS.readForRead.totalFeedback - user.totalFeedbackAllTime;
        return `📝 Need ${needed} more all-time feedback contributions`;
    }
}

async function getCompleteDraftsAccess(userId, member) {
    const user = await getUserData(userId);
    
    const hasLevel = hasLevel35Role(member);
    const hasFeedback = user.totalFeedbackAllTime >= ACCESS_REQUIREMENTS.completeDrafts.totalFeedback;
    
    if (hasLevel && hasFeedback) {
        return '✅ Access granted to complete drafts forum';
    } else {
        let missing = [];
        if (!hasLevel) missing.push('Level 35');
        if (!hasFeedback) {
            const needed = ACCESS_REQUIREMENTS.completeDrafts.totalFeedback - user.totalFeedbackAllTime;
            missing.push(`${needed} more feedback`);
        }
        return `❌ Need: ${missing.join(', ')}`;
    }
}

// ===== PARDON SYSTEM =====
async function isUserPardoned(userId) {
    try {
        const monthKey = getCurrentMonthKey();
        return await global.db.isUserPardoned(userId, monthKey);
    } catch (error) {
        return false;
    }
}

async function pardonUser(userId, reason = 'staff_discretion') {
    const monthKey = getCurrentMonthKey();
    try {
        await global.db.pardonUser(userId, monthKey, reason);
        console.log(`Pardoned user ${userId} for reason: ${reason}`);
    } catch (error) {
        console.error('Error pardoning user:', error);
    }
}

// ===== TEMPORARY MESSAGE FUNCTIONS =====
async function replyTemporary(interaction, messageOptions, delay = MESSAGE_DELETE_TIMEOUT) {
    try {
        const message = await interaction.reply(messageOptions);
        console.log(`Sent temporary interaction reply, will delete in ${delay}ms`);
        setTimeout(async () => {
            try { 
                await interaction.deleteReply(); 
                console.log('Successfully deleted temporary interaction reply');
            } catch (error) { 
                console.log('Failed to delete interaction reply:', error.message); 
            }
        }, delay);
        return message;
    } catch (error) {
        console.error('Failed to send temporary reply:', error);
        return null;
    }
}

async function sendTemporaryChannelMessage(channel, content, delay = MESSAGE_DELETE_TIMEOUT) {
    try {
        const message = await channel.send(content);
        console.log(`Sent temporary channel message, will delete in ${delay}ms`);
        setTimeout(async () => {
            try { 
                await message.delete(); 
                console.log('Successfully deleted temporary channel message');
            } catch (error) { 
                console.log('Failed to delete channel message:', error.message); 
            }
        }, delay);
        return message;
    } catch (error) {
        console.error('Failed to send temporary channel message:', error);
        return null;
    }
}

// ===== WELCOME SYSTEM =====
class WelcomeSystem {
    constructor(client) {
        this.client = client;
        this.logger = console;
    }

    init() {
        this.client.on('guildMemberAdd', this.handleMemberJoin.bind(this));
        this.logger.log('✅ Enhanced welcome system initialized');
    }

    async handleMemberJoin(member) {
        this.logger.log(`👋 Member joined: ${member.displayName} (${member.id}) in ${member.guild.name}`);
        
        try {
            await updateUserData(member.id, {
                joinDate: Date.now(),
                lastActive: Date.now()
            });
            
            await this.sendWelcomeMessage(member);
        } catch (error) {
            this.logger.error(`❌ Welcome system error for ${member.displayName}:`, error);
        }
    }

    findWelcomeChannel(guild) {
        for (const channelName of WELCOME_CONFIG.channelNames) {
            const channel = guild.channels.cache.find(ch => 
                ch.name === channelName && ch.isTextBased()
            );
            if (channel) {
                this.logger.log(`✅ Found welcome channel: #${channel.name} (exact match)`);
                return channel;
            }
        }
        return null;
    }

    createWelcomeEmbed(member) {
        const { guild } = member;
        const config = WELCOME_CONFIG.embed;
        
        const channels = getClickableChannelMentions(guild);

        const embed = new EmbedBuilder()
            .setTitle('A New Scribe Joins Our Literary Halls ☝️')
            .setDescription(`Welcome, **${member.displayName}**. Another soul seeks to join our distinguished gathering of writers and critics. Please study our ${channels.rulesChannel} and ${channels.serverGuideChannel}, then use ${channels.botStuff} and trigger the \`/help\` command for further guidance.`)
            .setColor(config.color);

        if (config.thumbnail) {
            embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true }));
        }

        if (config.timestamp) {
            embed.setTimestamp();
        }

        if (config.footer) {
            embed.setFooter({
                text: `Member #${guild.memberCount} • Welcome to Type&Draft`,
                iconURL: guild.iconURL({ dynamic: true })
            });
        }

        return embed;
    }

    async sendWelcomeMessage(member) {
        const channel = this.findWelcomeChannel(member.guild);
        
        if (!channel) {
            console.log('No suitable welcome channel found');
            return;
        }

        const embed = this.createWelcomeEmbed(member);
        
        try {
            const message = await channel.send({ embeds: [embed] });
            this.logger.log(`✅ Welcome message sent for ${member.displayName} in #${channel.name}`);
            return message;
        } catch (error) {
            this.logger.error(`❌ Failed to send welcome message in #${channel.name}:`, error);
        }
    }
}

const welcomeSystem = new WelcomeSystem(client);

// ===== COMMANDS SETUP =====
const commands = [
    new SlashCommandBuilder()
        .setName('feedback')
        .setDescription('Log your most recent feedback contribution')
        .addStringOption(option => 
            option.setName('type')
                .setDescription('Type of feedback provided')
                .setRequired(true)
                .addChoices(
                    { name: '💬 Inline Comments (1 credit base)', value: 'comment' },
                    { name: '📄 Document Feedback (3 credits base)', value: 'document' }
                ))
        .addIntegerOption(option =>
            option.setName('chapter')
                .setDescription('Which chapter did you review? (affects multiplier)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(99)),
    
    new SlashCommandBuilder()
        .setName('rate_feedback')
        .setDescription('Rate the quality of someone\'s feedback (Level 5+ only)')
        .addUserOption(option => option.setName('user').setDescription('User who gave feedback').setRequired(true))
        .addIntegerOption(option =>
            option.setName('rating')
                .setDescription('Quality rating (1-4)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(4)),
    
    new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your credits, feedback stats, monthly progress, and access status')
        .addUserOption(option => option.setName('user').setDescription('User to check (optional)').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('store')
        .setDescription('Browse the Type&Draft marketplace'),
    
    new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Purchase items from the store')
        .addStringOption(option => 
            option.setName('item')
                .setDescription('Item to purchase')
                .setRequired(true)
                .addChoices(
                    { name: '📚 Bookshelf Access (15 credits)', value: 'shelf' },
                    { name: '📝 Chapter Lease (3 credits)', value: 'lease' },
                    { name: '🤎 Mocha Mousse (12 credits)', value: 'mocha_mousse' },
                    { name: '🍑 Peach Fuzz (12 credits)', value: 'peach_fuzz' },
                    { name: '🔮 Magenta (12 credits)', value: 'magenta' },
                    { name: '💜 Very Peri (12 credits)', value: 'very_peri' }
                ))
        .addIntegerOption(option => 
            option.setName('quantity')
                .setDescription('Quantity to purchase (leases only)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(20)),
    
    new SlashCommandBuilder()
        .setName('hall_of_fame')
        .setDescription('View the most distinguished contributors')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Hall of Fame type')
                .setRequired(false)
                .addChoices(
                    { name: '🏆 Monthly Champions', value: 'monthly' },
                    { name: '👑 All-Time Legends', value: 'alltime' },
                    { name: '⭐ Quality Masters', value: 'quality' }
                )),
    
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Display the comprehensive guide to our feedback system'),
    
    // Staff commands
    new SlashCommandBuilder()
        .setName('feedback_add')
        .setDescription('Add feedback count to a member (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to add feedback to').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Amount to add (default: 1)').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('feedback_remove')
        .setDescription('Remove feedback count from a member (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to remove feedback from').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Amount to remove (default: 1)').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('credit_add')
        .setDescription('Add credits to a member\'s balance (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to add credits to').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Amount to add (default: 1)').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('credit_remove')
        .setDescription('Remove credits from a member\'s balance (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to remove credits from').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Amount to remove (default: 1)').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('lease_add')
        .setDescription('Add chapter leases to a member (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to add leases to').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Amount to add (default: 1)').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('setup_bookshelf')
        .setDescription('Grant bookshelf access to a member (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('Member to grant access to').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View detailed server statistics (Staff only)'),
    
    new SlashCommandBuilder()
        .setName('pardon')
        .setDescription('Pardon a member from monthly requirements (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('Member to pardon').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('unpardon')
        .setDescription('Remove pardon from a member (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('Member to remove pardon from').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('pardoned_last_month')
        .setDescription('View members pardoned last month (Staff only)'),
    
    new SlashCommandBuilder()
        .setName('purge_list')
        .setDescription('View members who would be purged (Staff only)'),
    
    new SlashCommandBuilder()
        .setName('post_guide')
        .setDescription('Post the server guide (Staff only)')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Guide type')
                .setRequired(true)
                .addChoices(
                    { name: 'Server Navigation', value: 'navigation' },
                    { name: 'Rules', value: 'rules' },
                    { name: 'Feedback System', value: 'feedback' }
                )),

    new SlashCommandBuilder()
    .setName('user_reset')
    .setDescription('Completely reset a member\'s progress (Staff only)')
    .addUserOption(option => option.setName('user').setDescription('User to reset completely').setRequired(true)),

    new SlashCommandBuilder()
    .setName('post_rules')
    .setDescription('Post the server rules (Staff only)'),
];

async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT2_TOKEN);
        console.log('Started refreshing enhanced feedback system commands.');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully reloaded enhanced feedback system commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// ===== BOT EVENTS =====
client.once('ready', async () => {
    console.log(`${client.user.tag} is online and serving the enhanced Type&Draft realm!`);
    
    try {
        const db = new DatabaseManager();
        await db.initialize();
        
        const connectionTest = await db.testConnection();
        if (!connectionTest) {
            throw new Error('Database connection test failed');
        }
        console.log('✅ Enhanced database connection verified');
        
        global.db = db;
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        process.exit(1);
    }
    
    await registerCommands();
    welcomeSystem.init();
    
    // Force fetch members for all guilds
    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.members.fetch();
            await guild.roles.fetch();
            console.log(`Fetched ${guild.members.cache.size} members and ${guild.roles.cache.size} roles for ${guild.name}`);
        } catch (error) {
            console.error(`Failed to fetch data for ${guild.name}:`, error);
        }
    }
    
    console.log('🎭 Enhanced Type&Draft bot fully initialized!');
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // BOOKSHELF THREAD HANDLING
    if (message.channel.isThread() && message.channel.parent && message.channel.parent.name === 'bookshelf') {
        
        // Only thread owners can post
        if (message.channel.ownerId !== message.author.id) {
            await message.delete();
            await sendTemporaryChannelMessage(message.channel, 
                `Apologies, **${message.author.displayName}**, but only the thread creator may post here. ☝️`,
                8000
            );
            return;
        }
        
        // Check lease requirements
        try {
            const messages = await message.channel.messages.fetch({ limit: 50 });
            const ownerMessages = messages.filter(msg => 
                msg.author.id === message.channel.ownerId && 
                msg.id !== message.id
            );
            
            const isFirstPost = ownerMessages.size === 0;
            const userRecord = await getUserData(message.author.id);
            
            if (isFirstPost) {
                await sendTemporaryChannelMessage(message.channel, 
                    `📝 Welcome to your bookshelf! First chapter is complimentary. **${userRecord.chapterLeases}** leases remaining. ☝️`, 
                    8000
                );
            } else {
                if (userRecord.chapterLeases <= 0) {
                    await message.delete();
                    await sendTemporaryChannelMessage(message.channel, 
                        `📝 **${message.author.displayName}**, you need chapter leases to post! Purchase with \`/buy lease\`. ☝️`,
                        8000
                    );
                    return;
                }
                
                await consumeLease(message.author.id);
                const updatedRecord = await getUserData(message.author.id);
                
                await sendTemporaryChannelMessage(message.channel, 
                    `📝 Chapter posted! **${updatedRecord.chapterLeases}** leases remaining. ☝️`, 
                    8000
                );
            }
            
        } catch (error) {
            console.error('Error in bookshelf message handling:', error);
        }
        
        return;
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    console.log(`🎯 Command received: /${interaction.commandName} from ${interaction.user.displayName}`);

    try {
        await handleSlashCommand(interaction);
    } catch (error) {
        console.error(`❌ Command /${interaction.commandName} failed:`, error);
        await handleInteractionError(interaction, error);
    }
});

// ===== COMMAND HANDLERS =====
async function handleSlashCommand(interaction) {
    const commandHandlers = {
        feedback: () => handleFeedbackCommand(interaction),
        rate_feedback: () => handleRateFeedbackCommand(interaction),
        balance: () => handleBalanceCommand(interaction),
        store: () => handleStoreCommand(interaction),
        buy: () => handleBuyCommand(interaction),
        hall_of_fame: () => handleHallOfFameCommand(interaction),
        help: () => handleHelpCommand(interaction),
        
        // Staff commands
        feedback_add: () => handleFeedbackAddCommand(interaction),
        feedback_remove: () => handleFeedbackRemoveCommand(interaction),
        credit_add: () => handleCreditAddCommand(interaction),
        credit_remove: () => handleCreditRemoveCommand(interaction),
        lease_add: () => handleLeaseAddCommand(interaction),
        setup_bookshelf: () => handleSetupBookshelfCommand(interaction),
        user_reset: () => handleUserResetCommand(interaction), // ADD THIS
        stats: () => handleStatsCommand(interaction),
        pardon: () => handlePardonCommand(interaction),
        unpardon: () => handleUnpardonCommand(interaction),
        pardoned_last_month: () => handlePardonedLastMonthCommand(interaction),
        purge_list: () => handlePurgeListCommand(interaction),
        post_guide: () => handlePostGuideCommand(interaction),
        post_rules: () => handlePostRulesCommand(interaction) // ADD THIS
    };
    
    const handler = commandHandlers[interaction.commandName];
    if (handler) {
        await handler();
    }
}

async function handleFeedbackCommand(interaction) {
    const feedbackType = interaction.options.getString('type');
    const chapterNumber = interaction.options.getInteger('chapter');
    
    // Check Level 5 requirement
    if (!hasLevel5Role(interaction.member)) {
        const embed = new EmbedBuilder()
            .setTitle('Level 5 Required ☝️')
            .setDescription('You must attain **Level 5** standing before logging feedback contributions.')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Check if in correct location
    if (!isInAllowedFeedbackThread(interaction.channel)) {
        const channels = getClickableChannelMentions(interaction.guild);
        const embed = new EmbedBuilder()
            .setTitle('Wrong Location ☝️')
            .addFields({
                name: 'Permitted Halls',
                value: `• ${channels.bookshelfFeedback} forum\n• ${channels.bookshelfDiscussion} forum`,
                inline: false
            })
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Check if thread owner trying to log own thread
    if (interaction.channel.isThread() && interaction.channel.ownerId === interaction.user.id) {
        const embed = new EmbedBuilder()
            .setTitle('Cannot Log Own Thread ☝️')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Find recent message
    const latestMessage = await findUserLatestMessage(interaction.channel, interaction.user.id);
    
    if (!latestMessage) {
        const embed = new EmbedBuilder()
            .setTitle('No Recent Message Found ☝️')
            .setDescription('You must post your feedback before using this command.')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Check if already logged
    if (await hasUserLoggedFeedbackForMessage(latestMessage.id, interaction.user.id)) {
        const embed = new EmbedBuilder()
            .setTitle('Already Logged ☝️')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Process feedback
    const feedbackData = await processFeedbackContribution(
        interaction.user.id, 
        feedbackType, 
        chapterNumber
    );
    
    // Log it
    await logFeedbackForMessage(
        latestMessage.id, 
        interaction.user.id, 
        feedbackType, 
        chapterNumber, 
        feedbackData.credits
    );
    
    // Create response
    const feedbackTypeData = FEEDBACK_TYPES[feedbackType];
    const { multiplier: chapterMultiplier, tier } = calculateChapterMultiplier(chapterNumber);
    
    const embed = new EmbedBuilder()
        .setTitle('Feedback Contribution Recorded ☝️')
        .addFields(
            { 
                name: 'Details', 
                value: `${feedbackTypeData.emoji} ${feedbackTypeData.name}\n📃 Chapter ${chapterNumber} (${tier})`, 
                inline: true 
            },
            { 
                name: 'Credits Earned', 
                value: `${feedbackTypeData.baseCredits} × ${chapterMultiplier} × ${feedbackData.qualityMultiplier.toFixed(1)} = **${feedbackData.credits}**`, 
                inline: true 
            },
            {
                name: 'Monthly Progress',
                value: `📄 Docs: ${feedbackData.monthlyData.docs}\n💬 Comments: ${feedbackData.monthlyData.comments}\n${feedbackData.requirementMet ? '✅' : '❌'} Requirement: ${feedbackData.requirementMet ? 'Met' : 'Not Met'}`,
                inline: true
            }
        )
        .setColor(feedbackData.requirementMet ? 0x00AA55 : 0x5865F2);
    
    await replyTemporary(interaction, { embeds: [embed] }, 8000);
}

async function handleRateFeedbackCommand(interaction) {
    if (!hasLevel5Role(interaction.member)) {
        const embed = new EmbedBuilder()
            .setTitle('Level 5 Required ☝️')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    const targetUser = interaction.options.getUser('user');
    const rating = interaction.options.getInteger('rating');
    
    // Find a recent message from the target user in this channel
    const targetMessage = await findUserLatestMessage(interaction.channel, targetUser.id);
    
    if (!targetMessage) {
        const embed = new EmbedBuilder()
            .setTitle('No Recent Feedback Found ☝️')
            .setDescription(`Cannot find recent feedback from ${targetUser.displayName} in this thread.`)
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    const result = await addQualityRating(targetUser.id, rating, interaction.user.id, targetMessage.id);
    
    if (!result.success) {
        let message = 'Failed to add rating.';
        if (result.reason === 'already_rated') {
            message = 'You have already rated this user\'s feedback.';
        }
        
        const embed = new EmbedBuilder()
            .setTitle('Rating Failed ☝️')
            .setDescription(message)
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    const qualityData = QUALITY_MULTIPLIERS[rating];
    
    const embed = new EmbedBuilder()
        .setTitle('Quality Rating Recorded ☝️')
        .addFields(
            { 
                name: 'Rating Given', 
                value: `${qualityData.emoji} ${qualityData.name} (${rating}/4)`, 
                inline: true 
            },
            { 
                name: 'New Average', 
                value: `${result.newAverage.toFixed(2)}/4.0 (${result.totalRatings} ratings)`, 
                inline: true 
            }
        )
        .setColor(0x00AA55);
    
    await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
}

async function handleBalanceCommand(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const targetMember = interaction.options.getMember('user') || interaction.member;
    
    const user = await getUserData(targetUser.id);
    const monthlyData = await getUserMonthlyFeedback(targetUser.id);
    const quotaStatus = checkMonthlyRequirement(monthlyData);
    
    // Access status checks
    const bookshelfStatus = await getBookshelfAccessStatus(targetUser.id, targetMember, interaction.guild);
    const readForReadStatus = await getReadForReadAccess(targetUser.id);
    const completeDraftsStatus = await getCompleteDraftsAccess(targetUser.id, targetMember);
    
    const embed = new EmbedBuilder()
        .setTitle(`⚔️ ${targetUser.displayName}'s Literary Standing ☝️`)
        .addFields(
            { name: '💰 Current Credits', value: `${user.currentCredits}`, inline: true },
            { name: '📝 Chapter Leases', value: `${user.chapterLeases}`, inline: true },
            { name: '📊 Total Feedback', value: `${user.totalFeedbackAllTime}`, inline: true },
            { name: '⭐ Quality Average', value: `${user.qualityRatings.average.toFixed(2)}/4.0`, inline: true },
            { name: '🗡️ Monthly Progress', value: `📄 ${monthlyData.docs} docs • 💬 ${monthlyData.comments} comments`, inline: true },
            { name: '👑 Monthly Quota', value: `${quotaStatus ? '✅ Fulfilled' : '❌ Unfulfilled'}`, inline: true },
            { name: '📚 Bookshelf Access', value: bookshelfStatus, inline: false },
            { name: '🔍 Read-for-Read Access', value: readForReadStatus, inline: true },
            { name: '📖 Complete Drafts Access', value: completeDraftsStatus, inline: true }
        )
        .setDescription(`**Monthly Requirements (Choose One):**\n⚔️ 2 document feedbacks\n🛡️ 6 comment feedbacks\n🗡️ 1 document + 3 comments`)
        .setColor(quotaStatus ? 0x00AA55 : 0xFF9900);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleMonthlyCommand(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const monthlyData = await getUserMonthlyFeedback(targetUser.id);
    const quotaStatus = checkMonthlyRequirement(monthlyData);
    
    const embed = new EmbedBuilder()
        .setTitle(`Monthly Progress - ${targetUser.displayName} ☝️`)
        .addFields(
            { name: 'Document Feedback', value: `📄 ${monthlyData.docs}`, inline: true },
            { name: 'Comment Feedback', value: `💬 ${monthlyData.comments}`, inline: true },
            { name: 'Requirement Status', value: quotaStatus ? '✅ Met' : '❌ Not Met', inline: true }
        )
        .setDescription(`**Monthly Options:**\n• 2 document feedbacks\n• 6 comment feedbacks\n• 1 document + 3 comments`)
        .setColor(quotaStatus ? 0x00AA55 : 0xFF9900);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleStoreCommand(interaction) {
    const channels = getClickableChannelMentions(interaction.guild);
    
    const embed = new EmbedBuilder()
        .setTitle('Type&Draft Literary Marketplace ☝️')
        .addFields(
            { 
                name: '📚 Bookshelf Access (15 credits)', // CHANGED: From 18 to 15
                value: `Create threads in ${channels.bookshelf}. Requires Level 5 + 2 total feedback.`, 
                inline: false 
            },
            { 
                name: '📝 Chapter Lease (3 credits)', 
                value: 'Post one chapter in your bookshelf thread. First chapter always free!', 
                inline: false 
            },
            // REMOVED: Premium Services section
            { 
                name: '🎨 Color Roles (Level 15, 12 credits)', 
                value: '🤎 Mocha Mousse • 🍑 Peach Fuzz • 🔮 Magenta • 💜 Very Peri', 
                inline: false 
            },
            {
                name: '💡 Credit System',
                value: '💬 **Comment Feedback:** 1 credit base\n📄 **Document Feedback:** 3 credits base\n📈 **Chapter Multipliers:** 1.0x → 1.75x\n⭐ **Quality Ratings:** Boost future earnings',
                inline: false
            }
        )
        .setColor(0xFF8C00);
        
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleBuyCommand(interaction) {
    const itemKey = interaction.options.getString('item');
    const quantity = interaction.options.getInteger('quantity') || 1;
    const item = STORE_ITEMS[itemKey];
    const user = await getUserData(interaction.user.id);
    
    // Validate purchase
    const finalQuantity = item.allowQuantity ? quantity : 1;
    const totalPrice = item.price * finalQuantity;
    
    // Check level requirements
    if (item.levelRequired && !hasLevel15Role(interaction.member)) {
        const embed = new EmbedBuilder()
            .setTitle(`Level ${item.levelRequired} Required ☝️`)
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Check special requirements for bookshelf
    if (itemKey === 'shelf') {
        if (!hasLevel5Role(interaction.member)) {
            const embed = new EmbedBuilder()
                .setTitle('Level 5 Required ☝️')
                .setColor(0xFF9900);
            
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        }
        
        if (user.totalFeedbackAllTime < ACCESS_REQUIREMENTS.bookshelf.feedbackRequired) {
            const needed = ACCESS_REQUIREMENTS.bookshelf.feedbackRequired - user.totalFeedbackAllTime;
            const embed = new EmbedBuilder()
                .setTitle('Insufficient Feedback History ☝️')
                .setDescription(`Bookshelf requires ${ACCESS_REQUIREMENTS.bookshelf.feedbackRequired} total feedback contributions. You need ${needed} more.`)
                .setColor(0xFF9900);
            
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        }
        
        if (user.purchases.includes('shelf')) {
            const embed = new EmbedBuilder()
                .setTitle('Already Purchased ☝️')
                .setColor(0xFF9900);
            
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        }
    }
    
    // Check credits
    if (user.currentCredits < totalPrice) {
        const needed = totalPrice - user.currentCredits;
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Credits ☝️')
            .addFields({
                name: 'Required', value: `${totalPrice} credits`, inline: true
            }, {
                name: 'Current', value: `${user.currentCredits} credits`, inline: true
            }, {
                name: 'Needed', value: `${needed} more credits`, inline: true
            })
            .setColor(0xFF6B6B);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Process purchase
    if (await spendCredits(interaction.user.id, totalPrice)) {
        if (itemKey === 'lease') {
            await addLeases(interaction.user.id, finalQuantity);
        } else if (!item.consumable) {
            const updatedUser = await getUserData(interaction.user.id);
            const newPurchases = [...updatedUser.purchases, itemKey];
            await updateUserData(interaction.user.id, { purchases: newPurchases });
            await global.db.db.run('INSERT OR REPLACE INTO user_purchases (user_id, item) VALUES (?, ?)', [interaction.user.id, itemKey]);
            
            // Assign role if needed
            if (item.role) {
                await assignRole(interaction.member, interaction.guild, item.role);
            }
            
            // Handle color roles
            if (item.category === 'color') {
                await assignColorRole(interaction.member, interaction.guild, itemKey);
            }
        }
        
        const embed = new EmbedBuilder()
            .setTitle('Purchase Successful ☝️')
            .addFields(
                { name: 'Item', value: `${item.emoji} ${item.name}${finalQuantity > 1 ? ` x${finalQuantity}` : ''}`, inline: true },
                { name: 'Price', value: `💰 ${totalPrice} credits`, inline: true }
            )
            .setColor(0x00AA55);
        
        if (itemKey === 'shelf') {
            embed.addFields({
                name: 'Next Steps',
                value: 'Staff will review and assign the **reader** role based on your feedback quality. Then you can create bookshelf threads!',
                inline: false
            });
        }
        
        await replyTemporary(interaction, { embeds: [embed] });
    }
}

async function assignRole(member, guild, roleName) {
    let role = guild.roles.cache.find(r => r.name === roleName);
    
    if (!role) {
        try {
            role = await guild.roles.create({
                name: roleName,
                color: 0x8B4513,
                reason: `Store purchase role`
            });
        } catch (error) {
            console.log(`Failed to create role ${roleName}:`, error.message);
            return;
        }
    }
    
    try {
        await member.roles.add(role);
        console.log(`Added ${roleName} role to ${member.displayName}`);
    } catch (error) {
        console.log(`Failed to add ${roleName} role:`, error.message);
    }
}

async function assignColorRole(member, guild, itemKey) {
    const item = STORE_ITEMS[itemKey];
    
    // Remove existing color roles
    const existingColorRoles = member.roles.cache.filter(role => 
        Object.values(STORE_ITEMS).some(storeItem => 
            storeItem.category === 'color' && storeItem.name === role.name
        )
    );
    
    for (const role of existingColorRoles.values()) {
        try {
            await member.roles.remove(role);
        } catch (error) {
            console.log(`Failed to remove color role:`, error.message);
        }
    }
    
    // Create/assign new color role
    let colorRole = guild.roles.cache.find(r => r.name === item.name);
    if (!colorRole) {
        try {
            colorRole = await guild.roles.create({
                name: item.name,
                color: item.color,
                reason: `Color role purchase: ${item.name}`
            });
        } catch (error) {
            console.log(`Failed to create color role:`, error.message);
            return;
        }
    }
    
    try {
        await member.roles.add(colorRole);
        console.log(`Added ${item.name} color role to ${member.displayName}`);
    } catch (error) {
        console.log(`Failed to add color role:`, error.message);
    }
}

async function handleAccessCommand(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const targetMember = interaction.options.getMember('user') || interaction.member;
    
    const bookshelfStatus = await getBookshelfAccessStatus(targetUser.id, targetMember, interaction.guild);
    const readForReadStatus = await getReadForReadAccess(targetUser.id);
    const completeDraftsStatus = await getCompleteDraftsAccess(targetUser.id, targetMember);
    
    const channels = getClickableChannelMentions(interaction.guild);
    
    const embed = new EmbedBuilder()
        .setTitle(`Access Status - ${targetUser.displayName} ☝️`)
        .addFields(
            { name: `📚 ${channels.bookshelf}`, value: bookshelfStatus, inline: false },
            { name: `🔍 ${channels.readForReadFinder}`, value: readForReadStatus, inline: false },
            { name: `📖 ${channels.completeDrafts}`, value: completeDraftsStatus, inline: false }
        )
        .setColor(0x5865F2);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleHelpCommand(interaction) {
    const channels = getClickableChannelMentions(interaction.guild);
    
    const embed = new EmbedBuilder()
        .setTitle('Type&Draft Feedback System Guide ☝️')
        .addFields(
            { 
                name: '📝 Two-Tier Feedback System', 
                value: `**💬 Comment Feedback (1 credit):** Inline comments within Google Docs\n**📄 Document Feedback (3 credits):** Comprehensive feedback in separate document\n\n*Document feedback requires reading all previous chapters!*`, 
                inline: false 
            },
            { 
                name: '📈 Chapter Multipliers', 
                value: `**Early** (Ch 1-2): 1.0x\n**Developing** (Ch 3-5): 1.25x\n**Established** (Ch 6-10): 1.5x\n**Epic Saga** (Ch 11+): 1.75x\n\n*Later chapters worth more because you read more!*`, 
                inline: false 
            },
            { 
                name: '⭐ Quality System', 
                value: `Community rates your feedback 1-4 stars. Higher average = better credit multipliers for future feedback!`, 
                inline: false 
            },
            { 
                name: '📅 Monthly Requirements', 
                value: `Choose one:\n• **2** document feedbacks\n• **6** comment feedbacks\n• **1** document + **3** comments`, 
                inline: false 
            },
            { 
                name: 'How to Start', 
                value: `1. Reach **Level 5**\n2. Visit ${channels.bookshelfFeedback}\n3. Find a story and give feedback\n4. Use \`/feedback type:[comment/document] chapter:[number]\`\n5. Earn credits and build your reputation!`, 
                inline: false 
            },
            {
                name: '🎯 Key Commands',
                value: '`/feedback` - Log feedback\n`/rate_feedback` - Rate others\n`/balance` - Check stats\n`/monthly` - Check progress\n`/store` - Browse marketplace\n`/access` - Check permissions',
                inline: false
            }
        )
        .setColor(0x5865F2);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleHallOfFameCommand(interaction) {
    const type = interaction.options.getString('type') || 'monthly';
    
    let embed;
    
    if (type === 'quality') {
        // Quality leaderboard
        const qualityLeaders = await global.db.db.all(`
            SELECT u.user_id, u.total_feedback_all_time, u.quality_ratings
            FROM users u
            WHERE u.total_feedback_all_time > 0 
            AND json_extract(u.quality_ratings, '$.total') >= 3
            ORDER BY json_extract(u.quality_ratings, '$.average') DESC
            LIMIT 10
        `);
        
        let description = '';
        for (let i = 0; i < qualityLeaders.length; i++) {
            const user = qualityLeaders[i];
            const quality = JSON.parse(user.quality_ratings);
            try {
                const discordUser = await client.users.fetch(user.user_id);
                const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `⚔️`;
                description += `${medal} **${discordUser.displayName}**\n   ⭐ ${quality.average.toFixed(2)}/4.0 • ${quality.total} judgments\n\n`;
            } catch (error) {
                continue;
            }
        }
        
        embed = new EmbedBuilder()
            .setTitle('⭐ Masters of Quality ☝️')
            .setDescription(description || 'None have achieved mastery yet.')
            .setColor(0xFFD700);
    } else {
        // Monthly or all-time leaderboard
        const monthKey = getCurrentMonthKey();
        let leaders;
        
        if (type === 'monthly') {
            leaders = await global.db.db.all(`
                SELECT user_id, (doc_feedback_count * 3 + comment_feedback_count) as score
                FROM monthly_feedback 
                WHERE month_key = ? AND score > 0
                ORDER BY score DESC 
                LIMIT 10
            `, [monthKey]);
        } else {
            leaders = await global.db.db.all(`
                SELECT user_id, total_feedback_all_time as score
                FROM users 
                WHERE total_feedback_all_time > 0
                ORDER BY score DESC 
                LIMIT 10
            `);
        }
        
        let description = '';
        for (let i = 0; i < leaders.length; i++) {
            const leader = leaders[i];
            try {
                const discordUser = await client.users.fetch(leader.user_id);
                const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                description += `${medal} **${discordUser.displayName}** • ${leader.score} contributions\n`;
            } catch (error) {
                continue;
            }
        }
        
        embed = new EmbedBuilder()
            .setTitle(`${type === 'monthly' ? '🏆 Monthly Champions' : '👑 Legendary Contributors'} ☝️`)
            .setDescription(description || 'The halls await their first champions.')
            .setColor(0xFFD700);
    }
    
    await replyTemporary(interaction, { embeds: [embed] });
}

// ===== STAFF COMMANDS =====
async function handleFeedbackAddCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    
    const userData = await getUserData(user.id);
    await updateUserData(user.id, {
        totalFeedbackAllTime: userData.totalFeedbackAllTime + amount
    });
    
    const embed = new EmbedBuilder()
        .setTitle('Feedback Added ☝️')
        .addFields(
            { name: 'Amount Added', value: `+${amount}`, inline: true },
            { name: 'New Total', value: `${userData.totalFeedbackAllTime + amount}`, inline: true }
        )
        .setColor(0x00AA55);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleCreditAddCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    
    const previousBalance = (await getUserData(user.id)).currentCredits;
    await addCredits(user.id, amount);
    const newBalance = (await getUserData(user.id)).currentCredits;
    
    const embed = new EmbedBuilder()
        .setTitle('Credits Added ☝️')
        .addFields(
            { name: 'Previous', value: `${previousBalance}`, inline: true },
            { name: 'Added', value: `+${amount}`, inline: true },
            { name: 'New Total', value: `${newBalance}`, inline: true }
        )
        .setColor(0x00AA55);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleFeedbackRemoveCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    
    const currentCount = await getUserMonthlyFeedback(user.id);
    await setUserMonthlyFeedback(user.id, 'document', Math.max(0, currentCount.docs - Math.min(amount, currentCount.docs)));
    
    const userRecord = await getUserData(user.id);
    await updateUserData(user.id, {
        totalFeedbackAllTime: Math.max(0, userRecord.totalFeedbackAllTime - amount),
        currentCredits: Math.max(0, userRecord.currentCredits - (amount * 3))
    });
    
    const embed = new EmbedBuilder()
        .setTitle('⚔️ Feedback Record Adjusted ☝️')
        .addFields(
            { name: 'Feedback Removed', value: `-${amount}`, inline: true },
            { name: 'Credits Deducted', value: `-${amount * 3}`, inline: true }
        )
        .setColor(0xFF6B6B);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleCreditRemoveCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    
    const userRecord = await getUserData(user.id);
    const previousBalance = userRecord.currentCredits;
    const newBalance = Math.max(0, userRecord.currentCredits - amount);
    
    await updateUserData(user.id, { currentCredits: newBalance });
    
    const embed = new EmbedBuilder()
        .setTitle('💰 Treasury Adjusted ☝️')
        .addFields(
            { name: 'Previous', value: `${previousBalance}`, inline: true },
            { name: 'Removed', value: `-${Math.min(amount, previousBalance)}`, inline: true },
            { name: 'New Total', value: `${newBalance}`, inline: true }
        )
        .setColor(0xFF6B6B);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleLeaseAddCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    
    const previousLeases = (await getUserData(user.id)).chapterLeases;
    await addLeases(user.id, amount);
    const newLeases = (await getUserData(user.id)).chapterLeases;
    
    const embed = new EmbedBuilder()
        .setTitle('📝 Chapter Leases Granted ☝️')
        .addFields(
            { name: 'Previous', value: `${previousLeases}`, inline: true },
            { name: 'Added', value: `+${amount}`, inline: true },
            { name: 'New Total', value: `${newLeases}`, inline: true }
        )
        .setColor(0x00AA55);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleSetupBookshelfCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const member = interaction.guild.members.cache.get(user.id);
    
    const userRecord = await getUserData(user.id);
    
    if (userRecord.purchases.includes('shelf')) {
        const embed = new EmbedBuilder()
            .setTitle('⚔️ Already Granted ☝️')
            .setColor(0xFF9900);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Grant shelf access
    const newPurchases = [...userRecord.purchases, 'shelf'];
    await updateUserData(user.id, { purchases: newPurchases });
    await global.db.db.run('INSERT OR REPLACE INTO user_purchases (user_id, item) VALUES (?, ?)', [user.id, 'shelf']);
    
    // Assign role
    await assignRole(member, interaction.guild, 'Shelf Owner');
    
    const embed = new EmbedBuilder()
        .setTitle('📚 Bookshelf Access Granted ☝️')
        .addFields(
            { name: 'Privileges', value: '⚔️ Shelf Owner role\n🏰 Thread creation access', inline: false },
            { name: 'Next Steps', value: 'Assign **reader** role when appropriate', inline: false }
        )
        .setColor(0x00AA55);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleUserResetCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const member = interaction.guild.members.cache.get(user.id);
    
    // Get current data for the embed
    const userData = await getUserData(user.id);
    const monthlyData = await getUserMonthlyFeedback(user.id);
    
    // Close user's bookshelf threads
    const closedThreads = await closeUserBookshelfThreads(interaction.guild, user.id);
    
    // Remove roles
    if (member) {
        await removeUserRoles(member, interaction.guild);
    }
    
    // Complete database reset
    await resetUserProgress(user.id, interaction.guild);
    
    const embed = new EmbedBuilder()
        .setTitle('⚔️ Complete User Reset Executed ☝️')
        .setDescription(`**${user.displayName}** has been stripped of all progress and returned to a blank slate.`)
        .addFields(
            { name: '📊 Previous Stats', value: `📝 ${userData.totalFeedbackAllTime} total feedback\n💰 ${userData.currentCredits} credits\n📄 ${userData.chapterLeases} leases`, inline: true },
            { name: '📅 Monthly Progress', value: `📄 ${monthlyData.docs} docs\n💬 ${monthlyData.comments} comments`, inline: true },
            { name: '🏰 Actions Taken', value: `🗑️ All data purged\n🔒 ${closedThreads} threads closed\n👑 Roles removed\n💾 Database cleaned`, inline: true }
        )
        .setColor(0xFF4444)
        .setFooter({ text: 'This action cannot be undone' });
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleUnpardonCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    
    try {
        const monthKey = getCurrentMonthKey();
        const success = await global.db.removePardon(user.id, monthKey);
        
        if (success) {
            const embed = new EmbedBuilder()
                .setTitle('⚔️ Pardon Revoked ☝️')
                .addFields({ name: 'User', value: user.displayName, inline: true })
                .setColor(0xFF6B6B);
            
            await replyTemporary(interaction, { embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setTitle('🛡️ No Pardon Found ☝️')
                .setColor(0xFF9900);
            
            await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        }
    } catch (error) {
        console.error('Error removing pardon:', error);
    }
}

async function handlePardonedLastMonthCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const lastMonthKey = getLastMonthKey();
    
    try {
        const pardonedUsers = await global.db.getPardonedUsersForMonth(lastMonthKey);
        
        if (pardonedUsers.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('🏰 No Pardons Last Month ☝️')
                .setDescription('No members required clemency. How admirably disciplined our realm was!')
                .setColor(0x2F3136);
            
            return await replyTemporary(interaction, { embeds: [embed] });
        }
        
        let pardonedList = '';
        for (const record of pardonedUsers.slice(0, 20)) {
            try {
                const member = await interaction.guild.members.fetch(record.user_id);
                pardonedList += `⚔️ **${member.displayName}**\n`;
            } catch (error) {
                pardonedList += `👻 *[Left Realm] (${record.user_id.slice(-4)})*\n`;
            }
        }
        
        const embed = new EmbedBuilder()
            .setTitle('🛡️ Last Month\'s Pardoned ☝️')
            .addFields({
                name: `👑 Royal Clemency (${pardonedUsers.length})`,
                value: pardonedList || '• None',
                inline: false
            })
            .setColor(0x00AA55);
        
        await replyTemporary(interaction, { embeds: [embed] });
            
    } catch (error) {
        console.error('Error fetching pardoned users:', error);
    }
}

async function handlePurgeListCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const allMembers = await interaction.guild.members.fetch();
    let purgeList = '';
    let purgeCount = 0;
    
    for (const [userId, member] of allMembers) {
        if (member.user.bot || !hasLevel5Role(member)) continue;
        
        const monthlyData = await getUserMonthlyFeedback(userId);
        const isPardoned = await isUserPardoned(userId);
        const meetingRequirement = checkMonthlyRequirement(monthlyData);
        
        if (!meetingRequirement && !isPardoned) {
            purgeCount++;
            if (purgeList.length < 900) {
                purgeList += `⚔️ **${member.displayName}** (${monthlyData.docs} docs, ${monthlyData.comments} comments)\n`;
            }
        }
    }
    
    const embed = new EmbedBuilder()
        .setTitle('🗡️ The Purge List ☝️')
        .setDescription('Members who have failed to meet their sworn duties to the realm.')
        .addFields(
            { name: `💀 Marked for Exile (${purgeCount})`, value: purgeList || '• None face exile', inline: false },
            { 
                name: '⚔️ Requirements', 
                value: `Choose one:\n🛡️ 2 document feedbacks\n⚔️ 6 comment feedbacks\n🗡️ 1 document + 3 comments`, 
                inline: false 
            }
        )
        .setColor(purgeCount > 0 ? 0xFF4444 : 0x00AA55);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleStatsCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const totalMembers = interaction.guild.memberCount;
    const level5Members = interaction.guild.members.cache.filter(member => hasLevel5Role(member));
    const totalLevel5 = level5Members.size;
    
    let monthlyContributors = 0;
    
    for (const [userId, member] of level5Members) {
        const monthlyData = await getUserMonthlyFeedback(userId);
        if (checkMonthlyRequirement(monthlyData)) {
            monthlyContributors++;
        }
    }
    
    const contributionRate = totalLevel5 > 0 ? Math.round((monthlyContributors / totalLevel5) * 100) : 0;
    
    // Get economy stats
    const economyStats = await global.db.db.get(`
        SELECT 
            SUM(current_credits) as total_credits,
            SUM(chapter_leases) as total_leases,
            COUNT(*) as tracked_users,
            AVG(current_credits) as avg_credits
        FROM users
    `);
    
    const embed = new EmbedBuilder()
        .setTitle('Type&Draft Community Statistics ☝️')
        .addFields(
            { name: 'Total Members', value: `${totalMembers}`, inline: true },
            { name: 'Level 5+ Tracked', value: `${totalLevel5}`, inline: true },
            { name: 'Meeting Monthly', value: `${monthlyContributors}`, inline: true },
            { name: 'Participation Rate', value: `${contributionRate}%`, inline: true },
            { name: 'Credits in Economy', value: `${economyStats?.total_credits || 0}`, inline: true },
            { name: 'Chapter Leases', value: `${economyStats?.total_leases || 0}`, inline: true }
        )
        .setColor(contributionRate >= 70 ? 0x00AA55 : contributionRate >= 50 ? 0xFF9900 : 0xFF4444);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handlePardonCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    
    if (await isUserPardoned(user.id)) {
        const embed = new EmbedBuilder()
            .setTitle('Already Pardoned ☝️')
            .setColor(0xFF9900);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    await pardonUser(user.id);
    
    const embed = new EmbedBuilder()
        .setTitle('Pardon Granted ☝️')
        .addFields({ name: 'Pardoned User', value: user.displayName, inline: true })
        .setColor(0x00AA55);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handlePostGuideCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const type = interaction.options.getString('type');
    
    let embed;
    const channels = getClickableChannelMentions(interaction.guild);
    
    if (type === 'navigation') {
        embed = new EmbedBuilder()
            .addFields(
                {
                    name: '🏛️ Welcome Halls',
                    value: `${channels.reactionRoles} - Claim your roles with a simple reaction\n${channels.rulesChannel} - Our community covenant (read thoroughly)\n${channels.introductions} - Present yourself to our distinguished assembly\n${channels.bump} - Support our growth with \`/bump\``,
                    inline: false
                },
                {
                    name: '🏰 Courts',
                    value: `${channels.ticket} - Private counsel with our esteemed staff\n${channels.botStuff} - I advise you to take advantage of the \`/help\` command, so you can learn more about the server's inner workings`,
                    inline: false
                },
                {
                    name: '🍺 The Tavern',
                    value: '• Quarters for discussion concerning daily life, hobbies, and interests',
                    inline: false
                },
                {
                    name: '✍️ Scriptorium',
                    value: `${channels.writingChat} - General discourse on the craft\n${channels.writingHelp} - Here, our community provides guidance in your literary questions\n${channels.onePageCritique} - Submit short excerpts for detailed feedback\n${channels.snippetShowcase} - Display your finest work for admiration`,
                    inline: false
                },
                {
                    name: '🎪 Circus',
                    value: `${channels.triggered} - Use a popular pictogram to share your most controversial writing opinions\n${channels.bookshelfMemes} - Share humorous jests about the works of your fellow scribes`,
                    inline: false
                },
                {
                    name: '📚 The Citadel',
                    value: `**Level 5** required: Access this domain by engaging with the community\n${channels.bookshelfFeedback} - Provide thorough, tactful critique using the \`/feedback\` command to earn credits\n${channels.bookshelf} - Post your chapters or short stories here after purchasing shelf access and leases. **See:** \`/store\`\n${channels.bookshelfDiscussion} - Scholarly discourse on critiques`,
                    inline: false
                },
                {
                    name: '📚 Maester Chambers',
                    value: `${channels.readForReadFinder} - Full draft exchanges (**20+ feedback** required)\n${channels.completeDrafts} - Complete works forum (**Level 35 + 20 feedback** required)`,
                    inline: false
                },
                {
                    name: '💰 Our Credit Economy',
                    value: `• **Two-tier system:** 1 credit (comments) or 3 credits (documents) per quality feedback (**Level 5+** only)\n• **Chapter multipliers:** Later chapters worth up to 1.75x more credits\n• **Quality ratings:** Community rates your feedback, affects future earnings\n• **Purchase** Bookshelf access (15 credits) + Chapter leases (3 credits each)\n• **Monthly requirement:** 2 docs OR 6 comments OR 1 doc + 3 comments`,
                    inline: false
                }
            )
            .setColor(0xFF8C00)
            .setFooter({ text: 'Your humble servant in all literary endeavors' });
    } else if (type === 'rules') {
        embed = new EmbedBuilder()
            .setTitle('The Laws of Type&Draft ☝️')
            .addFields(
                {
                    name: '📜 The Third Law - Enhanced',
                    value: `**Context is mandatory:** You MUST read all previous chapters before giving feedback. Document feedback requires complete story context. Comment feedback can be scene-specific. Monthly requirement: 2 doc feedbacks OR 6 comment feedbacks OR 1 doc + 3 comments.`,
                    inline: false
                },
                {
                    name: '📜 Content Limits',
                    value: 'Bookshelf limit: 25,000 words maximum per user. Quality over quantity. Focus on meaningful, thoughtful critique rather than rushed feedback.',
                    inline: false
                }
            )
            .setColor(0xFF8C00);
    } else if (type === 'feedback') {
        embed = new EmbedBuilder()
            .setTitle('Feedback System Quick Reference ☝️')
            .addFields(
                {
                    name: '💬 Comment Feedback (1 credit)',
                    value: 'Inline comments within Google Docs. Still requires reading previous chapters.',
                    inline: false
                },
                {
                    name: '📄 Document Feedback (3 credit)', 
                    value: 'Comprehensive feedback in separate document. Also requires reading all previous chapters.',
                    inline: false
                },
                {
                    name: '📈 Multipliers',
                    value: '**Chapter:** 1.0x (Ch 1-2) → 1.75x (Ch 11+)\n**Quality:** Community rates 1-4 stars, affects future earnings',
                    inline: false
                }
            )
            .setColor(0xFF8C00);
    }
    
    await interaction.channel.send({ embeds: [embed] });
    
    const confirmEmbed = new EmbedBuilder()
        .setTitle('Guide Posted ☝️')
        .setColor(0x00AA55);
    
    await replyTemporary(interaction, { embeds: [confirmEmbed] });
}

async function handlePostRulesCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    await postRules(interaction.channel);
    
    const embed = new EmbedBuilder()
        .setTitle('📜 Rules Posted ☝️')
        .setDescription('The laws of our realm have been proclaimed in this chamber.')
        .setColor(0x00AA55);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function postRules(channel) {
    const guild = channel.guild;
    const channels = getClickableChannelMentions(guild);

    const embed = new EmbedBuilder()
        .setTitle('📜 The Laws of Type&Draft ☝️')
        .addFields(
            {
                name: '⚔️ The First Law',
                value: 'All discourse shall be respectful and courteous. Discrimination of any form is strictly forbidden in our halls.',
                inline: false
            },
            {
                name: '🛡️ The Second Law', 
                value: 'Honor each channel\'s designated purpose. Writing matters belong in writing quarters, and likewise for all other subjects.',
                inline: false
            },
            {
                name: '🏰 The Third Law - Enhanced Feedback System',
                value: `Upon earning access to our ${channels.bookshelf} forum, you may post chapters using chapter leases. **Context is mandatory:** You MUST read all previous chapters before giving feedback. Document feedback requires complete story context. **Monthly requirement:** 2 document feedbacks OR 6 comment feedbacks OR 1 document + 3 comments. New members must reach **Level 5** within a month. This ensures all members contribute meaningfully to our literary community.`,
                inline: false
            },
            {
                name: '👑 The Fourth Law',
                value: `AI-generated artwork belongs solely in ${channels.aiArt}. AI-written work created from scratch is forbidden. Using AI as a writing tool is acceptable. Violations will be swiftly deleted.`,
                inline: false
            },
            {
                name: '🗡️ The Fifth Law',
                value: 'Direct messages require explicit permission. Promotional spam results in immediate banishment. Introduction requirement: State your lucky number and favorite animal to prove rule comprehension.',
                inline: false
            },
            {
                name: '🏰 The Sixth Law',
                value: '**18+ members only.** Suspected minors must provide age verification (selfie + passport). Failure results in removal. No exceptions, even for tomorrow\'s birthdays.',
                inline: false
            },
            {
                name: '⚔️ The Seventh Law',
                value: 'NSFW content is permitted within designated spaces. Pornography (content intended for sexual arousal) is strictly prohibited.',
                inline: false
            },
            {
                name: '🛡️ The Eighth Law',
                value: 'Camaraderie and jest are welcomed, but respect all boundaries. Exercise common sense in all interactions.',
                inline: false
            },
            {
                name: '👑 The Final Law',
                value: 'Arrogance has no place here. If you seek feedback, acknowledge you have room for growth. Dismissive attitudes toward our members result in immediate expulsion.',
                inline: false
            }
        )
        .setColor(0xFF8C00)
        .setFooter({ text: 'Compliance ensures our community\'s continued prosperity • Bookshelf limit: 25,000 words per user' });

    await channel.send({ embeds: [embed] });
}

// ===== ERROR HANDLERS =====
async function handleInteractionError(interaction, error) {
    const errorEmbed = new EmbedBuilder()
        .setTitle('System Error ☝️')
        .setDescription('An unexpected complication arose. Please try again or contact staff.')
        .setColor(0xFF6B6B);
    
    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
        } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    } catch (replyError) {
        console.error('Failed to send error response:', replyError);
    }
}

async function sendStaffOnlyMessage(target, isInteraction = false) {
    const embed = new EmbedBuilder()
        .setTitle('Insufficient Authority ☝️')
        .setColor(0xFF6B6B);
    
    if (isInteraction) {
        return await replyTemporary(target, { embeds: [embed], ephemeral: true });
    }
}

// ===== BOT LOGIN =====
client.login(process.env.DISCORD_BOT2_TOKEN);

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down gracefully...');
    if (global.db) {
        await global.db.close();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Shutting down gracefully...');
    if (global.db) {
        await global.db.close();
    }
    process.exit(0);
});
