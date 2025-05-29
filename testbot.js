require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs').promises;

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
        description: "Grants you the Shelf Owner role (reader role required separately from staff)",
        price: 1,
        role: "Shelf Owner",
        emoji: "📚"
    }
};

const ALLOWED_FEEDBACK_THREADS = ['bookshelf-feedback', 'bookshelf-discussion'];
const MONTHLY_FEEDBACK_REQUIREMENT = 2;
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

// ===== DATA STORAGE =====
let monthlyFeedback = {};
let userData = {};
let loggedFeedbackMessages = {};
let pardonedUsers = {};

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
        
        if (userData[userId] || monthlyFeedback[userId]) {
            this.logger.log(`🔄 Resetting data for rejoining member: ${member.displayName}`);
            await resetUserProgress(userId, member.guild);
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
        const rulesChannel = getChannelMention(guild, 'rules');
        const serverGuideChannel = getChannelMention(guild, 'server-guide');
        
        const embed = new EmbedBuilder()
            .setTitle('A New Bird Joins Our Nest ☝️')
            .setDescription(`Ah, ${member}... How delightful. Another soul seeks to join our most distinguished gathering of scribes and storytellers. I confess, your arrival brings me considerable pleasure. Welcome, welcome indeed, to Type&Draft, where words are currency and wisdom flows like wine. Please, after you have studied our ${channels.rulesChannel} and our ${channels.serverGuideChannel}, use the ${channels.botstuff} channel, and trigger the \`/help\` command for instructions on server mechanics. `)
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
        botstuff: getChannelMention(guild, 'bot-stuff')
    };
}

// ===== UTILITY FUNCTIONS =====
function getCurrentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth()}`;
}

function getUserMonthlyFeedback(userId) {
    const monthKey = getCurrentMonthKey();
    if (!monthlyFeedback[userId]) monthlyFeedback[userId] = {};
    return Math.max(0, monthlyFeedback[userId][monthKey] || 0);
}

function setUserMonthlyFeedback(userId, count) {
    const monthKey = getCurrentMonthKey();
    if (!monthlyFeedback[userId]) monthlyFeedback[userId] = {};
    monthlyFeedback[userId][monthKey] = Math.max(0, count);
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

function getUserData(userId) {
    if (!userData[userId]) {
        userData[userId] = {
            totalFeedbackAllTime: 0,
            currentCredits: 0,
            purchases: [],
            bookshelfPosts: 0
        };
    }
    
    const user = userData[userId];
    if (!Array.isArray(user.purchases)) user.purchases = [];
    if (typeof user.totalFeedbackAllTime !== 'number') user.totalFeedbackAllTime = 0;
    if (typeof user.currentCredits !== 'number') user.currentCredits = 0;
    if (typeof user.bookshelfPosts !== 'number') user.bookshelfPosts = 0;
    
    user.totalFeedbackAllTime = Math.max(0, user.totalFeedbackAllTime);
    user.currentCredits = Math.max(0, user.currentCredits);
    user.bookshelfPosts = Math.max(0, user.bookshelfPosts);
    
    return user;
}

function hasReaderRole(member) {
    if (!member?.roles?.cache) return false;
    return member.roles.cache.some(role => role.name === 'reader');
}

function canCreateBookshelfThread(member) {
    return hasShelfRole(member) && hasReaderRole(member);
}

function spendCredits(userId, amount) {
    const user = getUserData(userId);
    const validAmount = Math.max(0, Math.floor(amount));
    if (user.currentCredits >= validAmount) {
        user.currentCredits -= validAmount;
        console.log(`User ${userId} spent ${validAmount} credits. Remaining: ${user.currentCredits}`);
        return true;
    }
    console.log(`Insufficient credits for ${userId}: has ${user.currentCredits}, needs ${validAmount}`);
    return false;
}

function getBookshelfAccessStatus(userId, member = null) {
    const user = getUserData(userId);
    
    if (user.purchases.includes('shelf')) {
        if (member && hasReaderRole(member)) {
            return '✅ Full bookshelf access granted';
        } else {
            return '✅ Shelf Owner role acquired - reader role needed from staff';
        }
    } else if (user.totalFeedbackAllTime < 1) {
        return `📝 Need 1 more credit to qualify for bookshelf purchase`;
    } else {
        return '💰 Ready to purchase shelf access (credit requirement met)';
    }
}

function canPostInBookshelf(userId, member) {
    const user = getUserData(userId);
    const hasEnoughFeedback = user.totalFeedbackAllTime >= MINIMUM_FEEDBACK_FOR_SHELF;
    const hasShelfPurchase = user.purchases.includes('shelf');
    const hasRequiredRoles = member ? (hasShelfRole(member) && hasReaderRole(member)) : false;
    
    return hasEnoughFeedback && hasShelfPurchase && hasRequiredRoles;
}

function canMakeNewPost(userId) {
    const user = getUserData(userId);
    return user.currentCredits >= 1;
}

function getPostCreditStatus(userId, member) {
    const user = getUserData(userId);
    
    if (user.totalFeedbackAllTime < 1) {
        return `📝 Need bookshelf to qualify for purchase`;
    }
    
    if (!user.purchases.includes('shelf')) {
        return '💰 Qualified for purchase';
    }
    
    if (!member || !hasReaderRole(member)) {
        return '🔓 Awaiting reader role from staff';
    }
    
    if (user.currentCredits >= 1) {
        return `✅ ${user.currentCredits} credit${user.currentCredits === 1 ? '' : 's'} available for chapters`;
    } else {
        return `📝 Need more feedback to post chapters`;
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

function isServerOwner(userId, guild) {
    return userId === guild.ownerId;
}

function hasUserLoggedFeedbackForMessage(messageId, userId) {
    if (!loggedFeedbackMessages[messageId]) return false;
    return loggedFeedbackMessages[messageId].includes(userId);
}

function logFeedbackForMessage(messageId, userId) {
    if (!loggedFeedbackMessages[messageId]) {
        loggedFeedbackMessages[messageId] = [];
    }
    if (!loggedFeedbackMessages[messageId].includes(userId)) {
        loggedFeedbackMessages[messageId].push(userId);
    }
}

// ===== PARDON SYSTEM FUNCTIONS =====
function isUserPardoned(userId) {
    const monthKey = getCurrentMonthKey();
    return pardonedUsers[monthKey] && pardonedUsers[monthKey].includes(userId);
}

function pardonUser(userId) {
    const monthKey = getCurrentMonthKey();
    if (!pardonedUsers[monthKey]) {
        pardonedUsers[monthKey] = [];
    }
    if (!pardonedUsers[monthKey].includes(userId)) {
        pardonedUsers[monthKey].push(userId);
    }
}

// ===== MONTHLY PURGE SYSTEM =====
async function performMonthlyPurge(guild) {
    console.log('Starting monthly purge - kicking inactive Level 5 members...');
    
    const now = new Date();
    const purgeStartDate = new Date('2025-07-01');
    if (now < purgeStartDate) {
        console.log('Monthly purge not yet active (starts July 1, 2025)');
        return { success: false, reason: 'not_active_yet' };
    }
    
    // Force fetch all guild members to ensure cache is populated
    try {
        await guild.members.fetch();
        console.log(`Fetched ${guild.members.cache.size} members for purge`);
    } catch (error) {
        console.error('Failed to fetch guild members for purge:', error);
    }
    
    let purgedCount = 0;
    const purgedUsers = [];
    const exemptUsers = [];
    const pardonedList = [];
    
    // Get all members with Level 5 role
    const level5Members = guild.members.cache.filter(member => hasLevel5Role(member));
    
    console.log(`Found ${level5Members.size} Level 5 members for purge evaluation`);
    
    if (level5Members.size === 0) {
        console.log('No Level 5 members found for monthly purge');
        return { success: false, reason: 'no_level5_members' };
    }
    
    for (const [userId, member] of level5Members) {
        if (isUserPardoned(userId)) {
            console.log(`Skipping ${member.displayName} - pardoned this month`);
            pardonedList.push(member.displayName);
            continue;
        }
        
        const monthlyCount = getUserMonthlyFeedback(userId);
        
        if (monthlyCount < MONTHLY_FEEDBACK_REQUIREMENT) {
            try {
                try {
                    const dmChannel = await member.createDM();
                    const embed = new EmbedBuilder()
                        .setTitle('Monthly Requirement Not Met - Server Removal ☝️')
                        .setDescription(`Dear ${member.displayName}, I regret to inform you that you are being removed from the server due to insufficient feedback contributions this month.`)
                        .addFields(
                            { name: 'Your Monthly Contributions', value: `${monthlyCount} feedback credits`, inline: true },
                            { name: 'Required Amount', value: `${MONTHLY_FEEDBACK_REQUIREMENT} feedback credits`, inline: true },
                            { name: 'What This Means', value: '• You are being kicked from the server\n• You may rejoin if invited again\n• Your progress will be reset upon rejoining', inline: false },
                            { name: 'How to Avoid This in Future', value: '1. Provide thoughtful feedback to fellow writers\n2. Log your contributions with `/feedback`\n3. Meet the monthly requirement of 2 feedback credits', inline: false }
                        )
                        .setColor(0xFF6B6B);
                    
                    await dmChannel.send({ embeds: [embed] });
                } catch (dmError) {
                    console.log(`Could not send purge notification DM to ${member.displayName}`);
                }
                
                await member.kick('Monthly feedback requirement not met - automatic purge');
                
                purgedCount++;
                purgedUsers.push(`${member.displayName} (${monthlyCount}/${MONTHLY_FEEDBACK_REQUIREMENT})`);
                console.log(`Kicked ${member.displayName} for insufficient monthly feedback (${monthlyCount}/${MONTHLY_FEEDBACK_REQUIREMENT})`);
                
            } catch (error) {
                console.error(`Failed to kick ${member.displayName}:`, error);
            }
        } else {
            exemptUsers.push(`${member.displayName} (${monthlyCount}/${MONTHLY_FEEDBACK_REQUIREMENT})`);
        }
    }
    
    console.log(`Monthly purge completed: ${purgedCount} Level 5 members kicked from server for inactivity`);
    if (purgedUsers.length > 0) {
        console.log(`Kicked users: ${purgedUsers.join(', ')}`);
    }
    
    return { 
        success: true, 
        purgedCount, 
        purgedUsers, 
        pardonedUsers: pardonedList, 
        exemptUsers,
        totalLevel5: level5Members.size
    };
}

function scheduleMonthlyPurge(guild) {
    setInterval(async () => {
        const now = new Date();
        if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() <= 5) {
            await performMonthlyPurge(guild);
        }
    }, 5 * 60 * 1000);
}

// ===== USER RESET FUNCTION =====
async function resetUserProgress(userId, guild) {
    console.log(`Resetting all progress for user ${userId}`);
    
    if (monthlyFeedback[userId]) {
        delete monthlyFeedback[userId];
    }
    
    if (userData[userId]) {
        delete userData[userId];
    }
    
    Object.keys(loggedFeedbackMessages).forEach(messageId => {
        if (loggedFeedbackMessages[messageId] && loggedFeedbackMessages[messageId].includes(userId)) {
            loggedFeedbackMessages[messageId] = loggedFeedbackMessages[messageId].filter(id => id !== userId);
            if (loggedFeedbackMessages[messageId].length === 0) {
                delete loggedFeedbackMessages[messageId];
            }
        }
    });
    
    const closedThreads = await closeUserBookshelfThreads(guild, userId);
    
    await saveData();
    console.log(`User ${userId} progress completely reset - ${closedThreads} threads closed`);
    return closedThreads;
}

// ===== TEMPORARY MESSAGE FUNCTIONS =====
async function sendTemporaryMessage(channel, messageOptions, delay = 1800000) {
    try {
        const message = await channel.send(messageOptions);
        setTimeout(async () => {
            try { 
                await message.delete(); 
            } catch (error) { 
                console.log('Failed to delete message:', error.message); 
            }
        }, delay);
        return message;
    } catch (error) {
        console.error('Failed to send temporary message:', error);
        return null;
    }
}

async function replyTemporary(interaction, messageOptions, delay = 1800000) {
    try {
        const message = await interaction.reply(messageOptions);
        setTimeout(async () => {
            try { 
                await interaction.deleteReply(); 
            } catch (error) { 
                console.log('Failed to delete reply:', error.message); 
            }
        }, delay);
        return message;
    } catch (error) {
        console.error('Failed to send temporary reply:', error);
        return null;
    }
}

async function replyTemporaryMessage(message, messageOptions, delay = 1800000) {
    try {
        const reply = await message.reply(messageOptions);
        setTimeout(async () => {
            try { 
                await reply.delete(); 
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

// ===== DATA PERSISTENCE =====
async function saveData() {
    try {
        const data = { monthlyFeedback, userData, loggedFeedbackMessages, pardonedUsers };
        await fs.writeFile('testbot_data.json', JSON.stringify(data, null, 2));
        console.log('Data saved successfully');
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

async function loadData() {
    try {
        const data = await fs.readFile('testbot_data.json', 'utf8');
        const parsed = JSON.parse(data);
        monthlyFeedback = parsed.monthlyFeedback || {};
        userData = parsed.userData || {};
        loggedFeedbackMessages = parsed.loggedFeedbackMessages || {};
        pardonedUsers = parsed.pardonedUsers || {};
        
        for (const userId in userData) {
            getUserData(userId);
        }
        
        console.log('Data loaded successfully');
    } catch (error) {
        console.log('Starting with fresh data:', error.message);
        monthlyFeedback = {};
        userData = {};
        loggedFeedbackMessages = {};
        pardonedUsers = {};
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

async function setupBookshelfPermissions(guild) {
    try {
        const bookshelfForum = guild.channels.cache.find(channel => 
            channel.name === 'bookshelf' && channel.type === 15
        );
        
        if (!bookshelfForum) {
            console.log('⚠️ Bookshelf forum not found');
            return false;
        }
        
        const shelfRole = guild.roles.cache.find(r => r.name === 'Shelf Owner');
        const readerRole = guild.roles.cache.find(r => r.name === 'reader');
        
        if (!shelfRole) {
            console.log('⚠️ Shelf Owner role not found');
            return false;
        }
        
        if (!readerRole) {
            console.log('⚠️ reader role not found');
            return false;
        }
        
        await bookshelfForum.permissionOverwrites.edit(guild.id, {
            CreatePublicThreads: false,
            CreatePrivateThreads: false
        });
        
        await bookshelfForum.permissionOverwrites.edit(shelfRole.id, {
            CreatePublicThreads: true,
            CreatePrivateThreads: false
        });
        
        console.log('✅ Bookshelf forum permissions configured');
        return true;
    } catch (error) {
        console.error('❌ Failed to setup bookshelf permissions:', error.message);
        return false;
    }
}

// ===== FEEDBACK PROCESSING =====
async function processFeedbackContribution(userId) {
    const currentCount = getUserMonthlyFeedback(userId);
    const newCount = currentCount + 1;
    setUserMonthlyFeedback(userId, newCount);
    
    const user = getUserData(userId);
    user.totalFeedbackAllTime += 1;
    user.currentCredits += 1;
    
    await saveData();
    
    return {
        newCount,
        totalAllTime: user.totalFeedbackAllTime,
        currentCredits: user.currentCredits,
        requirementMet: newCount >= MONTHLY_FEEDBACK_REQUIREMENT
    };
}

function createFeedbackEmbed(user, feedbackData) {
    return new EmbedBuilder()
        .setTitle('Feedback Credit Duly Recorded ☝️')
        .setDescription(`Your generous offering of feedback has been noted with appreciation, ${user}. Such dedication to your fellow scribes is most commendable indeed.`)
        .addFields(
            { name: 'This Month', value: `${feedbackData.newCount} credit${feedbackData.newCount !== 1 ? 's' : ''}`, inline: true },
            { name: 'Monthly Requirement', value: feedbackData.requirementMet ? '✅ Graciously fulfilled' : '📝 Still in progress', inline: true },
            { name: 'All Time Total', value: `${feedbackData.totalAllTime} credit${feedbackData.totalAllTime !== 1 ? 's' : ''}`, inline: true },
            { name: 'Current Balance', value: `💰 ${feedbackData.currentCredits} credit${feedbackData.currentCredits !== 1 ? 's' : ''}`, inline: true }
        )
        .setColor(feedbackData.requirementMet ? 0x00AA55 : 0x5865F2);
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
        .setName('feedback_status')
        .setDescription('Check monthly feedback status')
        .addUserOption(option => option.setName('user').setDescription('User to check (optional)').setRequired(false)),
    
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
            .addChoices({ name: 'Bookshelf Access (1 credit)', value: 'shelf' })),
    
    new SlashCommandBuilder()
        .setName('post_chapter')
        .setDescription('Post a new chapter in your bookshelf thread (costs 1 credit)'),
    
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
        .setName('stats')
        .setDescription('View detailed server statistics (Staff only)'),
    
    new SlashCommandBuilder()
        .setName('setup_bookshelf')
        .setDescription('Setup bookshelf forum permissions (Staff only)'),
    
    new SlashCommandBuilder()
        .setName('pardon')
        .setDescription('Pardon a Level 5 member from monthly feedback requirement (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('Level 5 member to pardon from this month\'s requirement').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('manual_purge')
        .setDescription('Manually trigger monthly purge of inactive Level 5 members (Server Owner only)')
];

async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT2_TOKEN);
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
    await loadData();
    await registerCommands();
    
    // Initialize welcome system
    welcomeSystem.init();
    
    // Force fetch all guild members to populate cache on startup
    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.members.fetch();
            console.log(`Fetched ${guild.members.cache.size} members for ${guild.name}`);
        } catch (error) {
            console.error(`Failed to fetch members for ${guild.name}:`, error);
        }
        
        // Start monthly purge scheduler
        scheduleMonthlyPurge(guild);
        console.log(`Monthly purge scheduler started for guild: ${guild.name}`);
    }
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
                    const embed = new EmbedBuilder()
                        .setTitle('Bookshelf Thread Removed ☝️')
                        .setDescription(`Dear ${member.displayName}, your bookshelf thread has been removed as you lack the required roles.`)
                        .addFields(
                            { name: 'Requirements to Create Bookshelf Threads', value: `• **Shelf Owner role** (purchasable with 1 credit via \`/store\`)\n• **reader role** (assigned by staff based on feedback quality)\n• **Both roles required** to create threads`, inline: false },
                            { name: 'Your Current Status', value: `• Shelf Owner: ${hasShelfRole(member) ? '✅' : '❌'}\n• reader role: ${hasReaderRole(member) ? '✅' : '❌'}`, inline: false },
                            { name: 'How to Gain Access', value: `1. Give feedback to fellow writers and log it with \`/feedback\`\n2. Purchase "Shelf Owner" role from \`/store\` for 1 credit\n3. Staff will review your feedback quality and assign reader role\n4. Once you have both roles, you can create ${channels.bookshelf} threads`, inline: false }
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

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.channel.isThread() && message.channel.parent && message.channel.parent.name === 'bookshelf') {
        const isThreadOwner = message.channel.ownerId === message.author.id;
        
        if (!isThreadOwner) {
            await message.delete();
            await sendBookshelfAccessDeniedDM(message.author, 'thread_owner', null, message.member);
        }
        return;
    }

    if (message.content.startsWith('!')) {
        await handleCommand(message);
        return;
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
        await handleSlashCommand(interaction);
    } catch (error) {
        console.error('Interaction error:', error);
        await handleInteractionError(interaction, error);
    }
});

// ===== MESSAGE HANDLERS =====
async function sendBookshelfAccessDeniedDM(author, reason, user = null, member = null) {
    const guild = member?.guild;
    const channels = guild ? getClickableChannelMentions(guild) : {
        bookshelfFeedback: '#bookshelf-feedback',
        bookshelfDiscussion: '#bookshelf-discussion',
        bookshelf: '#bookshelf'
    };
    
    const embeds = {
        thread_owner: new EmbedBuilder()
            .setTitle('Thread Owner Only ☝️')
            .setDescription(`Dear ${author}, I regret to inform you that only the original author may add content to their literary threads. This sacred space is reserved for the creator's continued narrative.`)
            .addFields(
                { name: 'How to Provide Feedback', value: `• Visit the ${channels.bookshelfFeedback} or ${channels.bookshelfDiscussion} forums\n• Create a thread or comment with your thoughts\n• Use \`/feedback\` or \`!feedback\` to log your contribution`, inline: false },
                { name: 'Why This Restriction?', value: 'Each bookshelf thread is the author\'s personal showcase space. Feedback and discussions happen in the dedicated feedback forums.', inline: false }
            )
            .setColor(0xFF9900),
        
        no_access: new EmbedBuilder()
            .setTitle('Bookshelf Access Required ☝️')
            .setDescription(`Dear ${author}, I regret to inform you that posting in the bookshelf forum requires specific roles.`)
            .addFields(
                { name: 'Requirements to Post', value: `• **Shelf Owner role** (purchasable with 1 credit)\n• **reader role** (assigned by staff based on feedback quality)\n• **Both roles required** to create or post in threads`, inline: false },
                { name: 'Your Current Status', value: `• Credits Available: ${user?.currentCredits || 0}\n• Shelf Owner: ${member && hasShelfRole(member) ? '✅' : '❌'}\n• reader role: ${member && hasReaderRole(member) ? '✅' : '❌'}`, inline: false },
                { name: 'How to Gain Access', value: '1. Give feedback to fellow writers and log it with `/feedback`\n2. Purchase "Shelf Owner" role from `/store` for 1 credit\n3. Staff will review your feedback quality and assign reader role\n4. Use `/post_chapter` to post chapters (costs 1 credit each)', inline: false }
            )
            .setColor(0xFF9900),
        
        no_credits: new EmbedBuilder()
            .setTitle('Insufficient Credits ☝️')
            .setDescription(`Dear ${author}, you need at least 1 credit to post a chapter. Each chapter costs 1 credit.`)
            .addFields(
                { name: 'Your Status', value: `• **Current credits:** ${user?.currentCredits || 0}\n• **Credits needed:** 1`, inline: false },
                { name: 'How to Earn Credits', value: `Give feedback to fellow writers in the forums and log it with \`/feedback\` to earn more credits`, inline: false }
            )
            .setColor(0xFF9900)
    };
    
    try {
        const dmChannel = await author.createDM();
        await dmChannel.send({ embeds: [embeds[reason]] });
    } catch (error) {
        console.log('Could not send DM to user:', error.message);
    }
}

// ===== COMMAND HANDLERS =====
async function handleCommand(message) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    try {
        console.log(`Processing command: ${command} from ${message.author.displayName}`);
        
        const commandHandlers = {
            feedback: () => handleFeedbackCommand(message),
            feedback_status: () => handleFeedbackStatusCommand(message),
            feedback_add: () => handleFeedbackAddCommand(message, args),
            feedback_remove: () => handleFeedbackRemoveCommand(message, args),
            feedback_reset: () => handleFeedbackResetCommand(message),
            help: () => handleHelpCommand(message),
            commands: () => handleCommandsCommand(message),
            hall_of_fame: () => handleHallOfFameCommand(message),
            post_chapter: () => handlePostChapterCommand(message),
            stats: () => handleStatsCommand(message),
            balance: () => handleBalanceCommand(message),
            store: () => handleStoreCommand(message),
            buy: () => handleBuyCommand(message, args),
            setup_bookshelf: () => handleSetupBookshelfCommand(message),
            pardon: () => handlePardonCommand(message, args),
            manual_purge: () => handleManualPurgeCommand(message)
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
        feedback_status: () => handleFeedbackStatusSlashCommand(interaction),
        feedback_add: () => handleFeedbackAddSlashCommand(interaction),
        feedback_remove: () => handleFeedbackRemoveSlashCommand(interaction),
        feedback_reset: () => handleFeedbackResetSlashCommand(interaction),
        help: () => handleHelpSlashCommand(interaction),
        commands: () => handleCommandsSlashCommand(interaction),
        hall_of_fame: () => handleHallOfFameSlashCommand(interaction),
        post_chapter: () => handlePostChapterSlashCommand(interaction),
        stats: () => handleStatsSlashCommand(interaction),
        balance: () => handleBalanceSlashCommand(interaction),
        store: () => handleStoreSlashCommand(interaction),
        buy: () => handleBuySlashCommand(interaction),
        setup_bookshelf: () => handleSetupBookshelfSlashCommand(interaction),
        pardon: () => handlePardonSlashCommand(interaction),
        manual_purge: () => handleManualPurgeSlashCommand(interaction)
    };
    
    const handler = commandHandlers[interaction.commandName];
    if (handler) {
        await handler();
    }
}

// ===== FEEDBACK COMMANDS =====
async function handleFeedbackCommand(message) {
    console.log(`Processing !feedback command for ${message.author.displayName}`);
    return await processFeedbackCommand(message.author, message.member, message.channel, false);
}

async function handleFeedbackSlashCommand(interaction) {
    console.log(`Processing /feedback command for ${interaction.user.displayName}`);
    return await processFeedbackCommand(interaction.user, interaction.member, interaction.channel, true, interaction);
}

async function processFeedbackCommand(user, member, channel, isSlash, interaction = null) {
    console.log(`Processing feedback command for ${user.displayName} in ${channel.name}`);
    
    // Ensure member object is fresh (re-fetch if needed)
    try {
        member = await channel.guild.members.fetch(user.id);
    } catch (error) {
        console.log('Could not fetch member, using existing member object');
    }
    
    // Check if user has Level 5 role
    if (!hasLevel5Role(member)) {
        const embed = new EmbedBuilder()
            .setTitle('Level 5 Role Required ☝️')
            .setDescription('I regret to inform you that only those who have achieved Level 5 status may log feedback credits in our distinguished community.')
            .addFields({
                name: 'How to Gain Access',
                value: 'Continue participating in the server activities and earning experience to reach Level 5 status.',
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage({ author: user, reply: (msg) => channel.send(msg) }, { embeds: [embed] });
        }
    }
    
    const guild = channel.guild;
    const channels = getClickableChannelMentions(guild);
    
    if (!isInAllowedFeedbackThread(channel)) {
        const embed = new EmbedBuilder()
            .setTitle('Incorrect Thread ☝️')
            .setDescription('I regret to inform you that feedback credits may only be logged within the designated literary threads of our community, under works other than your own.')
            .addFields({
                name: 'Permitted Threads',
                value: `• ${channels.bookshelfFeedback} forum - For recording feedback given to fellow writers\n• ${channels.bookshelfDiscussion} forum - For discussions about literary critiques`,
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage({ author: user, reply: (msg) => channel.send(msg) }, { embeds: [embed] });
        }
    }
    
    if (channel.isThread() && channel.ownerId === user.id) {
        const embed = new EmbedBuilder()
            .setTitle('Cannot Log Own Thread Feedback ☝️')
            .setDescription('I regret to inform you that you cannot log feedback credits on your own thread, dear writer. Feedback credits must be earned by providing critique to fellow writers, not for receiving it.')
            .addFields({
                name: 'How to Earn Credits',
                value: '• Visit other writers\' threads in the feedback forums\n• Provide thoughtful critique and feedback\n• Use `/feedback` to log your contribution\n• Credits are earned by giving feedback, not receiving it',
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage({ author: user, reply: (msg) => channel.send(msg) }, { embeds: [embed] });
        }
    }
    
    const latestMessage = await findUserLatestMessage(channel, user.id);
    
    if (!latestMessage) {
        const embed = new EmbedBuilder()
            .setTitle('No Feedback Message Found ☝️')
            .setDescription('I regret that I could not locate a recent feedback message from you in this thread, dear writer. You must post your feedback message **before** using the feedback command.')
            .addFields({
                name: 'How to Properly Use This System',
                value: '1. **First:** Write a thoughtful feedback message in this thread\n2. **Then:** Use `/feedback` command to log that message for credits\n3. **Note:** Commands like `/feedback` itself do not count as feedback messages',
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage({ author: user, reply: (msg) => channel.send(msg) }, { embeds: [embed] });
        }
    }
    
    if (hasUserLoggedFeedbackForMessage(latestMessage.id, user.id)) {
        const embed = new EmbedBuilder()
            .setTitle('Feedback Already Logged ☝️')
            .setDescription('I regret to inform you that you have already logged feedback credits for this particular message, dear writer. Each feedback message may only be counted once.')
            .addFields({
                name: 'To Log More Feedback',
                value: 'Post a new feedback message and then use the feedback command again.',
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage({ author: user, reply: (msg) => channel.send(msg) }, { embeds: [embed] });
        }
    }
    
    logFeedbackForMessage(latestMessage.id, user.id);
    
    const feedbackData = await processFeedbackContribution(user.id);
    const embed = createFeedbackEmbed(user, feedbackData);
    
    console.log('Feedback command completed successfully');
    
    if (isSlash) {
        await replyTemporary(interaction, { embeds: [embed] });
    } else {
        await replyTemporaryMessage({ author: user, reply: (msg) => channel.send(msg) }, { embeds: [embed] });
    }
}

// ===== POST CHAPTER COMMANDS =====
async function handlePostChapterCommand(message) {
    console.log(`Processing !post_chapter command for ${message.author.displayName}`);
    return await processPostChapterCommand(message.author, message.member, message.channel, false);
}

async function handlePostChapterSlashCommand(interaction) {
    console.log(`Processing /post_chapter command for ${interaction.user.displayName}`);
    return await processPostChapterCommand(interaction.user, interaction.member, interaction.channel, true, interaction);
}

async function processPostChapterCommand(user, member, channel, isSlash, interaction = null) {
    const guild = channel.guild;
    const channels = getClickableChannelMentions(guild);
    
    if (!channel.isThread() || !channel.parent || channel.parent.name !== 'bookshelf') {
        const embed = new EmbedBuilder()
            .setTitle('Wrong Thread ☝️')
            .setDescription('I regret to inform you that the post chapter command may only be used within your own bookshelf thread, dear writer.')
            .addFields({
                name: 'How to Use',
                value: `• Go to your thread in the ${channels.bookshelf} forum\n• Use \`/post_chapter\` to post a new chapter (costs 1 credit)\n• Only the thread owner may post chapters`,
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage(message, { embeds: [embed] });
        }
    }
    
    if (channel.ownerId !== user.id) {
        const embed = new EmbedBuilder()
            .setTitle('Thread Owner Only ☝️')
            .setDescription('I regret to inform you that only the thread owner may post chapters in their bookshelf thread, dear writer.')
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage(message, { embeds: [embed] });
        }
    }
    
    const userId = user.id;
    const userRecord = getUserData(userId);
    
    // Check each requirement individually for better error messages
    const hasEnoughFeedback = userRecord.totalFeedbackAllTime >= MINIMUM_FEEDBACK_FOR_SHELF;
    const hasShelfPurchase = userRecord.purchases.includes('shelf');
    const hasShelfOwnerRole = hasShelfRole(member);
    const hasReaderRoleCheck = hasReaderRole(member);
    
    // Check feedback requirement first
    if (!hasEnoughFeedback) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Total Feedback ☝️')
            .setDescription(`I regret to inform you that you need at least ${MINIMUM_FEEDBACK_FOR_SHELF} total feedback credits to post chapters, dear writer.`)
            .addFields({
                name: 'Your Status',
                value: `• **Total feedback earned:** ${userRecord.totalFeedbackAllTime}\n• **Required:** ${MINIMUM_FEEDBACK_FOR_SHELF}`,
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage(message, { embeds: [embed] });
        }
    }
    
    // Check if shelf access was purchased
    if (!hasShelfPurchase) {
        const embed = new EmbedBuilder()
            .setTitle('Shelf Access Not Purchased ☝️')
            .setDescription('I regret to inform you that you must first purchase Shelf Owner access from the store, dear writer.')
            .addFields({
                name: 'How to Purchase',
                value: `Use \`/store\` to view items and \`/buy shelf\` to purchase shelf access for 1 credit.`,
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage(message, { embeds: [embed] });
        }
    }
    
    // Check roles last (this was the original bug - roles check came first)
    if (!hasShelfOwnerRole || !hasReaderRoleCheck) {
        const embed = new EmbedBuilder()
            .setTitle('Required Roles Missing ☝️')
            .setDescription('I regret to inform you that posting chapters requires both the Shelf Owner role and the reader role, dear writer.')
            .addFields({
                name: 'Your Current Status',
                value: `• Shelf Owner: ${hasShelfOwnerRole ? '✅' : '❌'}\n• reader role: ${hasReaderRoleCheck ? '✅' : '❌'}`,
                inline: false
            },
            {
                name: 'Next Steps',
                value: hasShelfOwnerRole ? 'Contact staff to request the reader role based on your feedback quality.' : 'Purchase Shelf Owner role from `/store` and contact staff for reader role.',
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage(message, { embeds: [embed] });
        }
    }
    
    // Check credits last
    if (userRecord.currentCredits < 1) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Credits ☝️')
            .setDescription(`I regret to inform you that posting a chapter requires 1 credit, dear writer. You currently have ${userRecord.currentCredits} credits.`)
            .addFields({
                name: 'How to Earn Credits',
                value: 'Give feedback to fellow writers in the feedback forums and log it with `/feedback` to earn more credits.',
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage(message, { embeds: [embed] });
        }
    }
    
    // All requirements met - process the chapter posting
    spendCredits(userId, 1);
    userRecord.bookshelfPosts += 1;
    await saveData();
    
    const embed = new EmbedBuilder()
        .setTitle('Chapter Posted Successfully ☝️')
        .setDescription(`Your chapter has been graciously posted, ${user}. Your dedication to sharing your literary work with our community is most commendable.`)
        .addFields(
            { name: 'Credits Spent', value: `📝 1 credit`, inline: true },
            { name: 'Credits Remaining', value: `💰 ${userRecord.currentCredits}`, inline: true },
            { name: 'Total Chapters Posted', value: `📚 ${userRecord.bookshelfPosts}`, inline: true }
        )
        .setColor(0x00AA55);
    
    if (isSlash) {
        await replyTemporary(interaction, { embeds: [embed] });
    } else {
        await replyTemporaryMessage(message, { embeds: [embed] });
    }
}

// ===== MANUAL PURGE COMMANDS =====
async function handleManualPurgeCommand(message) {
    if (!isServerOwner(message.author.id, message.guild)) {
        return replyTemporaryMessage(message, 'I regret to inform you that this sacred power is reserved exclusively for the server owner, my lord. Such grave authority cannot be delegated.');
    }
    
    const result = await performMonthlyPurge(message.guild);
    const embed = createPurgeResultEmbed(result);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleManualPurgeSlashCommand(interaction) {
    if (!isServerOwner(interaction.user.id, interaction.guild)) {
        const embed = new EmbedBuilder()
            .setTitle('Server Owner Only')
            .setDescription('I regret to inform you that this sacred power is reserved exclusively for the server owner, my lord. Such grave authority cannot be delegated.')
            .setColor(0xFF6B6B);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    const result = await performMonthlyPurge(interaction.guild);
    const embed = createPurgeResultEmbed(result);
    await replyTemporary(interaction, { embeds: [embed] });
}

function createPurgeResultEmbed(result) {
    if (!result.success) {
        const errorMessages = {
            not_active_yet: 'I regret to inform you that the monthly purge system is not yet active. It shall commence on July 1st, 2025.',
            no_level5_members: 'I regret to inform you that no Level 5 members could be found in this server. The purge cannot proceed without eligible members.'
        };
        
        return new EmbedBuilder()
            .setTitle('Purge Failed ☝️')
            .setDescription(errorMessages[result.reason] || 'An unexpected complication has arisen during the purge process.')
            .setColor(0xFF6B6B);
    }
    
    const embed = new EmbedBuilder()
        .setTitle('Manual Purge Completed ☝️')
        .setDescription(`The monthly purge has been executed at your command, my lord. I have reviewed all Level 5 members and taken appropriate action based on their contributions.`)
        .addFields(
            { name: 'Total Level 5 Members Reviewed', value: `${result.totalLevel5} members`, inline: true },
            { name: 'Members Removed', value: `${result.purgedCount} members`, inline: true },
            { name: 'Pardoned This Month', value: `${result.pardonedUsers.length} members`, inline: true }
        )
        .setColor(result.purgedCount > 0 ? 0xFF6B6B : 0x00AA55);
    
    if (result.purgedUsers.length > 0) {
        const purgedList = result.purgedUsers.slice(0, 10).join('\n');
        const additionalCount = result.purgedUsers.length > 10 ? `\n...and ${result.purgedUsers.length - 10} more` : '';
        
        embed.addFields({
            name: 'Removed Members (Credits This Month)',
            value: purgedList + additionalCount,
            inline: false
        });
    }
    
    if (result.pardonedUsers.length > 0) {
        const pardonedList = result.pardonedUsers.slice(0, 5).join('\n');
        const additionalPardoned = result.pardonedUsers.length > 5 ? `\n...and ${result.pardonedUsers.length - 5} more` : '';
        
        embed.addFields({
            name: 'Pardoned Members',
            value: pardonedList + additionalPardoned,
            inline: false
        });
    }
    
    if (result.exemptUsers.length > 0) {
        embed.addFields({
            name: 'Members Meeting Requirements',
            value: `${result.exemptUsers.length} Level 5 members have fulfilled their monthly obligations and remain in good standing.`,
            inline: false
        });
    }
    
    embed.setFooter({ text: 'Manual purge executed by server owner • All affected users have been notified via DM' });
    
    return embed;
}

// ===== BALANCE COMMANDS =====
async function handleBalanceCommand(message) {
    const user = message.mentions.users.first() || message.author;
    const member = message.mentions.members.first() || message.member;
    const embed = createBalanceEmbed(user, member);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleBalanceSlashCommand(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = interaction.options.getMember('user') || interaction.member;
    const embed = createBalanceEmbed(user, member);
    await replyTemporary(interaction, { embeds: [embed] });
}

function createBalanceEmbed(user, member) {
    const userId = user.id;
    const userRecord = getUserData(userId);
    const monthlyCount = getUserMonthlyFeedback(userId);
    const monthlyQuotaStatus = monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT ? 'Monthly quota fulfilled' : 'Monthly quota unfulfilled';
    
    return new EmbedBuilder()
        .setTitle(`${user.displayName}'s Literary Standing ☝️`)
        .setDescription(`Allow me to present the current literary standing and achievements of this distinguished writer.`)
        .addFields(
            { name: 'Total Credits Earned', value: `📝 ${userRecord.totalFeedbackAllTime}`, inline: true },
            { name: 'Monthly Credits', value: `📅 ${monthlyCount}`, inline: true },
            { name: 'Current Credit Balance', value: `💰 ${userRecord.currentCredits}`, inline: true },
            { name: 'Monthly Status', value: `${monthlyQuotaStatus}`, inline: true },
            { name: 'Bookshelf Status', value: getBookshelfAccessStatus(userId, member), inline: true },
            { name: 'Post Status', value: getPostCreditStatus(userId, member), inline: true },
            { name: 'Purchases Made', value: userRecord.purchases.length > 0 ? userRecord.purchases.map(item => `• ${STORE_ITEMS[item]?.name || item}`).join('\n') : 'None yet', inline: false }
        )
        .setColor(canPostInBookshelf(userId, member) ? 0x00AA55 : 0xFF9900);
}

// ===== REMAINING COMMAND IMPLEMENTATIONS =====

async function handleFeedbackStatusCommand(message) {
    const user = message.mentions.users.first() || message.author;
    const embed = createFeedbackStatusEmbed(user, message.author);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleFeedbackStatusSlashCommand(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const embed = createFeedbackStatusEmbed(user, interaction.user);
    await replyTemporary(interaction, { embeds: [embed] });
}

function createFeedbackStatusEmbed(user, requester) {
    const userId = user.id;
    const monthlyCount = getUserMonthlyFeedback(userId);
    const totalAllTime = getUserData(userId).totalFeedbackAllTime;
    
    return new EmbedBuilder()
        .setTitle(`Monthly Standing - ${user.displayName}`)
        .setDescription(`Allow me to present the current state of ${user.id === requester.id ? 'your' : `${user.displayName}'s`} feedback credits to our literary community.`)
        .addFields(
            { name: 'This Month', value: `${monthlyCount} credit${monthlyCount !== 1 ? 's' : ''}`, inline: true },
            { name: 'Requirement Status', value: monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT ? '✅ Monthly requirement graciously fulfilled' : '📝 Monthly credits still awaited', inline: true },
            { name: 'All Time Credits', value: `${totalAllTime}`, inline: true }
        )
        .setColor(monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT ? 0x00AA55 : 0xFF9900);
}

async function handleHallOfFameCommand(message) {
    const embed = await createHallOfFameEmbed(message.guild);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleHallOfFameSlashCommand(interaction) {
    const embed = await createHallOfFameEmbed(interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

async function createHallOfFameEmbed(guild) {
    const usersWithCredits = Object.entries(userData)
        .filter(([userId, data]) => data.totalFeedbackAllTime > 0)
        .sort(([, a], [, b]) => b.totalFeedbackAllTime - a.totalFeedbackAllTime)
        .slice(0, 10);
    
    if (usersWithCredits.length === 0) {
        return new EmbedBuilder()
            .setTitle('Hall of Fame ☝️')
            .setDescription('It appears no writers have yet contributed feedback to our literary realm. Perhaps it is time to begin sharing wisdom with fellow scribes?')
            .setColor(0x2F3136);
    }
    
    let leaderboard = '';
    for (let i = 0; i < usersWithCredits.length; i++) {
        const [userId, data] = usersWithCredits[i];
        try {
            const member = await guild.members.fetch(userId);
            const rank = i + 1;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
            leaderboard += `${medal} **${member.displayName}** - ${data.totalFeedbackAllTime} credit${data.totalFeedbackAllTime !== 1 ? 's' : ''}\n`;
        } catch (error) {
            continue;
        }
    }
    
    return new EmbedBuilder()
        .setTitle('Hall of Fame ☝️')
        .setDescription('Behold, the most dedicated contributors in our distinguished literary community, honored for their generous sharing of wisdom through thoughtful critique.')
        .addFields({
            name: 'Most Dedicated Contributors',
            value: leaderboard || 'No qualifying writers found.',
            inline: false
        })
        .setColor(0xFFD700)
        .setFooter({ text: 'Recognition reflects dedication to nurturing fellow scribes through meaningful feedback' });
}

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
    
    return new EmbedBuilder()
        .setTitle('Type&Draft Literary Emporium ☝️')
        .setDescription('Welcome to our humble establishment, where dedication to the craft is rewarded with privileges. Examine our current offerings, crafted with the utmost care for our literary community.')
        .addFields(
            { name: '📚 Bookshelf Access', value: `Grants you the Shelf Owner role to create threads in ${channels.bookshelf}\n**Price:** ${STORE_ITEMS.shelf.price} feedback credits\n**Note:** reader role must be assigned by staff separately based on feedback quality`, inline: false },
            { name: 'How to Earn Credits', value: `• **Provide feedback** to fellow writers in the designated forums\n• **Log contributions** with \`/feedback\` to earn 1 credit each\n• **Build your reputation** through meaningful engagement`, inline: false },
            { name: 'Important Notice', value: `To post chapters in ${channels.bookshelf}, you need **both** the Shelf Owner role (purchasable) **and** the reader role (staff-assigned based on feedback quality). Each chapter posted costs 1 credit via \`/post_chapter\`.`, inline: false }
        )
        .setColor(0x2F3136)
        .setFooter({ text: 'All purchases support our thriving literary community.' });
}

async function handleBuyCommand(message, args) {
    const itemKey = args[0]?.toLowerCase();
    if (!itemKey || !STORE_ITEMS[itemKey]) {
        return replyTemporaryMessage(message, 'Pray, specify a valid item to purchase. Use `/store` to view available items.');
    }
    
    const result = await processPurchase(message.author.id, itemKey, message.member, message.guild);
    const embed = createPurchaseResultEmbed(message.author, itemKey, result, message.guild);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleBuySlashCommand(interaction) {
    const itemKey = interaction.options.getString('item');
    const result = await processPurchase(interaction.user.id, itemKey, interaction.member, interaction.guild);
    const embed = createPurchaseResultEmbed(interaction.user, itemKey, result, interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

async function processPurchase(userId, itemKey, member, guild) {
    const item = STORE_ITEMS[itemKey];
    const userRecord = getUserData(userId);
    
    if (userRecord.purchases.includes(itemKey)) {
        return { success: false, reason: 'already_purchased' };
    }
    
    if (userRecord.currentCredits < item.price) {
        return {
            success: false,
            reason: 'insufficient_credits',
            needed: item.price - userRecord.currentCredits,
            current: userRecord.currentCredits,
            price: item.price
        };
    }
    
    if (spendCredits(userId, item.price)) {
        userRecord.purchases.push(itemKey);
        
        if (item.role) {
            await assignPurchaseRoles(member, guild, itemKey);
        }
        
        await saveData();
        return { success: true, creditsSpent: item.price };
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

function createPurchaseResultEmbed(user, itemKey, result, guild) {
    const item = STORE_ITEMS[itemKey];
    const channels = getClickableChannelMentions(guild);
    
    if (!result.success) {
        const errorEmbeds = {
            already_purchased: new EmbedBuilder()
                .setTitle('Item Already Acquired')
                .setDescription(`You have already acquired ${item.name}, dear writer. There is no need for duplicate purchases.`)
                .setColor(0xFF9900),
            
            insufficient_credits: new EmbedBuilder()
                .setTitle('Insufficient Credits')
                .setDescription(`I fear your current balance of ${result.current} credits is insufficient for this purchase.`)
                .addFields({
                    name: 'Required Amount', value: `${result.price} credit${result.price === 1 ? '' : 's'}`, inline: true
                }, {
                    name: 'Still Needed', value: `${result.needed} more credit${result.needed === 1 ? '' : 's'}`, inline: true
                })
                .setColor(0xFF6B6B)
        };
        
        return errorEmbeds[result.reason] || new EmbedBuilder().setTitle('Purchase Failed').setColor(0xFF6B6B);
    }
    
    return new EmbedBuilder()
        .setTitle('Purchase Completed Successfully ☝️')
        .setDescription(`Congratulations, ${user}! Your acquisition of ${item.name} has been processed with the utmost care.`)
        .addFields(
            { name: 'Item Purchased', value: `${item.emoji} ${item.name}`, inline: true },
            { name: 'Credits Spent', value: `📝 ${result.creditsSpent}`, inline: true },
            { name: 'Role Granted', value: `🎭 Shelf Owner`, inline: true },
            { name: 'Important Notice', value: `⚠️ **reader role required separately from staff** to post chapters in ${channels.bookshelf} forum. Staff will review your feedback quality and assign the reader role when appropriate.`, inline: false },
            { name: 'Next Steps', value: '1. Continue giving quality feedback to fellow writers\n2. Staff will review and assign reader role when ready\n3. Once you have both roles, use `/post_chapter` to post chapters (1 credit each)', inline: false }
        )
        .setColor(0x00AA55);
}

// ===== STAFF COMMANDS =====
async function handleFeedbackAddCommand(message, args) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions, my lord.');
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the writer whose feedback record you wish to enhance.');
    
    const amount = Math.max(1, parseInt(args[1]) || 1);
    await addFeedbackToUser(user.id, amount);
    
    const embed = createFeedbackModificationEmbed(user, amount, 'added');
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleFeedbackAddSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    await addFeedbackToUser(user.id, amount);
    
    const embed = createFeedbackModificationEmbed(user, amount, 'added');
    await replyTemporary(interaction, { embeds: [embed] });
}

async function addFeedbackToUser(userId, amount) {
    const currentCount = getUserMonthlyFeedback(userId);
    const newCount = currentCount + amount;
    setUserMonthlyFeedback(userId, newCount);
    
    const userRecord = getUserData(userId);
    userRecord.totalFeedbackAllTime += amount;
    userRecord.currentCredits += amount;
    
    await saveData();
    return { currentCount, newCount };
}

function createFeedbackModificationEmbed(user, amount, action) {
    const userRecord = getUserData(user.id);
    const monthlyCount = getUserMonthlyFeedback(user.id);
    
    return new EmbedBuilder()
        .setTitle(`Feedback Credits ${action === 'added' ? 'Enhanced' : 'Adjusted'} ☝️`)
        .setDescription(`I have ${action === 'added' ? 'graciously added to' : 'reduced'} ${user}'s feedback record, as ${action === 'added' ? 'befits their continued dedication to our literary community' : 'you have instructed, though I confess it pains me to diminish any writer\'s standing'}.`)
        .addFields(
            { name: 'Monthly Count', value: `${monthlyCount}`, inline: true },
            { name: 'All-Time Total', value: `${userRecord.totalFeedbackAllTime}`, inline: true },
            { name: `Credits ${action === 'added' ? 'Added' : 'Removed'}`, value: `${amount}`, inline: true }
        )
        .setColor(action === 'added' ? 0x00AA55 : 0xFF6B6B);
}

async function handleFeedbackRemoveCommand(message, args) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions, my lord.');
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the writer whose credit balance requires adjustment.');
    
    const amount = Math.max(1, parseInt(args[1]) || 1);
    console.log(`Staff removing ${amount} credits from ${user.displayName}`);
    
    const result = await removeFeedbackFromUser(user.id, amount);
    const embed = createCreditModificationEmbed(user, amount, result, 'removed');
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleFeedbackRemoveSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    console.log(`Staff removing ${amount} credits from ${user.displayName}`);
    
    const result = await removeFeedbackFromUser(user.id, amount);
    const embed = createCreditModificationEmbed(user, amount, result, 'removed');
    await replyTemporary(interaction, { embeds: [embed] });
}

async function removeFeedbackFromUser(userId, amount) {
    const userRecord = getUserData(userId);
    const previousCredits = userRecord.currentCredits;
    
    console.log(`Removing ${amount} credits from user ${userId}. Previous: ${previousCredits}`);
    
    userRecord.currentCredits = Math.max(0, userRecord.currentCredits - amount);
    
    console.log(`New credit balance: ${userRecord.currentCredits}`);
    
    await saveData();
    return { previousCredits, newCredits: userRecord.currentCredits };
}

function createCreditModificationEmbed(user, amount, result, action) {
    console.log(`Creating embed for credit modification: ${action}, amount: ${amount}, result:`, result);
    
    return new EmbedBuilder()
        .setTitle(`Credit Balance ${action === 'removed' ? 'Reduced' : 'Enhanced'} ☝️`)
        .setDescription(`I have ${action === 'removed' ? 'reduced' : 'enhanced'} ${user}'s current credit balance, as you have instructed.`)
        .addFields(
            { name: 'Previous Balance', value: `💰 ${result.previousCredits} credit${result.previousCredits !== 1 ? 's' : ''}`, inline: true },
            { name: 'Current Balance', value: `💰 ${result.newCredits} credit${result.newCredits !== 1 ? 's' : ''}`, inline: true },
            { name: `Credits ${action === 'removed' ? 'Removed' : 'Added'}`, value: `${action === 'removed' ? '-' : '+'}${amount}`, inline: true }
        )
        .setColor(action === 'removed' ? 0xFF6B6B : 0x00AA55);
}

async function handleFeedbackResetCommand(message) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions, my lord.');
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the writer whose record you wish to reset to a clean slate.');
    
    const resetData = await performCompleteReset(user.id, message.guild);
    const embed = createResetEmbed(user, resetData);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleFeedbackResetSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const resetData = await performCompleteReset(user.id, interaction.guild);
    const embed = createResetEmbed(user, resetData);
    await replyTemporary(interaction, { embeds: [embed] });
}

async function performCompleteReset(userId, guild) {
    const previousCount = getUserMonthlyFeedback(userId);
    const userRecord = getUserData(userId);
    const previousAllTime = userRecord.totalFeedbackAllTime;
    const hadShelfAccess = userRecord.purchases.includes('shelf');
    
    setUserMonthlyFeedback(userId, 0);
    userRecord.totalFeedbackAllTime = 0;
    userRecord.currentCredits = 0;
    userRecord.bookshelfPosts = 0;
    userRecord.purchases = userRecord.purchases.filter(item => item !== 'shelf');
    
    const targetMember = guild.members.cache.get(userId);
    if (targetMember) {
        await removeUserRoles(targetMember, guild);
    }
    
    const closedThreads = await closeUserBookshelfThreads(guild, userId);
    
    await saveData();
    
    return {
        previousCount,
        previousAllTime,
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

function createResetEmbed(user, resetData) {
    return new EmbedBuilder()
        .setTitle('Complete Literary Record Reset ☝️')
        .setDescription(`${user}'s entire literary standing has been reset to a clean slate, as you have decreed. All achievements and privileges have been stripped away. Perhaps this complete fresh beginning shall inspire true dedication.`)
        .addFields(
            { name: 'Previous Monthly Count', value: `${resetData.previousCount}`, inline: true },
            { name: 'Previous All-Time Total', value: `${resetData.previousAllTime}`, inline: true },
            { name: 'Current Status', value: '**Everything reset to zero**', inline: true },
            { name: 'Bookshelf Access', value: resetData.hadShelfAccess ? '📚 Shelf Owner role removed' : '📚 No previous access', inline: true },
            { name: 'Threads Closed', value: `🔒 ${resetData.closedThreads} thread${resetData.closedThreads !== 1 ? 's' : ''} archived and locked`, inline: true },
            { name: 'Action Taken', value: 'Complete reset: monthly count, all-time total, purchases cleared, Shelf Owner role removed, message credits reset, and all threads closed', inline: false }
        )
        .setColor(0xFF6B6B);
}

// ===== PARDON COMMANDS =====
async function handlePardonCommand(message, args) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions, my lord.');
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the Level 5 member you wish to pardon from this month\'s feedback requirement.');
    
    const member = message.guild.members.cache.get(user.id);
    if (!member || !hasLevel5Role(member)) {
        return replyTemporaryMessage(message, 'I regret that the mentioned user does not possess the Level 5 role and thus requires no pardon.');
    }
    
    pardonUser(user.id);
    await saveData();
    
    const embed = createPardonEmbed(user, 'granted');
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handlePardonSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const member = interaction.guild.members.cache.get(user.id);
    
    if (!member || !hasLevel5Role(member)) {
        const embed = new EmbedBuilder()
            .setTitle('Invalid Target')
            .setDescription('I regret that the mentioned user does not possess the Level 5 role and thus requires no pardon.')
            .setColor(0xFF9900);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    pardonUser(user.id);
    await saveData();
    
    const embed = createPardonEmbed(user, 'granted');
    await replyTemporary(interaction, { embeds: [embed] });
}

function createPardonEmbed(user, action) {
    return new EmbedBuilder()
        .setTitle('Monthly Requirement Pardon Granted ☝️')
        .setDescription(`I have graciously pardoned ${user} from this month's feedback requirement, as you have decreed. They shall be spared from being kicked from the server regardless of their contribution count.`)
        .addFields(
            { name: 'Pardoned User', value: `${user.displayName}`, inline: true },
            { name: 'Effective Period', value: `Current month only`, inline: true },
            { name: 'What This Means', value: '• User will not be kicked this month\n• Pardon resets automatically next month\n• User retains their server membership and roles', inline: false }
        )
        .setColor(0x00AA55);
}

async function handleStatsCommand(message) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return replyTemporaryMessage(message, 'I regret that such privileged information is reserved for those with administrative authority, my lord.');
    }
    
    const embed = await createStatsEmbed(message.guild);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleStatsSlashCommand(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Authority')
            .setDescription('I regret that such privileged information is reserved for those with administrative authority, my lord.')
            .setColor(0xFF6B6B);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    const embed = await createStatsEmbed(interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

async function createStatsEmbed(guild) {
    const totalMembers = guild.memberCount;
    
    // Get all Level 5 members
    const level5Members = guild.members.cache.filter(member => hasLevel5Role(member));
    const totalLevel5 = level5Members.size;
    
    let monthlyContributors = 0;
    let fulfillmentList = '';
    let nonFulfillmentList = '';
    let pardonedList = '';
    let pardonedCount = 0;
    
    // Process each Level 5 member
    level5Members.forEach((member, userId) => {
        const monthlyCount = getUserMonthlyFeedback(userId);
        const isPardoned = isUserPardoned(userId);
        const status = monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT ? '✅' : '❌';
        
        if (monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT) {
            monthlyContributors++;
        }
        
        if (isPardoned) {
            pardonedCount++;
            pardonedList += `${status} **${member.displayName}** (${monthlyCount}) - *Pardoned*\n`;
        } else if (monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT) {
            fulfillmentList += `${status} **${member.displayName}** (${monthlyCount})\n`;
        } else {
            nonFulfillmentList += `${status} **${member.displayName}** (${monthlyCount})\n`;
        }
    });
    
    const contributionRate = totalLevel5 > 0 ? Math.round((monthlyContributors / totalLevel5) * 100) : 0;
    
    // Combine all level 5 member details
    let level5Details = '';
    if (fulfillmentList) level5Details += fulfillmentList;
    if (pardonedList) level5Details += pardonedList;
    if (nonFulfillmentList) level5Details += nonFulfillmentList;
    
    if (!level5Details) level5Details = '• No Level 5 members found';
    if (level5Details.length > 1024) {
        level5Details = level5Details.substring(0, 1000) + '...\n*(List truncated)*';
    }
    
    const embed = new EmbedBuilder()
        .setTitle('Type&Draft Community Statistics ☝️')
        .setDescription('Allow me to present the current state of our literary realm, as observed from my position of humble service.')
        .addFields(
            { name: 'Total Writers in Our Halls', value: `${totalMembers} souls`, inline: true },
            { name: 'Level 5 Members Tracked', value: `${totalLevel5} writers`, inline: true },
            { name: 'Active Contributors This Month', value: `${monthlyContributors} writers`, inline: true },
            { name: 'Monthly Participation Rate', value: `${contributionRate}%`, inline: true },
            { name: 'Community Health', value: contributionRate >= 70 ? '✅ Flourishing' : contributionRate >= 50 ? '⚠️ Moderate' : '🔴 Requires attention', inline: true },
            { name: 'Pardoned This Month', value: `${pardonedCount} members`, inline: true },
            { name: 'Overview', value: `• **${totalLevel5}** total Level 5 members\n• **${monthlyContributors}** meeting requirements\n• **${pardonedCount}** pardoned this month`, inline: false },
            { name: 'Detailed Status', value: level5Details, inline: false }
        )
        .setColor(contributionRate >= 70 ? 0x00AA55 : contributionRate >= 50 ? 0xFF9900 : 0xFF4444)
        .setFooter({ text: 'Monthly purge kicks inactive Level 5 members since July 2025 • ✅ = Meeting requirement • ❌ = Below requirement' });
    
    return embed;
}

async function handleSetupBookshelfCommand(message) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions, my lord.');
    }
    
    const success = await setupBookshelfPermissions(message.guild);
    const embed = createSetupEmbed(success);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleSetupBookshelfSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const success = await setupBookshelfPermissions(interaction.guild);
    const embed = createSetupEmbed(success);
    await replyTemporary(interaction, { embeds: [embed] });
}

function createSetupEmbed(success) {
    const embed = new EmbedBuilder()
        .setTitle(success ? 'Bookshelf Forum Configured ☝️' : 'Configuration Incomplete')
        .setDescription(success ? 
            'I have successfully configured the bookshelf forum permissions. Only those with "Shelf Owner" role may now create threads within.' :
            'I encountered difficulties while configuring the bookshelf forum. Please ensure the forum exists and the bot has proper permissions.')
        .setColor(success ? 0x00AA55 : 0xFF6B6B);
    
    if (success) {
        embed.addFields({
            name: 'Permissions Set',
            value: '• **@everyone**: Cannot create threads\n• **Shelf Owner role**: Can create threads\n• **Moderators**: Retain all permissions',
            inline: false
        });
    } else {
        embed.addFields({
            name: 'Manual Setup Required',
            value: '1. Create a forum channel named "bookshelf"\n2. Set @everyone permissions to deny "Create Public Threads"\n3. Set "Shelf Owner" role to allow "Create Public Threads"',
            inline: false
        });
    }
    
    return embed;
}

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
        .setTitle('Complete Commands Directory ☝️')
        .setDescription('Your comprehensive guide to all available commands in our literary realm, organized by purpose and authority level.')
        .addFields(
            { 
                name: '📝 Feedback System (Level 5 Required)', 
                value: '`/feedback` or `!feedback` - Log your most recent contribution\n`/feedback_status [user]` - Check monthly feedback status', 
                inline: false 
            },
            { 
                name: '💰 Credits & Recognition', 
                value: '`/balance [user]` - Check feedback credits and bookshelf status\n`/store` - View available items for purchase\n`/buy [item]` - Purchase items from the store\n`/hall_of_fame` - View leaderboard of top contributors', 
                inline: false 
            },
            { 
                name: '📚 Information & Help', 
                value: '`/help` - Essential commands guide\n`/commands` - This complete commands list', 
                inline: false 
            },
            { 
                name: '👑 Staff: Feedback Management', 
                value: '`/feedback_add` - Add feedback credits to a member\n`/feedback_remove` - Remove feedback credits from a member\n`/feedback_reset` - Complete account reset', 
                inline: false 
            },
            { 
                name: '👑 Staff: Server Administration', 
                value: '`/stats` - View detailed server statistics\n`/setup_bookshelf` - Configure bookshelf forum permissions\n`/pardon` - Pardon a Level 5 member from monthly feedback requirement\n`/manual_purge` - Manually trigger monthly purge (Server Owner only)', 
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
    
    return new EmbedBuilder()
        .setTitle('Essential Commands at Your Service ☝️')
        .setDescription('Welcome to our distinguished literary community! Behold the fundamental commands for the feedback and credit system:')
        .addFields(
            { 
                name: '📝 Earning Feedback Credits (Level 5 Required)', 
                value: `**Step 1:** Visit ${channels.bookshelfFeedback} or ${channels.bookshelfDiscussion} forums\n**Step 2:** Find another writer's thread and provide thoughtful feedback\n**Step 3:** Use \`/feedback\` to log your most recent contribution\n**Step 4:** Earn 1 credit per logged feedback contribution!`, 
                inline: false 
            },
            { 
                name: '💰 Credit System', 
                value: '`/balance` - Check your credits and chapter allowance\n`/feedback_status` - View monthly progress\n`/hall_of_fame` - See top contributors leaderboard', 
                inline: false 
            },
            { 
                name: '📚 Bookshelf Access', 
                value: `\`/store\` - View purchasable items\n\`/buy shelf\` - Purchase Shelf Owner role (1 credit)\n**Important:** You need **both** Shelf Owner role (purchasable) **and** reader role (staff-assigned) to post in ${channels.bookshelf}`, 
                inline: false 
            },
            { 
                name: '✍️ How It Works', 
                value: '• **Give feedback** to others in feedback forums\n• **Log with `/feedback`** to earn credits\n• **Purchase shelf access** when you have 1 free credit\n• **Post chapters** using `/post_chapter` (costs 1 credit each)', 
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
        .setDescription('I regret that an unforeseen complication has arisen while processing your request. The error details have been logged.')
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
        .setDescription('I fear you lack the necessary authority to conduct such administrative actions, my lord.')
        .setColor(0xFF6B6B);
    
    if (isInteraction) {
        return await replyTemporary(target, { embeds: [embed], ephemeral: true });
    } else {
        return await replyTemporaryMessage(target, { embeds: [embed] });
    }
}

// ===== BOT LOGIN =====
client.login(process.env.DISCORD_BOT2_TOKEN);
