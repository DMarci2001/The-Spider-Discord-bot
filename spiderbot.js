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
        price: 2,
        role: "Shelf Owner",
        emoji: "📚"
    }
};

const ALLOWED_FEEDBACK_THREADS = ['bookshelf-feedback', 'bookshelf-discussion'];
const MONTHLY_FEEDBACK_REQUIREMENT = 2;
const MINIMUM_FEEDBACK_FOR_SHELF = 2;

// ===== DATA STORAGE =====
let monthlyFeedback = {};
let userData = {};
let loggedFeedbackMessages = {}; // Track which messages have had feedback logged

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
            purchases: [],
            bookshelfPosts: 0
        };
    }
    
    const user = userData[userId];
    // Ensure all properties exist and are correct types
    if (!Array.isArray(user.purchases)) user.purchases = [];
    if (typeof user.totalFeedbackAllTime !== 'number') user.totalFeedbackAllTime = 0;
    if (typeof user.bookshelfPosts !== 'number') user.bookshelfPosts = 0;
    
    // Ensure no negative values
    user.totalFeedbackAllTime = Math.max(0, user.totalFeedbackAllTime);
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
    if (user.totalFeedbackAllTime >= validAmount) {
        // Credits are not actually "spent" - they represent total feedback given
        // But we track purchases to prevent duplicate buying
        console.log(`User ${userId} has sufficient credits: ${user.totalFeedbackAllTime} >= ${validAmount}`);
        return true;
    }
    console.log(`Insufficient credits for ${userId}: has ${user.totalFeedbackAllTime}, needs ${validAmount}`);
    return false;
}

function getBookshelfAccessStatus(userId) {
    const user = getUserData(userId);
    
    if (canPostInBookshelf(userId)) {
        return '✅ Access granted';
    } else if (user.totalFeedbackAllTime < MINIMUM_FEEDBACK_FOR_SHELF) {
        const needed = MINIMUM_FEEDBACK_FOR_SHELF - user.totalFeedbackAllTime;
        return `📝 Need ${needed} more credit${needed === 1 ? '' : 's'} to qualify for purchase`;
    } else if (!user.purchases.includes('shelf')) {
        return '💰 Ready to purchase shelf access (credit requirement met)';
    } else {
        return '🔓 Shelf Owner role acquired - reader role needed from staff';
    }
}

function canPostInBookshelf(userId) {
    const user = getUserData(userId);
    const hasEnoughFeedback = user.totalFeedbackAllTime >= MINIMUM_FEEDBACK_FOR_SHELF;
    const hasShelfPurchase = user.purchases.includes('shelf');
    
    return hasEnoughFeedback && hasShelfPurchase;
}

function canMakeNewPost(userId) {
    const user = getUserData(userId);
    
    if (!canPostInBookshelf(userId)) return false;
    
    // Calculate available message credits
    // Formula: total feedback - messages already posted - 1 (first message is free)
    const availableCredits = user.totalFeedbackAllTime - user.bookshelfPosts - 1;
    
    console.log(`Message credit check for ${userId}: feedback=${user.totalFeedbackAllTime}, messages posted=${user.bookshelfPosts}, available credits=${availableCredits}`);
    
    return availableCredits >= 1;
}

function getPostCreditStatus(userId) {
    const user = getUserData(userId);
    
    if (!canPostInBookshelf(userId)) {
        return getBookshelfAccessStatus(userId);
    }
    
    const chaptersRemaining = user.totalFeedbackAllTime - user.bookshelfPosts - 1;
    
    if (chaptersRemaining >= 1) {
        return `✅ ${chaptersRemaining} chapter${chaptersRemaining === 1 ? '' : 's'} remaining`;
    } else {
        const needed = Math.abs(chaptersRemaining) + 1;
        return `📝 Need ${needed} more feedback to post another chapter`;
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
        if (!shelfRole) {
            console.log('⚠️ Shelf Owner role not found');
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
    
    await saveData();
    
    return {
        newCount,
        totalAllTime: user.totalFeedbackAllTime,
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
            { name: 'All Time Total', value: `${feedbackData.totalAllTime} credit${feedbackData.totalAllTime !== 1 ? 's' : ''}`, inline: true }
        )
        .setColor(feedbackData.requirementMet ? 0x00AA55 : 0x5865F2);
}

// ===== FIND USER'S LATEST MESSAGE =====
async function findUserLatestMessage(channel, userId) {
    try {
        // Fetch recent messages and find the user's most recent one
        const messages = await channel.messages.fetch({ limit: 50 });
        const userMessages = messages.filter(msg => msg.author.id === userId && !msg.author.bot);
        
        if (userMessages.size === 0) return null;
        
        // Get the most recent message (first in the collection since it's sorted by newest first)
        return userMessages.first();
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
            .addChoices({ name: 'Bookshelf Access (2 credits)', value: 'shelf' })),
    
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
        .setDescription('Setup bookshelf forum permissions (Staff only)')
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
    await loadData();
    await registerCommands();
});

client.on('guildMemberAdd', async (member) => {
    // Welcome channel announcement
    const welcomeChannel = member.guild.channels.cache.find(ch => ch.name === 'welcome');
    if (welcomeChannel) {
        const welcomeEmbed = new EmbedBuilder()
            .setTitle(`Welcome to Type&Draft, ${member.displayName}! ☝️`)
            .setDescription(`Greetings, esteemed writer! I have the distinct pleasure of welcoming you to our distinguished literary community. To begin your journey amongst our fellow scribes, I humbly suggest you attend to these essential matters:`)
            .addFields(
                { name: '📜 Essential Reading', value: '• Review our <#rules> to understand our community standards\n• Peruse the <#server-guide> to learn how our realm operates', inline: false },
                { name: '🎭 Getting Started', value: '• Introduce yourself in <#introductions> with your lucky number and favorite animal\n• Select your roles in <#reaction-roles> to personalize your experience', inline: false },
                { name: '✍️ Your Literary Path', value: `Once settled, you may begin contributing feedback to fellow writers. Those who reach Level 5 standing must provide at least ${MONTHLY_FEEDBACK_REQUIREMENT} feedback credits monthly to maintain their good name in our community.`, inline: false }
            )
            .setColor(0x5865F2)
            .setThumbnail(member.user.displayAvatarURL())
            .setFooter({ text: 'Your humble servant in all matters literary and administrative' });
        
        await sendTemporaryMessage(welcomeChannel, { embeds: [welcomeEmbed] });
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Bookshelf forum protection
    if (await handleBookshelfMessage(message)) return;

    // Handle traditional commands
    if (message.content.startsWith('!')) {
        await handleCommand(message);
        return;
    }

    // Introduction detection
    await handleIntroductionMessage(message);
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
async function handleBookshelfMessage(message) {
    if (!message.channel.isThread() || !message.channel.parent || message.channel.parent.name !== 'bookshelf') {
        return false;
    }

    const userId = message.author.id;
    const user = getUserData(userId);
    const isThreadOwner = message.channel.ownerId === userId;
    
    if (!isThreadOwner) {
        await message.delete();
        await sendBookshelfAccessDeniedDM(message.author, 'thread_owner');
        return true;
    }
    
    if (!canPostInBookshelf(userId, message.member)) {
        await message.delete();
        await sendBookshelfAccessDeniedDM(message.author, 'no_access', user, message.member);
        return true;
    }
    
    if (!canMakeNewPost(userId)) {
        await message.delete();
        await sendBookshelfAccessDeniedDM(message.author, 'no_credits', user);
        return true;
    }
    
    // Allow the message and increment counter
    user.bookshelfPosts += 1;
    await saveData();
    
    // Send milestone message
    await sendBookshelfMilestone(message, user);
    return true;
}

async function sendBookshelfAccessDeniedDM(author, reason, user = null, member = null) {
    const embeds = {
        thread_owner: new EmbedBuilder()
            .setTitle('Thread Owner Only ☝️')
            .setDescription(`Dear ${author}, I regret to inform you that only the original author may add content to their literary threads. This sacred space is reserved for the creator's continued narrative.`)
            .addFields(
                { name: 'How to Provide Feedback', value: '• Visit the **#bookshelf-feedback** or **#bookshelf-discussion** forums\n• Create a thread or comment with your thoughts\n• Use `/feedback` or `!feedback` to log your contribution', inline: false },
                { name: 'Why This Restriction?', value: 'Each bookshelf thread is the author\'s personal showcase space. Feedback and discussions happen in the dedicated feedback forums.', inline: false }
            )
            .setColor(0xFF9900),
        
        no_access: new EmbedBuilder()
            .setTitle('Bookshelf Access Required ☝️')
            .setDescription(`Dear ${author}, I regret to inform you that posting in the bookshelf forum requires specific roles and dedication to our literary community.`)
            .addFields(
                { name: 'Requirements to Post', value: `• **Minimum ${MINIMUM_FEEDBACK_FOR_SHELF} feedback credits** (You have: ${user?.totalFeedbackAllTime || 0})\n• **Shelf Owner role** (purchasable with 2 credits)\n• **reader role** (assigned by staff)\n• **Both roles required** to create or post in threads`, inline: false },
                { name: 'Your Current Status', value: `• Credits: ${user?.totalFeedbackAllTime || 0}\n• Shelf Owner: ${member && hasShelfRole(member) ? '✅' : '❌'}\n• reader role: ${member && hasReaderRole(member) ? '✅' : '❌'}`, inline: false },
                { name: 'How to Gain Access', value: '1. Give feedback to fellow writers and log it with `/feedback`\n2. Purchase "Shelf Owner" role from `/store` for 2 credits\n3. Request reader role assignment from staff\n4. Return here to share your literary works', inline: false }
            )
            .setColor(0xFF9900),
        
        no_credits: new EmbedBuilder()
            .setTitle('Insufficient Chapter Credits ☝️')
            .setDescription(`Dear ${author}, while you possess the necessary roles, each chapter beyond your first requires additional feedback credits.`)
            .addFields(
                { name: 'Your Bookshelf Activity', value: `• **Chapters posted:** ${user?.bookshelfPosts || 0}\n• **Total feedback given:** ${user?.totalFeedbackAllTime || 0}\n• **Additional feedback needed:** ${Math.abs((user?.totalFeedbackAllTime || 0) - (user?.bookshelfPosts || 0) - 1) + 1}`, inline: false },
                { name: 'How the System Works', value: '• **First chapter ever:** Free after gaining access\n• **Each additional chapter:** Requires 1 more total feedback credit\n• **Example:** 5 total feedback = 4 chapters allowed (1 free + 3 earned)', inline: false },
                { name: 'How to Earn More Credits', value: `Give feedback to fellow writers in the forums and log it with \`/feedback\``, inline: false }
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

async function sendBookshelfMilestone(message, user) {
    const isFirstMessage = user.bookshelfPosts === 1;
    const remainingPosts = Math.max(0, user.totalFeedbackAllTime - user.bookshelfPosts - 1);
    
    if (isFirstMessage || user.bookshelfPosts % 5 === 0) {
        const embed = new EmbedBuilder()
            .setTitle(isFirstMessage ? 'First Chapter Posted ☝️' : 'Writing Milestone Reached ☝️')
            .setDescription(isFirstMessage ? 
                `Your first literary contribution has been graciously accepted into the bookshelf forum, ${message.author}. May it inspire meaningful discussions among our community.` :
                `Congratulations, ${message.author}! You have reached ${user.bookshelfPosts} chapter${user.bookshelfPosts !== 1 ? 's' : ''} in our literary forum. Your dedication to our community is most commendable.`)
            .addFields(
                { name: 'Chapters Posted', value: `${user.bookshelfPosts}`, inline: true },
                { name: 'Chapters Remaining', value: remainingPosts > 0 ? `${remainingPosts}` : 'Give more feedback to post again', inline: true },
                { name: 'Total Feedback Given', value: `${user.totalFeedbackAllTime}`, inline: true }
            )
            .setColor(0x00AA55);
        
        await sendTemporaryMessage(message.channel, { embeds: [embed] });
    }
}

async function handleIntroductionMessage(message) {
    if (message.channel.name !== 'introductions') return;
    
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
            stats: () => handleStatsCommand(message),
            balance: () => handleBalanceCommand(message),
            store: () => handleStoreCommand(message),
            buy: () => handleBuyCommand(message, args),
            setup_bookshelf: () => handleSetupBookshelfCommand(message)
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
        stats: () => handleStatsSlashCommand(interaction),
        balance: () => handleBalanceSlashCommand(interaction),
        store: () => handleStoreSlashCommand(interaction),
        buy: () => handleBuySlashCommand(interaction),
        setup_bookshelf: () => handleSetupBookshelfSlashCommand(interaction)
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
    // Check if command is used in correct threads
    if (!isInAllowedFeedbackThread(channel)) {
        const embed = new EmbedBuilder()
            .setTitle('Incorrect Thread ☝️')
            .setDescription('I regret to inform you that feedback credits may only be logged within the designated literary threads of our community.')
            .addFields({
                name: 'Permitted Threads',
                value: '• **bookshelf-feedback** forum - For recording feedback given to fellow writers\n• **bookshelf-discussion** forum - For discussions about literary critiques',
                inline: false
            })
            .setColor(0xFF9900);
        
        if (isSlash) {
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            return await replyTemporaryMessage({ author: user, reply: (msg) => channel.send(msg) }, { embeds: [embed] });
        }
    }
    
    if (!hasLevel5Role(member)) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Standing')
            .setDescription('I fear you must first attain Level 5 standing within our community before you may log feedback credits, dear writer. Continue your literary journey and return when you have gained the necessary experience.')
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
            .setTitle('No Recent Message Found ☝️')
            .setDescription('I regret that I could not locate a recent message from you in this thread, dear writer. Please ensure you have posted your feedback before attempting to log it.')
            .addFields({
                name: 'How to Use This Command',
                value: '1. Post your feedback/critique in this thread\n2. Use `/feedback` or `!feedback` to log your most recent message\n3. This awards you feedback credits and dinars',
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

// ===== HALL OF FAME COMMAND =====
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

// ===== COMMANDS LIST =====
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
                value: '`/stats` - View detailed server statistics\n`/setup_bookshelf` - Configure bookshelf forum permissions', 
                inline: false 
            }
        )
        .setColor(0x2F3136)
        .setFooter({ text: 'Your humble servant in all matters literary and administrative' });
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
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the writer whose feedback record requires adjustment.');
    
    const amount = Math.max(1, parseInt(args[1]) || 1);
    await removeFeedbackFromUser(user.id, amount);
    
    const embed = createFeedbackModificationEmbed(user, amount, 'removed');
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleFeedbackRemoveSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    await removeFeedbackFromUser(user.id, amount);
    
    const embed = createFeedbackModificationEmbed(user, amount, 'removed');
    await replyTemporary(interaction, { embeds: [embed] });
}

async function removeFeedbackFromUser(userId, amount) {
    const currentCount = getUserMonthlyFeedback(userId);
    const newCount = Math.max(0, currentCount - amount);
    setUserMonthlyFeedback(userId, newCount);
    
    const userRecord = getUserData(userId);
    userRecord.totalFeedbackAllTime = Math.max(0, userRecord.totalFeedbackAllTime - amount);
    
    await saveData();
    return { currentCount, newCount };
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

// ===== REMAINING IMPLEMENTATIONS =====
// (For brevity, I'll implement the remaining commands with the same pattern)

async function handleDinarsAddCommand(message, args) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions, my lord.');
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the writer whose dinar balance you wish to enhance.');
    
    const amount = parseInt(args[1]);
    if (!amount || amount <= 0) return replyTemporaryMessage(message, 'Please specify a positive amount of dinars to add.');
    
    const result = await modifyUserDinars(user.id, amount, 'add');
    const embed = createDinarModificationEmbed(user, amount, result, 'added');
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleDinarsAddSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
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
    
    const result = await modifyUserDinars(user.id, amount, 'add');
    const embed = createDinarModificationEmbed(user, amount, result, 'added');
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleDinarsRemoveCommand(message, args) {
    if (!hasStaffPermissions(message.member)) {
        return replyTemporaryMessage(message, 'I fear you lack the necessary authority to conduct such administrative actions, my lord.');
    }
    
    const user = message.mentions.users.first();
    if (!user) return replyTemporaryMessage(message, 'Pray, mention the writer whose dinar balance requires adjustment.');
    
    const amount = parseInt(args[1]);
    if (!amount || amount <= 0) return replyTemporaryMessage(message, 'Please specify a positive amount of dinars to remove.');
    
    const result = await modifyUserDinars(user.id, amount, 'remove');
    const embed = createDinarModificationEmbed(user, amount, result, 'removed');
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleDinarsRemoveSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
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
    
    const result = await modifyUserDinars(user.id, amount, 'remove');
    const embed = createDinarModificationEmbed(user, amount, result, 'removed');
    await replyTemporary(interaction, { embeds: [embed] });
}

async function modifyUserDinars(userId, amount, action) {
    const userRecord = getUserData(userId);
    const previousBalance = userRecord.dinars;
    
    if (action === 'add') {
        addDinars(userId, amount);
    } else {
        userRecord.dinars = Math.max(0, userRecord.dinars - amount);
    }
    
    await saveData();
    return { previousBalance, newBalance: userRecord.dinars };
}

function createDinarModificationEmbed(user, amount, result, action) {
    return new EmbedBuilder()
        .setTitle(`Dinar Treasury ${action === 'added' ? 'Enhanced' : 'Adjusted'} ☝️`)
        .setDescription(`I have ${action === 'added' ? 'graciously added to' : 'reduced'} ${user}'s dinar treasury, as ${action === 'added' ? 'befits your administrative authority in our literary realm' : 'you have instructed, though I confess it pains me to diminish any writer\'s wealth'}.`)
        .addFields(
            { name: 'Previous Balance', value: `💰 ${result.previousBalance} dinars`, inline: true },
            { name: 'Current Balance', value: `💰 ${result.newBalance} dinars`, inline: true },
            { name: `Dinars ${action === 'added' ? 'Added' : 'Removed'}`, value: `💰 ${action === 'added' ? '+' : '-'}${Math.min(amount, result.previousBalance)} dinars`, inline: true }
        )
        .setColor(action === 'added' ? 0x00AA55 : 0xFF6B6B);
}

async function handleBalanceCommand(message) {
    const user = message.mentions.users.first() || message.author;
    const embed = createBalanceEmbed(user);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleBalanceSlashCommand(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const embed = createBalanceEmbed(user);
    await replyTemporary(interaction, { embeds: [embed] });
}

function createBalanceEmbed(user) {
    const userId = user.id;
    const userRecord = getUserData(userId);
    
    return new EmbedBuilder()
        .setTitle(`${user.displayName}'s Literary Standing ☝️`)
        .setDescription(`Allow me to present the current literary standing and achievements of this distinguished writer.`)
        .addFields(
            { name: 'Feedback Credits', value: `📝 ${userRecord.totalFeedbackAllTime} credit${userRecord.totalFeedbackAllTime !== 1 ? 's' : ''}`, inline: true },
            { name: 'Monthly Progress', value: `${getUserMonthlyFeedback(userId)}/${MONTHLY_FEEDBACK_REQUIREMENT} this month`, inline: true },
            { name: 'Bookshelf Status', value: getBookshelfAccessStatus(userId), inline: true },
            { name: 'Chapter Credits', value: getPostCreditStatus(userId), inline: false },
            { name: 'Purchases Made', value: userRecord.purchases.length > 0 ? userRecord.purchases.map(item => `• ${STORE_ITEMS[item]?.name || item}`).join('\n') : 'None yet', inline: false }
        )
        .setColor(canPostInBookshelf(userId) ? 0x00AA55 : 0xFF9900);
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
            { name: '📚 Bookshelf Access', value: `Grants you the Shelf Owner role to create threads in #bookshelf\n**Price:** ${STORE_ITEMS.shelf.price} feedback credits\n**Requirements:** ${MINIMUM_FEEDBACK_FOR_SHELF}+ total feedback credits\n**Note:** reader role must be assigned by staff separately`, inline: false },
            { name: 'How to Earn Credits', value: `• **Provide feedback** to fellow writers in the designated forums\n• **Log contributions** with \`/feedback\` to earn credits\n• **Build your reputation** through meaningful engagement`, inline: false },
            { name: 'Important Notice', value: 'To post in #bookshelf, you need **both** the Shelf Owner role (purchasable) **and** the reader role (staff-assigned). Contact staff for reader role assignment after purchase.', inline: false }
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
    
    if (itemKey === 'shelf' && userRecord.totalFeedbackAllTime < MINIMUM_FEEDBACK_FOR_SHELF) {
        return { 
            success: false, 
            reason: 'insufficient_feedback',
            needed: MINIMUM_FEEDBACK_FOR_SHELF - userRecord.totalFeedbackAllTime,
            current: userRecord.totalFeedbackAllTime
        };
    }
    
    if (userRecord.totalFeedbackAllTime < item.price) {
        return {
            success: false,
            reason: 'insufficient_credits',
            needed: item.price - userRecord.totalFeedbackAllTime,
            current: userRecord.totalFeedbackAllTime,
            price: item.price
        };
    }
    
    if (spendCredits(userId, item.price)) {
        userRecord.purchases.push(itemKey);
        
        if (item.role) {
            await assignPurchaseRoles(member, guild, itemKey);
        }
        
        await saveData();
        return { success: true, creditsUsed: item.price };
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
            
            insufficient_feedback: new EmbedBuilder()
                .setTitle('Insufficient Literary Credits')
                .setDescription(`I regret to inform you that bookshelf access requires a minimum of **${MINIMUM_FEEDBACK_FOR_SHELF} feedback credits**. You currently have ${result.current}.`)
                .addFields({
                    name: 'How to Qualify',
                    value: `• Provide feedback to fellow writers\n• Log each credit with \`/feedback\`\n• Return when you have ${result.needed} more credit${result.needed === 1 ? '' : 's'}`,
                    inline: false
                })
                .setColor(0xFF6B6B),
            
            insufficient_credits: new EmbedBuilder()
                .setTitle('Insufficient Credits')
                .setDescription(`I fear your current total of ${result.current} credits is insufficient for this purchase.`)
                .addFields({
                    name: 'Required Amount', value: `${result.price} credits`, inline: true
                }, {
                    name: 'Still Needed', value: `${result.needed} more feedback credit${result.needed === 1 ? '' : 's'}`, inline: true
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
            { name: 'Credits Used', value: `📝 ${result.creditsUsed} credits`, inline: true },
            { name: 'Role Granted', value: `🎭 Shelf Owner`, inline: true },
            { name: 'Important Notice', value: '⚠️ **reader role required separately from staff** to create threads in #bookshelf forum. Contact staff for reader role assignment.', inline: false },
            { name: 'Next Steps', value: '1. Contact staff to request reader role assignment\n2. Once you have both roles, you may create threads in #bookshelf\n3. Each chapter posted uses 1 of your feedback credits', inline: false }
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
    
    return new EmbedBuilder()
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
        .setDescription('Welcome to our distinguished literary community! Here are the fundamental commands for the feedback and credit system:')
        .addFields(
            { 
                name: '📝 Earning Feedback Credits (Level 5 Required)', 
                value: '**Step 1:** Visit #bookshelf-feedback or #bookshelf-discussion forums\n**Step 2:** Find another writer\'s thread and provide thoughtful feedback\n**Step 3:** Use `/feedback` to log your most recent feedback message\n**Step 4:** Earn 1 credit per logged feedback contribution!', 
                inline: false 
            },
            { 
                name: '💰 Credit System', 
                value: '`/balance` - Check your credits and chapter allowance\n`/feedback_status` - View monthly progress\n`/hall_of_fame` - See top contributors leaderboard', 
                inline: false 
            },
            { 
                name: '📚 Bookshelf Access', 
                value: '`/store` - View purchasable items\n`/buy shelf` - Purchase Shelf Owner role (2 credits)\n**Important:** You need **both** Shelf Owner role (purchasable) **and** reader role (staff-assigned) to post in #bookshelf', 
                inline: false 
            },
            { 
                name: '✍️ How It Works', 
                value: '• **Give feedback** to others in feedback forums\n• **Log with `/feedback`** to earn credits\n• **Purchase shelf access** when you have 2 credits\n• **Request reader role** from staff after purchase\n• **Post chapters** using your accumulated credits\n• **Each chapter** posted uses 1 feedback credit', 
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
client.login(process.env.DISCORD_BOT_TOKEN);
