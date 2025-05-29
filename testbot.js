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
const MINIMUM_FEEDBACK_FOR_SHELF = 2; // Changed from 1 to 2

// ===== DATA STORAGE =====
let monthlyFeedback = {};
let userData = {};
let loggedFeedbackMessages = {}; // Track which messages have had feedback logged
let pardonedUsers = {}; // Track users pardoned from monthly requirements

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
            return level >= 15; // Level 15+ includes Level 5 privileges
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
            currentCredits: 0, // Available credits for posting
            purchases: [],
            bookshelfPosts: 0
        };
    }
    
    const user = userData[userId];
    // Ensure all properties exist and are correct types
    if (!Array.isArray(user.purchases)) user.purchases = [];
    if (typeof user.totalFeedbackAllTime !== 'number') user.totalFeedbackAllTime = 0;
    if (typeof user.currentCredits !== 'number') user.currentCredits = 0;
    if (typeof user.bookshelfPosts !== 'number') user.bookshelfPosts = 0;
    
    // Ensure no negative values
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
    // Must have both Shelf Owner role AND reader role to create threads
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
    
    // If user doesn't have enough total feedback to even qualify for purchase
    if (user.totalFeedbackAllTime < 1) {
        return `📝 Need bookshelf to qualify for purchase`;
    }
    
    // If user hasn't purchased shelf access yet
    if (!user.purchases.includes('shelf')) {
        return '💰 Qualified for purchase';
    }
    
    // If user has purchased but doesn't have reader role
    if (!member || !hasReaderRole(member)) {
        return '🔓 Awaiting reader role from staff';
    }
    
    // If user has full access, check credits for posting
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
    
    // If it's a thread, check if the PARENT forum name is in allowed list
    if (channel.isThread() && channel.parent) {
        const parentIsAllowed = ALLOWED_FEEDBACK_THREADS.includes(channel.parent.name);
        if (parentIsAllowed) {
            console.log(`✅ Thread in ${channel.parent.name} forum is allowed`);
            return true;
        }
    }
    
    // Check if it's the forum/channel itself with allowed name
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
    console.log('Starting monthly purge - kicking inactive readers...');
    
    // Check if purging should be active (starting July 1, 2025)
    const now = new Date();
    const purgeStartDate = new Date('2025-07-01');
    if (now < purgeStartDate) {
        console.log('Monthly purge not yet active (starts July 1, 2025)');
        return;
    }
    
    const readerRole = guild.roles.cache.find(r => r.name === 'reader');
    if (!readerRole) {
        console.log('reader role not found for monthly purge');
        return;
    }
    
    let purgedCount = 0;
    const purgedUsers = [];
    
    // Get all members with reader role
    const readersWithRole = guild.members.cache.filter(member => 
        member.roles.cache.has(readerRole.id)
    );
    
    for (const [userId, member] of readersWithRole) {
        // Skip if user is pardoned this month
        if (isUserPardoned(userId)) {
            console.log(`Skipping ${member.displayName} - pardoned this month`);
            continue;
        }
        
        const monthlyCount = getUserMonthlyFeedback(userId);
        
        // If user hasn't met monthly requirement, purge them
        if (monthlyCount < MONTHLY_FEEDBACK_REQUIREMENT) {
            try {
                // Send DM notification before kicking
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
                
                // Kick the user from the server
                await member.kick('Monthly feedback requirement not met - automatic purge');
                
                purgedCount++;
                purgedUsers.push(member.displayName);
                console.log(`Kicked ${member.displayName} for insufficient monthly feedback (${monthlyCount}/${MONTHLY_FEEDBACK_REQUIREMENT})`);
                
            } catch (error) {
                console.error(`Failed to kick ${member.displayName}:`, error);
            }
        }
    }
    
    // Log summary
    console.log(`Monthly purge completed: ${purgedCount} readers kicked from server for inactivity`);
    if (purgedUsers.length > 0) {
        console.log(`Kicked users: ${purgedUsers.join(', ')}`);
    }
    
    return { purgedCount, purgedUsers };
}

function scheduleMonthlyPurge(guild) {
    setInterval(async () => {
        const now = new Date();
        // Run on the 1st of each month at 00:01
        if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() <= 5) {
            await performMonthlyPurge(guild);
        }
    }, 5 * 60 * 1000); // Check every 5 minutes
}

// ===== USER RESET FUNCTION =====
async function resetUserProgress(userId, guild) {
    console.log(`Resetting all progress for user ${userId}`);
    
    // COMPLETE DATA WIPE
    if (monthlyFeedback[userId]) {
        delete monthlyFeedback[userId];
    }
    
    if (userData[userId]) {
        delete userData[userId];
    }
    
    // Remove from logged messages
    Object.keys(loggedFeedbackMessages).forEach(messageId => {
        if (loggedFeedbackMessages[messageId] && loggedFeedbackMessages[messageId].includes(userId)) {
            loggedFeedbackMessages[messageId] = loggedFeedbackMessages[messageId].filter(id => id !== userId);
            if (loggedFeedbackMessages[messageId].length === 0) {
                delete loggedFeedbackMessages[messageId];
            }
        }
    });
    
    // Close their bookshelf threads
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
        
        // Clean up data on load
        for (const userId in userData) {
            getUserData(userId); // This will fix any missing/invalid properties
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
            channel.name === 'bookshelf' && channel.type === 15 // GUILD_FORUM
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
        
        // Deny thread creation for everyone by default
        await bookshelfForum.permissionOverwrites.edit(guild.id, {
            CreatePublicThreads: false,
            CreatePrivateThreads: false
        });
        
        // Allow thread creation only for users with BOTH roles
        // Note: Discord doesn't support "AND" logic for multiple roles directly
        // So this will allow anyone with either role - we'll handle the logic in the bot
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
    user.currentCredits += 1; // Add 1 credit for each feedback
    
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
        // Fetch recent messages and find the user's most recent non-command message
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
        
        // Get the most recent message (first in the collection since it's sorted by newest first)
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
        .setDescription('Log your most recent feedback message in this thread'),
    
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
        .setDescription('Pardon a reader from monthly feedback requirement (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('Reader to pardon from this month\'s requirement').setRequired(true))
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
    
    // Start monthly purge scheduler for all guilds
    client.guilds.cache.forEach(guild => {
        scheduleMonthlyPurge(guild);
        console.log(`Monthly purge scheduler started for guild: ${guild.name}`);
    });
});

client.on('guildMemberAdd', async (member) => {
    console.log(`New member joined: ${member.displayName} (${member.id})`);
    
    // Check if this user has existing data (rejoining) and reset it
    if (userData[member.id] || monthlyFeedback[member.id]) {
        console.log(`Detected returning user ${member.displayName}, resetting their data`);
        await resetUserProgress(member.id, member.guild);
    }
});

// ===== NEW EVENT HANDLERS FOR USER RESET =====
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
    // Check if this is a bookshelf forum thread
    if (thread.parent && thread.parent.name === 'bookshelf') {
        console.log(`New bookshelf thread created: ${thread.name} by ${thread.ownerId}`);
        
        try {
            const member = await thread.guild.members.fetch(thread.ownerId);
            
            // Check if user has both required roles
            if (!canCreateBookshelfThread(member)) {
                console.log(`User ${member.displayName} lacks required roles for bookshelf thread`);
                
                // Delete the thread
                await thread.delete();
                
                // Send DM to user explaining why
                try {
                    const dmChannel = await member.createDM();
                    const embed = new EmbedBuilder()
                        .setTitle('Bookshelf Thread Removed ☝️')
                        .setDescription(`Dear ${member.displayName}, your bookshelf thread has been removed as you lack the required roles.`)
                        .addFields(
                            { name: 'Requirements to Create Bookshelf Threads', value: `• **Shelf Owner role** (purchasable with 1 credit via \`/store\`)\n• **reader role** (assigned by staff based on feedback quality)\n• **Both roles required** to create threads`, inline: false },
                            { name: 'Your Current Status', value: `• Shelf Owner: ${hasShelfRole(member) ? '✅' : '❌'}\n• reader role: ${hasReaderRole(member) ? '✅' : '❌'}`, inline: false },
                            { name: 'How to Gain Access', value: '1. Give feedback to fellow writers and log it with `/feedback`\n2. Purchase "Shelf Owner" role from `/store` for 1 credit\n3. Staff will review your feedback quality and assign reader role\n4. Once you have both roles, you can create <#bookshelf> threads', inline: false }
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

    // Only allow thread owners to post in bookshelf threads, but don't handle credits here
    // Credits are handled by /post_chapter command
    if (message.channel.isThread() && message.channel.parent && message.channel.parent.name === 'bookshelf') {
        const isThreadOwner = message.channel.ownerId === message.author.id;
        
        if (!isThreadOwner) {
            await message.delete();
            await sendBookshelfAccessDeniedDM(message.author, 'thread_owner');
        }
        // If thread owner, allow the message but don't process credits
        return;
    }

    // Handle traditional commands
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
    const embeds = {
        thread_owner: new EmbedBuilder()
            .setTitle('Thread Owner Only ☝️')
            .setDescription(`Dear ${author}, I regret to inform you that only the original author may add content to their literary threads. This sacred space is reserved for the creator's continued narrative.`)
            .addFields(
                { name: 'How to Provide Feedback', value: '• Visit the **<#bookshelf-feedback>** or **<#bookshelf-discussion>** forums\n• Create a thread or comment with your thoughts\n• Use `/feedback` or `!feedback` to log your contribution', inline: false },
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
            pardon: () => handlePardonCommand(message, args)
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
        pardon: () => handlePardonSlashCommand(interaction)
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
    
    // Check if command is used in correct threads
    if (!isInAllowedFeedbackThread(channel)) {
        const embed = new EmbedBuilder()
            .setTitle('Incorrect Thread ☝️')
            .setDescription('I regret to inform you that feedback credits may only be logged within the designated literary threads of our community, under works other than your own.')
            .addFields({
                name: 'Permitted Threads',
                value: '• **<#bookshelf-feedback>** forum - For recording feedback given to fellow writers\n• **<#bookshelf-discussion>** forum - For discussions about literary critiques',
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage({ author: user, reply: (msg) => channel.send(msg) }, { embeds: [embed] });
        }
    }
    
    // Check if this is the user's own thread (prevent self-feedback logging)
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
    
    // Find user's most recent message in this channel
    const latestMessage = await findUserLatestMessage(channel, user.id);
    
    if (!latestMessage) {
        const embed = new EmbedBuilder()
            .setTitle('No Feedback Message Found ☝️')
            .setDescription('I regret that I could not locate a recent feedback message from you in this thread, dear writer. You must post your feedback message **before** using the feedback command.')
            .addFields({
                name: 'How to Properly Use This System',
                value: '1. **First:** Write a thoughtful feedback message in this thread\n2. **Then:** Use `/feedback` command to log that message for credits\n3. **Note:** Commands like `/feedback` itself do not count as feedback messages',
                inline: false
            },
            {
                name: 'What Counts as Feedback',
                value: '• Constructive critique of another writer\'s work\n• Thoughtful analysis and suggestions\n• Meaningful discussion about writing techniques\n• **Not commands, short replies, or non-feedback messages**',
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage({ author: user, reply: (msg) => channel.send(msg) }, { embeds: [embed] });
        }
    }
    
    // Additional validation: message must be substantial (at least 20 characters)
    if (latestMessage.content.length < 20) {
        const embed = new EmbedBuilder()
            .setTitle('Feedback Too Brief ☝️')
            .setDescription('I regret to inform you that your most recent message appears too brief to qualify as meaningful feedback, dear writer.')
            .addFields({
                name: 'Quality Standards',
                value: '• Feedback messages should be **thoughtful and substantial**\n• Provide specific critique, suggestions, or analysis\n• Short replies like "good job" or "nice" do not qualify\n• Aim for detailed, constructive feedback',
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage({ author: user, reply: (msg) => channel.send(msg) }, { embeds: [embed] });
        }
    }
    
    // Check if this message has already been logged
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
    
    // Log the feedback
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
    // Check if in bookshelf thread
    if (!channel.isThread() || !channel.parent || channel.parent.name !== 'bookshelf') {
        const embed = new EmbedBuilder()
            .setTitle('Wrong Thread ☝️')
            .setDescription('I regret to inform you that the post chapter command may only be used within your own bookshelf thread, dear writer.')
            .addFields({
                name: 'How to Use',
                value: '• Go to your thread in the <#bookshelf> forum\n• Use `/post_chapter` to post a new chapter (costs 1 credit)\n• Only the thread owner may post chapters',
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage(message, { embeds: [embed] });
        }
    }
    
    // Check if user is the thread owner
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
    
    // Check if user has both required roles
    if (!canPostInBookshelf(userId, member)) {
        const embed = new EmbedBuilder()
            .setTitle('Required Roles Missing ☝️')
            .setDescription('I regret to inform you that posting chapters requires both the Shelf Owner role and the reader role, dear writer.')
            .addFields({
                name: 'Your Current Status',
                value: `• Shelf Owner: ${hasShelfRole(member) ? '✅' : '❌'}\n• reader role: ${hasReaderRole(member) ? '✅' : '❌'}`,
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage(message, { embeds: [embed] });
        }
    }
    
    // Check if user has credits
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
    
    // Spend the credit and update posts count
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
    // Get all users with feedback credits and sort them
    const usersWithCredits = Object.entries(userData)
        .filter(([userId, data]) => data.totalFeedbackAllTime > 0)
        .sort(([, a], [, b]) => b.totalFeedbackAllTime - a.totalFeedbackAllTime)
        .slice(0, 10); // Top 10
    
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
            // Skip users who are no longer in the guild
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
    const embed = createStoreEmbed();
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleStoreSlashCommand(interaction) {
    const embed = createStoreEmbed();
    await replyTemporary(interaction, { embeds: [embed] });
}

function createStoreEmbed() {
    return new EmbedBuilder()
        .setTitle('Type&Draft Literary Emporium ☝️')
        .setDescription('Welcome to our humble establishment, where dedication to the craft is rewarded with privileges. Examine our current offerings, crafted with the utmost care for our literary community.')
        .addFields(
            { name: '📚 Bookshelf Access', value: `Grants you the Shelf Owner role to create threads in <#bookshelf>\n**Price:** ${STORE_ITEMS.shelf.price} feedback credits\n**Note:** reader role must be assigned by staff separately based on feedback quality`, inline: false },
            { name: 'How to Earn Credits', value: `• **Provide feedback** to fellow writers in the designated forums\n• **Log contributions** with \`/feedback\` to earn 1 credit each\n• **Build your reputation** through meaningful engagement`, inline: false },
            { name: 'Important Notice', value: 'To post chapters in <#bookshelf>, you need **both** the Shelf Owner role (purchasable) **and** the reader role (staff-assigned based on feedback quality). Each chapter posted costs 1 credit via `/post_chapter`.', inline: false }
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
    const embed = createPurchaseResultEmbed(message.author, itemKey, result);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleBuySlashCommand(interaction) {
    const itemKey = interaction.options.getString('item');
    const result = await processPurchase(interaction.user.id, itemKey, interaction.member, interaction.guild);
    const embed = createPurchaseResultEmbed(interaction.user, itemKey, result);
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
    // Only assign Shelf Owner role - reader role must be assigned by staff
    const roleNames = [STORE_ITEMS[itemKey].role];
    
    for (const roleName of roleNames) {
        if (!roleName) continue;
        
        let role = guild.roles.cache.find(r => r.name === roleName);
        if (!role) {
            try {
                const roleColor = 0x8B4513; // Brown color for Shelf Owner
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

function createPurchaseResultEmbed(user, itemKey, result) {
    const item = STORE_ITEMS[itemKey];
    
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
            { name: 'Important Notice', value: '⚠️ **reader role required separately from staff** to post chapters in <#bookshelf> forum. Staff will review your feedback quality and assign the reader role when appropriate.', inline: false },
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
    userRecord.currentCredits += amount; // Also add to current credits
    
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
    
    // Only reduce current credits, not total feedback or monthly count
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
    
    // COMPLETE RESET
    setUserMonthlyFeedback(userId, 0);
    userRecord.totalFeedbackAllTime = 0;
    userRecord.currentCredits = 0;
    userRecord.bookshelfPosts = 0;
    userRecord.purchases = userRecord.purchases.filter(item => item !== 'shelf');
    
    // Remove Shelf Owner role (reader role is managed by staff separately)
    const targetMember = guild.members.cache.get(userId);
    if (targetMember) {
        await removeUserRoles(targetMember, guild);
    }
    
    // Close threads
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
    // Only remove Shelf Owner role - reader role is managed by staff
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
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the reader you wish to pardon from this month\'s feedback requirement.');
    
    const member = message.guild.members.cache.get(user.id);
    if (!member || !hasReaderRole(member)) {
        return replyTemporaryMessage(message, 'I regret that the mentioned user does not possess the reader role and thus requires no pardon.');
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
    
    if (!member || !hasReaderRole(member)) {
        const embed = new EmbedBuilder()
            .setTitle('Invalid Target')
            .setDescription('I regret that the mentioned user does not possess the reader role and thus requires no pardon.')
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
    const verifiedCount = Object.keys(userData).length;
    
    const monthKey = getCurrentMonthKey();
    let monthlyContributors = 0;
    for (const [userId, userMonthlyData] of Object.entries(monthlyFeedback)) {
        if (userMonthlyData[monthKey] && userMonthlyData[monthKey] > 0) {
            monthlyContributors++;
        }
    }
    
    const contributionRate = verifiedCount > 0 ? Math.round((monthlyContributors / verifiedCount) * 100) : 0;
    
    // Get reader role status
    const readerRole = guild.roles.cache.find(r => r.name === 'reader');
    let readerStats = '• No reader role found';
    let readerDetails = '';
    
    if (readerRole) {
        const readersWithRole = guild.members.cache.filter(member => 
            member.roles.cache.has(readerRole.id)
        );
        
        let fulfillmentList = '';
        let nonFulfillmentList = '';
        let pardonedList = '';
        
        for (const [userId, member] of readersWithRole) {
            const monthlyCount = getUserMonthlyFeedback(userId);
            const isPardoned = isUserPardoned(userId);
            const status = monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT ? '✅' : '❌';
            
            if (isPardoned) {
                pardonedList += `${status} **${member.displayName}** (${monthlyCount}) - *Pardoned*\n`;
            } else if (monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT) {
                fulfillmentList += `${status} **${member.displayName}** (${monthlyCount})\n`;
            } else {
                nonFulfillmentList += `${status} **${member.displayName}** (${monthlyCount})\n`;
            }
        }
        
        const totalReaders = readersWithRole.size;
        const fulfillmentCount = readersWithRole.filter(([userId]) => 
            getUserMonthlyFeedback(userId) >= MONTHLY_FEEDBACK_REQUIREMENT
        ).size;
        const pardonedCount = readersWithRole.filter(([userId]) => 
            isUserPardoned(userId)
        ).size;
        
        readerStats = `• **${totalReaders}** total readers\n• **${fulfillmentCount}** meeting requirements\n• **${pardonedCount}** pardoned this month`;
        
        // Combine all reader details
        readerDetails = '';
        if (fulfillmentList) readerDetails += fulfillmentList;
        if (pardonedList) readerDetails += pardonedList;
        if (nonFulfillmentList) readerDetails += nonFulfillmentList;
        
        if (!readerDetails) readerDetails = '• No readers found';
        if (readerDetails.length > 1024) {
            readerDetails = readerDetails.substring(0, 1000) + '...\n*(List truncated)*';
        }
    }
    
    const embed = new EmbedBuilder()
        .setTitle('Type&Draft Community Statistics ☝️')
        .setDescription('Allow me to present the current state of our literary realm, as observed from my position of humble service.')
        .addFields(
            { name: 'Total Writers in Our Halls', value: `${totalMembers} souls`, inline: true },
            { name: 'Writers Under My Watch', value: `${verifiedCount} tracked`, inline: true },
            { name: 'Active Contributors This Month', value: `${monthlyContributors} writers`, inline: true },
            { name: 'Monthly Participation Rate', value: `${contributionRate}%`, inline: true },
            { name: 'Community Health', value: contributionRate >= 70 ? '✅ Flourishing' : contributionRate >= 50 ? '⚠️ Moderate' : '🔴 Requires attention', inline: true },
            { name: 'Current Month', value: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), inline: true },
            { name: 'Reader Overview', value: readerStats, inline: false },
            { name: 'Reader Detailed Status', value: readerDetails, inline: false }
        )
        .setColor(contributionRate >= 70 ? 0x00AA55 : contributionRate >= 50 ? 0xFF9900 : 0xFF4444)
        .setFooter({ text: 'Monthly purge kicks inactive readers since July 2025 • ✅ = Meeting requirement • ❌ = Below requirement' });
    
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
                value: '`/feedback` or `!feedback` - Log your most recent feedback message\n`/feedback_status [user]` - Check monthly feedback status', 
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
                value: '`/stats` - View detailed server statistics\n`/setup_bookshelf` - Configure bookshelf forum permissions\n`/pardon` - Pardon a reader from monthly feedback requirement', 
                inline: false 
            }
        )
        .setColor(0x2F3136)
        .setFooter({ text: 'Your humble servant in all matters literary and administrative' });
}

async function handleHelpCommand(message) {
    const embed = createHelpEmbed();
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleHelpSlashCommand(interaction) {
    const embed = createHelpEmbed();
    await replyTemporary(interaction, { embeds: [embed] });
}

function createHelpEmbed() {
    return new EmbedBuilder()
        .setTitle('Essential Commands at Your Service ☝️')
        .setDescription('Welcome to our distinguished literary community! Behold the fundamental commands for the feedback and credit system:')
        .addFields(
            { 
                name: '📝 Earning Feedback Credits (Level 5 Required)', 
                value: '**Step 1:** Visit <#bookshelf-feedback> or <#bookshelf-discussion> forums\n**Step 2:** Find another writer\'s thread and provide thoughtful feedback\n**Step 3:** Use `/feedback` to log your most recent feedback message\n**Step 4:** Earn 1 credit per logged feedback contribution!', 
                inline: false 
            },
            { 
                name: '💰 Credit System', 
                value: '`/balance` - Check your credits and chapter allowance\n`/feedback_status` - View monthly progress\n`/hall_of_fame` - See top contributors leaderboard', 
                inline: false 
            },
            { 
                name: '📚 Bookshelf Access', 
                value: '`/store` - View purchasable items\n`/buy shelf` - Purchase Shelf Owner role (1 credit)\n**Important:** You need **both** Shelf Owner role (purchasable) **and** reader role (staff-assigned) to post in <#bookshelf>', 
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
