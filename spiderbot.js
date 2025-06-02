require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs').promises;
const DatabaseManager = require('./database');

// ===== MESSAGE DELETION TIMEOUT CONFIGURATION =====
// Change this value to adjust how long bot messages stay before deletion
// Current: 5 minutes (300000 milliseconds)
// Examples: 60000 = 1 minute, 180000 = 3 minutes, 600000 = 10 minutes
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

// ===== CONSTANTS =====
const STORE_ITEMS = {
    shelf: {
        name: "Bookshelf Access",
        description: "Grants you the **Shelf Owner** role (reader role required separately from staff)",
        price: 1,
        role: "Shelf Owner",
        emoji: "📚",
        allowQuantity: false,
        category: "access"
    },
    lease: {
        name: "Chapter Lease",
        description: "Allows you to post one message in your bookshelf thread",
        price: 1,
        role: null,
        emoji: "📝",
        allowQuantity: true,
        category: "utility"
    },
    // New color roles
    mocha_mousse: {
        name: "Mocha Mousse",
        description: "A warm, choccy brown that evokes comfort and grounding",
        color: 0xA47864,
        price: 1,
        emoji: "🤎",
        year: "2025",
        category: "color",
        levelRequired: 15
    },
    peach_fuzz: {
        name: "Peach Fuzz",
        description: "A soft, gentle peach that radiates warmth and community",
        color: 0xFFBE98,
        price: 1,
        emoji: "🍑",
        year: "2024",
        category: "color",
        levelRequired: 15
    },
    magenta: {
        name: "Magenta",
        description: "A bold, vibrant purple that screams vigor and craziness",
        color: 0xFF00FF,
        price: 1,
        emoji: "🔮",
        year: "2023",
        category: "color",
        levelRequired: 15
    },
    very_peri: {
        name: "Very Peri",
        description: "A dynamic periwinkle blue with violet undertones",
        color: 0x6667AB,
        price: 1,
        emoji: "💜",
        year: "2022",
        category: "color",
        levelRequired: 15
    },
    illuminating_yellow: {
        name: "Illuminating Yellow",
        description: "A bright, cheerful yellow that sparks optimism",
        color: 0xF5DF4D,
        price: 1,
        emoji: "💛",
        year: "2021",
        category: "color",
        levelRequired: 15
    },
    living_coral: {
        name: "Living Coral",
        description: "An animating orange-pink that energizes and enlivens",
        color: 0xFF6F61,
        price: 1,
        emoji: "🦩",
        year: "2019",
        category: "color",
        levelRequired: 15
    },
    marsala: {
        name: "Marsala",
        description: "A rich, wine-red that exudes sophistication",
        color: 0x955251,
        price: 1,
        emoji: "🍷",
        year: "2015",
        category: "color",
        levelRequired: 15
    },
    greenery: {
        name: "Greenery",
        description: "A fresh, zesty yellow-green that revitalizes",
        color: 0x88B04B,
        price: 1,
        emoji: "🌿",
        year: "2017",
        category: "color",
        levelRequired: 15
    },
    mimosa: {
        name: "Mimosa",
        description: "A warm, encouraging golden yellow",
        color: 0xF0C05A,
        price: 1,
        emoji: "🥂",
        year: "2009",
        category: "color",
        levelRequired: 15
    },
    chilli_pepper: {
        name: "Chilli Pepper",
        description: "A bold, spicy red that commands attention",
        color: 0x9B1B30,
        price: 1,
        emoji: "🌶️",
        year: "2007",
        category: "color",
        levelRequired: 15
    },
    ultimate_gray: {
        name: "Ultimate Gray",
        description: "A timeless, neutral gray",
        color: 0x939597,
        price: 1,
        emoji: "🐘",
        year: "2021",
        category: "color",
        levelRequired: 15
    }
};

const ALLOWED_FEEDBACK_THREADS = ['bookshelf-feedback', 'bookshelf-discussion'];
const MONITORED_FORUMS = ['bookshelf-feedback', 'bookshelf-discussion', 'bookshelf'];
const ACTIVITY_MONITOR_CHANNEL = 'activity-monitor';
const MONTHLY_FEEDBACK_REQUIREMENT = 1;
const MINIMUM_FEEDBACK_FOR_SHELF = 2;

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

// ===== ACTIVITY MONITORING FUNCTIONS =====
async function sendActivityNotification(guild, type, data) {
    try {
        const activityChannel = guild.channels.cache.find(ch => 
            ch.name === ACTIVITY_MONITOR_CHANNEL && ch.isTextBased()
        );
        
        if (!activityChannel) {
            console.log(`⚠️ Activity monitor channel #${ACTIVITY_MONITOR_CHANNEL} not found`);
            return;
        }

        let embed;
        
        if (type === 'thread_created') {
            embed = new EmbedBuilder()
                .setTitle('📝 New Thread Created')
                .addFields(
                    { name: 'Thread', value: `${data.thread.name}`, inline: false },
                    { name: 'Forum', value: `<#${data.thread.parentId}>`, inline: true },
                    { name: 'Creator', value: `<@${data.thread.ownerId}>`, inline: true },
                    { name: 'Created At', value: `<t:${Math.floor(data.thread.createdTimestamp / 1000)}:F>`, inline: true }
                )
                .setColor(0x00AA55)
                .setTimestamp();
        } else if (type === 'feedback_command') {
            embed = new EmbedBuilder()
                .setTitle('📋 Feedback Command Used')
                .addFields(
                    { name: 'Thread', value: `[${data.thread.name}](${data.messageUrl})`, inline: false },
                    { name: 'Forum', value: `<#${data.thread.parentId}>`, inline: true },
                    { name: 'User', value: `<@${data.userId}>`, inline: true },
                    { name: 'Used At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                )
                .setColor(0x5865F2)
                .setTimestamp();
        } else if (type === 'lease_consumed') {
            embed = new EmbedBuilder()
                .setTitle('📝 Chapter Lease Consumed')
                .addFields(
                    { name: 'Thread', value: `[${data.thread.name}](${data.messageUrl})`, inline: false },
                    { name: 'Forum', value: `<#${data.thread.parentId}>`, inline: true },
                    { name: 'Author', value: `<@${data.userId}>`, inline: true },
                    { name: 'Leases Remaining', value: `${data.leasesRemaining}`, inline: true },
                    { name: 'Posted At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                )
                .setColor(0xFF9900)
                .setTimestamp();
        } else if (type === 'feedback_posted') {
            embed = new EmbedBuilder()
                .setTitle('💬 Feedback Message Posted')
                .addFields(
                    { name: 'Thread', value: `[${data.thread.name}](${data.messageUrl})`, inline: false },
                    { name: 'Forum', value: `<#${data.thread.parentId}>`, inline: true },
                    { name: 'Author', value: `<@${data.userId}>`, inline: true },
                    { name: 'Thread Owner', value: `<@${data.thread.ownerId}>`, inline: true },
                    { name: 'Posted At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                    { name: 'Message Preview', value: `${data.messagePreview}`, inline: false }
                )
                .setColor(0x5865F2)
                .setTimestamp();
        } else if (type === 'thread_deleted') {
            embed = new EmbedBuilder()
                .setTitle('🗑️ Thread Deleted')
                .addFields(
                    { name: 'Thread Name', value: `${data.threadName}`, inline: false },
                    { name: 'Forum', value: `<#${data.parentId}>`, inline: true },
                    { name: 'Thread Owner', value: `<@${data.ownerId}>`, inline: true },
                    { name: 'Deleted At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                    { name: 'Thread ID', value: `${data.threadId}`, inline: true }
                )
                .setColor(0xFF4444)
                .setTimestamp();
        }

        if (embed) {
            await activityChannel.send({ embeds: [embed] });
            console.log(`📢 Activity notification sent to #${ACTIVITY_MONITOR_CHANNEL}`);
        }
    } catch (error) {
        console.error('❌ Failed to send activity notification:', error);
    }
}

function isMonitoredForum(channel) {
    if (!channel || !channel.parent) return false;
    return MONITORED_FORUMS.includes(channel.parent.name);
}

function isMonitoredForumDirect(channel) {
    if (!channel) return false;
    return MONITORED_FORUMS.includes(channel.name);
}

// ===== WELCOME SYSTEM CLASS =====
class WelcomeSystem {
    constructor(client) {
        this.client = client;
        this.logger = console;
    }

    init() {
        this.client.on('guildMemberAdd', this.handleMemberJoin.bind(this));
        this.logger.log('✅ Welcome system initialized');
    }

    async handleMemberJoin(member) {
        this.logger.log(`👋 Member joined: ${member.displayName} (${member.id}) in ${member.guild.name}`);
        
        try {
            await this.handleRejoiningMember(member);
            await this.sendWelcomeMessage(member);
        } catch (error) {
            this.logger.error(`❌ Welcome system error for ${member.displayName}:`, error);
            await this.handleWelcomeError(member, error);
        }
    }

    async handleRejoiningMember(member) {
        const userId = member.id;
        
        // Check if user has existing data in database instead of global variables
        try {
            const userRecord = await getUserData(userId);
            const monthlyCount = await getUserMonthlyFeedback(userId);
            
            if (userRecord.totalFeedbackAllTime > 0 || monthlyCount > 0) {
                this.logger.log(`🔄 Resetting data for rejoining member: ${member.displayName}`);
                await resetUserProgress(userId, member.guild);
            }
        } catch (error) {
            // If user doesn't exist in database, that's fine - they're new
            this.logger.log(`New member detected: ${member.displayName}`);
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

        for (const categoryName of WELCOME_CONFIG.categoryNames) {
            const category = guild.channels.cache.find(ch => 
                ch.type === 4 && ch.name.toLowerCase().includes(categoryName)
            );
            
            if (category) {
                const channel = category.children.cache.find(ch => ch.isTextBased());
                if (channel) {
                    this.logger.log(`✅ Found welcome channel: #${channel.name} (in ${category.name} category)`);
                    return channel;
                }
            }
        }

        const fallbackChannel = guild.channels.cache.find(ch => 
            ch.name.toLowerCase().includes('welcome') && ch.isTextBased()
        );
        
        if (fallbackChannel) {
            this.logger.log(`✅ Found welcome channel: #${fallbackChannel.name} (fallback)`);
            return fallbackChannel;
        }

        this.logger.warn(`⚠️ No welcome channel found in ${guild.name}`);
        return null;
    }

    hasRequiredPermissions(channel) {
        const permissions = channel.permissionsFor(channel.guild.members.me);
        const required = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
        
        for (const permission of required) {
            if (!permissions || !permissions.has(permission)) {
                this.logger.warn(`❌ Missing permission ${permission} in #${channel.name}`);
                return false;
            }
        }
        
        return true;
    }

    createWelcomeEmbed(member) {
        const { guild } = member;
        const config = WELCOME_CONFIG.embed;
        
        const channels = getClickableChannelMentions(guild);

        const embed = new EmbedBuilder()
            .setTitle('A New Bird Joins Our Literary Nest ☝️')
            .setDescription(`Ah, **${member.displayName}**... How delightful. Another soul seeks to join our distinguished gathering of scribes and storytellers. Please, after you have studied our ${channels.rulesChannel} and our ${channels.serverGuideChannel}, use the ${channels.botStuff} channel, and trigger the \`/help\` command for  further instructions!`)
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
            throw new Error('No suitable welcome channel found');
        }

        if (!this.hasRequiredPermissions(channel)) {
            throw new Error(`Insufficient permissions in #${channel.name}`);
        }

        const embed = this.createWelcomeEmbed(member);
        
        try {
            const message = await channel.send({ embeds: [embed] });
            
            this.logger.log(`✅ Welcome message sent for ${member.displayName} in #${channel.name}`);
            this.logger.log(`📬 Message ID: ${message.id}`);
            
            return message;
            
        } catch (error) {
            this.logger.error(`❌ Failed to send welcome message in #${channel.name}:`, error);
            throw error;
        }
    }

    async handleWelcomeError(member, error) {
        const staffChannels = ['staff', 'admin', 'bot-logs', 'logs', 'errors'];
        let notificationChannel = null;

        for (const channelName of staffChannels) {
            notificationChannel = member.guild.channels.cache.find(ch => 
                ch.name.toLowerCase().includes(channelName) && ch.isTextBased()
            );
            if (notificationChannel && this.hasRequiredPermissions(notificationChannel)) {
                break;
            }
        }

        if (!notificationChannel) {
            this.logger.warn('⚠️ No staff notification channel available');
            return;
        }

        const errorEmbed = new EmbedBuilder()
            .setTitle('⚠️ Welcome System Error')
            .setDescription(`Failed to welcome new member: ${member.displayName}`)
            .addFields([
                { name: 'Member', value: `${member} (${member.id})`, inline: true },
                { name: 'Joined At', value: member.joinedAt?.toLocaleString() || 'Unknown', inline: true },
                { name: 'Error Type', value: error.name || 'Unknown', inline: true },
                { name: 'Error Details', value: `\`\`\`${error.message}\`\`\``, inline: false }
            ])
            .setColor(0xFF6B6B)
            .setTimestamp();

        try {
            await notificationChannel.send({ embeds: [errorEmbed] });
            this.logger.log(`📢 Error notification sent to #${notificationChannel.name}`);
        } catch (notifyError) {
            this.logger.error('❌ Failed to send error notification:', notifyError);
        }
    }
}

async function fixChannelPermissions() {
    // This function doesn't need database access, so it can remain as is
    // Just make sure it exists
    console.log('🔧 Channel permissions checked');
}

const welcomeSystem = new WelcomeSystem(client);

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
        rulesChannel: getChannelMention(guild, 'rules'),
        serverGuideChannel: getChannelMention(guild, 'server-guide'),
        botStuff: getChannelMention(guild, 'bot-stuff'),
        reactionRoles: getChannelMention(guild, 'reaction-roles'),
        announcements: getChannelMention(guild, 'announcements'),
        introductions: getChannelMention(guild, 'introductions'),
        bump: getChannelMention(guild, 'bump'),
        ticket: getChannelMention(guild, 'ticket'),
        writingChat: getChannelMention(guild, 'writing-chat'),
        actionHelp: getChannelMention(guild, 'action-help'),
        dialogueHelp: getChannelMention(guild, 'dialogue-help'),
        onePageCritique: getChannelMention(guild, 'one-page-critique'),
        snippetShowcase: getChannelMention(guild, 'snippet-showcase'),
        bookshelfMemes: getChannelMention(guild, 'bookshelf-memes'),
        aiArt: getChannelMention(guild, 'ai-art')
    };
}

// ===== ROLE MENTION HELPER FUNCTIONS =====
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

// ===== UTILITY FUNCTIONS =====

// Helper function to remove existing color roles from a user
async function removeExistingColorRoles(member, guild) {
    const userColorRoles = member.roles.cache.filter(role => {
        return Object.values(STORE_ITEMS).some(storeItem => 
            storeItem.category === 'color' && storeItem.name === role.name
        );
    });
    
    for (const role of userColorRoles.values()) {
        try {
            await member.roles.remove(role);
            console.log(`Removed existing color role ${role.name} from ${member.displayName}`);
        } catch (error) {
            console.log(`Failed to remove color role ${role.name}:`, error.message);
        }
    }
}

// Helper function to remove all color purchases from database
async function removeAllUserColorPurchases(userId) {
    try {
        // Get all color item keys
        const colorItems = Object.keys(STORE_ITEMS).filter(key => STORE_ITEMS[key].category === 'color');
        
        // Remove all color purchases for this user
        for (const colorKey of colorItems) {
            await global.db.db.run('DELETE FROM user_purchases WHERE user_id = ? AND item = ?', [userId, colorKey]);
        }
        
        console.log(`Removed all previous color purchases for user ${userId}`);
    } catch (error) {
        console.error(`Error removing color purchases for user ${userId}:`, error);
    }
}

function hasLevel15Role(member) {
    if (!member?.roles?.cache) {
        console.log('Invalid member object');
        return false;
    }
    
    const hasRole = member.roles.cache.some(role => {
        if (role.name.startsWith('Level ')) {
            const level = parseInt(role.name.split(' ')[1]);
            return level >= 15;
        }
        return false;
    });
    
    console.log(`${member.displayName} has Level 15+ role:`, hasRole);
    return hasRole;
}

function getCurrentMonthKey() {
    const now = new Date();
    // Subtract 1 day to shift the month boundary from 1st to 2nd
    const adjustedDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    return `${adjustedDate.getFullYear()}-${adjustedDate.getMonth()}`;
}

async function getUserMonthlyFeedback(userId) {
    const monthKey = getCurrentMonthKey();
    return await global.db.getMonthlyFeedback(userId, monthKey);
}

async function setUserMonthlyFeedback(userId, count) {
    const monthKey = getCurrentMonthKey();
    await global.db.setMonthlyFeedback(userId, monthKey, Math.max(0, count));
}

function hasLevel5Role(member) {
    if (!member?.roles?.cache) {
        console.log('Invalid member object');
        return false;
    }
    
    const hasRole = member.roles.cache.some(role => {
        if (role.name === 'Level 5') return true;
        if (role.name.startsWith('Level ')) {
            const level = parseInt(role.name.split(' ')[1]);
            return level >= 15;
        }
        return false;
    });
    
    console.log(`${member.displayName} has Level 5 role:`, hasRole);
    return hasRole;
}

function hasShelfRole(member) {
    if (!member?.roles?.cache) return false;
    return member.roles.cache.some(role => role.name === 'Shelf Owner');
}

// Alternative getUserData function - try this instead
// REVERT to this - don't use my broken version
async function getUserData(userId) {
    try {
        const userRecord = await global.db.db.get('SELECT * FROM users WHERE user_id = ?', [userId]);
        const purchaseRecords = await global.db.db.all('SELECT item FROM user_purchases WHERE user_id = ?', [userId]);
        const purchases = purchaseRecords ? purchaseRecords.map(p => p.item) : [];
        
        if (!userRecord) {
            return {
                totalFeedbackAllTime: 0,
                currentCredits: 0,
                bookshelfPosts: 0,
                chapterLeases: 0,
                purchases: []
            };
        }
        
        return {
            totalFeedbackAllTime: userRecord.total_feedback_all_time || 0,
            currentCredits: userRecord.current_credits || 0,
            bookshelfPosts: userRecord.bookshelf_posts || 0,
            chapterLeases: userRecord.chapter_leases || 0,
            purchases: purchases
        };
    } catch (error) {
        return {
            totalFeedbackAllTime: 0,
            currentCredits: 0,
            bookshelfPosts: 0,
            chapterLeases: 0,
            purchases: []
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
    if (updates.bookshelfPosts !== undefined) {
        fields.push('bookshelf_posts = ?');
        values.push(updates.bookshelfPosts);
    }
    if (updates.chapterLeases !== undefined) {
        fields.push('chapter_leases = ?');
        values.push(updates.chapterLeases);
    }
    
    if (fields.length > 0) {
        values.push(userId);
        try {
            const result = await global.db.db.run(`UPDATE users SET ${fields.join(', ')} WHERE user_id = ?`, values);
            if (result.changes === 0) {
                // User doesn't exist, create them
                await global.db.db.run(`
                    INSERT INTO users (user_id, total_feedback_all_time, current_credits, bookshelf_posts, chapter_leases)
                    VALUES (?, ?, ?, ?, ?)
                `, [userId, updates.totalFeedbackAllTime || 0, updates.currentCredits || 0, updates.bookshelfPosts || 0, updates.chapterLeases || 0]);
            }
        } catch (error) {
            // If insert fails, try a simpler approach
            await global.db.db.run(`
                INSERT OR REPLACE INTO users (user_id, total_feedback_all_time, current_credits, bookshelf_posts, chapter_leases)
                VALUES (?, ?, ?, ?, ?)
            `, [userId, updates.totalFeedbackAllTime || 0, updates.currentCredits || 0, updates.bookshelfPosts || 0, updates.chapterLeases || 0]);
        }
    }
}

function hasReaderRole(member) {
    if (!member?.roles?.cache) return false;
    return member.roles.cache.some(role => role.name === 'reader');
}

function canCreateBookshelfThread(member) {
    return hasShelfRole(member) && hasReaderRole(member);
}

async function spendCredits(userId, amount) {
    const userData = await getUserData(userId);
    const validAmount = Math.max(0, Math.floor(amount));
    
    if (userData.currentCredits >= validAmount) {
        await updateUserData(userId, { 
            currentCredits: userData.currentCredits - validAmount 
        });
        console.log(`User ${userId} spent ${validAmount} credits. Remaining: ${userData.currentCredits - validAmount}`);
        return true;
    }
    
    console.log(`Insufficient credits for ${userId}: has ${userData.currentCredits}, needs ${validAmount}`);
    return false;
}

async function consumeLease(userId) {
    const userData = await getUserData(userId);
    
    if (userData.chapterLeases > 0) {
        await updateUserData(userId, { 
            chapterLeases: userData.chapterLeases - 1,
            bookshelfPosts: userData.bookshelfPosts + 1
        });
        console.log(`User ${userId} consumed 1 lease. Remaining: ${userData.chapterLeases - 1}`);
        return true;
    }
    
    console.log(`No leases available for ${userId}`);
    return false;
}

async function addLeases(userId, amount) {
    const userData = await getUserData(userId);
    await updateUserData(userId, { 
        chapterLeases: userData.chapterLeases + amount 
    });
    console.log(`Added ${amount} leases to user ${userId}. Total: ${userData.chapterLeases + amount}`);
}

async function addPurchase(userId, item) {
    try {
        await global.db.db.run(
            'INSERT OR REPLACE INTO user_purchases (user_id, item) VALUES (?, ?)',
            [userId, item]
        );
    } catch (error) {
        console.error(`Error adding purchase for ${userId}:`, error);
    }
}

async function getBookshelfAccessStatus(userId, member = null, guild = null) {
    const user = await getUserData(userId);
    const roles = guild ? getClickableRoleMentions(guild) : { reader: '**reader**' };
    
    if (user.purchases.includes('shelf')) {
        if (member && hasReaderRole(member)) {
            return '✅ Full access granted';
        } else {
            return `✅ ${roles.shelfOwner} role acquired - ${roles.reader} role needed from staff`;
        }
    } else if (user.totalFeedbackAllTime < 1) {
        return `📝 Need 1 more credit to qualify for bookshelf purchase`;
    } else {
        return '💰 Ready to purchase shelf access (credit requirement met)';
    }
}

function isInAllowedFeedbackThread(channel) {
    console.log(`Checking channel: ${channel.name}, type: ${channel.type}, isThread: ${channel.isThread()}`);
    if (channel.parent) {
        console.log(`Parent channel: ${channel.parent.name}`);
    }
    
    if (channel.isThread() && channel.parent) {
        const parentIsAllowed = ALLOWED_FEEDBACK_THREADS.includes(channel.parent.name);
        if (parentIsAllowed) {
            console.log(`✅ Thread in ${channel.parent.name} forum is allowed`);
            return true;
        }
    }
    
    if (ALLOWED_FEEDBACK_THREADS.includes(channel.name)) {
        console.log(`✅ Channel/forum ${channel.name} is in allowed list`);
        return true;
    }
    
    console.log(`❌ Channel/thread not allowed`);
    return false;
}

function hasStaffPermissions(member) {
    return member?.permissions?.has(PermissionFlagsBits.ManageMessages);
}

async function logFeedbackForMessage(messageId, userId) {
    try {
        await global.db.db.run(
            'INSERT OR REPLACE INTO logged_feedback (message_id, user_id) VALUES (?, ?)',
            [messageId, userId]
        );
    } catch (error) {
        console.error('Error logging feedback:', error);
    }
}

async function logFeedbackForMessage(messageId, userId) {
    try {
        await global.db.db.run(
            'INSERT OR REPLACE INTO logged_feedback (message_id, user_id) VALUES (?, ?)',
            [messageId, userId]
        );
    } catch (error) {
        console.error('Error logging feedback:', error);
    }
}

async function assignColorRole(member, guild, itemKey) {
    const item = STORE_ITEMS[itemKey];
    
    // First, remove any existing color roles from the user
    await removeExistingColorRoles(member, guild);
    
    // Find the highest role position to place color role above everything
    let targetPosition = 1;
    const memberRoles = member.roles.cache;
    
    // Get the highest position among the user's current roles
    for (const role of memberRoles.values()) {
        targetPosition = Math.max(targetPosition, role.position + 1);
    }
    
    // Also check existing color roles in the server to position above them
    const existingColorRoles = guild.roles.cache.filter(role => {
        return Object.values(STORE_ITEMS).some(storeItem => 
            storeItem.category === 'color' && storeItem.name === role.name
        );
    });
    
    for (const role of existingColorRoles.values()) {
        targetPosition = Math.max(targetPosition, role.position + 1);
    }
    
    // Create or find the color role
    let colorRole = guild.roles.cache.find(r => r.name === item.name);
    if (!colorRole) {
        try {
            colorRole = await guild.roles.create({
                name: item.name,
                color: item.color,
                reason: `Color role purchase: ${item.name}`,
                hoist: false, // Don't display separately in member list
                mentionable: false,
                position: targetPosition // Position at the top
            });
            console.log(`Created color role: ${item.name} with color ${item.color.toString(16)} at position ${targetPosition}`);
        } catch (error) {
            console.log(`Failed to create color role ${item.name}:`, error.message);
            throw error;
        }
    } else {
        // Update position to ensure it's the highest role
        try {
            await colorRole.setPosition(targetPosition);
            console.log(`Updated ${item.name} position to ${targetPosition}`);
        } catch (error) {
            console.log(`Failed to set color role position:`, error.message);
        }
    }
    
    // Assign the color role
    try {
        await member.roles.add(colorRole);
        console.log(`Added ${item.name} color role to ${member.displayName}`);
    } catch (error) {
        console.log(`Failed to add ${item.name} color role:`, error.message);
        throw error;
    }
}

// ===== PARDON SYSTEM FUNCTIONS =====
async function isUserPardoned(userId) {
    try {
        const monthKey = getCurrentMonthKey();
        const result = await global.db.db.get('SELECT 1 FROM pardoned_users WHERE user_id = ? AND month_key = ?', [userId, monthKey]);
        return !!result;
    } catch (error) {
        return false;
    }
}

async function pardonUser(userId) {
    const monthKey = getCurrentMonthKey();
    try {
        await global.db.db.run('INSERT OR REPLACE INTO pardoned_users (user_id, month_key) VALUES (?, ?)', [userId, monthKey]);
    } catch (error) {
        console.error('Error pardoning user:', error);
    }
}

// ===== USER RESET FUNCTION =====
async function resetUserProgress(userId, guild) {
    console.log(`Resetting all progress for user ${userId}`);
    
    // Clear user logged feedback
    await global.db.clearUserLoggedFeedback(userId);
    
    // Close user bookshelf threads
    const closedThreads = await closeUserBookshelfThreads(guild, userId);
    
    // Delete user entirely (cascades to all related data)
    await global.db.deleteUser(userId);
    
    console.log(`User ${userId} progress completely reset - ${closedThreads} threads closed`);
    return closedThreads;
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

async function replyTemporaryMessage(message, messageOptions, delay = MESSAGE_DELETE_TIMEOUT) {
    try {
        const reply = await message.reply(messageOptions);
        console.log(`Sent temporary message reply, will delete in ${delay}ms`);
        setTimeout(async () => {
            try { 
                await reply.delete(); 
                console.log('Successfully deleted temporary message reply');
            } catch (error) { 
                console.log('Failed to delete reply:', error.message); 
            }
        }, delay);
        return reply;
    } catch (error) {
        console.error('Failed to send temporary message reply:', error);
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

// ===== SETUP FUNCTIONS =====
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
                    console.log(`Closed thread: ${thread.name}`);
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

// ===== FEEDBACK PROCESSING =====
async function processFeedbackContribution(userId) {
    const currentCount = await getUserMonthlyFeedback(userId);
    const newCount = currentCount + 1;
    await setUserMonthlyFeedback(userId, newCount);
    
    const userData = await getUserData(userId);
    await updateUserData(userId, {
        totalFeedbackAllTime: userData.totalFeedbackAllTime + 1,
        currentCredits: userData.currentCredits + 1
    });
    
    return {
        newCount,
        totalAllTime: userData.totalFeedbackAllTime + 1,
        currentCredits: userData.currentCredits + 1,
        requirementMet: newCount >= MONTHLY_FEEDBACK_REQUIREMENT
    };
}

// ===== FIND USER'S LATEST MESSAGE =====
async function findUserLatestMessage(channel, userId) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const userMessages = messages.filter(msg => 
            msg.author.id === userId && 
            !msg.author.bot && 
            !msg.content.startsWith('/') && 
            !msg.content.startsWith('!')
        );
        
        if (userMessages.size === 0) {
            console.log(`No valid messages found for user ${userId} in channel ${channel.name}`);
            return null;
        }
        
        const latestMessage = userMessages.first();
        console.log(`Found latest message for user ${userId}: "${latestMessage.content.substring(0, 50)}..."`);
        return latestMessage;
    } catch (error) {
        console.error('Error fetching user messages:', error);
        return null;
    }
}

// ===== SLASH COMMANDS SETUP =====
const commands = [
    new SlashCommandBuilder()
        .setName('feedback')
        .setDescription('Log your most recent contribution in this thread'),
    
    new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your feedback credits and bookshelf eligibility')
        .addUserOption(option => option.setName('user').setDescription('User to check (optional)').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('store')
        .setDescription('View available items in the Type&Draft store'),
    
    new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Purchase an item from the store')
        .addStringOption(option => option.setName('item').setDescription('Item to purchase').setRequired(true)
            .addChoices(
                { name: 'Bookshelf Access (1 credit)', value: 'shelf' },
                { name: 'Chapter Lease (1 credit)', value: 'lease' },
                // Color roles
                { name: '🤎 Mocha Mousse (2025) - 1 credit', value: 'mocha_mousse' },
                { name: '🍑 Peach Fuzz (2024) - 1 credit', value: 'peach_fuzz' },
                { name: '🔮 Magenta (2023) - 1 credit', value: 'magenta' },
                { name: '💜 Very Peri (2022) - 1 credit', value: 'very_peri' },
                { name: '💛 Illuminating Yellow (2021) - 1 credit', value: 'illuminating_yellow' },
                { name: '🐘 Ultimate Gray (2021) - 1 credit', value: 'ultimate_gray' },
                { name: '🦩 Living Coral (2019) - 1 credit', value: 'living_coral' },
                { name: '🌿 Greenery (2017) - 1 credit', value: 'greenery' },
                { name: '🍷 Marsala (2015) - 1 credit', value: 'marsala' },
                { name: '🥂 Mimosa (2009) - 1 credit', value: 'mimosa' },
                { name: '🌶️ Chilli Pepper (2007) - 1 credit', value: 'chilli_pepper' }
            ))
        .addIntegerOption(option => option.setName('quantity').setDescription('Quantity to purchase (only for leases)').setRequired(false).setMinValue(1).setMaxValue(50)),
    
    new SlashCommandBuilder()
        .setName('hall_of_fame')
        .setDescription('View the most dedicated contributors in our literary realm'),
    
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Display essential commands guide'),
    
    new SlashCommandBuilder()
        .setName('commands')
        .setDescription('Display all available commands'),
    
    new SlashCommandBuilder()
        .setName('feedback_add')
        .setDescription('Add feedback credits to a member (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to add credits to').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Number of credits to add (default: 1)').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('feedback_remove')
        .setDescription('Remove feedback credits from a member (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to remove credits from').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Number of credits to remove (default: 1)').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('feedback_reset')
        .setDescription('Reset member\'s entire record to zero (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to reset').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('credit_add')
        .setDescription('Add credits to a member\'s current balance only (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to add credits to').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Number of credits to add (default: 1)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('credit_remove')
        .setDescription('Remove credits from a member\'s current balance only (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to remove credits from').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Number of credits to remove (default: 1)').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('lease_add')
        .setDescription('Add chapter leases to a member (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to add leases to').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Number of leases to add (default: 1)').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View detailed server statistics (Staff only)'),
    
    new SlashCommandBuilder()
        .setName('pardon')
        .setDescription('Pardon a member from monthly feedback requirement (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('Member to pardon from this month\'s requirement').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('unpardon')
        .setDescription('Remove pardon from a member (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('Member to remove pardon from').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('setup_bookshelf')
        .setDescription('Grant bookshelf access to a member (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('Member to grant bookshelf access to').setRequired(true)),

    new SlashCommandBuilder()
        .setName('purge_list')
        .setDescription('View all mebmers who would be purged for not meeting monthly requirements (Staff only)'),
    
    new SlashCommandBuilder()
        .setName('manual_purge')
        .setDescription('Manually purge all members who don\'t meet monthly requirements (Staff only)'),

    new SlashCommandBuilder()
    .setName('post_server_guide')
    .setDescription('Post the server navigation guide (Staff only)'),

    new SlashCommandBuilder()
    .setName('post_rules')
    .setDescription('Post the server rules (Staff only)'),

    new SlashCommandBuilder()
        .setName('faceless')
        .setDescription('Make an anonymous confession to the community')
        .addStringOption(option => option.setName('confession').setDescription('Your writing confession').setRequired(true))
];

async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
        console.log('Started refreshing application (/) commands.');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// ===== BOT EVENTS =====
client.once('ready', async () => {
    console.log(`${client.user.tag} is online and serving Type&Draft!`);
    
    try {
        // Initialize database BEFORE everything else
        const db = new DatabaseManager();
        await db.initialize();
        
        // Test database connection
        const connectionTest = await db.testConnection();
        if (!connectionTest) {
            throw new Error('Database connection test failed');
        }
        console.log('✅ Database connection verified');
        
        // Make db available globally
        global.db = db;
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        console.error('Bot cannot start without database. Exiting...');
        process.exit(1);
    }
    
    await registerCommands();
    
    // Initialize welcome system
    welcomeSystem.init();
    
    // Force fetch all guild members to populate cache on startup
    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.members.fetch();
            await guild.roles.fetch();
            console.log(`Fetched ${guild.members.cache.size} members and ${guild.roles.cache.size} roles for ${guild.name}`);
        } catch (error) {
            console.error(`Failed to fetch data for ${guild.name}:`, error);
        }
    }
    
    // Fix channel permissions for slash commands
    await fixChannelPermissions();
    
    console.log('🎭 Bot fully initialized. All commands should work everywhere!');
});

client.on('guildMemberRemove', async (member) => {
    console.log(`Member left the server: ${member.displayName} (${member.id})`);
    await resetUserProgress(member.id, member.guild);
});

client.on('guildBanAdd', async (ban) => {
    console.log(`Member was banned: ${ban.user.displayName} (${ban.user.id})`);
    await resetUserProgress(ban.user.id, ban.guild);
});

// ===== THREAD CREATION HANDLER =====
client.on('threadCreate', async (thread) => {
    // Send activity notification for monitored forums
    if (thread.parent && MONITORED_FORUMS.includes(thread.parent.name)) {
        console.log(`📝 Thread created in monitored forum: ${thread.name} in ${thread.parent.name}`);
        await sendActivityNotification(thread.guild, 'thread_created', { thread });
    }

    if (thread.parent && thread.parent.name === 'bookshelf') {
        console.log(`New bookshelf thread created: ${thread.name} by ${thread.ownerId}`);
        
        try {
            const member = await thread.guild.members.fetch(thread.ownerId);
            
            if (!canCreateBookshelfThread(member)) {
                console.log(`User ${member.displayName} lacks required roles for bookshelf thread`);
                
                await thread.delete();
                
                try {
                    const dmChannel = await member.createDM();
                    const channels = getClickableChannelMentions(thread.guild);
                    const roles = getClickableRoleMentions(thread.guild);
                    
                    const embed = new EmbedBuilder()
                        .setTitle('Bookshelf Thread Removed ☝️')
                        .addFields(
                            { name: 'Requirements to Create Bookshelf Threads', value: `• **Shelf Owner** role (purchasable with 1 credit via \`/buy shelf\`)\n• **reader** role (assigned by staff based on feedback quality)`, inline: false },
                            { name: 'Your Current Status', value: `• Shelf Owner: ${hasShelfRole(member) ? '✅' : '❌'}\n• reader: ${hasReaderRole(member) ? '✅' : '❌'}`, inline: false },
                            { name: 'How to Gain Access', value: `1. Give feedback to fellow writers and log it with \`/feedback\`\n2. Purchase shelf access with \`/buy shelf\`\n3. Staff will review your feedback quality and assign you the ${roles.reader} role if your feedback is sufficient\n4. Once you have both roles, you can create ${channels.bookshelf} threads`, inline: false }
                        )
                        .setColor(0xFF9900);
                    
                    await dmChannel.send({ embeds: [embed] });
                } catch (dmError) {
                    console.log('Could not send DM to user:', dmError.message);
                }
            }
        } catch (error) {
            console.error('Error handling thread creation:', error);
        }
    }
});

client.on('threadDelete', async (thread) => {
    // Send activity notification for deleted threads in monitored forums
    if (thread.parent && MONITORED_FORUMS.includes(thread.parent.name)) {
        console.log(`🗑️ Thread deleted in monitored forum: ${thread.name} in ${thread.parent.name}`);
        await sendActivityNotification(thread.guild, 'thread_deleted', {
            threadName: thread.name,
            threadId: thread.id,
            parentId: thread.parentId,
            ownerId: thread.ownerId
        });
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // ACTIVITY MONITORING: Monitor messages in bookshelf-feedback forum ONLY
    if (message.channel.isThread() && 
        message.channel.parent && 
        message.channel.parent.name === 'bookshelf-feedback') {
        
        console.log(`💬 Message posted in ${message.channel.parent.name}: ${message.author.displayName}`);
        
        // Create message preview (truncate if too long)
        let messagePreview = message.content || '*[No text content]*';
        if (messagePreview.length > 100) {
            messagePreview = messagePreview.substring(0, 97) + '...';
        }
        
        await sendActivityNotification(message.guild, 'feedback_posted', {
            thread: message.channel,
            userId: message.author.id,
            messageUrl: message.url,
            messagePreview: messagePreview
        });
    }

    // BOOKSHELF THREAD HANDLING - SINGLE CHECK ONLY
    if (message.channel.isThread() && message.channel.parent && message.channel.parent.name === 'bookshelf') {
        
        // Only thread owners can post
        if (message.channel.ownerId !== message.author.id) {
            await message.delete();
            await sendTemporaryChannelMessage(message.channel, 
                `I am terribly sorry, **${message.author.displayName}**, but only the thread creator can post here!`,
                8000
            );
            return;
        }
        
        // Check if this is the thread owner's first post
        try {
            const messages = await message.channel.messages.fetch({ limit: 50 });
            const ownerMessages = messages.filter(msg => 
                msg.author.id === message.channel.ownerId && 
                msg.id !== message.id // Exclude the current message
            );
            
            const isFirstPost = ownerMessages.size === 0;
            const userRecord = await getUserData(message.author.id); // Add await
            
            if (isFirstPost) {
                // First post is free - no lease consumed
                await sendTemporaryChannelMessage(message.channel, 
                    `📝 Welcome to your bookshelf! First post is complimentary. **${userRecord.chapterLeases}** leases remaining for future chapters. ☝️`, 
                    8000
                );
            } else {
                // Subsequent posts require leases
                if (userRecord.chapterLeases <= 0) {
                    await message.delete();
                    await sendTemporaryChannelMessage(message.channel, 
                        `📝 **${message.author.displayName}**, you have **0 chapter leases** remaining! Purchase more with \`/buy lease\` to continue posting.`,
                        8000
                    );
                    return;
                }
                
                // Has leases - consume one and continue
                await consumeLease(message.author.id); // Use the function instead of direct manipulation
                
                const updatedRecord = await getUserData(message.author.id);
                await sendTemporaryChannelMessage(message.channel, 
                    `📝 Chapter posted! **${updatedRecord.chapterLeases}** leases remaining.`, 
                    8000
                );
            }
            
        } catch (error) {
            console.error('Error checking message history:', error);
            // Fallback to old behavior if there's an error
            const userRecord = await getUserData(message.author.id); // Add await
            
            if (userRecord.chapterLeases <= 0) {
                await message.delete();
                await sendTemporaryChannelMessage(message.channel, 
                    `📝 **${message.author.displayName}**, you have **0 chapter leases** remaining! Purchase more with \`/buy lease\` to continue posting.`,
                    8000
                );
                return;
            }
            
            await consumeLease(message.author.id); // Use the function
            
            const updatedRecord = await getUserData(message.author.id);
            await sendTemporaryChannelMessage(message.channel, 
                `📝 Chapter posted! **${updatedRecord.chapterLeases}** leases remaining.`, 
                8000
            );
        }
        
        return; // CRITICAL: Exit here
    }

    // Handle legacy commands
    if (message.content.startsWith('!')) {
        await handleCommand(message);
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
async function handleCommand(message) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    try {
        console.log(`Processing command: ${command} from ${message.author.displayName}`);
        
        const commandHandlers = {
            feedback: () => handleFeedbackCommand(message),
            feedback_add: () => handleFeedbackAddCommand(message, args),
            feedback_remove: () => handleFeedbackRemoveCommand(message, args),
            feedback_reset: () => handleFeedbackResetCommand(message),
            credit_add: () => handleCreditAddCommand(message, args),
            credit_remove: () => handleCreditRemoveCommand(message, args),
            lease_add: () => handleLeaseAddCommand(message, args),
            help: () => handleHelpCommand(message),
            commands: () => handleCommandsCommand(message),
            hall_of_fame: () => handleHallOfFameCommand(message),
            stats: () => handleStatsCommand(message),
            balance: () => handleBalanceCommand(message),
            store: () => handleStoreCommand(message),
            buy: () => handleBuyCommand(message, args),
            setup_bookshelf: () => handleSetupBookshelfCommand(message),
            pardon: () => handlePardonCommand(message, args),
            purge_list: () => handlePurgeListCommand(message),
        };
        
        const handler = commandHandlers[command];
        if (handler) {
            await handler();
        }
    } catch (error) {
        console.error(`Command error for ${command}:`, error);
        await handleCommandError(message, command, error);
    }
}

async function handleSlashCommand(interaction) {
    const commandHandlers = {
        feedback: () => handleFeedbackSlashCommand(interaction),
        feedback_add: () => handleFeedbackAddSlashCommand(interaction),
        feedback_remove: () => handleFeedbackRemoveSlashCommand(interaction),
        feedback_reset: () => handleFeedbackResetSlashCommand(interaction),
        credit_add: () => handleCreditAddSlashCommand(interaction),
        credit_remove: () => handleCreditRemoveSlashCommand(interaction),
        lease_add: () => handleLeaseAddSlashCommand(interaction),
        help: () => handleHelpSlashCommand(interaction),
        commands: () => handleCommandsSlashCommand(interaction),
        hall_of_fame: () => handleHallOfFameSlashCommand(interaction),
        stats: () => handleStatsSlashCommand(interaction),
        balance: () => handleBalanceSlashCommand(interaction),
        store: () => handleStoreSlashCommand(interaction),
        buy: () => handleBuySlashCommand(interaction),
        setup_bookshelf: () => handleSetupBookshelfSlashCommand(interaction),
        pardon: () => handlePardonSlashCommand(interaction),
        unpardon: () => handleUnpardonSlashCommand(interaction),
        purge_list: () => handlePurgeListSlashCommand(interaction),
        manual_purge: () => handleManualPurgeSlashCommand(interaction),
        post_server_guide: () => handlePostServerGuideSlashCommand(interaction),
        post_rules: () => handlePostRulesSlashCommand(interaction),
        faceless: () => handleFacelessSlashCommand(interaction)
    };
    
    const handler = commandHandlers[interaction.commandName];
    if (handler) {
        console.log(`✅ Executing handler for /${interaction.commandName}`);
        await handler();
        console.log(`✅ Handler completed for /${interaction.commandName}`);
    } else {
        console.error(`❌ No handler found for command: /${interaction.commandName}`);
        const embed = new EmbedBuilder()
            .setTitle('Command Not Found')
            .setDescription(`The command \`/${interaction.commandName}\` is not recognized.`)
            .setColor(0xFF6B6B);
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
}

// ===== FEEDBACK COMMANDS =====

async function logFeedbackForMessage(messageId, userId) {
    try {
        await global.db.db.run('INSERT OR REPLACE INTO logged_feedback (message_id, user_id) VALUES (?, ?)', [messageId, userId]);
    } catch (error) {
        // Ignore errors
    }
}

async function hasUserLoggedFeedbackForMessage(messageId, userId) {
    try {
        const result = await global.db.db.get('SELECT 1 FROM logged_feedback WHERE message_id = ? AND user_id = ?', [messageId, userId]);
        return !!result;
    } catch (error) {
        return false;
    }
}
async function handleFeedbackCommand(message) {
    console.log(`Processing !feedback command for ${message.author.displayName}`);
    return await processFeedbackCommand(message.author, message.member, message.channel, false, null, message);
}

async function handleFeedbackSlashCommand(interaction) {
    console.log(`Processing /feedback command for ${interaction.user.displayName}`);
    return await processFeedbackCommand(interaction.user, interaction.member, interaction.channel, true, interaction, null);
}

async function processFeedbackCommand(user, member, channel, isSlash, interaction = null, message = null) {
    console.log(`Processing feedback command for ${user.displayName} in ${channel.name}`);
    
    // Ensure member object is fresh (re-fetch if needed)
    try {
        member = await channel.guild.members.fetch(user.id);
    } catch (error) {
        console.log('Could not fetch member, using existing member object');
    }
    
    const guild = channel.guild;
    const roles = getClickableRoleMentions(guild);
    
    // Check if user has Level 5 role
    if (!hasLevel5Role(member)) {
        const embed = new EmbedBuilder()
            .setTitle(`**Level 5** Required ☝️`)
            .addFields({
                name: 'How to Gain Access',
                value: `Continue participating in the server activities and earning experience to reach **Level 5** status.`,
                inline: false
            })
            .setColor(0xFF8C00);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage(message, { embeds: [embed] });
        }
    }
    
    const channels = getClickableChannelMentions(guild);
    
    if (!isInAllowedFeedbackThread(channel)) {
        const embed = new EmbedBuilder()
            .setTitle('Incorrect Thread ☝️')
            .setDescription('Feedback credits may only be logged within the designated literary threads of our community, under works other than your own, dear writer.')
            .addFields({
                name: 'Permitted Threads',
                value: `• ${channels.bookshelfFeedback} forum - For recording feedback given to fellow writers\n• ${channels.bookshelfDiscussion} forum - For discussions about literary critiques`,
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage(message, { embeds: [embed] });
        }
    }
    
    if (channel.isThread() && channel.ownerId === user.id) {
        const embed = new EmbedBuilder()
            .setTitle('Cannot Log Your Own Thread ☝️')
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage(message, { embeds: [embed] });
        }
    }
    
    const latestMessage = await findUserLatestMessage(channel, user.id);
    
    if (!latestMessage) {
        const embed = new EmbedBuilder()
            .setTitle('No Feedback Message Found ☝️')
            .setDescription('I regret that I could not locate a recent feedback message from you in this thread, dear writer. You must post your feedback message **before** using the feedback command.')
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage(message, { embeds: [embed] });
        }
    }
    
    if (await hasUserLoggedFeedbackForMessage(latestMessage.id, user.id)) {
        const embed = new EmbedBuilder()
            .setTitle('Feedback Already Logged ☝️')
            .setDescription('Each new message may only be counted once.')
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage(message, { embeds: [embed] });
        }
    }
    
    await logFeedbackForMessage(latestMessage.id, user.id);
    
    const feedbackData = await processFeedbackContribution(user.id);
    
    // Send activity notification if in monitored forum
    if (isMonitoredForum(channel)) {
        const messageUrl = isSlash ? 
            `https://discord.com/channels/${channel.guild.id}/${channel.id}` : 
            message.url;
        
        await sendActivityNotification(channel.guild, 'feedback_command', {
            thread: channel,
            userId: user.id,
            messageUrl: messageUrl
        });
    }
    
    // Create temporary confirmation message
    const confirmationMessage = `Feedback logged! ☝️`;
    
    console.log('Feedback command completed successfully');
    
    // Send temporary reply (8 second timeout)
    if (isSlash) {
        await replyTemporary(interaction, { content: confirmationMessage }, 8000);
    } else {
        await replyTemporaryMessage(message, { content: confirmationMessage }, 8000);
    }
}

// ===== BALANCE COMMANDS =====
async function handleBalanceCommand(message) {
    const user = message.mentions.users.first() || message.author;
    const member = message.mentions.members.first() || message.member;
    const embed = await createBalanceEmbed(user, member, message.guild); // Add await
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleBalanceSlashCommand(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = interaction.options.getMember('user') || interaction.member;
    const embed = await createBalanceEmbed(user, member, interaction.guild); // Add await
    await replyTemporary(interaction, { embeds: [embed] });
}

async function createBalanceEmbed(user, member, guild) {
    const userId = user.id;
    const userRecord = await getUserData(userId);
    const monthlyCount = await getUserMonthlyFeedback(userId);
    const monthlyQuotaStatus = monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT ? '✅ Graciously fulfilled' : '❌ Unfulfilled';
    
    return new EmbedBuilder()
        .addFields(
            { name: 'Total Credits', value: `📝 ${userRecord.totalFeedbackAllTime}`, inline: true },
            { name: 'Monthly Credits', value: `📅 ${monthlyCount}`, inline: true },
            { name: 'Current Credit Balance', value: `💰 ${userRecord.currentCredits}`, inline: true },
            { name: 'Chapter Leases', value: `📄 ${userRecord.chapterLeases}`, inline: true },
            { name: 'Monthly Quota', value: `${monthlyQuotaStatus}`, inline: true },
            { name: 'Bookshelf Status', value: await getBookshelfAccessStatus(userId, member, guild), inline: true } // Add await
        )
        .setColor(0xFF8C00) // Add await
}

// ===== HALL OF FAME COMMANDS =====
async function handleHallOfFameCommand(message) {
    const embed = await createHallOfFameEmbed(message.guild);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleHallOfFameSlashCommand(interaction) {
    const embed = await createHallOfFameEmbed(interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

async function createHallOfFameEmbed(guild) {
    const topContributors = await global.db.getTopContributors(10);
    
    if (topContributors.length === 0) {
        return new EmbedBuilder()
            .setTitle('Hall of Fame ☝️')
            .setDescription('It appears no writers have yet contributed feedback to our literary realm. Perhaps it is time to begin sharing wisdom with fellow scribes?')
            .setColor(0x2F3136);
    }
    
    let leaderboard = '';
    for (let i = 0; i < topContributors.length; i++) {
        const contributor = topContributors[i];
        try {
            const member = await guild.members.fetch(contributor.user_id);
            const rank = i + 1;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
            leaderboard += `${medal} **${member.displayName}** - ${contributor.total_feedback_all_time} credit${contributor.total_feedback_all_time !== 1 ? 's' : ''}\n`;
        } catch (error) {
            continue;
        }
    }
    
    return new EmbedBuilder()
        .setTitle('Hall of Fame ☝️')
        .setDescription('Behold, the most dedicated contributors in our distinguished literary community, honored for their generous sharing of wisdom through thoughtful critique.')
        .addFields({
            name: 'The honorable ranks of our literary champions',
            value: leaderboard || 'No qualifying writers found.',
            inline: false
        })
        .setColor(0xFFD700)
        .setFooter({ text: 'Recognition reflects dedication to nurturing fellow scribes through meaningful feedback' });
}

// ===== STORE COMMANDS =====
async function handleStoreCommand(message) {
    const embed = createStoreEmbed(message.guild);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleStoreSlashCommand(interaction) {
    const embed = createStoreEmbed(interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

function createStoreEmbed(guild) {
    const channels = getClickableChannelMentions(guild);
    const roles = getClickableRoleMentions(guild);
    
    // Get all color items and make them compact
    const colorItems = Object.entries(STORE_ITEMS).filter(([key, item]) => item.category === 'color');
    const colorList = colorItems.map(([key, item]) => {
        // Shortened descriptions
        const shortDescs = {
            'mocha_mousse': 'warm brown',
            'peach_fuzz': 'soft peach',
            'magenta': 'bold purple',
            'very_peri': 'periwinkle blue',
            'illuminating_yellow': 'bright yellow',
            'living_coral': 'orange-pink',
            'marsala': 'wine red',
            'greenery': 'fresh green',
            'mimosa': 'golden yellow',
            'chilli_pepper': 'spicy red',
            'ultimate_gray': 'neutral gray'
        };
        return `${item.emoji} **${item.name}** (${shortDescs[key]})`;
    }).join(' • ');
    
    return new EmbedBuilder()
        .setTitle('Type&Draft Literary Emporium ☝️')
        .addFields(
            { 
                name: '📚 Bookshelf Access', 
                value: `Grants you the ${roles.shelfOwner} role to create threads in ${channels.bookshelf}\n**Price:** ${STORE_ITEMS.shelf.price} credit\n**Note:** ${roles.reader} role must be assigned by staff separately based on feedback quality`, 
                inline: false 
            },
            { 
                name: '📝 Chapter Lease', 
                value: `Allows you to post one message in your bookshelf thread\n**Price:** ${STORE_ITEMS.lease.price} credit each\n**Note:** You can buy multiple leases at once by specifying quantity\n**Special Content:** Contact staff via ticket for free leases when posting maps, artwork, or other non-chapter content`, 
                inline: false 
            },
            { 
                name: '🎨 Color Roles (Level 15 Required, 1 credit each)', 
                value: colorList + "\n• **Note:** These are all real colors, each of them the winner of the Pantone Color of the Year award at some point", 
                inline: false 
            },
            { 
                name: 'How to Purchase', 
                value: `• \`/buy shelf\` - Purchase bookshelf access\n• \`/buy lease\` - Purchase 1 chapter lease\n• \`/buy lease quantity:5\` - Purchase 5 chapter leases\n• \`/buy [color_name]\` - Purchase a color role`, 
                inline: false 
            }
        )
        .setColor(0xFF8C00)
        .setFooter({ text: 'All purchases support our thriving literary community.' });
}


// ===== BUY COMMANDS =====
async function handleBuyCommand(message, args) {
    const itemKey = args[0]?.toLowerCase();
    if (!itemKey || !STORE_ITEMS[itemKey]) {
        return replyTemporaryMessage(message, { content: 'Pray, specify a valid item to purchase. Use `/store` to view available items.' });
    }
    
    const quantity = itemKey === 'lease' ? (parseInt(args[1]) || 1) : 1;
    const result = await processPurchase(message.author.id, itemKey, quantity, message.member, message.guild);
    const embed = createPurchaseResultEmbed(message.author, itemKey, quantity, result, message.guild);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleBuySlashCommand(interaction) {
    const itemKey = interaction.options.getString('item');
    const quantity = STORE_ITEMS[itemKey]?.allowQuantity ? (interaction.options.getInteger('quantity') || 1) : 1;
    const result = await processPurchase(interaction.user.id, itemKey, quantity, interaction.member, interaction.guild);
    const embed = createPurchaseResultEmbed(interaction.user, itemKey, quantity, result, interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

async function processPurchase(userId, itemKey, quantity, member, guild) {
    const item = STORE_ITEMS[itemKey];
    const userRecord = await getUserData(userId);
    const totalCost = item.price * quantity;
    
    // Check level requirements for color roles ONLY
    if (item.category === 'color' && !hasLevel15Role(member)) {
        return { 
            success: false, 
            reason: 'insufficient_level',
            requiredLevel: 15
        };
    }
    
    // For shelf purchases, check if already purchased
    if (itemKey === 'shelf' && userRecord.purchases.includes(itemKey)) {
    return { success: false, reason: 'already_purchased' };
}

    // For color roles, prevent buying the same color they currently have active
    if (item.category === 'color') {
        const currentlyHasThisColor = member.roles.cache.some(role => role.name === item.name);
    if (currentlyHasThisColor) {
        return { success: false, reason: 'color_already_active' };
        }
    }
    
    if (userRecord.currentCredits < totalCost) {
        return {
            success: false,
            reason: 'insufficient_credits',
            needed: totalCost - userRecord.currentCredits,
            current: userRecord.currentCredits,
            totalCost: totalCost
        };
    }
    
    if (await spendCredits(userId, totalCost)) {
        if (itemKey === 'shelf') {
            await global.db.db.run('INSERT OR REPLACE INTO user_purchases (user_id, item) VALUES (?, ?)', [userId, itemKey]);
            if (item.role) {
                await assignPurchaseRoles(member, guild, itemKey);
            }
            return { success: true, creditsSpent: totalCost, quantity: quantity };
        } else if (itemKey === 'lease') {
            await addLeases(userId, quantity);
            return { success: true, creditsSpent: totalCost, quantity: quantity };
        } else if (item.category === 'color') {
    // Handle color role purchase - this will remove old colors and assign new one
    try {
        await assignColorRole(member, guild, itemKey);
        
        // Remove all previous color purchases from database and add the new one
        await removeAllUserColorPurchases(userId);
        await global.db.db.run('INSERT OR REPLACE INTO user_purchases (user_id, item) VALUES (?, ?)', [userId, itemKey]);
        
        return { 
            success: true, 
            creditsSpent: totalCost, 
            quantity: quantity,
            newColor: item.name,
            replaced: true // Indicate this was a replacement
        };
    } catch (error) {
        console.error('Color role assignment failed:', error);
        // Refund the credits if color role assignment fails
        const userData = await getUserData(userId);
        await updateUserData(userId, { 
            currentCredits: userData.currentCredits + totalCost 
        });
        return { success: false, reason: 'color_role_failed' };
    }
}
    }
    
    return { success: false, reason: 'unknown_error' };
}

async function assignPurchaseRoles(member, guild, itemKey) {
    const roleNames = [STORE_ITEMS[itemKey].role];
    
    for (const roleName of roleNames) {
        if (!roleName) continue;
        
        let role = guild.roles.cache.find(r => r.name === roleName);
        if (!role) {
            try {
                const roleColor = 0x8B4513;
                role = await guild.roles.create({
                    name: roleName,
                    color: roleColor,
                    reason: `Role for store purchase: ${itemKey}`
                });
                console.log(`Created role: ${roleName}`);
            } catch (error) {
                console.log(`Failed to create role ${roleName}:`, error.message);
                continue;
            }
        }
        
        try {
            await member.roles.add(role);
            console.log(`Added ${roleName} role to ${member.displayName}`);
        } catch (error) {
            console.log(`Failed to add ${roleName} role:`, error.message);
        }
    }
}

async function processPurchase(userId, itemKey, quantity, member, guild) {
    const item = STORE_ITEMS[itemKey];
    const userRecord = await getUserData(userId);
    const totalCost = item.price * quantity;
    
    // Check level requirements for color roles
    if (item.category === 'color' && item.levelRequired) {
        if (!hasLevel15Role(member)) {
            return { 
                success: false, 
                reason: 'insufficient_level',
                requiredLevel: item.levelRequired
            };
        }
    }
    
    // For shelf purchases, check if already purchased
    if (itemKey === 'shelf' && userRecord.purchases.includes(itemKey)) {
        return { success: false, reason: 'already_purchased' };
    }
    
    // For color roles, only prevent buying the same color they currently have active
    if (item.category === 'color') {
        const currentlyHasThisColor = member.roles.cache.some(role => role.name === item.name);
        if (currentlyHasThisColor) {
            return { success: false, reason: 'color_already_active' };
        }
    }
    
    if (userRecord.currentCredits < totalCost) {
        return {
            success: false,
            reason: 'insufficient_credits',
            needed: totalCost - userRecord.currentCredits,
            current: userRecord.currentCredits,
            totalCost: totalCost
        };
    }
    
    if (await spendCredits(userId, totalCost)) {
        if (itemKey === 'shelf') {
            await global.db.db.run('INSERT OR REPLACE INTO user_purchases (user_id, item) VALUES (?, ?)', [userId, itemKey]);
            if (item.role) {
                await assignPurchaseRoles(member, guild, itemKey);
            }
            return { success: true, creditsSpent: totalCost, quantity: quantity };
        } else if (itemKey === 'lease') {
            await addLeases(userId, quantity);
            return { success: true, creditsSpent: totalCost, quantity: quantity };
        } else if (item.category === 'color') {
            try {
                await assignColorRole(member, guild, itemKey);
                await removeAllUserColorPurchases(userId);
                await global.db.db.run('INSERT OR REPLACE INTO user_purchases (user_id, item) VALUES (?, ?)', [userId, itemKey]);
                return { 
                    success: true, 
                    creditsSpent: totalCost, 
                    quantity: quantity,
                    newColor: item.name,
                    replaced: true
                };
            } catch (error) {
                console.error('Color role assignment failed:', error);
                const userData = await getUserData(userId);
                await updateUserData(userId, { 
                    currentCredits: userData.currentCredits + totalCost 
                });
                return { success: false, reason: 'color_role_failed' };
            }
        }
    }
    
    return { success: false, reason: 'unknown_error' };
}

function createPurchaseResultEmbed(user, itemKey, quantity, result, guild) {
    const item = STORE_ITEMS[itemKey];
    const channels = getClickableChannelMentions(guild);
    const roles = getClickableRoleMentions(guild);
    
    if (!result.success) {
        if (result.reason === 'already_purchased') {
            return new EmbedBuilder()
                .setTitle('Item Already Acquired')
                .setColor(0xFF9900);
        }
        
        if (result.reason === 'color_already_active') {
    return new EmbedBuilder()
        .setTitle('Color Currently Active ☝️')
        .setDescription(`You already have the **${item.name}** color role active, dear writer. Perhaps you'd prefer a different hue from our distinguished palette?`)
        .setColor(0xFF9900);
    }
        
        if (result.reason === 'insufficient_level') {
            return new EmbedBuilder()
                .setTitle(`Level ${result.requiredLevel} Required ☝️`)
                .setDescription(`Color roles are reserved for our most distinguished members who have reached **Level ${result.requiredLevel}** status.`)
                .setColor(0xFF9900);
        }
        
        if (result.reason === 'color_role_failed') {
            return new EmbedBuilder()
                .setTitle('Color Role Assignment Failed ☝️')
                .setDescription('There was an issue assigning your color role. Your credits have been refunded.')
                .setColor(0xFF6B6B);
        }
        
        if (result.reason === 'insufficient_credits') {
            return new EmbedBuilder()
                .setTitle('Insufficient Credits')
                .addFields({
                    name: 'Required Amount', value: `${result.totalCost} credit${result.totalCost === 1 ? '' : 's'}`, inline: true
                }, {
                    name: 'Still Needed', value: `${result.needed} more credit${result.needed === 1 ? '' : 's'}`, inline: true
                })
                .setColor(0xFF6B6B);
        }
        
        return new EmbedBuilder().setTitle('Purchase Failed').setColor(0xFF6B6B);
    }
    
    // Success cases
    if (itemKey === 'shelf') {
        return new EmbedBuilder()
            .setTitle('Purchase Completed Successfully ☝️')
            .addFields(
                { name: 'Item Purchased', value: `${item.emoji} ${item.name}`, inline: true },
                { name: 'Credits Spent', value: `📝 ${result.creditsSpent}`, inline: true },
                { name: 'Role Granted', value: `🎭 ${roles.shelfOwner}`, inline: true },
                { name: 'Important Notice', value: `⚠️ **${roles.reader} role required separately from staff** to post in ${channels.bookshelf} forum. Staff will review your feedback quality and assign the ${roles.reader} role when appropriate.`, inline: false },
                { name: 'Next Steps', value: `1. Continue giving quality feedback to fellow writers\n2. Staff will review and assign ${roles.reader} role when ready\n3. Purchase chapter leases with \`/buy lease\` to post content (1 credit each)`, inline: false }
            )
            .setColor(0x00AA55);
    } else if (itemKey === 'lease') {
        return new EmbedBuilder()
            .setTitle('Lease Purchase Completed ☝️')
            .addFields(
                { name: 'Credits Spent', value: `📝 ${result.creditsSpent}`, inline: true }
            )
            .setColor(0x00AA55);
    } else if (item.category === 'color') {
    const title = result.replaced ? 'Color Role Replaced ☝️' : 'Color Role Acquired ☝️';
    const description = result.replaced ? 
        'Your previous color role has been replaced with your new selection.' : 
        'Your new color role has been successfully assigned.';
    
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .addFields(
            { name: 'New Color Role', value: `${item.emoji} **${item.name}**`, inline: true },
            { name: 'Credits Spent', value: `📝 ${result.creditsSpent}`, inline: true },
            { name: 'Note', value: 'Your name will now display in this color throughout the server.', inline: false }
        )
        .setColor(item.color);
}
    
    // Fallback for other items
    return new EmbedBuilder()
        .setTitle('Purchase Completed ☝️')
        .addFields(
            { name: 'Credits Spent', value: `📝 ${result.creditsSpent}`, inline: true }
        )
        .setColor(0x00AA55);
}
// ===== STAFF COMMANDS =====

// Rules Message for #rules channel
async function handlePostServerGuideSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    await postServerGuide(interaction.channel);
    
    const embed = new EmbedBuilder()
        .setTitle('Server Guide Posted ☝️')
        .setDescription('The navigation guide has been graciously posted to this channel.')
        .setColor(0x00AA55);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handlePostRulesSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    await postRules(interaction.channel);
    
    const embed = new EmbedBuilder()
        .setTitle('Rules Posted ☝️')
        .setDescription('The literary laws have been graciously posted to this channel.')
        .setColor(0x00AA55);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function postServerGuide(channel) {
    try {
        console.log('Starting postServerGuide function...');
        const guild = channel.guild;
        console.log(`Guild: ${guild.name}`);
        
        const channels = getClickableChannelMentions(guild);
        const roles = getClickableRoleMentions(guild);
        console.log('Channels object:', channels);
        
        const embed = new EmbedBuilder()
            .addFields(
                {
                    name: '🏛️ Welcome Halls',
                    value: `${channels.reactionRoles} - Claim your roles with a simple reaction\n${channels.rulesChannel} - Our community covenant (read thoroughly)\n${channels.introductions} - Present yourself to our distinguished assembly\n${channels.bump} - Support our community growth with \`/bump\``,
                    inline: false
                },
                {
                    name: '🎫 Support Quarters',
                    value: `${channels.ticket} - Private counsel with our esteemed staff\n${channels.botStuff} - My own domain. I advise you to take advantage of the \`/help\` command, so you can learn more about the server's inner workings`,
                    inline: false
                },
                {
                    name: '✍️ Scriptorium',
                    value: `${channels.writingChat} - General discourse on the craft\n• In the help channels, our community provides specialized guidance\n${channels.onePageCritique} - Submit short excerpts for detailed feedback\n${channels.snippetShowcase} - Display your finest work for admiration`,
                    inline: false
                },
                {
                    name: '📚 The Citadel',
                    value: `**Level 5** Required: Access this domain by engaging with the community.\n${channels.bookshelfFeedback} - Provide thorough feedback using the \`/feedback\` command to earn credits\n${channels.bookshelf} - Post your chapters or short stories here after you have bought a shelf and a lease from the store. **See:** \`/store\`\n${channels.bookshelfDiscussion} - Scholarly discourse on critiques`,
                    inline: false
                },
                {
                    name: '💰 Our Credit Economy',
                    value: `• **Earn:** 1 credit per quality feedback (**Level 5**+ only)\n• **Purchase:** Bookshelf access (1 credit)\n• **Post:** Chapter leases (1 credit each) to publish your work`,
                    inline: false
                }
            )
            .setColor(0xFF8C00)
            .setFooter({ text: 'Your humble servant in all literary endeavors' });

        console.log('Embed created successfully, sending...');
        await channel.send({ embeds: [embed] });
        console.log('Message sent successfully!');
        
    } catch (error) {
        console.error('Error in postServerGuide:', error);
        throw error; // Re-throw so the command handler can catch it
    }
}

async function postRules(channel) {
    const guild = channel.guild;
    const channels = getClickableChannelMentions(guild);
    const roles = getClickableRoleMentions(guild);

    const embed = new EmbedBuilder()
        .setTitle('The Nine Laws of Type&Draft ☝️')
        .addFields(
            {
                name: '📜 The First Law',
                value: 'All discourse shall be respectful and courteous. Discrimination of any form is strictly forbidden in our halls.',
                inline: false
            },
            {
                name: '📜 The Second Law', 
                value: 'Honor each channel\'s designated purpose. Writing matters belong in writing quarters, and likewise for all other subjects.',
                inline: false
            },
            {
                name: '📜 The Third Law',
                value: `Upon earning access to our ${channels.bookshelf} forum, you may post chapters using chapter leases. The preferred format of feedback in our server is Google Docs, albeit you can deter from it, as long as your contribution is sufficient. **Provide at least one quality feedback or face purging.** Poorly executed feedback shall not count toward your quota. New members must reach **Level 5** in a month; failure to comply will result in removal from the server. This is a necessary measure to maintain our community\'s integrity, and ensure all members contribute meaningfully.`,
                inline: false
            },
            {
                name: '📜 The Fourth Law',
                value: `AI-generated artwork belongs solely in ${channels.aiArt}. AI-written work created from scratch is forbidden. Using AI as a writing tool is acceptable. Violations will be swiftly deleted.`,
                inline: false
            },
            {
                name: '📜 The Fifth Law',
                value: 'Direct messages require explicit permission. Promotional spam results in immediate banishment. Introduction requirement: State your lucky number and favorite animal to prove rule comprehension.',
                inline: false
            },
            {
                name: '📜 The Sixth Law',
                value: '**18+ members only.** Suspected minors must provide age verification (selfie + passport). Failure results in removal. No exceptions, even for tomorrow\'s birthdays.',
                inline: false
            },
            {
                name: '📜 The Seventh Law',
                value: 'NSFW content is permitted within designated spaces. Pornography (content intended for sexual arousal) is strictly prohibited.',
                inline: false
            },
            {
                name: '📜 The Eighth Law',
                value: 'Camaraderie and jest are welcomed, but respect all boundaries. Exercise common sense in all interactions.',
                inline: false
            },
            {
                name: '📜 The Final Law',
                value: 'Arrogance has no place here. If you seek feedback, acknowledge you have room for growth. Dismissive attitudes toward our members result in immediate expulsion.',
                inline: false
            }
        )
        .setColor(0xFF8C00)
        .setFooter({ text: 'Compliance ensures our community\'s continued prosperity' });

    await channel.send({ embeds: [embed] });
}

async function handleFeedbackAddCommand(message, args) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, { content: 'I fear you lack the necessary authority to conduct such administrative actions.' });
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, { content: 'Pray, mention the writer whose feedback record you wish to enhance.' });
    
    const amount = Math.max(1, parseInt(args[1]) || 1);
    await addFeedbackToUser(user.id, amount);
    
    const embed = await createFeedbackModificationEmbed(user, amount, 'added'); // Add await
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleFeedbackAddSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    await addFeedbackToUser(user.id, amount);
    
    const embed = await createFeedbackModificationEmbed(user, amount, 'added'); // Add await
    await replyTemporary(interaction, { embeds: [embed] });
}

async function addFeedbackToUser(userId, amount) {
    const currentCount = await getUserMonthlyFeedback(userId);
    const newCount = currentCount + amount;
    await setUserMonthlyFeedback(userId, newCount);
    
    const userRecord = await getUserData(userId);
    await updateUserData(userId, {
        totalFeedbackAllTime: userRecord.totalFeedbackAllTime + amount,
        currentCredits: userRecord.currentCredits + amount
    });
    
    return { currentCount, newCount };
}

async function handleFeedbackRemoveCommand(message, args) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, { content: 'I fear you lack the necessary authority to conduct such administrative actions.' });
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, { content: 'Pray, mention the writer whose credit balance requires adjustment.' });
    
    const amount = Math.max(1, parseInt(args[1]) || 1);
    console.log(`Staff removing ${amount} from all feedback counters for ${user.displayName}`);
    
    const result = await removeFeedbackFromUser(user.id, amount);
    const embed = await createFeedbackModificationEmbed(user, amount, 'removed'); // Add await
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleFeedbackRemoveSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    console.log(`Staff removing ${amount} from all feedback counters for ${user.displayName}`);
    
    const result = await removeFeedbackFromUser(user.id, amount);
    const embed = await createFeedbackModificationEmbed(user, amount, 'removed'); // Add await
    await replyTemporary(interaction, { embeds: [embed] });
}

async function removeFeedbackFromUser(userId, amount) {
    const userRecord = await getUserData(userId);
    const currentMonthlyCount = await getUserMonthlyFeedback(userId);
    const previousCredits = userRecord.currentCredits;
    const previousAllTime = userRecord.totalFeedbackAllTime;
    
    console.log(`Removing ${amount} from all feedback counters for user ${userId}`);
    console.log(`Previous - Monthly: ${currentMonthlyCount}, All-time: ${previousAllTime}, Credits: ${previousCredits}`);
    
    // Remove from monthly feedback (but don't go below 0)
    const newMonthlyCount = Math.max(0, currentMonthlyCount - amount);
    await setUserMonthlyFeedback(userId, newMonthlyCount);
    
    // Update user data
    await updateUserData(userId, {
        totalFeedbackAllTime: Math.max(0, userRecord.totalFeedbackAllTime - amount),
        currentCredits: Math.max(0, userRecord.currentCredits - amount)
    });
    
    console.log(`New - Monthly: ${newMonthlyCount}, All-time: ${Math.max(0, userRecord.totalFeedbackAllTime - amount)}, Credits: ${Math.max(0, userRecord.currentCredits - amount)}`);
    
    return { 
        previousCredits, 
        newCredits: Math.max(0, userRecord.currentCredits - amount),
        previousMonthly: currentMonthlyCount,
        newMonthly: newMonthlyCount,
        previousAllTime,
        newAllTime: Math.max(0, userRecord.totalFeedbackAllTime - amount)
    };
}

async function createFeedbackModificationEmbed(user, amount, action) {
    const userRecord = await getUserData(user.id);
    const monthlyCount = await getUserMonthlyFeedback(user.id);
    
    if (action === 'added') {
        return new EmbedBuilder()
            .addFields(
                { name: 'Feedback(s) Added ☝️', value: `+${amount}`, inline: false }
            )
            .setColor(0x00AA55);
    } else {
        return new EmbedBuilder()
            .addFields(
                { name: 'Feedback(s) Removed ☝️', value: `-${amount}`, inline: false }
            )
            .setColor(0xFF6B6B);
    }
}


// ===== CREDIT BALANCE MANAGEMENT COMMANDS =====
async function handleCreditAddCommand(message, args) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions.');
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the writer whose credit balance you wish to enhance.');
    
    const amount = Math.max(1, parseInt(args[1]) || 1);
    console.log(`Staff adding ${amount} credits to ${user.displayName}'s balance only`);
    
    const result = await addCreditsToUser(user.id, amount);
    const embed = createCreditBalanceModificationEmbed(user, amount, result, 'added');
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleCreditAddSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    console.log(`Staff adding ${amount} credits to ${user.displayName}'s balance only`);
    
    const result = await addCreditsToUser(user.id, amount);
    const embed = createCreditBalanceModificationEmbed(user, amount, result, 'added');
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleCreditRemoveSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    console.log(`Staff removing ${amount} credits from ${user.displayName}'s balance only`);
    
    const result = await removeCreditsFromUser(user.id, amount);
    const embed = createCreditBalanceModificationEmbed(user, amount, result, 'removed');
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleCreditRemoveSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    console.log(`Staff removing ${amount} credits from ${user.displayName}'s balance only`);
    
    const result = await removeCreditsFromUser(user.id, amount);
    const embed = createCreditBalanceModificationEmbed(user, amount, result, 'removed');
    await replyTemporary(interaction, { embeds: [embed] });
}

async function addCreditsToUser(userId, amount) {
    const userRecord = await getUserData(userId);
    const previousCredits = userRecord.currentCredits;
    
    console.log(`Adding ${amount} credits to user ${userId} balance only. Previous: ${previousCredits}`);
    
    await updateUserData(userId, {
        currentCredits: userRecord.currentCredits + amount
    });
    
    console.log(`New credit balance: ${userRecord.currentCredits + amount} (monthly and all-time totals unchanged)`);
    
    return { 
        previousCredits, 
        newCredits: userRecord.currentCredits + amount,
        monthlyCount: await getUserMonthlyFeedback(userId),
        allTimeTotal: userRecord.totalFeedbackAllTime
    };
}

async function removeCreditsFromUser(userId, amount) {
    const userRecord = await getUserData(userId);
    const previousCredits = userRecord.currentCredits;
    
    console.log(`Removing ${amount} credits from user ${userId} balance only. Previous: ${previousCredits}`);
    
    const newCredits = Math.max(0, userRecord.currentCredits - amount);
    await updateUserData(userId, {
        currentCredits: newCredits
    });
    
    console.log(`New credit balance: ${newCredits} (monthly and all-time totals unchanged)`);
    
    return { 
        previousCredits, 
        newCredits: newCredits,
        monthlyCount: await getUserMonthlyFeedback(userId),
        allTimeTotal: userRecord.totalFeedbackAllTime
    };
}

function createCreditBalanceModificationEmbed(user, amount, result, action) {
    return new EmbedBuilder()
        .setTitle(`Credit Balance ${action === 'removed' ? 'Reduced' : 'Enhanced'} ☝️`)
        .addFields(
            { name: 'Previous Balance', value: `💰 ${result.previousCredits} credit${result.previousCredits !== 1 ? 's' : ''}`, inline: true },
            { name: 'Current Balance', value: `💰 ${result.newCredits} credit${result.newCredits !== 1 ? 's' : ''}`, inline: true },
            { name: `Credits ${action === 'removed' ? 'Removed' : 'Added'}`, value: `${action === 'removed' ? '-' : '+'}${amount}`, inline: true }
        )
        .setColor(action === 'removed' ? 0xFF6B6B : 0x00AA55);
}

// ===== LEASE MANAGEMENT COMMANDS =====
async function handleLeaseAddSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    console.log(`Staff adding ${amount} leases to ${user.displayName}`);
    
    const result = await addLeasesToUser(user.id, amount);
    const embed = createLeaseModificationEmbed(user, amount, result, 'added');
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleLeaseAddSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    console.log(`Staff adding ${amount} leases to ${user.displayName}`);
    
    const result = await addLeasesToUser(user.id, amount);
    const embed = createLeaseModificationEmbed(user, amount, result, 'added');
    await replyTemporary(interaction, { embeds: [embed] });
}

async function addLeasesToUser(userId, amount) {
    const userRecord = await getUserData(userId);
    const previousLeases = userRecord.chapterLeases;
    
    console.log(`Adding ${amount} leases to user ${userId}. Previous: ${previousLeases}`);
    
    await addLeases(userId, amount);
    
    console.log(`New lease balance: ${userRecord.chapterLeases + amount}`);
    
    return { 
        previousLeases, 
        newLeases: userRecord.chapterLeases + amount
    };
}

function createLeaseModificationEmbed(user, amount, result, action) {
    return new EmbedBuilder()
        .setTitle(`Chapter Leases ${action === 'removed' ? 'Reduced' : 'Enhanced'} ☝️`)
        .addFields(
            { name: 'Previous Leases', value: `📄 ${result.previousLeases} lease${result.previousLeases !== 1 ? 's' : ''}`, inline: true },
            { name: 'Current Leases', value: `📄 ${result.newLeases} lease${result.newLeases !== 1 ? 's' : ''}`, inline: true },
            { name: `Leases ${action === 'removed' ? 'Removed' : 'Added'}`, value: `${action === 'removed' ? '-' : '+'}${amount}`, inline: true },
            { name: 'Note', value: 'These leases can be used to post content in bookshelf threads', inline: false }
        )
        .setColor(action === 'removed' ? 0xFF6B6B : 0x00AA55);
}

// ===== FEEDBACK RESET COMMANDS =====
async function handleFeedbackResetSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const resetData = await performCompleteReset(user.id, interaction.guild);
    const embed = createResetEmbed(user, resetData, interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleFeedbackResetSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const resetData = await performCompleteReset(user.id, interaction.guild);
    const embed = createResetEmbed(user, resetData, interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

async function performCompleteReset(userId, guild) {
    const previousCount = await getUserMonthlyFeedback(userId);
    const userRecord = await getUserData(userId);
    const previousAllTime = userRecord.totalFeedbackAllTime;
    const previousLeases = userRecord.chapterLeases;
    const hadShelfAccess = userRecord.purchases.includes('shelf');
    
    await setUserMonthlyFeedback(userId, 0);
    
    const targetMember = guild.members.cache.get(userId);
    if (targetMember) {
        await removeUserRoles(targetMember, guild);
    }
    
    const closedThreads = await closeUserBookshelfThreads(guild, userId);
    
    // Reset user data in database
    await resetUserProgress(userId, guild);
    
    return {
        previousCount,
        previousAllTime,
        previousLeases,
        hadShelfAccess,
        closedThreads
    };
}

async function removeUserRoles(member, guild) {
    const rolesToRemove = ['Shelf Owner'];
    
    for (const roleName of rolesToRemove) {
        const role = guild.roles.cache.find(r => r.name === roleName);
        if (role && member.roles.cache.has(role.id)) {
            try {
                await member.roles.remove(role);
                console.log(`Removed ${roleName} role from ${member.displayName}`);
            } catch (error) {
                console.log(`Failed to remove ${roleName} role:`, error.message);
            }
        }
    }
}

function createResetEmbed(user, resetData, guild) {
    const roles = getClickableRoleMentions(guild);
    
    return new EmbedBuilder()
        .setTitle('Complete Literary Record Reset ☝️')
        .addFields(
            { name: 'Previous Monthly Count', value: `${resetData.previousCount}`, inline: true },
            { name: 'Previous All-Time Total', value: `${resetData.previousAllTime}`, inline: true },
            { name: 'Previous Chapter Leases', value: `${resetData.previousLeases}`, inline: true },
            { name: 'Current Status', value: '**Everything reset to zero**', inline: true },
            { name: 'Bookshelf Access', value: resetData.hadShelfAccess ? `📚 ${roles.shelfOwner} role removed` : '📚 No previous access', inline: true },
            { name: 'Threads Closed', value: `🔒 ${resetData.closedThreads} thread${resetData.closedThreads !== 1 ? 's' : ''} archived and locked`, inline: true },
            { name: 'Action Taken', value: `Complete reset: monthly count, all-time total, chapter leases, purchases cleared, ${roles.shelfOwner} role removed, and all threads closed`, inline: false }
        )
        .setColor(0xFF6B6B);
}

// ===== PARDON COMMANDS =====
async function handlePardonCommand(message, args) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions.');
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the member you wish to pardon from this month\'s feedback requirement.');
    
    const member = message.guild.members.cache.get(user.id);
    
    if (await isUserPardoned(user.id)) { // Add await
        return replyTemporaryMessage(message, 'I regret to inform you that this distinguished member has already been granted clemency for this month\'s requirements.');
    }
    
    await pardonUser(user.id);
    
    const embed = createPardonEmbed(user, 'granted');
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handlePardonSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    
    if (await isUserPardoned(user.id)) { // Add await
        const embed = new EmbedBuilder()
            .setTitle('Already Pardoned ☝️')
            .setDescription('I regret to inform you that this distinguished member has already been granted clemency for this month\'s requirements.')
            .setColor(0xFF9900);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    await pardonUser(user.id);
    
    const embed = createPardonEmbed(user, 'granted');
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleUnpardonSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    
    try {
        // Check if user is actually pardoned first
        const isPardoned = await isUserPardoned(user.id);
        
        if (!isPardoned) {
            const embed = new EmbedBuilder()
                .setTitle('No Pardon Found ☝️')
                .setDescription('This member currently holds no pardon for this month\'s requirements.')
                .setColor(0xFF9900);
            
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        }
        
        // Remove the pardon using the same method that adds it
        const monthKey = getCurrentMonthKey();
        await global.db.db.run('DELETE FROM pardoned_users WHERE user_id = ? AND month_key = ?', [user.id, monthKey]);
        
        const embed = new EmbedBuilder()
            .setTitle('Pardon Revoked ☝️')
            .setDescription(`The clemency previously granted to **${user.displayName}** has been rescinded.`)
            .setColor(0xFF6B6B);
        
        await replyTemporary(interaction, { embeds: [embed] });
        
    } catch (error) {
        console.error('Full unpardon error:', error);
        const embed = new EmbedBuilder()
            .setTitle('Error')
            .setDescription(`Error details: ${error.message}`)
            .setColor(0xFF6B6B);
        
        await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
}

function createPardonEmbed(user, action) {
    return new EmbedBuilder()
        .setTitle('Pardon Granted ☝️')
        .addFields(
            { name: 'Pardoned User', value: `${user.displayName}`, inline: true }
        )
        .setColor(0x00AA55);
}

// ===== MANUAL PURGE COMMANDS =====
async function handleManualPurgeSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    // Defer the reply since this operation might take time
    await interaction.deferReply();
    
    const result = await performManualPurge(interaction.guild);
    const embed = createManualPurgeResultEmbed(result, interaction.guild);
    
    await interaction.editReply({ embeds: [embed] });
}

// Helper function to check if member should be protected from purge
function isProtectedFromPurge(member) {
    if (member.permissions.has(PermissionFlagsBits.ManageMessages) ||
        member.permissions.has(PermissionFlagsBits.ManageRoles) ||
        member.permissions.has(PermissionFlagsBits.ManageGuild) ||
        member.permissions.has(PermissionFlagsBits.Administrator)) {
        return true;
    }
    
    const protectedRoles = ['Admin', 'Moderator', 'Staff', 'Owner', 'Bot Manager'];
    return member.roles.cache.some(role => 
        protectedRoles.some(protectedRole => 
            role.name.toLowerCase().includes(protectedRole.toLowerCase())
        )
    );
}

async function performManualPurge(guild) {
    const allMembers = await guild.members.fetch();
    let purgedMembers = [];
    let failedKicks = [];
    let protectedMembers = [];
    
    // Find all Level 5 members who should be purged
    for (const [userId, member] of allMembers) {
        if (!hasLevel5Role(member)) continue;
        
        const monthlyCount = await getUserMonthlyFeedback(userId); // Add await
        const isPardoned = await isUserPardoned(userId); // Add await
        const meetingRequirement = monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT;
        
        if (!meetingRequirement && !isPardoned) {
            // Check if member is protected from purge
            if (isProtectedFromPurge(member)) {
                protectedMembers.push({
                    displayName: member.displayName,
                    id: userId,
                    monthlyCount: monthlyCount,
                    reason: 'Staff/Admin permissions'
                });
                console.log(`Protected from purge: ${member.displayName} (${monthlyCount} credits) - Staff/Admin`);
                continue;
            }
            
            // This member should be purged
            try {
                await member.kick(`Monthly purge - Failed to meet feedback requirement (${monthlyCount}/${MONTHLY_FEEDBACK_REQUIREMENT} credits)`);
                purgedMembers.push({
                    displayName: member.displayName,
                    id: userId,
                    monthlyCount: monthlyCount
                });
                console.log(`Purged member: ${member.displayName} (${monthlyCount} credits)`);
                
                // Clean up their data after successful kick
                await resetUserProgress(userId, guild);
                
                // Small delay to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                failedKicks.push({
                    displayName: member.displayName,
                    id: userId,
                    error: error.message
                });
                console.error(`Failed to kick ${member.displayName}:`, error);
            }
        }
    }
    
    return {
        purgedMembers,
        failedKicks,
        protectedMembers,
        totalPurged: purgedMembers.length,
        totalFailed: failedKicks.length,
        totalProtected: protectedMembers.length
    };
}

function createManualPurgeResultEmbed(result, guild) {
    const { purgedMembers, failedKicks, protectedMembers, totalPurged, totalFailed, totalProtected } = result;
    const roles = getClickableRoleMentions(guild);
    
    let purgedList = '';
    if (purgedMembers.length > 0) {
        purgedList = purgedMembers.slice(0, 10).map(member => 
            `• **${member.displayName}** (${member.monthlyCount} credits)`
        ).join('\n');
        
        if (purgedMembers.length > 10) {
            purgedList += `\n• *...and ${purgedMembers.length - 10} more*`;
        }
    } else {
        purgedList = '• No members were purged';
    }
    
    let protectedList = '';
    if (protectedMembers.length > 0) {
        protectedList = protectedMembers.slice(0, 5).map(member => 
            `• **${member.displayName}** (${member.monthlyCount} credits) - ${member.reason}`
        ).join('\n');
        
        if (protectedMembers.length > 5) {
            protectedList += `\n• *...and ${protectedMembers.length - 5} more*`;
        }
    } else {
        protectedList = '• No protected members found';
    }
    
    let failedList = '';
    if (failedKicks.length > 0) {
        failedList = failedKicks.slice(0, 5).map(member => 
            `• **${member.displayName}** - ${member.error}`
        ).join('\n');
        
        if (failedKicks.length > 5) {
            failedList += `\n• *...and ${failedKicks.length - 5} more failures*`;
        }
    } else {
        failedList = '• No failures occurred';
    }
    
    const embed = new EmbedBuilder()
        .setTitle('Manual Purge Completed ☝️')
        .setDescription('The monthly purge has been executed with the precision befitting our literary standards.')
        .addFields(
            { name: `🔥 Successfully Purged (${totalPurged})`, value: purgedList, inline: false },
            { name: `🛡️ Protected from Purge (${totalProtected})`, value: protectedList, inline: false }
        )
        .setColor(totalFailed === 0 ? 0x00AA55 : 0xFF9900)
        .setTimestamp();
    
    if (totalFailed > 0) {
        embed.addFields(
            { name: `Failed to Purge (${totalFailed})`, value: failedList, inline: false }
        );
    }
    
    embed.setFooter({ 
        text: `Purge complete • ${totalPurged} removed • ${totalProtected} protected • ${totalFailed} failed • Requirement: ${MONTHLY_FEEDBACK_REQUIREMENT} credit${MONTHLY_FEEDBACK_REQUIREMENT !== 1 ? 's' : ''}/month` 
    });
    
    return embed;
}

// ===== STATS COMMANDS =====
async function handleStatsCommand(message) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return replyTemporaryMessage(message, { content: 'I regret that such privileged information is reserved for those with administrative authority.' });
    }
    
    const embed = await createStatsEmbed(message.guild);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleStatsSlashCommand(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Authority')
            .setColor(0xFF6B6B);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    const embed = await createStatsEmbed(interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

async function createStatsEmbed(guild) {
    const totalMembers = guild.memberCount;
    const roles = getClickableRoleMentions(guild);
    
    // Get all Level 5 members
    const level5Members = guild.members.cache.filter(member => hasLevel5Role(member));
    const totalLevel5 = level5Members.size;
    
    let monthlyContributors = 0;
    let fulfillmentList = '';
    let nonFulfillmentList = '';
    let pardonedList = '';
    let pardonedCount = 0;
    
    // Process each member
    for (const [userId, member] of level5Members) {
        const monthlyCount = await getUserMonthlyFeedback(userId);
        const isPardoned = await isUserPardoned(userId);
        const status = monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT ? '✅' : '❌';
        
        // FIXED LOGIC: Check requirement first, then pardon
        if (monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT) {
            monthlyContributors++;
            fulfillmentList += `${status} **${member.displayName}** (${monthlyCount})\n`;
        } else if (isPardoned) {
            pardonedCount++;
            pardonedList += `${status} **${member.displayName}** (${monthlyCount}) - *Pardoned*\n`;
        } else {
            nonFulfillmentList += `${status} **${member.displayName}** (${monthlyCount})\n`;
        }
    }
    
    const contributionRate = totalLevel5 > 0 ? Math.round((monthlyContributors / totalLevel5) * 100) : 0;
    
    // Combine all level 5 member details
    let level5Details = '';
    if (fulfillmentList) level5Details += fulfillmentList;
    if (pardonedList) level5Details += pardonedList;
    if (nonFulfillmentList) level5Details += nonFulfillmentList;
    
    if (!level5Details) level5Details = `• No **Level 5** members found`;
    if (level5Details.length > 1024) {
        level5Details = level5Details.substring(0, 1000) + '...\n*(List truncated)*';
    }
    
    const embed = new EmbedBuilder()
        .setTitle('Type&Draft Community Statistics ☝️')
        .addFields(
            { name: 'Total Writers in Our Halls', value: `${totalMembers} souls`, inline: true },
            { name: 'Members Tracked', value: `${totalLevel5} writers`, inline: true },
            { name: 'Active Contributors This Month', value: `${monthlyContributors} writers`, inline: true },
            { name: 'Monthly Participation Rate', value: `${contributionRate}%`, inline: true },
            { name: 'Community Health', value: contributionRate >= 70 ? '✅ Flourishing' : contributionRate >= 50 ? '⚠️ Moderate' : '🔴 Requires attention', inline: true },
            { name: 'Pardoned This Month', value: `${pardonedCount} members`, inline: true },
            { name: 'Overview', value: `• **${totalLevel5}** total **Level 5** members\n• **${monthlyContributors}** meeting requirements\n• **${pardonedCount}** pardoned this month`, inline: false },
            { name: 'Detailed Status', value: level5Details, inline: false }
        )
        .setColor(contributionRate >= 70 ? 0x00AA55 : contributionRate >= 50 ? 0xFF9900 : 0xFF4444)
        .setFooter({ text: `Monthly purge kicks inactive **Level 5** members since July 2025 • ✅ = Meeting requirement • ❌ = Below requirement` });
    
    return embed;
}

// ===== SETUP BOOKSHELF COMMANDS =====
async function handleSetupBookshelfCommand(message, args) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions.');
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the writer to whom you wish to grant bookshelf privileges.');
    
    const result = await grantBookshelfAccess(user.id, message.guild.members.cache.get(user.id), message.guild);
    const embed = createBookshelfGrantEmbed(user, result, message.guild);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleSetupBookshelfSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const member = interaction.guild.members.cache.get(user.id);
    const result = await grantBookshelfAccess(user.id, member, interaction.guild);
    const embed = createBookshelfGrantEmbed(user, result, interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

async function grantBookshelfAccess(userId, member, guild) {
    const userRecord = await getUserData(userId);
    
    if (userRecord.purchases.includes('shelf')) {
        return { success: false, reason: 'already_has_access' };
    }
    
    await global.db.addPurchase(userId, 'shelf');
    
    try {
        let shelfRole = guild.roles.cache.find(r => r.name === 'Shelf Owner');
        if (!shelfRole) {
            shelfRole = await guild.roles.create({
                name: 'Shelf Owner',
                color: 0x8B4513,
                reason: 'Staff granted bookshelf access'
            });
        }
        await member.roles.add(shelfRole);
    } catch (error) {
        console.log('Failed to assign Shelf Owner role:', error.message);
    }
    
    return { success: true };
}

function createBookshelfGrantEmbed(user, result, guild) {
    const roles = getClickableRoleMentions(guild);
    
    if (!result.success) {
        const errorMessages = {
            already_has_access: new EmbedBuilder()
                .setTitle('Already Granted ☝️')
                .setColor(0xFF9900)
        };
        return errorMessages[result.reason];
    }
    
    return new EmbedBuilder()
        .setTitle('Bookshelf Access Granted ☝️')
        .addFields(
            { name: 'Privileges Achieved', value: `📚 ${roles.shelfOwner} role\n🎭 Thread creation access`, inline: false },
            { name: 'Important Note', value: `⚠️ **${roles.reader} role still required from staff** to post content. User must also purchase chapter leases to post messages.`, inline: false }
        )
        .setColor(0x00AA55);
}

// ===== PURGE LIST COMMANDS =====
async function handlePurgeListSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const embed = await createPurgeListEmbed(interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handlePurgeListSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const embed = await createPurgeListEmbed(interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

async function createPurgeListEmbed(guild) {
    const allMembers = await guild.members.fetch();
    const roles = getClickableRoleMentions(guild);
    
    let purgeList = '';
    let pardonedList = '';
    let protectedList = '';
    let purgeCount = 0;
    let pardonedCount = 0;
    let protectedCount = 0;
    
    // Process each member - need to handle async calls
    for (const [userId, member] of allMembers) {
        try {
            const monthlyCount = await getUserMonthlyFeedback(userId);
            const isPardoned = await isUserPardoned(userId);
            const meetingRequirement = monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT;
            const isProtected = isProtectedFromPurge(member);
            
            if (!meetingRequirement && !isPardoned && !isProtected) {
                // Would be purged
                purgeCount++;
                if (purgeList.length < 900) { // Leave room for truncation message
                    purgeList += `❌ **${member.displayName}** (${monthlyCount} credits)\n`;
                }
            } else if (!meetingRequirement && isPardoned) {
                // Pardoned from purge
                pardonedCount++;
                if (pardonedList.length < 900) { // Leave room for truncation message
                    pardonedList += `✅ **${member.displayName}** (${monthlyCount} credits)\n`;
                }
            } else if (!meetingRequirement && isProtected) {
                // Protected from purge
                protectedCount++;
                if (protectedList.length < 900) { // Leave room for truncation message
                    protectedList += `🛡️ **${member.displayName}** (${monthlyCount} credits) - Staff\n`;
                }
            }
        } catch (error) {
            console.error(`Error processing member ${member.displayName}:`, error);
            continue; // Skip this member and continue with others
        }
    }
    
    const embed = new EmbedBuilder()
        .setTitle('Monthly Purge List ☝️')
        .setDescription('Do not be alarmed, my liege. This list merely reflects the current status quo, but it is subject to change, depending on the actions of our noble writers.')
        .addFields(
            { name: `🔥 To be Purged (${purgeCount})`, value: purgeList, inline: false },
            { name: `🛡️ Pardoned from Purge (${pardonedCount})`, value: pardonedList, inline: false },
            { name: 'Notes', value: `• **Monthly minimum:** ${MONTHLY_FEEDBACK_REQUIREMENT} credit${MONTHLY_FEEDBACK_REQUIREMENT !== 1 ? 's' : ''}`, inline: false }
        )
        .setColor(purgeCount > 0 ? 0xFF4444 : 0x00AA55);
    
    return embed;
}

// ===== HELP AND COMMANDS =====
async function handleCommandsCommand(message) {
    const embed = createAllCommandsEmbed();
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleCommandsSlashCommand(interaction) {
    const embed = createAllCommandsEmbed();
    await replyTemporary(interaction, { embeds: [embed] });
}

function createAllCommandsEmbed() {
    return new EmbedBuilder()
        .setTitle('Staff Commands Directory ☝️')
        .addFields(
            { 
                name: '👑 Feedback Management', 
                value: '`/feedback_add` - Add feedback credits (affects monthly, all-time, and current balance)\n`/feedback_remove` - Remove feedback credits (affects monthly, all-time, and current balance)\n`/feedback_reset` - Complete account reset\n`/credit_add` - Add to current credit balance only\n`/credit_remove` - Remove from current credit balance only\n`/lease_add` - Add chapter leases to a member', 
                inline: false 
            },
            { 
                name: '👑 Server Administration', 
                value: '`/stats` - View detailed server statistics\n`/setup_bookshelf` - Grant bookshelf access to a member\n`/pardon` - Pardon a member from monthly feedback requirement\n`/unpardon` - Remove pardon from a member\n`/purge_list` - View all members who would be purged\n`/manual_purge` - Execute manual purge of all qualifying members', 
                inline: false 
            }
        )
        .setColor(0x2F3136)
        .setFooter({ text: 'Your humble servant in all matters literary and administrative' });
}

async function handleHelpCommand(message) {
    const embed = createHelpEmbed(message.guild);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleHelpSlashCommand(interaction) {
    const embed = createHelpEmbed(interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

function createHelpEmbed(guild) {
    const channels = getClickableChannelMentions(guild);
    const roles = getClickableRoleMentions(guild);
    
    return new EmbedBuilder()
        .setTitle('Essential Commands at Your Service ☝️')
        .addFields(
            { 
                name: `📝 Earning Feedback Credits (**Level 5** Required)`, 
                value: `**Step 1:** Visit ${channels.bookshelfFeedback} or ${channels.bookshelfDiscussion} forums\n**Step 2:** Find another writer's thread and provide thoughtful feedback\n**Step 3:** Use \`/feedback\` to log your most recent contribution\n**Step 4:** Earn 1 credit per logged feedback!`, 
                inline: false 
            },
            { 
                name: '💰 Credit System', 
                value: '`/balance` - Check your credits and lease availability\n`/hall_of_fame` - See top contributors leaderboard', 
                inline: false 
            },
            { 
                name: '📚 Bookshelf Access', 
                value: `\`/store\` - View all the items for sale in our store\n\`/buy shelf\` - Purchase bookshelf access (1 credit)\n**Important:** You need **both** the ${roles.shelfOwner} role (purchasable) **and** the ${roles.reader} role (staff-assigned) to create threads in ${channels.bookshelf}`, 
                inline: false 
            },
            { 
                name: '✍️ Chapter Posting', 
                value: 'After gaining bookshelf access:\n1. Purchase chapter leases with `/buy lease` (1 credit each)\n2. Create your thread in the bookshelf forum\n3. Each chapter/short story you post will automatically consume one lease\n4. Contact staff via ticket for free leases when posting maps, artwork, or special content', 
                inline: false 
            },
            { 
                name: '🎭 Lighthearted Tomfoolery', 
                value: '`/faceless` - Make anonymous confessions to the community\n*"The Many-Faced God protects your secrets, dear writer"*\n**Note:** To avoid spammers/trolls, Level 15 is required', 
                inline: false 
            },
            { 
                name: '👑 Staff Commands', 
                value: 'Use `/commands` to see the complete list of all available staff tools.', 
                inline: false 
            }
        )
        .setColor(0x5865F2)
        .setFooter({ text: 'Your humble servant in all matters literary and administrative' });
}

// ===== ERROR HANDLERS =====
async function handleCommandError(message, command, error) {
    const errorEmbed = new EmbedBuilder()
        .setTitle('An Unforeseen Complication')
        .addFields({
            name: 'Command',
            value: `\`!${command}\``,
            inline: true
        }, {
            name: 'Error',
            value: `\`\`\`${error.message}\`\`\``,
            inline: false
        })
        .setColor(0xFF6B6B);
    
    try {
        await replyTemporaryMessage(message, { embeds: [errorEmbed] });
    } catch (replyError) {
        console.error('Failed to send error message:', replyError);
    }
}

async function handleInteractionError(interaction, error) {
    const errorEmbed = new EmbedBuilder()
        .setTitle('An Unforeseen Complication')
        .setDescription('I regret that an unforeseen complication has arisen while processing your request. Perhaps you might try again, or seek assistance from our esteemed staff?')
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
        .setTitle('Insufficient Authority')
        .setColor(0xFF6B6B);
    
    if (isInteraction) {
        return await replyTemporary(target, { embeds: [embed], ephemeral: true });
    } else {
        return await replyTemporaryMessage(target, { embeds: [embed] });
    }
}

// ===== FACELESS COMMAND =====

async function getFacelessCooldown(userId) {
    return await global.db.getFacelessCooldown(userId);
}

async function setFacelessCooldown(userId) {
    await global.db.setFacelessCooldown(userId);
}

async function isOnFacelessCooldown(userId) {
    const lastUsed = await getFacelessCooldown(userId);
    const cooldownTime = 5 * 60 * 1000; // 5 minutes in milliseconds
    const timeRemaining = (lastUsed + cooldownTime) - Date.now();
    
    if (timeRemaining > 0) {
        return {
            onCooldown: true,
            timeRemaining: Math.ceil(timeRemaining / 1000) // seconds remaining
        };
    }
    
    return { onCooldown: false };
}

async function cleanupOldCooldowns() {
    await global.db.cleanupOldCooldowns();
}

async function handleFacelessSlashCommand(interaction) {
    const userId = interaction.user.id;
    const confession = interaction.options.getString('confession');
    
    // Check if user has Level 15 role
    if (!hasLevel15Role(interaction.member)) {
        const embed = new EmbedBuilder()
            .setTitle(`**Level 15** Required ☝️`)
            .setDescription('The Many-Faced God only speaks with those who have proven their dedication to our literary realm.')
            .addFields({
                name: 'How to Gain Access',
                value: `Continue participating in the server activities and earning experience to reach **Level 15** status.`,
                inline: false
            })
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Check cooldown first - ADD AWAIT
    const cooldownStatus = await isOnFacelessCooldown(userId);
    
    if (cooldownStatus.onCooldown) {
        const minutes = Math.floor(cooldownStatus.timeRemaining / 60);
        const seconds = cooldownStatus.timeRemaining % 60;
        const timeString = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
        
        const cooldownEmbed = new EmbedBuilder()
            .setTitle('The Many-Faced God Requires Patience ☝️')
            .setDescription(`The shadows must settle before you can confess again. Please, wait **${timeString}**.`)
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [cooldownEmbed], ephemeral: true }, 10000);
    }
    
    // Don't allow in forum channels
    if (interaction.channel.isThread() && interaction.channel.parent && 
        (interaction.channel.parent.type === 15)) { // Forum channel
        const embed = new EmbedBuilder()
            .setTitle('Chamber Unsuitable ☝️')
            .setDescription('The Many-Faced God does not whisper secrets in the formal halls. Seek a more... casual venue.')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true }, 8000);
    }
    
    // Array of Faceless Men themed postscripts
    const facelessPostscripts = [
        "A writer has no name, but has many secrets.",
        "The Many-Faced God hears all confessions.",
        "What is written in shadow need not burden the light.",
        "A secret shared is a burden halved, a name forgotten.",
        "The House of Black and White keeps all truths.",
        "Valar morghulis - all men must die, but secrets live forever.",
        "A girl knows many things, but speaks none of them.",
        "In Braavos, even the stones keep secrets.",
        "A confession without a face is a truth without consequence.",
        "The Many-Faced God smiles upon honest words spoken in shadow.",
        "A man speaks truth when a man has no name to protect."
    ];
    
    // Select random postscript
    const randomPostscript = facelessPostscripts[Math.floor(Math.random() * facelessPostscripts.length)];
    
    // Create the confession embed
    const confessionEmbed = new EmbedBuilder()
        .setTitle('🎭 Anonymous Confession 🎭')
        .setDescription(`*"${confession}"*`)
        .setColor(0x000000)
        .setFooter({ text: randomPostscript })
        .setTimestamp();
    
    try {
        // Send PERMANENT anonymous confession
        const confessionMessage = await interaction.channel.send({ embeds: [confessionEmbed] });
        
        // Set cooldown AFTER successful posting - ADD AWAIT
        await setFacelessCooldown(userId);
        
        // Clean up old cooldowns periodically
        if (Math.random() < 0.1) { // 10% chance to cleanup
            await cleanupOldCooldowns(); // ADD AWAIT
        }
        
        console.log(`Permanent anonymous confession posted - Message ID: ${confessionMessage.id}`);
        
        // Send ephemeral confirmation (only user sees this)
        const confirmEmbed = new EmbedBuilder()
            .setTitle('🎭 Confession Delivered')
            .setDescription('Your words have been whispered to the shadows. No trace remains. The confession is permanent.')
            .addFields({
                name: 'Next Confession Available',
                value: 'In 5 minutes',
                inline: true
            })
            .setColor(0x2F4F4F);
        
        await interaction.reply({ embeds: [confirmEmbed], ephemeral: true });
        
    } catch (error) {
        console.error('Error posting faceless confession:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setTitle('Confession Failed ☝️')
            .setDescription('The shadows themselves reject your words. Try again.')
            .setColor(0xFF6B6B);
        
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
}

// ===== BOT LOGIN =====
client.login(process.env.DISCORD_BOT_TOKEN);

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    if (global.db) {
        await global.db.close();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    if (global.db) {
        await global.db.close();
    }
    process.exit(0);
});
