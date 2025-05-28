require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, REST, Routes } = require('discord.js');
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

// ===== DATA STORAGE =====
let monthlyFeedback = {};
let userData = {};
let loggedFeedbackMessages = {}; // Track which messages have had feedback logged: { messageId: [userId1, userId2, ...] }

const STORE_ITEMS = {
    shelf: {
        name: "Bookshelf Access",
        description: "Grants you the ability to post messages in the #bookshelf forum and assigns reader role",
        price: 200,
        role: "Shelf Owner",
        emoji: "📚"
    }
};

const ALLOWED_FEEDBACK_THREADS = ['bookshelf-feedback', 'bookshelf-discussion'];
const MONTHLY_FEEDBACK_REQUIREMENT = 2;
const MINIMUM_FEEDBACK_FOR_SHELF = 2;
const DINARS_PER_FEEDBACK = 100;

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
    if (!member || !member.roles) {
        console.log('Invalid member object');
        return false;
    }
    
    const roles = member.roles.cache.map(role => role.name);
    console.log(`Checking roles for ${member.displayName}:`, roles);
    const hasRole = member.roles.cache.some(role => 
        role.name === 'Level 5' || 
        role.name === 'Level 15' || 
        role.name.startsWith('Level ') && parseInt(role.name.split(' ')[1]) >= 5
    );
    console.log(`Has Level 5+ role:`, hasRole);
    return hasRole;
}

function hasShelfRole(member) {
    if (!member || !member.roles) return false;
    return member.roles.cache.some(role => role.name === 'Shelf Owner');
}

function getUserData(userId) {
    if (!userData[userId]) {
        userData[userId] = {
            totalFeedbackAllTime: 0,
            dinars: 0,
            purchases: [],
            bookshelfPosts: 0
        };
        console.log(`Created new user data for ${userId}`);
    }
    
    // Ensure all properties exist and are correct types
    const user = userData[userId];
    if (!Array.isArray(user.purchases)) user.purchases = [];
    if (typeof user.totalFeedbackAllTime !== 'number') user.totalFeedbackAllTime = 0;
    if (typeof user.dinars !== 'number') user.dinars = 0;
    if (typeof user.bookshelfPosts !== 'number') user.bookshelfPosts = 0;
    
    // Ensure no negative values
    user.totalFeedbackAllTime = Math.max(0, user.totalFeedbackAllTime);
    user.dinars = Math.max(0, user.dinars);
    user.bookshelfPosts = Math.max(0, user.bookshelfPosts);
    
    console.log(`User data for ${userId}:`, user);
    return user;
}

function addDinars(userId, amount) {
    const user = getUserData(userId);
    const validAmount = Math.max(0, Math.floor(amount));
    user.dinars += validAmount;
    console.log(`Added ${validAmount} dinars to ${userId}, new balance: ${user.dinars}`);
    return user.dinars;
}

function spendDinars(userId, amount) {
    const user = getUserData(userId);
    const validAmount = Math.max(0, Math.floor(amount));
    if (user.dinars >= validAmount) {
        user.dinars -= validAmount;
        console.log(`Spent ${validAmount} dinars for ${userId}, new balance: ${user.dinars}`);
        return true;
    }
    console.log(`Insufficient dinars for ${userId}: has ${user.dinars}, needs ${validAmount}`);
    return false;
}

function getBookshelfAccessStatus(userId) {
    const user = getUserData(userId);
    
    if (canPostInBookshelf(userId)) {
        return '✅ Access granted';
    } else if (user.totalFeedbackAllTime < MINIMUM_FEEDBACK_FOR_SHELF) {
        const needed = MINIMUM_FEEDBACK_FOR_SHELF - user.totalFeedbackAllTime;
        return `📝 Need ${needed} more feedback${needed === 1 ? '' : 's'} to qualify for purchase`;
    } else if (!user.purchases.includes('shelf')) {
        return '💰 Ready to purchase shelf access (feedback requirement met)';
    } else {
        return '❓ Contact staff';
    }
}

function canPostInBookshelf(userId) {
    const user = getUserData(userId);
    const hasEnoughFeedback = user.totalFeedbackAllTime >= MINIMUM_FEEDBACK_FOR_SHELF;
    const hasShelfPurchase = user.purchases.includes('shelf');
    
    console.log(`Bookshelf check for ${userId}: feedback=${user.totalFeedbackAllTime} (need ${MINIMUM_FEEDBACK_FOR_SHELF}), shelf=${hasShelfPurchase}`);
    
    return hasEnoughFeedback && hasShelfPurchase;
}

function canMakeNewPost(userId) {
    const user = getUserData(userId);
    
    // Must have shelf access first
    if (!canPostInBookshelf(userId)) {
        return false;
    }
    
    // Calculate available message credits
    // Formula: total feedback - messages already posted - 1 (since first message is free)
    const availableCredits = user.totalFeedbackAllTime - user.bookshelfPosts - 1;
    
    console.log(`Message credit check for ${userId}: feedback=${user.totalFeedbackAllTime}, messages posted=${user.bookshelfPosts}, available credits=${availableCredits}`);
    
    // FIX: Changed from >= 0 to > 0
    return availableCredits > 0;
}

function getPostCreditStatus(userId) {
    const user = getUserData(userId);
    
    if (!canPostInBookshelf(userId)) {
        return getBookshelfAccessStatus(userId);
    }
    
    const messagesRemaining = user.totalFeedbackAllTime - user.bookshelfPosts - 1;
    
    if (messagesRemaining > 0) {
        return `✅ ${messagesRemaining} message${messagesRemaining === 1 ? '' : 's'} remaining`;
    } else {
        const needed = Math.abs(messagesRemaining) + 1;
        return `📝 Need ${needed} more feedback to post another message`;
    }
}

function isInAllowedFeedbackThread(channel) {
    // For debugging - remove these logs once working
    console.log(`Checking channel: ${channel.name}, type: ${channel.type}, isThread: ${channel.isThread()}`);
    if (channel.parent) {
        console.log(`Parent channel: ${channel.parent.name}, parent type: ${channel.parent.type}`);
    }
    
    // If it's a thread, check if the PARENT forum name is in allowed list
    if (channel.isThread() && channel.parent) {
        const parentIsAllowed = ALLOWED_FEEDBACK_THREADS.includes(channel.parent.name);
        console.log(`Thread parent check: ${channel.parent.name} allowed? ${parentIsAllowed}`);
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
    
    console.log(`❌ Channel/thread not allowed. Thread parent: ${channel.parent?.name || 'none'}, Channel name: ${channel.name}, Allowed: ${ALLOWED_FEEDBACK_THREADS.join(', ')}`);
    return false;
}

function hasStaffPermissions(member) {
    return member && member.permissions && member.permissions.has(PermissionFlagsBits.ManageMessages);
}

async function closeUserBookshelfThreads(guild, userId) {
    try {
        // Find the bookshelf forum
        const bookshelfForum = guild.channels.cache.find(channel => 
            channel.name === 'bookshelf' && channel.type === 15 // GUILD_FORUM
        );
        
        if (!bookshelfForum) {
            console.log('Bookshelf forum not found');
            return;
        }
        
        // Get all threads in the bookshelf forum
        const threads = await bookshelfForum.threads.fetch();
        let closedCount = 0;
        
        // Close threads created by the reset user
        for (const [threadId, thread] of threads.threads) {
            if (thread.ownerId === userId) {
                try {
                    await thread.setArchived(true);
                    await thread.setLocked(true);
                    closedCount++;
                    console.log(`Closed thread: ${thread.name} (${threadId})`);
                } catch (error) {
                    console.log(`Failed to close thread ${thread.name}:`, error.message);
                }
            }
        }
        
        console.log(`Closed ${closedCount} threads for user ${userId}`);
        return closedCount;
    } catch (error) {
        console.error('Error closing user threads:', error);
        return 0;
    }
}

async function setupBookshelfPermissions(guild) {
    try {
        // Find the bookshelf forum
        const bookshelfForum = guild.channels.cache.find(channel => 
            channel.name === 'bookshelf' && channel.type === 15 // GUILD_FORUM
        );
        
        if (!bookshelfForum) {
            console.log('⚠️ Bookshelf forum not found. Please create a forum channel named "bookshelf"');
            return false;
        }
        
        // Find the Shelf Owner role
        const shelfRole = guild.roles.cache.find(r => r.name === 'Shelf Owner');
        if (!shelfRole) {
            console.log('⚠️ Shelf Owner role not found. It will be created when first user purchases shelf access.');
            return false;
        }
        
        // Set permissions so only Shelf Owner role can create threads
        await bookshelfForum.permissionOverwrites.edit(guild.id, {
            CreatePublicThreads: false,
            CreatePrivateThreads: false
        });
        
        await bookshelfForum.permissionOverwrites.edit(shelfRole.id, {
            CreatePublicThreads: true,
            CreatePrivateThreads: false
        });
        
        console.log('✅ Bookshelf forum permissions configured successfully');
        return true;
    } catch (error) {
        console.error('❌ Failed to setup bookshelf permissions:', error.message);
        return false;
    }
}

// ===== AUTO-DELETE FUNCTIONS =====
async function sendTemporaryMessage(channel, messageOptions, delay = 1800000) {
    try {
        const message = await channel.send(messageOptions);
        setTimeout(async () => {
            try { await message.delete(); } catch (error) { console.log('Failed to delete message:', error.message); }
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
            try { await interaction.deleteReply(); } catch (error) { console.log('Failed to delete reply:', error.message); }
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
            try { await reply.delete(); } catch (error) { console.log('Failed to delete reply:', error.message); }
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
        const data = { monthlyFeedback, userData, loggedFeedbackMessages };
        await fs.writeFile('bot_data.json', JSON.stringify(data, null, 2));
        console.log('Data saved successfully');
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

async function loadData() {
    try {
        const data = await fs.readFile('bot_data.json', 'utf8');
        const parsed = JSON.parse(data);
        monthlyFeedback = parsed.monthlyFeedback || {};
        userData = parsed.userData || {};
        loggedFeedbackMessages = parsed.loggedFeedbackMessages || {};
        
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
    }
}

// ===== SLASH COMMANDS SETUP =====
const commands = [
    new SlashCommandBuilder().setName('feedback').setDescription('Log a feedback contribution you have given to a fellow writer'),
    new SlashCommandBuilder().setName('feedback_status').setDescription('Check monthly contribution status')
        .addUserOption(option => option.setName('user').setDescription('User to check status for (optional)').setRequired(false)),
    new SlashCommandBuilder().setName('feedback_add').setDescription('Add feedback points to a member (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to add points to').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Number of points to add (default: 1)').setRequired(false)),
    new SlashCommandBuilder().setName('feedback_remove').setDescription('Remove feedback points from a member (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to remove points from').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Number of points to remove (default: 1)').setRequired(false)),
    new SlashCommandBuilder().setName('feedback_reset').setDescription('Reset member\'s monthly feedback to zero (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to reset').setRequired(true)),
    new SlashCommandBuilder().setName('dinars_add').setDescription('Add dinars to a member (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to add dinars to').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Number of dinars to add').setRequired(true)),
    new SlashCommandBuilder().setName('dinars_remove').setDescription('Remove dinars from a member (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to remove dinars from').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Number of dinars to remove').setRequired(true)),
    new SlashCommandBuilder().setName('help').setDescription('Display command guide'),
    new SlashCommandBuilder().setName('stats').setDescription('View detailed server statistics (Staff only)'),
    new SlashCommandBuilder().setName('balance').setDescription('Check your dinar balance and bookshelf eligibility')
        .addUserOption(option => option.setName('user').setDescription('User to check balance for (optional)').setRequired(false)),
    new SlashCommandBuilder().setName('store').setDescription('View available items in the Type&Draft store'),
    new SlashCommandBuilder().setName('buy').setDescription('Purchase an item from the store')
        .addStringOption(option => option.setName('item').setDescription('Item to purchase').setRequired(true)
            .addChoices({ name: 'Bookshelf Access (200 dinars)', value: 'shelf' })),
    new SlashCommandBuilder().setName('setup_bookshelf').setDescription('Setup bookshelf forum permissions (Staff only)')
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

// ===== FEEDBACK COMMAND LOGIC =====
function hasUserLoggedFeedbackForMessage(messageId, userId) {
    if (!loggedFeedbackMessages[messageId]) {
        return false;
    }
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

// ===== CORE FEEDBACK LOGIC =====
async function processFeedbackContribution(userId, isSlashCommand = false) {
    const currentCount = getUserMonthlyFeedback(userId);
    const newCount = currentCount + 1;
    setUserMonthlyFeedback(userId, newCount);
    
    const user = getUserData(userId);
    user.totalFeedbackAllTime += 1;
    const newBalance = addDinars(userId, DINARS_PER_FEEDBACK);
    
    await saveData();
    
    return {
        newCount,
        totalAllTime: user.totalFeedbackAllTime,
        newBalance,
        requirementMet: newCount >= MONTHLY_FEEDBACK_REQUIREMENT
    };
}

async function createFeedbackEmbed(user, feedbackData) {
    return new EmbedBuilder()
        .setTitle('Contribution Duly Recorded ☝️')
        .setDescription(`Your generous offering of feedback has been noted with appreciation, ${user}. Such dedication to your fellow scribes is most commendable indeed.`)
        .addFields(
            { name: 'This Month', value: `${feedbackData.newCount} contribution${feedbackData.newCount !== 1 ? 's' : ''}`, inline: true },
            { name: 'Monthly Requirement', value: feedbackData.requirementMet ? '✅ Graciously fulfilled' : '📝 Still in progress', inline: true },
            { name: 'All Time Total', value: `${feedbackData.totalAllTime}`, inline: true },
            { name: 'Dinars Earned', value: `💰 +${DINARS_PER_FEEDBACK} dinars`, inline: true },
            { name: 'Current Balance', value: `💰 ${feedbackData.newBalance} dinars`, inline: true },
            { name: 'Bookshelf Access', value: getBookshelfAccessStatus(user.id), inline: true }
        )
        .setColor(feedbackData.requirementMet ? 0x00AA55 : 0x5865F2);
}

// ===== BOT EVENTS =====
client.once('ready', async () => {
    console.log(`${client.user.tag} is online and serving Type&Draft!`);
    await loadData();
    await registerCommands();
});

client.on('guildMemberAdd', async (member) => {
    // Welcome channel announcement
    const welcomeChannel = member.guild.channels.cache.find(ch => ch.name === 'welcome');
    if (welcomeChannel) {
        const welcomeEmbed = new EmbedBuilder()
            .setTitle(`Behold! A New Scribe Joins Our Esteemed Halls ☝️`)
            .setDescription(`@everyone\n\nMy lords and ladies, I have the distinct pleasure of announcing the arrival of ${member.displayName} to our distinguished literary realm. Word has reached my ears that they seek to test their mettle amongst writers of considerable reputation.\n\nAs your humble servant, I do hope you shall extend the customary courtesies befitting our station. Perhaps a warm greeting, a gentle word of guidance, or—dare I suggest—an invitation to partake in the noble art of critique exchange.\n\nRemember, dear writers, that today's newcomer may well become tomorrow's most celebrated wordsmith. I have witnessed many a humble quill rise to greatness through the nurturing embrace of this very community.`)
            .addFields(
                { name: 'A Most Sage Counsel', value: `${member.displayName}, you would do exceedingly well to acquaint yourself with our customs forthwith. Visit the introductions channel, peruse our rules with the attention they deserve, and perhaps—when you feel sufficiently prepared—venture forth to offer or seek the invaluable gift of feedback.`, inline: false },
                { name: 'The Path to Literary Standing', value: `Know this: in Type&Draft, we measure worth not by birth nor station, but by one\'s willingness to nurture the craft of fellow scribes. Each month, those of Level 5 standing must contribute at least ${MONTHLY_FEEDBACK_REQUIREMENT} offerings of feedback to maintain their good name.`, inline: false }
            )
            .setColor(0xFFD700)
            .setThumbnail(member.user.displayAvatarURL())
            .setFooter({ text: 'Your devoted servant in all matters literary and administrative' });
        
        await sendTemporaryMessage(welcomeChannel, { embeds: [welcomeEmbed] });
    }
    
    // Introduction channel instructions
    const introChannel = member.guild.channels.cache.find(ch => ch.name === 'introductions');
    if (introChannel) {
        const embed = new EmbedBuilder()
            .setTitle(`A New Writer Graces Type&Draft ☝️`)
            .setDescription(`Welcome, ${member.displayName}. I do hope your quill shall prove as sharp as your wit. Please, do acquaint yourself with our modest customs and introduce yourself with your **lucky number** and **favorite animal** - small tokens that help us know our fellow scribes better.`)
            .addFields(
                { name: 'Your Path Forward', value: '• Peruse the rules with utmost care\n• Select your roles in reaction-roles\n• Introduce yourself here with the required particulars\n• Begin your literary journey amongst kindred spirits', inline: false },
                { name: 'A Gentle Counsel', value: `Remember, dear writer, that in Type&Draft we flourish through the sharing of wisdom. Each month, you must offer at least ${MONTHLY_FEEDBACK_REQUIREMENT} contributions of feedback to remain in good standing once you reach Level 5.`, inline: false }
            )
            .setColor(0x2F3136)
            .setThumbnail(member.user.displayAvatarURL());
        
        await sendTemporaryMessage(introChannel, { embeds: [embed] });
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Bookshelf forum protection - Only OP can post in their own threads
    // Check if message is in a thread within the bookshelf forum
    if (message.channel.isThread() && message.channel.parent && message.channel.parent.name === 'bookshelf') {
        const userId = message.author.id;
        const user = getUserData(userId);
        const isThreadOwner = message.channel.ownerId === userId;
        
        console.log(`Message in bookshelf thread: ${message.channel.name} by ${message.author.displayName}, isOwner: ${isThreadOwner}`);
        
        // Block anyone who isn't the thread owner
        if (!isThreadOwner) {
            await message.delete();
            
            const embed = new EmbedBuilder()
                .setTitle('Thread Owner Only ☝️')
                .setDescription(`Dear ${message.author}, I regret to inform you that only the original author may add content to their literary threads. This sacred space is reserved for the creator's continued narrative.`)
                .addFields(
                    { name: 'How to Provide Feedback', value: '• Visit the **#bookshelf-feedback** or **#bookshelf-discussion** forums\n• Create a thread or comment with your thoughts\n• Reply to your own feedback message with `!feedback` to log your contribution', inline: false },
                    { name: 'Why This Restriction?', value: 'Each bookshelf thread is the author\'s personal showcase space. Feedback and discussions happen in the dedicated feedback forums to maintain organization.', inline: false }
                )
                .setColor(0xFF9900);
            
            try {
                const dmChannel = await message.author.createDM();
                await dmChannel.send({ embeds: [embed] });
            } catch (error) {
                console.log('Could not send DM to user:', error.message);
            }
            return;
        }
        
        // For thread owners: check shelf access and message credits
        if (!canPostInBookshelf(userId) || !hasShelfRole(message.member)) {
            await message.delete();
            
            const embed = new EmbedBuilder()
                .setTitle('Bookshelf Access Required ☝️')
                .setDescription(`Dear ${message.author}, I regret to inform you that posting in the bookshelf forum requires both dedication and investment in our literary community.`)
                .addFields(
                    { name: 'Requirements to Post', value: `• **Minimum ${MINIMUM_FEEDBACK_FOR_SHELF} feedback contributions** (You have: ${user.totalFeedbackAllTime})\n• **Purchase bookshelf access** from the store for ${STORE_ITEMS.shelf.price} dinars\n• **Current balance:** ${user.dinars} dinars`, inline: false },
                    { name: 'How to Gain Access', value: '1. Give feedback to fellow writers and log it with `!feedback` or `/feedback`\n2. Earn 100 dinars per logged feedback\n3. Purchase "Bookshelf Access" from `!store` or `/store` for 200 dinars\n4. Return here to share your literary works', inline: false }
                )
                .setColor(0xFF9900);
            
            try {
                const dmChannel = await message.author.createDM();
                await dmChannel.send({ embeds: [embed] });
            } catch (error) {
                console.log('Could not send DM to user:', error.message);
            }
            return;
        }
        
        // Check message credits for thread owner (every message costs 1 credit except the first ever)
        if (!canMakeNewPost(userId)) {
            await message.delete();
            
            const postsRemaining = user.totalFeedbackAllTime - user.bookshelfPosts - 1;
            const needed = Math.abs(postsRemaining) + 1;
            
            const embed = new EmbedBuilder()
                .setTitle('Insufficient Message Credits ☝️')
                .setDescription(`Dear ${message.author}, while you possess bookshelf access, each message beyond your first requires additional dedication to our community through feedback contributions.`)
                .addFields(
                    { name: 'Your Bookshelf Activity', value: `• **Messages posted:** ${user.bookshelfPosts}\n• **Total feedback given:** ${user.totalFeedbackAllTime}\n• **Additional feedback needed:** ${needed}`, inline: false },
                    { name: 'How the System Works', value: '• **First message ever:** Free after purchasing shelf access\n• **Each additional message:** Requires 1 more total feedback contribution\n• **Example:** 5 total feedback = 4 messages allowed (1 free + 3 earned)', inline: false },
                    { name: 'How to Earn More Messages', value: `Give feedback to fellow writers in the forums and log it with \`!feedback\` in #bookshelf-feedback or #bookshelf-discussion`, inline: false }
                )
                .setColor(0xFF9900);
            
            try {
                const dmChannel = await message.author.createDM();
                await dmChannel.send({ embeds: [embed] });
            } catch (error) {
                console.log('Could not send DM to user:', error.message);
            }
            return;
        }
        
        // Allow the message from thread owner and increment counter
        user.bookshelfPosts += 1;
        await saveData();
        
        // Send a congratulatory message for significant milestones
        const isFirstMessage = user.bookshelfPosts === 1;
        const remainingPosts = Math.max(0, user.totalFeedbackAllTime - user.bookshelfPosts - 1);
        
        if (isFirstMessage || user.bookshelfPosts % 5 === 0) { // Show message on first post or every 5th post
            const embed = new EmbedBuilder()
                .setTitle(isFirstMessage ? 'First Message Posted ☝️' : 'Milestone Reached ☝️')
                .setDescription(isFirstMessage ? 
                    `Your first literary contribution has been graciously accepted into the bookshelf forum, ${message.author}. May it inspire meaningful discussions among our community.` :
                    `Congratulations, ${message.author}! You have reached ${user.bookshelfPosts} messages in our literary forum. Your dedication to our community is most commendable.`)
                .addFields(
                    { name: 'Messages Posted', value: `${user.bookshelfPosts}`, inline: true },
                    { name: 'Messages Remaining', value: remainingPosts > 0 ? `${remainingPosts}` : 'Give more feedback to post again', inline: true },
                    { name: 'Total Feedback Given', value: `${user.totalFeedbackAllTime}`, inline: true }
                )
                .setColor(0x00AA55);
            
            await sendTemporaryMessage(message.channel, { embeds: [embed] });
        }
        
        return; // Exit early for all bookshelf forum messages
    }

    // Handle traditional commands
    if (message.content.startsWith('!')) {
        await handleCommand(message);
        return;
    }

    // Introduction detection
    if (message.channel.name === 'introductions') {
        const content = message.content.toLowerCase();
        const hasLuckyNumber = /lucky number|number.*\d|\d.*lucky/.test(content);
        const hasFavoriteAnimal = /favorite animal|favourite animal|fav animal/.test(content);
        
        if (hasLuckyNumber && hasFavoriteAnimal) {
            const embed = new EmbedBuilder()
                .setTitle('A Most Satisfactory Introduction ☝️')
                .setDescription(`${message.author}, you have provided all that was requested with admirable precision. I shall ensure our esteemed staff reviews your particulars with due consideration.`)
                .addFields(
                    { name: 'Requirements Fulfilled', value: '✅ Lucky number mentioned\n✅ Favorite animal shared', inline: true },
                    { name: 'What Follows', value: 'Our staff shall review and, if suitable, grant you passage', inline: true }
                )
                .setColor(0xFFD700);
            
            await replyTemporaryMessage(message, { embeds: [embed] });
        } else if (hasLuckyNumber || hasFavoriteAnimal) {
            const missing = [];
            if (!hasLuckyNumber) missing.push('lucky number');
            if (!hasFavoriteAnimal) missing.push('favorite animal');
            
            const embed = new EmbedBuilder()
                .setTitle('A Small Matter Overlooked')
                .setDescription(`I do believe you may have forgotten to mention your **${missing.join(' and ')}**. A small detail, but one that helps us know our fellow writers better.`)
                .setColor(0xFF9900);
            
            await replyTemporaryMessage(message, { embeds: [embed] });
            try {
                await message.react('📝');
            } catch (error) {
                console.log('Could not add reaction:', error.message);
            }
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
        switch (interaction.commandName) {
            case 'feedback': await handleFeedbackSlash(interaction); break;
            case 'feedback_status': await handleFeedbackStatusSlash(interaction); break;
            case 'feedback_add': await handleFeedbackAddSlash(interaction); break;
            case 'feedback_remove': await handleFeedbackRemoveSlash(interaction); break;
            case 'feedback_reset': await handleFeedbackResetSlash(interaction); break;
            case 'dinars_add': await handleDinarsAddSlash(interaction); break;
            case 'dinars_remove': await handleDinarsRemoveSlash(interaction); break;
            case 'help': await handleHelpSlash(interaction); break;
            case 'stats': await handleStatsSlash(interaction); break;
            case 'balance': await handleBalanceSlash(interaction); break;
            case 'store': await handleStoreSlash(interaction); break;
            case 'buy': await handleBuySlash(interaction); break;
            case 'setup_bookshelf': await handleSetupBookshelfSlash(interaction); break;
        }
    } catch (error) {
        console.error('Slash command error:', error);
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
});

// ===== TRADITIONAL COMMAND HANDLER =====
async function handleCommand(message) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    try {
        console.log(`Processing command: ${command} from ${message.author.displayName}`);
        
        switch (command) {
            case 'feedback': await handleFeedback(message); break;
            case 'feedback_status': await handleFeedbackStatus(message); break;
            case 'feedback_add': await handleFeedbackAdd(message, args); break;
            case 'feedback_remove': await handleFeedbackRemove(message, args); break;
            case 'feedback_reset': await handleFeedbackReset(message); break;
            case 'dinars_add': await handleDinarsAdd(message, args); break;
            case 'dinars_remove': await handleDinarsRemove(message, args); break;
            case 'help': await handleHelp(message); break;
            case 'stats': await handleStats(message); break;
            case 'balance': await handleBalance(message); break;
            case 'store': await handleStore(message); break;
            case 'buy': await handleBuy(message, args); break;
            case 'setup_bookshelf': await handleSetupBookshelf(message); break;
            default:
                console.log(`Unknown command: ${command}`);
                break;
        }
    } catch (error) {
        console.error(`Command error for ${command}:`, error);
        
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
            try {
                await message.reply('A critical error occurred. Please contact staff.');
            } catch (fallbackError) {
                console.error('Failed to send fallback error message:', fallbackError);
            }
        }
    }
}

// ===== FEEDBACK COMMANDS =====
async function handleFeedback(message) {
    console.log(`Processing !feedback command for ${message.author.displayName}`);
    
    // Check if command is used in correct threads
    if (!isInAllowedFeedbackThread(message.channel)) {
        const embed = new EmbedBuilder()
            .setTitle('Incorrect Thread ☝️')
            .setDescription('I regret to inform you that feedback contributions may only be logged within the designated literary threads of our community.')
            .addFields({
                name: 'Permitted Threads',
                value: '• **bookshelf-feedback** thread - For recording feedback given to fellow writers\n• **bookshelf-discussion** thread - For discussions about literary critiques',
                inline: false
            })
            .setColor(0xFF9900);
        return await replyTemporaryMessage(message, { embeds: [embed] });
    }
    
    if (!hasLevel5Role(message.member)) {
        console.log('User does not have Level 5 role');
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Standing')
            .setDescription('I fear you must first attain Level 5 standing within our community before you may log feedback contributions, dear writer. Continue your literary journey and return when you have gained the necessary experience.')
            .setColor(0xFF9900);
        return await replyTemporaryMessage(message, { embeds: [embed] });
    }
    
    // Check if this is a reply to another message
    if (!message.reference || !message.reference.messageId) {
        const embed = new EmbedBuilder()
            .setTitle('Reply Required ☝️')
            .setDescription('I regret to inform you that the feedback command must be used as a reply to your own feedback message, dear writer.')
            .addFields({
                name: 'How to Use This Command',
                value: '1. Post your feedback/critique in this thread\n2. Reply to your own feedback message with `!feedback`\n3. This logs your contribution and awards dinars',
                inline: false
            }, {
                name: 'Why This System?',
                value: 'This ensures each piece of feedback is intentionally logged and prevents accidental double-counting of contributions.',
                inline: false
            })
            .setColor(0xFF9900);
        return await replyTemporaryMessage(message, { embeds: [embed] });
    }
    
    // Get the message being replied to
    try {
        const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
        
        // Check if replying to own message
        if (repliedMessage.author.id !== message.author.id) {
            const embed = new EmbedBuilder()
                .setTitle('Own Message Required ☝️')
                .setDescription('I regret to inform you that the feedback command may only be used in reply to your own feedback messages, dear writer.')
                .addFields({
                    name: 'Correct Usage',
                    value: 'You must reply to a message that you yourself posted with your feedback or critique.',
                    inline: false
                })
                .setColor(0xFF9900);
            return await replyTemporaryMessage(message, { embeds: [embed] });
        }
        
        // Check if feedback already logged for this message by this user
        if (hasUserLoggedFeedbackForMessage(repliedMessage.id, message.author.id)) {
            const embed = new EmbedBuilder()
                .setTitle('Feedback Already Logged ☝️')
                .setDescription('I regret to inform you that you have already logged feedback for this particular message, dear writer. Each contribution may only be counted once.')
                .addFields({
                    name: 'To Log More Feedback',
                    value: 'Post a new feedback message and reply to that new message with the feedback command.',
                    inline: false
                })
                .setColor(0xFF9900);
            return await replyTemporaryMessage(message, { embeds: [embed] });
        }
        
        // All checks passed - log the feedback
        logFeedbackForMessage(repliedMessage.id, message.author.id);
        
    } catch (error) {
        console.log('Error fetching replied message:', error.message);
        const embed = new EmbedBuilder()
            .setTitle('Message Not Found')
            .setDescription('I regret that I could not locate the message you are replying to. Please ensure you are replying to a valid feedback message.')
            .setColor(0xFF6B6B);
        return await replyTemporaryMessage(message, { embeds: [embed] });
    }
    
    console.log('User has Level 5+ role and is replying to own message, processing feedback...');
    
    const userId = message.author.id;
    const feedbackData = await processFeedbackContribution(userId);
    const embed = await createFeedbackEmbed(message.author, feedbackData);
    
    console.log('Feedback command completed successfully');
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleFeedbackSlash(interaction) {
    // Check if command is used in correct threads
    if (!isInAllowedFeedbackThread(interaction.channel)) {
        const embed = new EmbedBuilder()
            .setTitle('Incorrect Thread ☝️')
            .setDescription('I regret to inform you that feedback contributions may only be logged within the designated literary threads of our community.')
            .addFields({
                name: 'Permitted Threads',
                value: '• **bookshelf-feedback** thread - For recording feedback given to fellow writers\n• **bookshelf-discussion** thread - For discussions about literary critiques',
                inline: false
            })
            .setColor(0xFF9900);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    if (!hasLevel5Role(interaction.member)) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Standing')
            .setDescription('I fear you must first attain Level 5 standing within our community before you may log feedback contributions, dear writer. Continue your literary journey and return when you have gained the necessary experience.')
            .setColor(0xFF9900);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Try to detect if this is a reply - Discord slash commands can be tricky for replies
    console.log('Slash feedback - checking for reply context...');
    console.log('Interaction targetId:', interaction.targetId);
    console.log('Interaction data:', interaction.data);
    
    // Check for replied message in various possible locations
    let repliedMessageId = null;
    
    // Method 1: targetId (for context menu commands)
    if (interaction.targetId) {
        repliedMessageId = interaction.targetId;
        console.log('Found targetId:', repliedMessageId);
    }
    
    // Method 2: Check resolved data
    if (!repliedMessageId && interaction.data && interaction.data.resolved && interaction.data.resolved.messages) {
        const messageIds = Object.keys(interaction.data.resolved.messages);
        if (messageIds.length > 0) {
            repliedMessageId = messageIds[0];
            console.log('Found in resolved messages:', repliedMessageId);
        }
    }
    
    // Method 3: For now, if no reply detected, provide helpful instructions
    if (!repliedMessageId) {
        const embed = new EmbedBuilder()
            .setTitle('Reply Required ☝️')
            .setDescription('I regret to inform you that the feedback command must be used as a reply to your own feedback message, dear writer.')
            .addFields({
                name: 'How to Use Slash Command',
                value: '**Method 1:** Right-click your feedback message → Apps → feedback\n**Method 2:** Reply to your message, then type `/feedback`\n**Method 3:** Use `!feedback` as a traditional reply (always works)',
                inline: false
            }, {
                name: 'Why This System?',
                value: 'This ensures each piece of feedback is intentionally logged and prevents accidental double-counting of contributions.',
                inline: false
            })
            .setColor(0xFF9900);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Get the message being replied to
    try {
        const repliedMessage = await interaction.channel.messages.fetch(repliedMessageId);
        
        // Check if replying to own message
        if (repliedMessage.author.id !== interaction.user.id) {
            const embed = new EmbedBuilder()
                .setTitle('Own Message Required ☝️')
                .setDescription('I regret to inform you that the feedback command may only be used in reply to your own feedback messages, dear writer.')
                .addFields({
                    name: 'Correct Usage',
                    value: 'You must reply to a message that you yourself posted with your feedback or critique.',
                    inline: false
                })
                .setColor(0xFF9900);
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        }
        
        // Check if feedback already logged for this message by this user
        if (hasUserLoggedFeedbackForMessage(repliedMessage.id, interaction.user.id)) {
            const embed = new EmbedBuilder()
                .setTitle('Feedback Already Logged ☝️')
                .setDescription('I regret to inform you that you have already logged feedback for this particular message, dear writer. Each contribution may only be counted once.')
                .addFields({
                    name: 'To Log More Feedback',
                    value: 'Post a new feedback message and reply to that new message with the feedback command.',
                    inline: false
                })
                .setColor(0xFF9900);
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        }
        
        // All checks passed - log the feedback
        logFeedbackForMessage(repliedMessage.id, interaction.user.id);
        
    } catch (error) {
        console.log('Error fetching replied message:', error.message);
        const embed = new EmbedBuilder()
            .setTitle('Message Not Found')
            .setDescription('I regret that I could not locate the message you are replying to. Please ensure you are replying to a valid feedback message.')
            .setColor(0xFF6B6B);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    console.log('User has Level 5+ role and is replying to own message, processing feedback...');
    
    const userId = interaction.user.id;
    const feedbackData = await processFeedbackContribution(userId, true);
    const embed = await createFeedbackEmbed(interaction.user, feedbackData);
    
    console.log('Feedback command completed successfully');
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleFeedbackStatus(message) {
    const user = message.mentions.users.first() || message.author;
    const userId = user.id;
    const monthlyCount = getUserMonthlyFeedback(userId);
    const totalAllTime = getUserData(userId).totalFeedbackAllTime;
    
    const embed = new EmbedBuilder()
        .setTitle(`Monthly Standing - ${user.displayName}`)
        .setDescription(`Allow me to present the current state of ${user.id === message.author.id ? 'your' : `${user.displayName}'s`} contributions to our literary community.`)
        .addFields(
            { name: 'This Month', value: `${monthlyCount} contribution${monthlyCount !== 1 ? 's' : ''}`, inline: true },
            { name: 'Requirement Status', value: monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT ? '✅ Monthly requirement graciously fulfilled' : '📝 Monthly contribution still awaited', inline: true },
            { name: 'All Time Contributions', value: `${totalAllTime}`, inline: true }
        )
        .setColor(monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT ? 0x00AA55 : 0xFF9900);
    
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleFeedbackStatusSlash(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const userId = user.id;
    const monthlyCount = getUserMonthlyFeedback(userId);
    const totalAllTime = getUserData(userId).totalFeedbackAllTime;
    
    const embed = new EmbedBuilder()
        .setTitle(`Monthly Standing - ${user.displayName}`)
        .setDescription(`Allow me to present the current state of ${user.id === interaction.user.id ? 'your' : `${user.displayName}'s`} contributions to our literary community.`)
        .addFields(
            { name: 'This Month', value: `${monthlyCount} contribution${monthlyCount !== 1 ? 's' : ''}`, inline: true },
            { name: 'Requirement Status', value: monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT ? '✅ Monthly requirement graciously fulfilled' : '📝 Monthly contribution still awaited', inline: true },
            { name: 'All Time Contributions', value: `${totalAllTime}`, inline: true }
        )
        .setColor(monthlyCount >= MONTHLY_FEEDBACK_REQUIREMENT ? 0x00AA55 : 0xFF9900);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

// ===== STAFF COMMANDS =====
async function handleFeedbackAdd(message, args) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions, my lord.');
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the writer whose feedback record you wish to enhance.');
    
    const amount = Math.max(1, parseInt(args[1]) || 1);
    const userId = user.id;
    const currentCount = getUserMonthlyFeedback(userId);
    const newCount = currentCount + amount;
    setUserMonthlyFeedback(userId, newCount);
    
    const userRecord = getUserData(userId);
    userRecord.totalFeedbackAllTime += amount;
    const newBalance = addDinars(userId, amount * DINARS_PER_FEEDBACK);
    
    await saveData();
    
    const embed = new EmbedBuilder()
        .setTitle('Feedback Contributions Enhanced ☝️')
        .setDescription(`I have graciously added to ${user}'s feedback record, as befits their continued dedication to our literary community.`)
        .addFields(
            { name: 'Previous Monthly Count', value: `${currentCount}`, inline: true },
            { name: 'Current Monthly Count', value: `${newCount}`, inline: true },
            { name: 'Points Added', value: `${amount}`, inline: true },
            { name: 'Dinars Awarded', value: `💰 +${amount * DINARS_PER_FEEDBACK} dinars`, inline: true },
            { name: 'New Balance', value: `💰 ${newBalance} dinars`, inline: true }
        )
        .setColor(0x00AA55);
    
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleFeedbackAddSlash(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Authority')
            .setDescription('I fear you lack the necessary authority to conduct such administrative actions, my lord.')
            .setColor(0xFF6B6B);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    const userId = user.id;
    const currentCount = getUserMonthlyFeedback(userId);
    const newCount = currentCount + amount;
    setUserMonthlyFeedback(userId, newCount);
    
    const userRecord = getUserData(userId);
    userRecord.totalFeedbackAllTime += amount;
    const newBalance = addDinars(userId, amount * DINARS_PER_FEEDBACK);
    
    await saveData();
    
    const embed = new EmbedBuilder()
        .setTitle('Feedback Contributions Enhanced ☝️')
        .setDescription(`I have graciously added to ${user}'s feedback record, as befits their continued dedication to our literary community.`)
        .addFields(
            { name: 'Previous Monthly Count', value: `${currentCount}`, inline: true },
            { name: 'Current Monthly Count', value: `${newCount}`, inline: true },
            { name: 'Points Added', value: `${amount}`, inline: true },
            { name: 'Dinars Awarded', value: `💰 +${amount * DINARS_PER_FEEDBACK} dinars`, inline: true },
            { name: 'New Balance', value: `💰 ${newBalance} dinars`, inline: true }
        )
        .setColor(0x00AA55);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleFeedbackRemove(message, args) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions, my lord.');
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the writer whose feedback record requires adjustment.');
    
    const amount = Math.max(1, parseInt(args[1]) || 1);
    const userId = user.id;
    const currentCount = getUserMonthlyFeedback(userId);
    const newCount = Math.max(0, currentCount - amount);
    setUserMonthlyFeedback(userId, newCount);
    
    const userRecord = getUserData(userId);
    userRecord.totalFeedbackAllTime = Math.max(0, userRecord.totalFeedbackAllTime - amount);
    
    await saveData();
    
    const embed = new EmbedBuilder()
        .setTitle('Feedback Record Adjusted')
        .setDescription(`I have reduced ${user}'s feedback contributions as you have instructed, though I confess it pains me to diminish any writer's standing.`)
        .addFields(
            { name: 'Previous Monthly Count', value: `${currentCount}`, inline: true },
            { name: 'Current Monthly Count', value: `${newCount}`, inline: true },
            { name: 'Points Removed', value: `${amount}`, inline: true }
        )
        .setColor(0xFF6B6B);
    
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleFeedbackRemoveSlash(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Authority')
            .setDescription('I fear you lack the necessary authority to conduct such administrative actions, my lord.')
            .setColor(0xFF6B6B);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    const userId = user.id;
    const currentCount = getUserMonthlyFeedback(userId);
    const newCount = Math.max(0, currentCount - amount);
    setUserMonthlyFeedback(userId, newCount);
    
    const userRecord = getUserData(userId);
    userRecord.totalFeedbackAllTime = Math.max(0, userRecord.totalFeedbackAllTime - amount);
    
    await saveData();
    
    const embed = new EmbedBuilder()
        .setTitle('Feedback Record Adjusted')
        .setDescription(`I have reduced ${user}'s feedback contributions as you have instructed, though I confess it pains me to diminish any writer's standing.`)
        .addFields(
            { name: 'Previous Monthly Count', value: `${currentCount}`, inline: true },
            { name: 'Current Monthly Count', value: `${newCount}`, inline: true },
            { name: 'Points Removed', value: `${amount}`, inline: true }
        )
        .setColor(0xFF6B6B);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleFeedbackReset(message) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions, my lord.');
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the writer whose record you wish to reset to a clean slate.');
    
    const userId = user.id;
    const previousCount = getUserMonthlyFeedback(userId);
    const userRecord = getUserData(userId);
    const previousAllTime = userRecord.totalFeedbackAllTime;
    const previousDinars = userRecord.dinars;
    const hadShelfAccess = userRecord.purchases.includes('shelf');
    
    // COMPLETE RESET - everything back to zero
    setUserMonthlyFeedback(userId, 0);
    userRecord.totalFeedbackAllTime = 0;
    userRecord.dinars = 0;
    userRecord.bookshelfPosts = 0;
    userRecord.purchases = userRecord.purchases.filter(item => item !== 'shelf');
    
    // Remove Shelf Owner role and reader role, then close their threads
    const targetMember = message.guild.members.cache.get(userId);
    if (targetMember) {
        const shelfRole = message.guild.roles.cache.find(r => r.name === 'Shelf Owner');
        const readerRole = message.guild.roles.cache.find(r => r.name === 'reader');
        
        if (shelfRole && targetMember.roles.cache.has(shelfRole.id)) {
            try {
                await targetMember.roles.remove(shelfRole);
                console.log(`Removed Shelf Owner role from ${targetMember.displayName}`);
            } catch (error) {
                console.log('Failed to remove Shelf Owner role:', error.message);
            }
        }
        
        if (readerRole && targetMember.roles.cache.has(readerRole.id)) {
            try {
                await targetMember.roles.remove(readerRole);
                console.log(`Removed reader role from ${targetMember.displayName}`);
            } catch (error) {
                console.log('Failed to remove reader role:', error.message);
            }
        }
    }
    
    // Close all their bookshelf threads
    const closedThreads = await closeUserBookshelfThreads(message.guild, userId);
    
    await saveData();
    
    const embed = new EmbedBuilder()
        .setTitle('Complete Literary Record Reset ☝️')
        .setDescription(`${user}'s entire literary standing has been reset to a clean slate, as you have decreed. All achievements, wealth, and privileges have been stripped away. Perhaps this complete fresh beginning shall inspire true dedication.`)
        .addFields(
            { name: 'Previous Monthly Count', value: `${previousCount}`, inline: true },
            { name: 'Previous All-Time Total', value: `${previousAllTime}`, inline: true },
            { name: 'Previous Balance', value: `💰 ${previousDinars} dinars`, inline: true },
            { name: 'Current Status', value: '**Everything reset to zero**', inline: false },
            { name: 'Bookshelf Access', value: hadShelfAccess ? '📚 Access completely revoked' : '📚 No access', inline: true },
            { name: 'Threads Closed', value: `🔒 ${closedThreads} thread${closedThreads !== 1 ? 's' : ''} archived and locked`, inline: true },
            { name: 'Action Taken', value: 'Complete reset: monthly count, all-time total, dinars, bookshelf access cleared, roles removed (Shelf Owner + reader), message credits reset, and all threads closed', inline: false }
        )
        .setColor(0xFF6B6B);
    
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleFeedbackResetSlash(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Authority')
            .setDescription('I fear you lack the necessary authority to conduct such administrative actions, my lord.')
            .setColor(0xFF6B6B);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    const user = interaction.options.getUser('user');
    const userId = user.id;
    const previousCount = getUserMonthlyFeedback(userId);
    const userRecord = getUserData(userId);
    const previousAllTime = userRecord.totalFeedbackAllTime;
    const previousDinars = userRecord.dinars;
    const hadShelfAccess = userRecord.purchases.includes('shelf');
    
    // COMPLETE RESET - everything back to zero
    setUserMonthlyFeedback(userId, 0);
    userRecord.totalFeedbackAllTime = 0;
    userRecord.dinars = 0;
    userRecord.bookshelfPosts = 0;
    userRecord.purchases = userRecord.purchases.filter(item => item !== 'shelf');
    
    // Remove Shelf Owner role and reader role, then close their threads
    const targetMember = interaction.guild.members.cache.get(userId);
    if (targetMember) {
        const shelfRole = interaction.guild.roles.cache.find(r => r.name === 'Shelf Owner');
        const readerRole = interaction.guild.roles.cache.find(r => r.name === 'reader');
        
        if (shelfRole && targetMember.roles.cache.has(shelfRole.id)) {
            try {
                await targetMember.roles.remove(shelfRole);
                console.log(`Removed Shelf Owner role from ${targetMember.displayName}`);
            } catch (error) {
                console.log('Failed to remove Shelf Owner role:', error.message);
            }
        }
        
        if (readerRole && targetMember.roles.cache.has(readerRole.id)) {
            try {
                await targetMember.roles.remove(readerRole);
                console.log(`Removed reader role from ${targetMember.displayName}`);
            } catch (error) {
                console.log('Failed to remove reader role:', error.message);
            }
        }
    }
    
    // Close all their bookshelf threads
    const closedThreads = await closeUserBookshelfThreads(interaction.guild, userId);
    
    await saveData();
    
    const embed = new EmbedBuilder()
        .setTitle('Complete Literary Record Reset ☝️')
        .setDescription(`${user}'s entire literary standing has been reset to a clean slate, as you have decreed. All achievements, wealth, and privileges have been stripped away. Perhaps this complete fresh beginning shall inspire true dedication.`)
        .addFields(
            { name: 'Previous Monthly Count', value: `${previousCount}`, inline: true },
            { name: 'Previous All-Time Total', value: `${previousAllTime}`, inline: true },
            { name: 'Previous Balance', value: `💰 ${previousDinars} dinars`, inline: true },
            { name: 'Current Status', value: '**Everything reset to zero**', inline: false },
            { name: 'Bookshelf Access', value: hadShelfAccess ? '📚 Access completely revoked' : '📚 No access', inline: true },
            { name: 'Threads Closed', value: `🔒 ${closedThreads} thread${closedThreads !== 1 ? 's' : ''} archived and locked`, inline: true },
            { name: 'Action Taken', value: 'Complete reset: monthly count, all-time total, dinars, bookshelf access cleared, roles removed (Shelf Owner + reader), message credits reset, and all threads closed', inline: false }
        )
        .setColor(0xFF6B6B);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

// ===== DINARS STAFF COMMANDS =====
async function handleDinarsAdd(message, args) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions, my lord.');
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the writer whose dinar balance you wish to enhance.');
    
    const amount = parseInt(args[1]);
    if (!amount || amount <= 0) return replyTemporaryMessage(message, 'Please specify a positive amount of dinars to add.');
    
    const userId = user.id;
    const userRecord = getUserData(userId);
    const previousBalance = userRecord.dinars;
    const newBalance = addDinars(userId, amount);
    
    await saveData();
    
    const embed = new EmbedBuilder()
        .setTitle('Dinar Treasury Enhanced ☝️')
        .setDescription(`I have graciously added to ${user}'s dinar treasury, as befits your administrative authority in our literary realm.`)
        .addFields(
            { name: 'Previous Balance', value: `💰 ${previousBalance} dinars`, inline: true },
            { name: 'Current Balance', value: `💰 ${newBalance} dinars`, inline: true },
            { name: 'Dinars Added', value: `💰 +${amount} dinars`, inline: true }
        )
        .setColor(0x00AA55);
    
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleDinarsAddSlash(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Authority')
            .setDescription('I fear you lack the necessary authority to conduct such administrative actions, my lord.')
            .setColor(0xFF6B6B);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    const user = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    
    if (amount <= 0) {
        const embed = new EmbedBuilder()
            .setTitle('Invalid Amount')
            .setDescription('Please specify a positive amount of dinars to add.')
            .setColor(0xFF6B6B);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    const userId = user.id;
    const userRecord = getUserData(userId);
    const previousBalance = userRecord.dinars;
    const newBalance = addDinars(userId, amount);
    
    await saveData();
    
    const embed = new EmbedBuilder()
        .setTitle('Dinar Treasury Enhanced ☝️')
        .setDescription(`I have graciously added to ${user}'s dinar treasury, as befits your administrative authority in our literary realm.`)
        .addFields(
            { name: 'Previous Balance', value: `💰 ${previousBalance} dinars`, inline: true },
            { name: 'Current Balance', value: `💰 ${newBalance} dinars`, inline: true },
            { name: 'Dinars Added', value: `💰 +${amount} dinars`, inline: true }
        )
        .setColor(0x00AA55);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleDinarsRemove(message, args) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions, my lord.');
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the writer whose dinar balance requires adjustment.');
    
    const amount = parseInt(args[1]);
    if (!amount || amount <= 0) return replyTemporaryMessage(message, 'Please specify a positive amount of dinars to remove.');
    
    const userId = user.id;
    const userRecord = getUserData(userId);
    const previousBalance = userRecord.dinars;
    const amountToRemove = Math.min(amount, previousBalance); // Don't go below 0
    userRecord.dinars = Math.max(0, userRecord.dinars - amount);
    
    await saveData();
    
    const embed = new EmbedBuilder()
        .setTitle('Dinar Treasury Adjusted')
        .setDescription(`I have reduced ${user}'s dinar treasury as you have instructed, though I confess it pains me to diminish any writer's wealth.`)
        .addFields(
            { name: 'Previous Balance', value: `💰 ${previousBalance} dinars`, inline: true },
            { name: 'Current Balance', value: `💰 ${userRecord.dinars} dinars`, inline: true },
            { name: 'Dinars Removed', value: `💰 -${amountToRemove} dinars`, inline: true }
        )
        .setColor(0xFF6B6B);
    
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleDinarsRemoveSlash(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Authority')
            .setDescription('I fear you lack the necessary authority to conduct such administrative actions, my lord.')
            .setColor(0xFF6B6B);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    const user = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    
    if (amount <= 0) {
        const embed = new EmbedBuilder()
            .setTitle('Invalid Amount')
            .setDescription('Please specify a positive amount of dinars to remove.')
            .setColor(0xFF6B6B);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    const userId = user.id;
    const userRecord = getUserData(userId);
    const previousBalance = userRecord.dinars;
    const amountToRemove = Math.min(amount, previousBalance); // Don't go below 0
    userRecord.dinars = Math.max(0, userRecord.dinars - amount);
    
    await saveData();
    
    const embed = new EmbedBuilder()
        .setTitle('Dinar Treasury Adjusted')
        .setDescription(`I have reduced ${user}'s dinar treasury as you have instructed, though I confess it pains me to diminish any writer's wealth.`)
        .addFields(
            { name: 'Previous Balance', value: `💰 ${previousBalance} dinars`, inline: true },
            { name: 'Current Balance', value: `💰 ${userRecord.dinars} dinars`, inline: true },
            { name: 'Dinars Removed', value: `💰 -${amountToRemove} dinars`, inline: true }
        )
        .setColor(0xFF6B6B);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleStats(message) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return replyTemporaryMessage(message, 'I regret that such privileged information is reserved for those with administrative authority, my lord.');
    }
    
    const guild = message.guild;
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
    
    const embed = new EmbedBuilder()
        .setTitle('Type&Draft Community Statistics ☝️')
        .setDescription('Allow me to present the current state of our literary realm, as observed from my position of humble service.')
        .addFields(
            { name: 'Total Writers in Our Halls', value: `${totalMembers} souls`, inline: true },
            { name: 'Writers Under My Watch', value: `${verifiedCount} tracked`, inline: true },
            { name: 'Active Contributors This Month', value: `${monthlyContributors} writers`, inline: true },
            { name: 'Monthly Participation Rate', value: `${contributionRate}%`, inline: true },
            { name: 'Community Health', value: contributionRate >= 70 ? '✅ Flourishing' : contributionRate >= 50 ? '⚠️ Moderate' : '🔴 Requires attention', inline: true },
            { name: 'Current Month', value: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), inline: true }
        )
        .setColor(contributionRate >= 70 ? 0x00AA55 : contributionRate >= 50 ? 0xFF9900 : 0xFF4444)
        .setFooter({ text: 'These numbers reflect the dedication of our writing community to mutual growth' });
    
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleStatsSlash(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Authority')
            .setDescription('I regret that such privileged information is reserved for those with administrative authority, my lord.')
            .setColor(0xFF6B6B);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    const guild = interaction.guild;
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
    
    const embed = new EmbedBuilder()
        .setTitle('Type&Draft Community Statistics ☝️')
        .setDescription('Allow me to present the current state of our literary realm, as observed from my position of humble service.')
        .addFields(
            { name: 'Total Writers in Our Halls', value: `${totalMembers} souls`, inline: true },
            { name: 'Writers Under My Watch', value: `${verifiedCount} tracked`, inline: true },
            { name: 'Active Contributors This Month', value: `${monthlyContributors} writers`, inline: true },
            { name: 'Monthly Participation Rate', value: `${contributionRate}%`, inline: true },
            { name: 'Community Health', value: contributionRate >= 70 ? '✅ Flourishing' : contributionRate >= 50 ? '⚠️ Moderate' : '🔴 Requires attention', inline: true },
            { name: 'Current Month', value: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), inline: true }
        )
        .setColor(contributionRate >= 70 ? 0x00AA55 : contributionRate >= 50 ? 0xFF9900 : 0xFF4444)
        .setFooter({ text: 'These numbers reflect the dedication of our writing community to mutual growth' });
    
    await replyTemporary(interaction, { embeds: [embed] });
}

// ===== ECONOMY COMMANDS =====
async function handleBalance(message) {
    const user = message.mentions.users.first() || message.author;
    const userId = user.id;
    const userRecord = getUserData(userId);
    
    const embed = new EmbedBuilder()
        .setTitle(`${user.displayName}'s Literary Standing ☝️`)
        .setDescription(`Allow me to present the current economic and literary standing of ${user.id === message.author.id ? 'your esteemed self' : 'this distinguished writer'}.`)
        .addFields(
            { name: 'Current Balance', value: `💰 ${userRecord.dinars} dinars`, inline: true },
            { name: 'Lifetime Feedback', value: `📝 ${userRecord.totalFeedbackAllTime} contribution${userRecord.totalFeedbackAllTime !== 1 ? 's' : ''}`, inline: true },
            { name: 'Bookshelf Access', value: getBookshelfAccessStatus(userId), inline: true },
            { name: 'Message Credits', value: getPostCreditStatus(userId), inline: false },
            { name: 'Purchases Made', value: userRecord.purchases.length > 0 ? userRecord.purchases.map(item => `• ${STORE_ITEMS[item]?.name || item}`).join('\n') : 'None yet', inline: false }
        )
        .setColor(canPostInBookshelf(userId) ? 0x00AA55 : 0xFF9900);
    
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleBalanceSlash(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const userId = user.id;
    const userRecord = getUserData(userId);
    
    const embed = new EmbedBuilder()
        .setTitle(`${user.displayName}'s Literary Standing ☝️`)
        .setDescription(`Allow me to present the current economic and literary standing of ${user.id === interaction.user.id ? 'your esteemed self' : 'this distinguished writer'}.`)
        .addFields(
            { name: 'Current Balance', value: `💰 ${userRecord.dinars} dinars`, inline: true },
            { name: 'Lifetime Feedback', value: `📝 ${userRecord.totalFeedbackAllTime} contribution${userRecord.totalFeedbackAllTime !== 1 ? 's' : ''}`, inline: true },
            { name: 'Bookshelf Access', value: getBookshelfAccessStatus(userId), inline: true },
            { name: 'Message Credits', value: getPostCreditStatus(userId), inline: false },
            { name: 'Purchases Made', value: userRecord.purchases.length > 0 ? userRecord.purchases.map(item => `• ${STORE_ITEMS[item]?.name || item}`).join('\n') : 'None yet', inline: false }
        )
        .setColor(canPostInBookshelf(userId) ? 0x00AA55 : 0xFF9900);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleStore(message) {
    const embed = new EmbedBuilder()
        .setTitle('Type&Draft Literary Emporium ☝️')
        .setDescription('Welcome to our humble establishment, where dedication to the craft is rewarded with tangible benefits. Examine our current offerings, crafted with the utmost care for our literary community.')
        .addFields(
            { name: '📚 Bookshelf Access', value: `Grants you the ability to post messages in the #bookshelf forum\n**Price:** ${STORE_ITEMS.shelf.price} dinars\n**Requirements:** ${MINIMUM_FEEDBACK_FOR_SHELF}+ feedback contributions\n**Roles granted:** Shelf Owner + reader`, inline: false },
            { name: 'How to Earn Dinars', value: `• **Provide feedback** to fellow writers and log it with \`!feedback\` or \`/feedback\`\n• **Earn ${DINARS_PER_FEEDBACK} dinars** per logged feedback contribution\n• **Build your reputation** through meaningful engagement`, inline: false }
        )
        .setColor(0x2F3136)
        .setFooter({ text: 'All prices are final. Purchases support our thriving literary community.' });
    
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleStoreSlash(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('Type&Draft Literary Emporium ☝️')
        .setDescription('Welcome to our humble establishment, where dedication to the craft is rewarded with tangible benefits. Examine our current offerings, crafted with the utmost care for our literary community.')
        .addFields(
            { name: '📚 Bookshelf Access', value: `Grants you the ability to post messages in the #bookshelf forum\n**Price:** ${STORE_ITEMS.shelf.price} dinars\n**Requirements:** ${MINIMUM_FEEDBACK_FOR_SHELF}+ feedback contributions\n**Roles granted:** Shelf Owner + reader`, inline: false },
            { name: 'How to Earn Dinars', value: `• **Provide feedback** to fellow writers and log it with \`!feedback\` or \`/feedback\`\n• **Earn ${DINARS_PER_FEEDBACK} dinars** per logged feedback contribution\n• **Build your reputation** through meaningful engagement`, inline: false }
        )
        .setColor(0x2F3136)
        .setFooter({ text: 'All prices are final. Purchases support our thriving literary community.' });
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleBuy(message, args) {
    const itemKey = args[0]?.toLowerCase();
    if (!itemKey || !STORE_ITEMS[itemKey]) {
        return replyTemporaryMessage(message, 'Pray, specify a valid item to purchase. Use `!store` to view available items.');
    }
    
    const item = STORE_ITEMS[itemKey];
    const userId = message.author.id;
    const userRecord = getUserData(userId);
    
    if (userRecord.purchases.includes(itemKey)) {
        const embed = new EmbedBuilder()
            .setTitle('Item Already Acquired')
            .setDescription(`You have already acquired ${item.name}, dear writer. There is no need for duplicate purchases.`)
            .setColor(0xFF9900);
        return await replyTemporaryMessage(message, { embeds: [embed] });
    }
    
    if (itemKey === 'shelf' && userRecord.totalFeedbackAllTime < MINIMUM_FEEDBACK_FOR_SHELF) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Literary Contributions')
            .setDescription(`I regret to inform you that bookshelf access requires a minimum of **${MINIMUM_FEEDBACK_FOR_SHELF} feedback contributions**. You currently have ${userRecord.totalFeedbackAllTime}.`)
            .addFields({
                name: 'How to Qualify',
                value: `• Provide feedback to fellow writers\n• Log each contribution with \`!feedback\` or \`/feedback\`\n• Return when you have ${MINIMUM_FEEDBACK_FOR_SHELF - userRecord.totalFeedbackAllTime} more contribution${userRecord.totalFeedbackAllTime === MINIMUM_FEEDBACK_FOR_SHELF - 1 ? '' : 's'}`,
                inline: false
            })
            .setColor(0xFF6B6B);
        return await replyTemporaryMessage(message, { embeds: [embed] });
    }
    
    if (userRecord.dinars < item.price) {
        const needed = item.price - userRecord.dinars;
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Funds')
            .setDescription(`I fear your current balance of ${userRecord.dinars} dinars is insufficient for this purchase.`)
            .addFields({
                name: 'Required Amount', value: `${item.price} dinars`, inline: true
            }, {
                name: 'Still Needed', value: `${needed} dinars (${Math.ceil(needed / DINARS_PER_FEEDBACK)} more feedback contributions)`, inline: true
            })
            .setColor(0xFF6B6B);
        return await replyTemporaryMessage(message, { embeds: [embed] });
    }
    
    if (spendDinars(userId, item.price)) {
        userRecord.purchases.push(itemKey);
        
        if (item.role) {
            // Add Shelf Owner role
            let shelfRole = message.guild.roles.cache.find(r => r.name === item.role);
            if (!shelfRole) {
                try {
                    shelfRole = await message.guild.roles.create({
                        name: item.role,
                        color: 0x8B4513,
                        reason: 'Bookshelf access role for store purchases'
                    });
                } catch (error) {
                    console.log('Failed to create Shelf Owner role:', error.message);
                }
            }
            if (shelfRole) {
                try {
                    await message.member.roles.add(shelfRole);
                    console.log(`Added Shelf Owner role to ${message.author.displayName}`);
                } catch (error) {
                    console.log('Failed to add Shelf Owner role to member:', error.message);
                }
            }
            
            // Add reader role for shelf purchases
            if (itemKey === 'shelf') {
                let readerRole = message.guild.roles.cache.find(r => r.name === 'reader');
                if (!readerRole) {
                    try {
                        readerRole = await message.guild.roles.create({
                            name: 'reader',
                            color: 0x5865F2,
                            reason: 'Reader role for shelf access purchasers'
                        });
                        console.log('Created reader role');
                    } catch (error) {
                        console.log('Failed to create reader role:', error.message);
                    }
                }
                if (readerRole) {
                    try {
                        await message.member.roles.add(readerRole);
                        console.log(`Added reader role to ${message.author.displayName}`);
                    } catch (error) {
                        console.log('Failed to add reader role to member:', error.message);
                    }
                }
            }
        }
        
        await saveData();
        
        const embed = new EmbedBuilder()
            .setTitle('Purchase Completed Successfully ☝️')
            .setDescription(`Congratulations, ${message.author}! Your acquisition of ${item.name} has been processed with the utmost care.`)
            .addFields(
                { name: 'Item Purchased', value: `${item.emoji} ${item.name}`, inline: true },
                { name: 'Price Paid', value: `💰 ${item.price} dinars`, inline: true },
                { name: 'Remaining Balance', value: `💰 ${userRecord.dinars} dinars`, inline: true },
                { name: 'New Privileges', value: itemKey === 'shelf' ? '📚 You may now post messages in the #bookshelf forum!\n📝 First message is free, then 1 feedback = 1 additional message\n🎭 Roles assigned: Shelf Owner + reader' : item.description, inline: false }
            )
            .setColor(0x00AA55);
        
        await replyTemporaryMessage(message, { embeds: [embed] });
    }
}

async function handleBuySlash(interaction) {
    const itemKey = interaction.options.getString('item');
    const item = STORE_ITEMS[itemKey];
    const userId = interaction.user.id;
    const userRecord = getUserData(userId);
    
    if (userRecord.purchases.includes(itemKey)) {
        const embed = new EmbedBuilder()
            .setTitle('Item Already Acquired')
            .setDescription(`You have already acquired ${item.name}, dear writer. There is no need for duplicate purchases.`)
            .setColor(0xFF9900);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    if (itemKey === 'shelf' && userRecord.totalFeedbackAllTime < MINIMUM_FEEDBACK_FOR_SHELF) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Literary Contributions')
            .setDescription(`I regret to inform you that bookshelf access requires a minimum of **${MINIMUM_FEEDBACK_FOR_SHELF} feedback contributions**. You currently have ${userRecord.totalFeedbackAllTime}.`)
            .addFields({
                name: 'How to Qualify',
                value: `• Provide feedback to fellow writers\n• Log each contribution with \`!feedback\` or \`/feedback\`\n• Return when you have ${MINIMUM_FEEDBACK_FOR_SHELF - userRecord.totalFeedbackAllTime} more contribution${userRecord.totalFeedbackAllTime === MINIMUM_FEEDBACK_FOR_SHELF - 1 ? '' : 's'}`,
                inline: false
            })
            .setColor(0xFF6B6B);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    if (userRecord.dinars < item.price) {
        const needed = item.price - userRecord.dinars;
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Funds')
            .setDescription(`I fear your current balance of ${userRecord.dinars} dinars is insufficient for this purchase.`)
            .addFields({
                name: 'Required Amount', value: `${item.price} dinars`, inline: true
            }, {
                name: 'Still Needed', value: `${needed} dinars (${Math.ceil(needed / DINARS_PER_FEEDBACK)} more feedback contributions)`, inline: true
            })
            .setColor(0xFF6B6B);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    if (spendDinars(userId, item.price)) {
        userRecord.purchases.push(itemKey);
        
        if (item.role) {
            // Add Shelf Owner role
            let shelfRole = interaction.guild.roles.cache.find(r => r.name === item.role);
            if (!shelfRole) {
                try {
                    shelfRole = await interaction.guild.roles.create({
                        name: item.role,
                        color: 0x8B4513,
                        reason: 'Bookshelf access role for store purchases'
                    });
                } catch (error) {
                    console.log('Failed to create Shelf Owner role:', error.message);
                }
            }
            if (shelfRole) {
                try {
                    await interaction.member.roles.add(shelfRole);
                    console.log(`Added Shelf Owner role to ${interaction.user.displayName}`);
                } catch (error) {
                    console.log('Failed to add Shelf Owner role to member:', error.message);
                }
            }
            
            // Add reader role for shelf purchases
            if (itemKey === 'shelf') {
                let readerRole = interaction.guild.roles.cache.find(r => r.name === 'reader');
                if (!readerRole) {
                    try {
                        readerRole = await interaction.guild.roles.create({
                            name: 'reader',
                            color: 0x5865F2,
                            reason: 'Reader role for shelf access purchasers'
                        });
                        console.log('Created reader role');
                    } catch (error) {
                        console.log('Failed to create reader role:', error.message);
                    }
                }
                if (readerRole) {
                    try {
                        await interaction.member.roles.add(readerRole);
                        console.log(`Added reader role to ${interaction.user.displayName}`);
                    } catch (error) {
                        console.log('Failed to add reader role to member:', error.message);
                    }
                }
            }
        }
        
        await saveData();
        
        const embed = new EmbedBuilder()
            .setTitle('Purchase Completed Successfully ☝️')
            .setDescription(`Congratulations, ${interaction.user}! Your acquisition of ${item.name} has been processed with the utmost care.`)
            .addFields(
                { name: 'Item Purchased', value: `${item.emoji} ${item.name}`, inline: true },
                { name: 'Price Paid', value: `💰 ${item.price} dinars`, inline: true },
                { name: 'Remaining Balance', value: `💰 ${userRecord.dinars} dinars`, inline: true },
                { name: 'New Privileges', value: itemKey === 'shelf' ? '📚 You may now post messages in the #bookshelf forum!\n📝 First message is free, then 1 feedback = 1 additional message\n🎭 Roles assigned: Shelf Owner + reader' : item.description, inline: false }
            )
            .setColor(0x00AA55);
        
        await replyTemporary(interaction, { embeds: [embed] });
    }
}

// ===== HELP COMMAND =====
async function handleHelp(message) {
    const embed = new EmbedBuilder()
        .setTitle('Commands at Your Service ☝️')
        .setDescription('I am at your disposal, dear writer. Allow me to present the available commands for our literary community:')
        .addFields(
            { 
                name: '📝 Feedback Commands (Level 5+ Required)', 
                value: '`!feedback` or `/feedback` - Log a feedback contribution (must reply to your own feedback message)\n*Only works in #bookshelf-feedback and #bookshelf-discussion forums*\n*Must be used as a reply to your own feedback message*\n`!feedback_status [@user]` or `/feedback_status [user]` - Check contribution status', 
                inline: false 
            },
            { 
                name: '💰 Economy Commands', 
                value: '`!balance [@user]` or `/balance [user]` - Check dinar balance\n`!store` or `/store` - View available items\n`!buy [item]` or `/buy [item]` - Purchase items', 
                inline: false 
            },
            { 
                name: '👑 Staff Commands', 
                value: '**Feedback Management:**\n`!feedback_add @user [amount]` or `/feedback_add` - Add feedback points\n`!feedback_remove @user [amount]` or `/feedback_remove` - Remove feedback points\n`!feedback_reset @user` or `/feedback_reset` - Complete account reset\n\n**Dinar Management:**\n`!dinars_add @user <amount>` or `/dinars_add` - Add dinars to user\n`!dinars_remove @user <amount>` or `/dinars_remove` - Remove dinars from user\n\n**Server Management:**\n`!stats` or `/stats` - View server statistics\n`!setup_bookshelf` or `/setup_bookshelf` - Configure bookshelf forum permissions', 
                inline: false 
            },
            { 
                name: '📋 Quick Examples', 
                value: '`!feedback` or `/feedback` → *Reply to your own feedback message to log it*\n`!balance` → *Check your dinars and bookshelf status*\n`!buy shelf` → *Purchase bookshelf access for 200 dinars*\n`!dinars_add @user 500` → *Staff: Give user 500 dinars*', 
                inline: false 
            }
        )
        .setColor(0x2F3136)
        .setFooter({ text: 'Your humble servant in all matters literary and administrative' });
    
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleHelpSlash(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('Commands at Your Service ☝️')
        .setDescription('I am at your disposal, dear writer. Allow me to present the available commands for our literary community:')
        .addFields(
            { 
                name: '📝 Feedback Commands (Level 5+ Required)', 
                value: '`!feedback` or `/feedback` - Log a feedback contribution (must reply to your own feedback message)\n*Only works in #bookshelf-feedback and #bookshelf-discussion forums*\n*Must be used as a reply to your own feedback message*\n`!feedback_status [@user]` or `/feedback_status [user]` - Check contribution status', 
                inline: false 
            },
            { 
                name: '💰 Economy Commands', 
                value: '`!balance [@user]` or `/balance [user]` - Check dinar balance\n`!store` or `/store` - View available items\n`!buy [item]` or `/buy [item]` - Purchase items', 
                inline: false 
            },
            { 
                name: '👑 Staff Commands', 
                value: '**Feedback Management:**\n`!feedback_add @user [amount]` or `/feedback_add` - Add feedback points\n`!feedback_remove @user [amount]` or `/feedback_remove` - Remove feedback points\n`!feedback_reset @user` or `/feedback_reset` - Complete account reset\n\n**Dinar Management:**\n`!dinars_add @user <amount>` or `/dinars_add` - Add dinars to user\n`!dinars_remove @user <amount>` or `/dinars_remove` - Remove dinars from user\n\n**Server Management:**\n`!stats` or `/stats` - View server statistics\n`!setup_bookshelf` or `/setup_bookshelf` - Configure bookshelf forum permissions', 
                inline: false 
            },
            { 
                name: '📋 Quick Examples', 
                value: '`!feedback` or `/feedback` → *Reply to your own feedback message to log it*\n`!balance` → *Check your dinars and bookshelf status*\n`!buy shelf` → *Purchase bookshelf access for 200 dinars*\n`!dinars_add @user 500` → *Staff: Give user 500 dinars*', 
                inline: false 
            }
        )
        .setColor(0x2F3136)
        .setFooter({ text: 'Your humble servant in all matters literary and administrative' });
    
    await replyTemporary(interaction, { embeds: [embed] });
}

// ===== SETUP COMMANDS =====
async function handleSetupBookshelf(message) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions, my lord.');
    }
    
    const success = await setupBookshelfPermissions(message.guild);
    
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
    
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleSetupBookshelfSlash(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Authority')
            .setDescription('I fear you lack the necessary authority to conduct such administrative actions, my lord.')
            .setColor(0xFF6B6B);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    const success = await setupBookshelfPermissions(interaction.guild);
    
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
    
    await replyTemporary(interaction, { embeds: [embed] });
}

// ===== BOT LOGIN =====
client.login(process.env.DISCORD_BOT_TOKEN);