require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, REST, Routes, StringSelectMenuBuilder, ActionRowBuilder, ComponentType, ButtonBuilder, ButtonStyle, roleMention } = require('discord.js');
const fs = require('fs').promises;
const DatabaseManager = require('./database2');

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

// ===== CONSTANTS =====
const STORE_ITEMS = {
    // New color roles
    mocha_mousse: {
        name: "Mocha Mousse",
        description: "A warm, choccy brown that evokes comfort and grounding",
        color: 0xA47864,
        emoji: "🤎",
        year: "2025",
        category: "color",
        levelRequired: 15
    },
    peach_fuzz: {
        name: "Peach Fuzz",
        description: "A soft, gentle peach that radiates warmth and community",
        color: 0xFFBE98,
        emoji: "🍑",
        year: "2024",
        category: "color",
        levelRequired: 15
    },
    magenta: {
        name: "Magenta",
        description: "A bold, vibrant purple that screams vigor and craziness",
        color: 0xFF00FF,
        emoji: "🔮",
        year: "2023",
        category: "color",
        levelRequired: 15
    },
    very_peri: {
        name: "Very Peri",
        description: "A dynamic periwinkle blue with violet undertones",
        color: 0x6667AB,
        emoji: "💜",
        year: "2022",
        category: "color",
        levelRequired: 15
    },
    tangerine_tango: {
        name: "Tangerine Tango",
        description: "A spirited orange that radiates energy and enthusiasm",
        color: 0xDD4124,
        emoji: "🍊",
        year: "2012",
        category: "color",
        levelRequired: 15
    },
    illuminating_yellow: {
        name: "Illuminating Yellow",
        description: "A bright, cheerful yellow that sparks optimism",
        color: 0xF5DF4D,
        emoji: "💛",
        year: "2021",
        category: "color",
        levelRequired: 15
    },
    teal: {
        name: "Teal",
        description: "A calming, serene blue-green that soothes the soul",
        color: 0x01889F,
        emoji: "🌊",
        category: "color",
        levelRequired: 15
    },
    living_coral: {
        name: "Living Coral",
        description: "An animating orange-pink that energizes and enlivens",
        color: 0xFF6F61,
        emoji: "🦩",
        year: "2019",
        category: "color",
        levelRequired: 15
    },
    marsala: {
        name: "Marsala",
        description: "A rich, wine-red that exudes sophistication",
        color: 0x955251,
        emoji: "🍷",
        year: "2015",
        category: "color",
        levelRequired: 15
    },
    greenery: {
        name: "Greenery",
        description: "A fresh, zesty yellow-green that revitalizes",
        color: 0x88B04B,
        emoji: "🌿",
        year: "2017",
        category: "color",
        levelRequired: 15
    },
    mimosa: {
        name: "Mimosa",
        description: "A warm, encouraging golden yellow",
        color: 0xF0C05A,
        emoji: "🥂",
        year: "2009",
        category: "color",
        levelRequired: 15
    },
    chilli_pepper: {
        name: "Chilli Pepper",
        description: "A bold, spicy red that commands attention",
        color: 0x9B1B30,
        emoji: "🌶️",
        year: "2007",
        category: "color",
        levelRequired: 15
    },
    ultimate_gray: {
        name: "Ultimate Gray",
        description: "A timeless, neutral gray",
        color: 0x939597,
        emoji: "🐘",
        year: "2021",
        category: "color",
        levelRequired: 15
    }
};

// ===== NEW FEEDBACK SYSTEM CONSTANTS =====
const FEEDBACK_TYPES = {
    DOC: 'doc',
    COMMENT: 'comment'
};

const MONTHLY_FEEDBACK_REQUIREMENT = {
    // Need 2 full docs OR 4 comments OR 1 doc + 2 comments
    MIN_DOCS: 2,
    MIN_COMMENTS: 4,
    MIXED_DOCS: 1,
    MIXED_COMMENTS: 2
};

const ACCESS_REQUIREMENTS = {
    BOOKSHELF_DEMO: { level: 5, validatedFeedbacks: 0 },
    BOOKSHELF_POST: { level: 10, validatedFeedbacks: 2, docFeedbacks: 2, commentFeedbacks: 4 }, // 2 docs OR 4 comments OR 1 doc + 2 comments
    CITADEL_CHANNEL: { level: 15, validatedFeedbacks: 5, docFeedbacks: 3, commentFeedbacks: 5 } // 3 docs OR 5 comments OR 2 docs + 2 comments
};

const BOOKSHELF_DEMO_LIMIT = 2; // Max posts in demo bookshelf

const MONITORED_FORUMS = ['bookshelf-discussion', 'bookshelf'];
const ACTIVITY_MONITOR_CHANNEL = 'activity-monitor';

// Welcome system configuration (keeping existing)
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
                    { name: 'Feedback Type', value: data.feedbackType === 'doc' ? '📄 Full Document' : '💬 In-line Comments', inline: true },
                    { name: 'Used At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                )
                .setColor(0x5865F2)
                .setTimestamp();
        } else if (type === 'feedback_validated') {
            embed = new EmbedBuilder()
                .setTitle('✅ Feedback Validated')
                .addFields(
                    { name: 'Thread', value: `[${data.thread.name}](${data.messageUrl})`, inline: false },
                    { name: 'Validator', value: `<@${data.validatorId}>`, inline: true },
                    { name: 'Feedback Giver', value: `<@${data.feedbackGiverId}>`, inline: true },
                    { name: 'Feedback Type', value: data.feedbackType === 'doc' ? '📄 Full Document' : '💬 In-line Comments', inline: true },
                    { name: 'Validated At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                )
                .setColor(0x00FF00)
                .setTimestamp();
        } else if (type === 'citadel_channel_created') {
            embed = new EmbedBuilder()
                .setTitle('📚 New Citadel Channel Created')
                .addFields(
                    { name: 'Channel', value: `<#${data.channelId}>`, inline: false },
                    { name: 'Owner', value: `<@${data.ownerId}>`, inline: true },
                    { name: 'Validated Feedbacks', value: `${data.validatedFeedbacks}`, inline: true },
                    { name: 'Created At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                )
                .setColor(0xFFD700)
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

// ===== WELCOME SYSTEM CLASS (keeping existing) =====
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
        
        try {
            const userRecord = await global.db.getUserData(userId);
            const monthlyCount = await getUserMonthlyFeedback(userId);
            
            if (userRecord.totalFeedbackAllTime > 0 || monthlyCount.docs > 0 || monthlyCount.comments > 0) {
                this.logger.log(`🔄 Resetting data for rejoining member: ${member.displayName}`);
                await resetUserProgress(userId, member.guild);
            }
        } catch (error) {
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
            .setDescription(`Ah, **${member.displayName}**... How delightful. Another soul seeks to join our distinguished gathering of scribes and storytellers. Please, after you have studied our ${channels.rulesChannel} and our ${channels.serverGuideChannel}, use the ${channels.botStuff} channel, and trigger the \`/help\` command for further instructions!`)
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

// ===== NEW FEEDBACK SYSTEM FUNCTIONS =====

async function getUserData(userId) {
    return await global.db.getUserData(userId);
}

async function updateUserData(userId, updates) {
    return await global.db.updateUserData(userId, updates);
}

async function getUserValidatedFeedbacks(userId) {
    return await global.db.getUserValidatedFeedbacks(userId);
}

async function getUserValidatedFeedbacksByType(userId) {
    return await global.db.getUserValidatedFeedbacksByType(userId);
}

function checkCitadelRequirementMet(docs, comments) {
    // 3 docs OR 5 comments OR 2 docs + 2 comments (mixed case for higher tier)
    if (docs >= 3) return true;
    if (comments >= 5) return true;
    if (docs >= 2 && comments >= 2) return true; // Mixed case for Citadel
    if (docs >= 1 && comments >= 4) return true; // Mixed case for Citadel
    return false;
}

function checkBookshelfPostRequirementMet(docs, comments) {
    // 2 docs OR 4 comments OR 1 doc + 2 comments (same as monthly requirement)
    if (docs >= 2) return true;
    if (comments >= 4) return true;
    if (docs >= 1 && comments >= 2) return true; // ADD THIS LINE!
    return false;
}

async function addValidatedFeedback(userId, feedbackType, validatorId, threadId) {
    return await global.db.addValidatedFeedback(userId, feedbackType, validatorId, threadId);
}

async function getPendingFeedback(userId, threadId) {
    return await global.db.getPendingFeedback(userId, threadId);
}

async function addPendingFeedback(userId, threadId, feedbackType, messageId) {
    return await global.db.addPendingFeedback(userId, threadId, feedbackType, messageId);
}

async function removePendingFeedback(userId, threadId) {
    return await global.db.removePendingFeedback(userId, threadId);
}

async function getUserMonthlyFeedbackByType(userId) {
    return await global.db.getUserMonthlyFeedbackByType(userId);
}

function checkMonthlyRequirementMet(docs, comments) {
    // 2 full docs OR 4 comments OR 1 doc + 2 comments
    if (docs >= MONTHLY_FEEDBACK_REQUIREMENT.MIN_DOCS) return true;
    if (comments >= MONTHLY_FEEDBACK_REQUIREMENT.MIN_COMMENTS) return true;
    if (docs >= MONTHLY_FEEDBACK_REQUIREMENT.MIXED_DOCS && comments >= MONTHLY_FEEDBACK_REQUIREMENT.MIXED_COMMENTS) return true;
    return false;
}

async function createCitadelChannel(guild, userId, member, customName = null) {
    // Find a debug channel to send diagnostic info
    const debugChannel = guild.channels.cache.find(ch => 
        ch.isTextBased() && (
            ch.name.includes('bot-logs') || 
            ch.name.includes('staff') || 
            ch.name.includes('admin') ||
            ch.name.includes('errors')
        )
    );

    async function sendDebugMessage(message) {
        if (debugChannel) {
            try {
                await debugChannel.send(`🏰 **Citadel Debug**: ${message}`);
            } catch (e) {
                // Fallback: can't even send debug messages
            }
        }
    }

    try {
        await sendDebugMessage(`Starting channel creation for **${member.displayName}** (${userId})`);
        
        // Find Citadel category
        const allCategories = guild.channels.cache.filter(ch => ch.type === 4);
        await sendDebugMessage(`Found ${allCategories.size} categories: ${allCategories.map(c => `"${c.name}"`).join(', ')}`);
        
        const citadelCategory = allCategories.find(ch => {
            const normalizedName = ch.name
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^\w\s]/g, '')
                .toLowerCase()
                .trim();
            
            return normalizedName.includes('citadel') || 
                   normalizedName.includes('the citadel') ||
                   ch.name.toLowerCase().includes('citadel') ||
                   ch.name.includes('𝐂𝐢𝐭𝐚𝐝𝐞𝐥') ||
                   ch.name.includes('𝒞𝒾𝓉𝒶𝒹𝑒𝓁') ||
                   ch.name.includes('ℭ𝔦𝔱𝔞𝔡𝔢𝔩');
        });

        if (!citadelCategory) {
            const errorMsg = `❌ **CITADEL CATEGORY NOT FOUND**\n\nAvailable categories:\n${allCategories.map(c => `• "${c.name}" (ID: ${c.id})`).join('\n')}\n\n**Solution**: Create a category with "citadel" in the name.`;
            await sendDebugMessage(errorMsg);
            throw new Error('No Citadel category found. Please create a category containing "citadel" in the name.');
        }

        await sendDebugMessage(`✅ Found Citadel category: **"${citadelCategory.name}"** (ID: ${citadelCategory.id})`);

        // Check bot permissions
        const botMember = guild.members.me;
        const requiredPermissions = [
            'ManageChannels',
            'ViewChannel', 
            'SendMessages',
            'EmbedLinks'
        ];

        const missingGuildPerms = requiredPermissions.filter(perm => 
            !botMember.permissions.has(PermissionFlagsBits[perm])
        );

        if (missingGuildPerms.length > 0) {
            const errorMsg = `❌ **BOT MISSING GUILD PERMISSIONS**\n\nMissing: ${missingGuildPerms.join(', ')}\n\n**Solution**: Grant the bot these permissions server-wide.`;
            await sendDebugMessage(errorMsg);
            throw new Error(`Bot missing permissions: ${missingGuildPerms.join(', ')}`);
        }

        // Check category permissions
        const categoryPermissions = citadelCategory.permissionsFor(botMember);
        const missingCategoryPerms = requiredPermissions.filter(perm => 
            !categoryPermissions.has(PermissionFlagsBits[perm])
        );

        if (missingCategoryPerms.length > 0) {
            const errorMsg = `❌ **BOT MISSING CATEGORY PERMISSIONS**\n\nMissing in "${citadelCategory.name}": ${missingCategoryPerms.join(', ')}\n\n**Solution**: Grant bot permissions in the Citadel category specifically.`;
            await sendDebugMessage(errorMsg);
            throw new Error(`Bot missing category permissions: ${missingCategoryPerms.join(', ')}`);
        }

        await sendDebugMessage('✅ Bot permissions verified');

        // Generate channel name - use custom name if provided, otherwise fallback to display name
        let channelName;
        if (customName) {
            // Sanitize the custom name
            const sanitized = customName
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '') // Remove invalid characters
                .replace(/\s+/g, '-') // Replace spaces with hyphens
                .replace(/-+/g, '-') // Replace multiple hyphens with single
                .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
            
            if (sanitized.length < 1) {
                throw new Error('Channel name contains no valid characters. Please use letters, numbers, spaces, or hyphens.');
            }
            
            channelName = `${sanitized}-chamber`;
            await sendDebugMessage(`📝 Using custom channel name: **"${channelName}"** (from input: "${customName}")`);
        } else {
            // Fallback to display name
            channelName = `${member.displayName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-chamber`;
            await sendDebugMessage(`📝 Using fallback channel name: **"${channelName}"** (from display name)`);
        }

        // Discord channel name validation
        if (channelName.length > 100) {
            throw new Error('Channel name too long. Please use a shorter name (max 80 characters).');
        }

        const existingChannel = guild.channels.cache.find(ch => 
            ch.name === channelName && ch.parentId === citadelCategory.id
        );

        if (existingChannel) {
            const errorMsg = `❌ **CHANNEL NAME CONFLICT**\n\nChannel **"${channelName}"** already exists (ID: ${existingChannel.id})\n\n**Solution**: Choose a different name or contact staff to resolve the conflict.`;
            await sendDebugMessage(errorMsg);
            throw new Error(`Channel name "${channelName}" already exists. Please choose a different name.`);
        }

        await sendDebugMessage('✅ Channel name available, creating channel...');

        // Create the channel
        const channel = await guild.channels.create({
            name: channelName,
            type: 0,
            parent: citadelCategory.id,
            topic: `${member.displayName}'s Literary Chamber`,
            permissionOverwrites: [
                {
                    id: guild.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                    deny: [PermissionFlagsBits.SendMessages]
                },
                {
                    id: userId,
                    allow: [
                        PermissionFlagsBits.ViewChannel, 
                        PermissionFlagsBits.SendMessages, 
                        PermissionFlagsBits.ReadMessageHistory, 
                        PermissionFlagsBits.ManageThreads, 
                        PermissionFlagsBits.CreatePublicThreads
                    ]
                }
            ]
        });

        await sendDebugMessage(`✅ **CHANNEL CREATED SUCCESSFULLY**: ${channel} (ID: ${channel.id})`);

        // Store in database
        await global.db.createCitadelChannel(userId, channel.id);
        await sendDebugMessage('✅ Channel ownership stored in database');

        // Send welcome message
        const welcomeEmbed = new EmbedBuilder()
            .setTitle(`Welcome to Your Literary Chamber, ${member.displayName}! ☝️`)
            .setDescription('Congratulations on achieving **Level 15** and providing sufficient validated feedbacks! This is your personal space in The Citadel.')
            .addFields(
                { name: '📝 How to Use Your Chamber', value: 'You can post your stories, chapters, and literary works here. Other members can read and create feedback threads.', inline: false },
                { name: '🧵 Feedback Threads', value: 'When someone wants to give you feedback, they can create a thread in this channel and use `/feedback` to log their contribution after you validate it with `/feedback_valid`.', inline: false },
                { name: '🏆 Your Achievement', value: 'You have proven yourself as a dedicated member of our literary community through consistent, quality feedback.', inline: false }
            )
            .setColor(0xFFD700);

        await channel.send({ embeds: [welcomeEmbed] });
        await sendDebugMessage('✅ Welcome message sent to new channel');

        // Send activity notification
        const validatedCount = await getUserValidatedFeedbacks(userId);
        await sendActivityNotification(guild, 'citadel_channel_created', {
            channelId: channel.id,
            ownerId: userId,
            validatedFeedbacks: validatedCount
        });

        await sendDebugMessage(`✅ **CITADEL CHANNEL CREATION COMPLETE** for **${member.displayName}**`);
        return channel;

    } catch (error) {
        const fullErrorMsg = `❌ **CITADEL CHANNEL CREATION FAILED**\n\n**User**: ${member.displayName} (${userId})\n**Error**: ${error.message}\n**Stack**: \`\`\`${error.stack}\`\`\``;
        await sendDebugMessage(fullErrorMsg);
        
        console.error('Citadel channel creation error:', error);
        throw error;
    }
}

// Updated slash command handler with better user feedback
async function handleCitadelChannelSlashCommand(interaction) {
    console.log(`Processing /citadel_channel command for ${interaction.user.displayName}`);
    
    const user = interaction.user;
    const member = interaction.member;
    const guild = interaction.guild;
    const customName = interaction.options.getString('name');
    
    // Validate custom name input
    if (customName) {
        // Basic validation
        if (customName.length < 1) {
            const embed = new EmbedBuilder()
                .setTitle('Invalid Channel Name ☝️')
                .setDescription('Channel name cannot be empty.')
                .setColor(0xFF9900);
            
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        }

        if (customName.length > 80) {
            const embed = new EmbedBuilder()
                .setTitle('Channel Name Too Long ☝️')
                .setDescription('Channel name must be 80 characters or less (excluding "-chamber" suffix).')
                .setColor(0xFF9900);
            
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        }

        // Check for completely invalid characters
        const sanitized = customName.replace(/[^a-z0-9\s-]/gi, '');
        if (sanitized.length < 1) {
            const embed = new EmbedBuilder()
                .setTitle('Invalid Channel Name ☝️')
                .setDescription('Channel name must contain at least some letters, numbers, spaces, or hyphens.')
                .addFields({
                    name: 'Valid Characters',
                    value: 'Letters (a-z), numbers (0-9), spaces, and hyphens (-)',
                    inline: false
                })
                .setColor(0xFF9900);
            
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        }
    }
    
    // Check Level 15 requirement
    if (!hasLevel15Role(member)) {
        const embed = new EmbedBuilder()
            .setTitle('Level 15 Required ☝️')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Check validated feedback requirement
    const validatedFeedbacks = await getUserValidatedFeedbacksByType(user.id);
    const meetsCitadelRequirement = checkCitadelRequirementMet(validatedFeedbacks.docs, validatedFeedbacks.comments);

    if (!meetsCitadelRequirement) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Validated Feedbacks ☝️')
            .setDescription(`You need **3 doc feedbacks** OR **5 comment feedbacks** OR **2 docs + 2 comments** to create your own Citadel channel.`)
            .addFields({
                name: 'Current Progress',
                value: `• **Level 15**: ✅\n• **Doc Feedbacks**: ${validatedFeedbacks.docs}/3\n• **Comment Feedbacks**: ${validatedFeedbacks.comments}/5\n• **Mixed Option**: ${validatedFeedbacks.docs >= 2 && validatedFeedbacks.comments >= 2 ? '✅ 2 docs + 2 comments met' : `❌ Docs: ${validatedFeedbacks.docs}/2 | Comments: ${validatedFeedbacks.comments}/2`}`,
                inline: false
            },
            {
                name: 'Requirement Options',
                value: '**Option 1:** 3 validated doc feedbacks\n**Option 2:** 5 validated comment feedbacks\n**Option 3:** 2 validated docs + 2 validated comments',
                inline: false
            })
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Check if user already has a Citadel channel - WITH CLEANUP
    const existingChannelId = await global.db.getUserCitadelChannel(user.id);
    if (existingChannelId) {
        // Check if the channel actually exists in Discord
        const actualChannel = guild.channels.cache.get(existingChannelId);
        
        if (actualChannel) {
            // Channel exists - user really does have one
            const embed = new EmbedBuilder()
                .setTitle('Channel Already Exists ☝️')
                .setDescription(`You already have a Citadel channel: <#${existingChannelId}>`)
                .setColor(0xFF9900);
            
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        } else {
            // Channel was deleted but database wasn't cleaned up - fix this automatically
            await global.db.removeCitadelChannel(user.id);
            
            // Send debug message about cleanup
            const debugChannel = guild.channels.cache.find(ch => 
                ch.isTextBased() && (
                    ch.name.includes('bot-logs') || 
                    ch.name.includes('staff') || 
                    ch.name.includes('admin') ||
                    ch.name.includes('errors')
                )
            );
            
            if (debugChannel) {
                try {
                    await debugChannel.send(`🏰 **Citadel Cleanup**: Removed stale database record for **${member.displayName}** (channel ID ${existingChannelId} no longer exists)`);
                } catch (e) {
                    // Ignore if we can't send debug message
                }
            }
            
            // Continue with channel creation since the old one is gone
        }
    }
    
    await interaction.deferReply();
    
    try {
        const channel = await createCitadelChannel(guild, user.id, member, customName);
        
        const totalValidated = validatedFeedbacks.docs + validatedFeedbacks.comments;
        const embed = new EmbedBuilder()
            .setTitle('📚 Citadel Channel Created!')
            .setDescription(`Congratulations! Your personal literary chamber has been created: ${channel}`)
            .addFields(
                { name: 'Channel Name', value: `**${channel.name}**`, inline: true },
                { name: 'Achievement Unlocked', value: `✅ **Level 15** + **${totalValidated} Validated Feedbacks**`, inline: false },
                { name: 'Your New Powers', value: '• Post unlimited stories and chapters\n• Manage feedback threads\n• Full creative control of your space', inline: false },
                { name: 'Next Steps', value: 'Visit your new channel to start posting your literary works!', inline: false }
            )
            .setColor(0xFFD700);
        
        await interaction.editReply({ embeds: [embed] });
        
    } catch (error) {
        console.error('Error creating Citadel channel:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setTitle('Channel Creation Failed ☝️')
            .setDescription('There was an error creating your Citadel channel.')
            .addFields(
                { name: 'Error Details', value: `\`\`\`${error.message}\`\`\``, inline: false },
                { name: 'Next Steps', value: 'Try a different channel name, or check the staff/bot-logs channel for detailed diagnostics.', inline: false }
            )
            .setColor(0xFF6B6B);
        
        await interaction.editReply({ embeds: [errorEmbed] });
    }
}

function hasAccessToCitadelChannel(member) {
    const hasLevel = hasLevel15Role(member);
    return hasLevel; // We'll check validated feedbacks separately in the command
}

function hasAccessToBookshelfDemo(member) {
    return hasLevel5Role(member);
}

function hasAccessToBookshelfPosting(member) {
    return hasLevel10Role(member); // We'll check validated feedbacks separately
}

function hasLevel10Role(member) {
    if (!member?.roles?.cache) {
        console.log('Invalid member object');
        return false;
    }
    
    const hasRole = member.roles.cache.some(role => {
        if (role.name.startsWith('Level ')) {
            const level = parseInt(role.name.split(' ')[1]);
            return level >= 10;
        }
        return false;
    });
    
    console.log(`${member.displayName} has Level 10+ role:`, hasRole);
    return hasRole;
}

// ===== CHANNEL MENTION HELPER FUNCTIONS =====
function getChannelMention(guild, channelName) {
    const channel = guild.channels.cache.find(ch => ch.name === channelName);
    return channel ? `<#${channel.id}>` : `#${channelName}`;
}

function getClickableChannelMentions(guild) {
    return {
        bookshelfDiscussion: getChannelMention(guild, 'bookshelf-discussion'),
        bookshelf: getChannelMention(guild, 'bookshelf'),
        rulesChannel: getChannelMention(guild, '📜╠rules'),
        serverGuideChannel: getChannelMention(guild, '🗺╠server-guide'),
        botStuff: getChannelMention(guild, '🐤╠bot-stuff'),
        reactionRoles: getChannelMention(guild, '👑╠reaction-roles'),
        announcements: getChannelMention(guild, '📢╠announcements'),
        introductions: getChannelMention(guild, '👋╠introductions'),
        bump: getChannelMention(guild, '🐉╠bump'),
        ticket: getChannelMention(guild, '🎫╠ticket'),
        writingChat: getChannelMention(guild, '📝╠writing-chat'),
        writingHelp: getChannelMention(guild, '🤝╠writing-help'),
        onePageCritique: getChannelMention(guild, '🔎╠one-page-critique'),
        snippetShowcase: getChannelMention(guild, '💎╠snippet-showcase'),
        bookshelfMemes: getChannelMention(guild, '🤓╠bookshelf-memes'),
        aiArt: getChannelMention(guild, '⚡╠ai-art'),
        triggered: getChannelMention(guild, '💢╠triggered'),
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
        level5: getRoleMention(guild, 'Level 5'),
        level10: getRoleMention(guild, 'Level 10'),
        level15: getRoleMention(guild, 'Level 15')
    };
}

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

async function removeAllUserColorPurchases(userId) {
    try {
        const colorItems = Object.keys(STORE_ITEMS).filter(key => STORE_ITEMS[key].category === 'color');
        
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
    const adjustedDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    return `${adjustedDate.getFullYear()}-${adjustedDate.getMonth()}`;
}

async function getUserMonthlyFeedback(userId) {
    return await global.db.getUserMonthlyFeedbackByType(userId);
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
            return level >= 5;
        }
        return false;
    });
    
    console.log(`${member.displayName} has Level 5+ role:`, hasRole);
    return hasRole;
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

// FIXED: Enhanced isInAllowedFeedbackThread function with better Citadel detection
function isInAllowedFeedbackThread(channel) {
    console.log(`🔍 Checking feedback permissions for channel: ${channel.name}`);
    console.log(`   Type: ${channel.type}, IsThread: ${channel.isThread()}`);
    
    if (channel.parent) {
        console.log(`   Parent: ${channel.parent.name} (type: ${channel.parent.type})`);
        if (channel.parent.parent) {
            console.log(`   Parent's parent: ${channel.parent.parent.name} (type: ${channel.parent.parent.type})`);
        }
    }
    
    // RULE 1: Allow threads in bookshelf-discussion forum
    if (channel.isThread() && channel.parent && channel.parent.name === 'bookshelf-discussion') {
        console.log(`✅ Thread in bookshelf-discussion forum is allowed`);
        return true;
    }
    
    // RULE 2: Allow threads in text channels that are inside a Citadel category
    if (channel.isThread() && channel.parent && channel.parent.type === 0) {
        // Helper function to normalize Unicode text to ASCII
        function normalizeText(text) {
            return text
                .normalize('NFD') // Decompose Unicode
                .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
                .replace(/[^\w\s]/g, '') // Remove special characters
                .toLowerCase()
                .trim();
        }
        
        // Find categories that contain "citadel" in normalized form
        const citadelCategories = channel.guild.channels.cache.filter(ch => {
            if (ch.type !== 4) return false; // Must be category
            
            const normalizedName = normalizeText(ch.name);
            return normalizedName.includes('citadel') || 
                   normalizedName.includes('the citadel') ||
                   ch.name.toLowerCase().includes('citadel') ||
                   ch.name.includes('𝐂𝐢𝐭𝐚𝐝𝐞𝐥') || // Unicode bold
                   ch.name.includes('𝒞𝒾𝓉𝒶𝒹𝑒𝓁') || // Unicode script
                   ch.name.includes('ℭ𝔦𝔱𝔞𝔡𝔢𝔩');   // Unicode fraktur
        });
        
        console.log(`   Found ${citadelCategories.size} potential Citadel categories:`);
        citadelCategories.forEach(cat => {
            console.log(`     - ${cat.name} (ID: ${cat.id})`);
        });
        
        // Check if the thread's parent channel is in any Citadel category
        for (const [categoryId, category] of citadelCategories) {
            if (channel.parent.parentId === categoryId) {
                console.log(`✅ Thread in Citadel text channel (${channel.parent.name}) inside category (${category.name}) is allowed`);
                return true;
            }
        }
    }
    
    // RULE 3: Allow direct messages in Citadel text channels
    if (!channel.isThread() && channel.type === 0 && channel.parentId) {
        // Same Unicode-aware category detection
        function normalizeText(text) {
            return text
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^\w\s]/g, '')
                .toLowerCase()
                .trim();
        }
        
        const citadelCategories = channel.guild.channels.cache.filter(ch => {
            if (ch.type !== 4) return false;
            
            const normalizedName = normalizeText(ch.name);
            return normalizedName.includes('citadel') || 
                   normalizedName.includes('the citadel') ||
                   ch.name.toLowerCase().includes('citadel') ||
                   ch.name.includes('𝐂𝐢𝐭𝐚𝐝𝐞𝐥') ||
                   ch.name.includes('𝒞𝒾𝓉𝒶𝒹𝑒𝓁') ||
                   ch.name.includes('ℭ𝔦𝔱𝔞𝔡𝔢𝔩');
        });
        
        for (const [categoryId, category] of citadelCategories) {
            if (channel.parentId === categoryId) {
                console.log(`✅ Direct message in Citadel text channel (${channel.name}) is allowed`);
                return true;
            }
        }
    }
    
    // RULE 4: Allow user-created Citadel chambers
    if ((channel.isThread() && channel.parent) || (!channel.isThread() && channel.type === 0)) {
        const targetChannel = channel.isThread() ? channel.parent : channel;
        
        if (targetChannel.name.endsWith('-chamber')) {
            // Same Unicode-aware detection for chambers
            function normalizeText(text) {
                return text
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^\w\s]/g, '')
                    .toLowerCase()
                    .trim();
            }
            
            const citadelCategories = channel.guild.channels.cache.filter(ch => {
                if (ch.type !== 4) return false;
                
                const normalizedName = normalizeText(ch.name);
                return normalizedName.includes('citadel') || 
                       normalizedName.includes('the citadel') ||
                       ch.name.toLowerCase().includes('citadel') ||
                       ch.name.includes('𝐂𝐢𝐭𝐚𝐝𝐞𝐥') ||
                       ch.name.includes('𝒞𝒾𝓉𝒶𝒹𝑒𝓁') ||
                       ch.name.includes('ℭ𝔦𝔱𝔞𝔡𝔢𝔩');
            });
            
            for (const [categoryId, category] of citadelCategories) {
                if (targetChannel.parentId === categoryId) {
                    console.log(`✅ User Citadel chamber (${targetChannel.name}) is allowed`);
                    return true;
                }
            }
        }
    }
    
    console.log(`❌ Channel/thread not allowed for feedback`);
    return false;
}

function hasStaffPermissions(member) {
    return member?.permissions?.has(PermissionFlagsBits.ManageMessages);
}

async function assignColorRole(member, guild, itemKey) {
    const item = STORE_ITEMS[itemKey];
    
    try {
        // Remove existing color roles first
        await removeExistingColorRoles(member, guild);
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Find the user's current highest role position
        const userHighestRole = member.roles.highest;
        const botHighestRole = guild.members.me.roles.highest;
        
        // Set target position to be just above user's highest role
        // But ensure it doesn't exceed bot's permissions
        let targetPosition = Math.min(
            userHighestRole.position + 1,
            botHighestRole.position - 1 // Keep it below bot's highest role
        );
        
        // Ensure minimum position of 1
        targetPosition = Math.max(targetPosition, 1);
        
        console.log(`Setting color role position: ${targetPosition} (User highest: ${userHighestRole.position}, Bot highest: ${botHighestRole.position})`);
        
        // Check if color role already exists
        let colorRole = guild.roles.cache.find(r => r.name === item.name);
        
        if (!colorRole) {
            // Create new color role
            colorRole = await guild.roles.create({
                name: item.name,
                color: item.color,
                reason: `Color role purchase: ${item.name}`,
                hoist: false, // Set to true if you want the role to show separately in member list
                mentionable: false,
                position: targetPosition
            });
            console.log(`Created color role: ${item.name} with color ${item.color.toString(16)} at position ${targetPosition}`);
        } else {
            // Update existing role position to be highest for this user
            await colorRole.setPosition(targetPosition);
            await colorRole.setColor(item.color); // Ensure color is correct
            console.log(`Updated ${item.name} position to ${targetPosition}`);
        }
        
        // Add the role to the user
        await member.roles.add(colorRole);
        console.log(`Added ${item.name} color role to ${member.displayName}`);
        
        // Optional: Make the role "hoist" so it shows separately in the member list
        // This makes the color more prominent
        if (!colorRole.hoist) {
            await colorRole.setHoist(true);
            console.log(`Set ${item.name} to hoist (show separately in member list)`);
        }
        
    } catch (error) {
        console.error('Color role assignment failed:', {
            error: error.message,
            code: error.code,
            itemName: item.name,
            userHighestRole: member.roles.highest.name,
            botHighestRole: guild.members.me.roles.highest.name
        });
        throw error;
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

function getLastMonthKey() {
    const now = new Date();
    const adjustedDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    adjustedDate.setMonth(adjustedDate.getMonth() - 1);
    return `${adjustedDate.getFullYear()}-${adjustedDate.getMonth()}`;
}

// ===== USER RESET FUNCTION =====
async function resetUserProgress(userId, guild) {
    console.log(`Resetting all progress for user ${userId}`);
    
    await global.db.clearUserLoggedFeedback(userId);
    
    const closedThreads = await closeUserBookshelfThreads(guild, userId);
    
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
        
        // Get the latest message
        const latestMessage = userMessages.first();
        
        // FIXED: Check if this specific message was already logged for feedback
        const alreadyLogged = await hasUserLoggedFeedbackForMessage(latestMessage.id, userId);
        
        if (alreadyLogged) {
            console.log(`Latest message ${latestMessage.id} already used for feedback by user ${userId}`);
            return null;
        }
        
        console.log(`Found valid latest message for user ${userId}: "${latestMessage.content.substring(0, 50)}..."`);
        return latestMessage;
    } catch (error) {
        console.error('Error fetching user messages:', error);
        return null;
    }
}

async function hasUserLoggedFeedbackForMessage(messageId, userId) {
    try {
        // Check if this specific message was already used for pending or validated feedback
        const pendingCheck = await global.db.getRow(
            'SELECT id FROM pending_feedback WHERE user_id = ? AND message_id = ?',
            [userId, messageId]
        );
        
        if (pendingCheck) return true;
        
        // You might also want to check a message_feedback table if you track that
        // For now, we'll just check pending feedback since that's where message_id is stored
        
        return false;
    } catch (error) {
        console.error('Error checking logged feedback for message:', error);
        return false;
    }
}

// ===== SLASH COMMANDS SETUP =====
const commands = [
    new SlashCommandBuilder()
        .setName('feedback')
        .setDescription('Log your most recent contribution in this thread'),
    
    new SlashCommandBuilder()
        .setName('feedback_valid')
        .setDescription('Validate a feedback given in your thread (Thread owners only)')
        .addUserOption(option => option.setName('user').setDescription('User whose feedback to validate').setRequired(true))
        .addStringOption(option => option.setName('type').setDescription('Type of feedback to validate').setRequired(true)
            .addChoices(
                { name: '📄 Full Google Doc Review', value: 'doc' },
                { name: '💬 In-line Comments Only', value: 'comment' }
            )),
    
    new SlashCommandBuilder()
    .setName('feedback_invalid')
    .setDescription('Invalidate/remove a validated feedback from your thread (Thread owners only)')
    .addUserOption(option => option.setName('user').setDescription('User whose feedback to invalidate').setRequired(true))
    .addStringOption(option => option.setName('type').setDescription('Type of feedback to invalidate').setRequired(true)
        .addChoices(
            { name: '📄 Full Google Doc Review', value: 'doc' },
            { name: '💬 In-line Comments Only', value: 'comment' }
        )),
    
    new SlashCommandBuilder()
        .setName('progress')
        .setDescription('Check your feedback credits and access levels')
        .addUserOption(option => option.setName('user').setDescription('User to check (optional)').setRequired(false)),

    new SlashCommandBuilder()
    .setName('color_role')
    .setDescription('Choose your color role (15 total validated feedbacks required)'),
    
    new SlashCommandBuilder()
    .setName('citadel_channel')
    .setDescription('Create your personal channel in The Citadel (Level 15 + validated feedbacks required)')
    .addStringOption(option => 
        option.setName('name')
            .setDescription('Your channel name (will have "-chamber" added automatically)')
            .setRequired(true)
            .setMaxLength(80) // Leave room for "-chamber"
    ),
    
    new SlashCommandBuilder()
        .setName('hall_of_fame')
        .setDescription('View the most dedicated contributors in our literary realm'),
    
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Display essential commands guide'),
    
    new SlashCommandBuilder()
        .setName('commands')
        .setDescription('Display all available commands'),
    
    // Staff commands (keeping existing ones)
    new SlashCommandBuilder()
    .setName('feedback_add')
    .setDescription('Add validated feedbacks to a member (Staff only)')
    .addUserOption(option => option.setName('user').setDescription('User to add feedbacks to').setRequired(true))
    .addStringOption(option => option.setName('type').setDescription('Type of feedback to add').setRequired(true)
        .addChoices(
            { name: '📄 Full Google Doc Review', value: 'doc' },
            { name: '💬 In-line Comments Only', value: 'comment' }
        ))
    .addIntegerOption(option => option.setName('amount').setDescription('Number of feedbacks to add (default: 1)').setRequired(false)),
    
    new SlashCommandBuilder()
    .setName('feedback_remove')
    .setDescription('Remove validated feedbacks from a member (Staff only)')
    .addUserOption(option => option.setName('user').setDescription('User to remove feedbacks from').setRequired(true))
    .addStringOption(option => option.setName('type').setDescription('Type of feedback to remove').setRequired(true)
        .addChoices(
            { name: '📄 Full Google Doc Review', value: 'doc' },
            { name: '💬 In-line Comments Only', value: 'comment' },
            { name: '🔄 Any Type (Most Recent)', value: 'any' }
        ))
    .addIntegerOption(option => option.setName('amount').setDescription('Number of feedbacks to remove (default: 1)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('feedback_reset')
        .setDescription('Reset member\'s entire record to zero (Staff only)')
        .addUserOption(option => option.setName('user').setDescription('User to reset').setRequired(true)),

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
        .setName('pardoned_last_month')
        .setDescription('View all members who were pardoned last month (Staff only)'),

    new SlashCommandBuilder()
        .setName('purge_list')
        .setDescription('View all members who would be purged for not meeting monthly requirements (Staff only)'),
    
    new SlashCommandBuilder()
        .setName('manual_purge')
        .setDescription('Manually purge all members who don\'t meet monthly requirements (Staff only)'),

    new SlashCommandBuilder()
        .setName('post_server_guide')
        .setDescription('Post the server navigation guide (Staff only)'),

    new SlashCommandBuilder()
        .setName('post_rules')
        .setDescription('Post the server rules (Staff only)'),

    // Fun commands (keeping existing ones)
    new SlashCommandBuilder()
        .setName('faceless')
        .setDescription('Make an anonymous confession to the community')
        .addStringOption(option => option.setName('confession').setDescription('Your writing confession').setRequired(true)),

    new SlashCommandBuilder()
        .setName('shame')
        .setDescription('Ring the shame bell of King\'s Landing')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to shame')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Why are they being shamed?')
                .setRequired(false)
                .setMaxLength(200))
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
    console.log(`${client.user.tag} is online and serving Type&Draft with the new feedback system!`);
    
    try {
        const db = new DatabaseManager();
        await db.initialize();
        
        const connectionTest = await db.testConnection();
        if (!connectionTest) {
            throw new Error('Database connection test failed');
        }
        console.log('✅ Database connection verified with new feedback system tables');
        
        global.db = db;
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        console.error('Bot cannot start without database. Exiting...');
        process.exit(1);
    }
    
    await registerCommands();
    welcomeSystem.init();
    
    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.members.fetch();
            await guild.roles.fetch();
            console.log(`Fetched ${guild.members.cache.size} members and ${guild.roles.cache.size} roles for ${guild.name}`);
        } catch (error) {
            console.error(`Failed to fetch data for ${guild.name}:`, error);
        }
    }
    console.log('🎭 Bot fully initialized with new feedback validation system!');
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
    if (thread.parent && MONITORED_FORUMS.includes(thread.parent.name)) {
        console.log(`📝 Thread created in monitored forum: ${thread.name} in ${thread.parent.name}`);
        await sendActivityNotification(thread.guild, 'thread_created', { thread });
    }

    if (thread.parent && thread.parent.name === 'bookshelf') {
        console.log(`New bookshelf thread created: ${thread.name} by ${thread.ownerId}`);
        
        try {
            const member = await thread.guild.members.fetch(thread.ownerId);
            
            // Check if they have demo access (Level 5+)
            if (!hasAccessToBookshelfDemo(member)) {
                console.log(`User ${member.displayName} lacks Level 5 for demo bookshelf access`);
                
                // Send DM first, then delete thread
                try {
                    const dmChannel = await member.createDM();
                    const embed = new EmbedBuilder()
                        .setTitle('Bookshelf Thread Removed ☝️')
                        .setDescription('You need **Level 5** to access the demo bookshelf.')
                        .addFields({
                            name: 'How to Progress',
                            value: 'Continue participating in server activities to reach **Level 5** status.',
                            inline: false
                        })
                        .setColor(0xFF9900);
                    
                    await dmChannel.send({ embeds: [embed] });
                } catch (dmError) {
                    console.log('Could not send DM to user:', dmError.message);
                }
                
                await thread.delete();
                return;
            }
            
            // Check if they can post (Level 10 + validated feedbacks)
            const validatedFeedbacks = await getUserValidatedFeedbacksByType(member.id);
            const canPost = checkBookshelfPostRequirementMet(validatedFeedbacks.docs, validatedFeedbacks.comments);
            
            if (!hasAccessToBookshelfPosting(member) || !canPost) {
    console.log(`User ${member.displayName} can access demo but cannot post yet`);
    
    // Send DM first, then delete thread
    try {
        const dmChannel = await member.createDM();
        const embed = new EmbedBuilder()
            .setTitle('Cannot Post in Bookshelf Yet ☝️')
            .setDescription(`You can view the demo bookshelf, but need **Level 10** and **2 validated doc feedbacks OR 4 comment feedbacks OR 1 doc + 2 comment feedbacks** to post your own demo chapters.`)
            .addFields(
                { 
                    name: 'Current Status', 
                    value: `• Level 10+: ${hasAccessToBookshelfPosting(member) ? '✅' : '❌'}\n• Doc Feedbacks: ${validatedFeedbacks.docs}/2\n• Comment Feedbacks: ${validatedFeedbacks.comments}/4\n• Mixed Option: ${validatedFeedbacks.docs >= 1 && validatedFeedbacks.comments >= 2 ? '✅ 1 doc + 2 comments met' : `❌ Need 1 doc + 2 comments (currently ${validatedFeedbacks.docs} docs + ${validatedFeedbacks.comments} comments)`}`, 
                    inline: false 
                },
                { 
                    name: 'How to Progress', 
                    value: 'Give quality feedback in the bookshelf-discussion forum and Citadel channels, then ask thread owners to validate your feedback with `/feedback_valid`.', 
                    inline: false 
                }
            )
            .setColor(0xFF9900);
        
        await dmChannel.send({ embeds: [embed] });
    } catch (dmError) {
        console.log('Could not send DM to user:', dmError.message);
    }
    
    await thread.delete();
    return;
}
            
            // If they can post, send a welcome message to the thread
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('Welcome to the Demo Bookshelf! 📚')
                .setDescription(`Congratulations ${member.displayName}! You can now post up to **${BOOKSHELF_DEMO_LIMIT} chapters** here.`)
                .addFields({
                    name: 'Next Step',
                    value: `Reach **Level 15** and get **3 additional doc feedbacks OR 5 additional comment feedbacks** to create your own unlimited Citadel channel with \`/citadel_channel\`!`,
                    inline: false
                })
                .setColor(0x00AA55);
            
            await thread.send({ embeds: [welcomeEmbed] });
            
        } catch (error) {
            console.error('Error handling bookshelf thread creation:', error);
            // If there's an error, delete the thread as a safety measure
            try {
                await thread.delete();
            } catch (deleteError) {
                console.error('Error deleting thread after error:', deleteError);
            }
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Monitor feedback posting in bookshelf-discussion
    if (message.channel.isThread() && 
        message.channel.parent && 
        message.channel.parent.name === 'bookshelf-discussion') {
        
        console.log(`💬 Message posted in ${message.channel.parent.name}: ${message.author.displayName}`);
        
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

    // BOOKSHELF DEMO POSTING LIMITS - UPDATED
    if (message.channel.isThread() && message.channel.parent && message.channel.parent.name === 'bookshelf') {
    
    if (message.channel.ownerId !== message.author.id) {
        await message.delete();
        await sendTemporaryChannelMessage(message.channel, 
            `Only the thread creator can post here, **${message.author.displayName}**! ☝️`,
            8000
        );
        return;
    }
    
    // Check demo post limit - FIRST MESSAGE IS ALWAYS FREE
    try {
        const messages = await message.channel.messages.fetch({ limit: 50 });
        const ownerMessages = messages.filter(msg => 
            msg.author.id === message.channel.ownerId && 
            msg.id !== message.id // Exclude current message
        );
        
        const totalOwnerMessages = ownerMessages.size + 1; // +1 for current message
        
        // First message is always free (for blurb, warnings, etc.)
        if (totalOwnerMessages === 1) {
            await sendTemporaryChannelMessage(message.channel, 
                `📚 **Blurb posted!** This first message is free for your story description, trigger warnings, etc. You can post **${BOOKSHELF_DEMO_LIMIT} demo chapters** after this! ☝️`,
                8000
            );
            return;
        }
        
        // Count demo chapters (excluding the first free message)
        const demoChapterCount = totalOwnerMessages - 1;
        
        if (demoChapterCount > BOOKSHELF_DEMO_LIMIT) {
            await message.delete();
            await sendTemporaryChannelMessage(message.channel, 
                `📚 **Demo limit reached!** You can post **1 free blurb** + **${BOOKSHELF_DEMO_LIMIT} demo chapters**. To get unlimited posting, reach **Level 15** and get **3 additional doc OR 5 additional comment validated feedbacks** to create your own Citadel channel! ☝️`,
                12000
            );
            return;
        }
        
        // Increment demo post count (only for actual chapters, not the first free message)
        await global.db.incrementBookshelfDemoPostCount(message.author.id);
        
        if (demoChapterCount === BOOKSHELF_DEMO_LIMIT) {
            await sendTemporaryChannelMessage(message.channel, 
                `📚 **Final demo chapter!** You've used ${demoChapterCount}/${BOOKSHELF_DEMO_LIMIT} demo chapters (plus 1 free blurb). Reach **Level 15** + **3 additional doc OR 5 additional comment validated feedbacks** for your own unlimited Citadel channel! ☝️`,
                12000
            );
        } else {
            await sendTemporaryChannelMessage(message.channel, 
                `📚 Demo chapter ${demoChapterCount}/${BOOKSHELF_DEMO_LIMIT} posted! (Plus 1 free blurb) ☝️`,
                8000
            );
        }
        
    } catch (error) {
        console.error('Error checking demo post count:', error);
    }
    
    return;
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
            help: () => handleHelpCommand(message),
            progress: () => handleBalanceCommand(message)
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
        feedback_valid: () => handleFeedbackValidSlashCommand(interaction),
        feedback_invalid: () => handleFeedbackInvalidSlashCommand(interaction),
        progress: () => handleBalanceSlashCommand(interaction),
        color_role: () => handleColorRoleSlashCommand(interaction),
        citadel_channel: () => handleCitadelChannelSlashCommand(interaction),
        hall_of_fame: () => handleHallOfFameSlashCommand(interaction),
        help: () => handleHelpSlashCommand(interaction),
        commands: () => handleCommandsSlashCommand(interaction),
        // Staff commands
        feedback_add: () => handleFeedbackAddSlashCommand(interaction),
        feedback_remove: () => handleFeedbackRemoveSlashCommand(interaction),
        feedback_reset: () => handleFeedbackResetSlashCommand(interaction),
        stats: () => handleStatsSlashCommand(interaction),
        pardon: () => handlePardonSlashCommand(interaction),
        unpardon: () => handleUnpardonSlashCommand(interaction),
        pardoned_last_month: () => handlePardonedLastMonthSlashCommand(interaction),
        purge_list: () => handlePurgeListSlashCommand(interaction),
        manual_purge: () => handleManualPurgeSlashCommand(interaction),
        post_server_guide: () => handlePostServerGuideSlashCommand(interaction),
        post_rules: () => handlePostRulesSlashCommand(interaction),
        // Fun commands
        faceless: () => handleFacelessSlashCommand(interaction),
        shame: () => handleShameSlashCommand(interaction)
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

// ===== NEW FEEDBACK COMMANDS =====

async function handleFeedbackSlashCommand(interaction) {
    console.log(`Processing /feedback command for ${interaction.user.displayName}`);
    
    const user = interaction.user;
    const member = interaction.member;
    const channel = interaction.channel;
    const guild = interaction.guild;
    
    // Ensure member object is fresh
    try {
        const freshMember = await guild.members.fetch(user.id);
        Object.assign(member, freshMember);
    } catch (error) {
        console.log('Could not fetch member, using existing member object');
    }
    
    // Check if user has Level 5 role
    if (!hasLevel5Role(member)) {
        const embed = new EmbedBuilder()
            .setTitle(`**Level 5** Required ☝️`)
            .setColor(0xFF8C00);
        
        return await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // Check if in allowed feedback location
    if (!isInAllowedFeedbackThread(channel)) {
        const channels = getClickableChannelMentions(guild);
        const embed = new EmbedBuilder()
            .setTitle('Incorrect Location ☝️')
            .setDescription('Feedback can only be logged in these locations:')
            .addFields({
                name: 'Permitted Locations',
                value: `• ${channels.bookshelfDiscussion} forum threads\n• Citadel channel feedback threads`,
                inline: false
            })
            .setColor(0xFF9900);
        
        return await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // SIMPLE ANTI-FARMING CHECK: Only block if in your own Citadel channel
    // Check if this is your own Citadel channel (thread or direct)
    const targetChannel = channel.isThread() ? channel.parent : channel;
    
    if (targetChannel && targetChannel.type === 0 && targetChannel.parentId) {
        // Check if this is a Citadel channel
        function normalizeText(text) {
            return text
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^\w\s]/g, '')
                .toLowerCase()
                .trim();
        }
        
        const citadelCategories = channel.guild.channels.cache.filter(ch => {
            if (ch.type !== 4) return false;
            
            const normalizedName = normalizeText(ch.name);
            return normalizedName.includes('citadel') || 
                   normalizedName.includes('the citadel') ||
                   ch.name.toLowerCase().includes('citadel') ||
                   ch.name.includes('𝐂𝐢𝐭𝐚𝐝𝐞𝐥') ||
                   ch.name.includes('𝒞𝒾𝓉𝒶𝒹𝑒𝓁') ||
                   ch.name.includes('ℭ𝔦𝔱𝔞𝔡𝔢𝔩');
        });
        
        const isInCitadel = citadelCategories.some(category => 
            targetChannel.parentId === category.id
        );
        
        if (isInCitadel) {
            // Check if the user owns this Citadel channel
            const userCitadelChannel = await global.db.getUserCitadelChannel(user.id);
            if (userCitadelChannel === targetChannel.id) {
                const embed = new EmbedBuilder()
                    .setTitle('Cannot Log Feedback in Your Own Chamber ☝️')
                    .setColor(0xFF9900);
                
                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
    }
    
    // Check if user has recent message
    const latestMessage = await findUserLatestMessage(channel, user.id);
    if (!latestMessage) {
        const embed = new EmbedBuilder()
            .setTitle('No Recent Feedback Message Found ☝️')
            .setDescription('You must post your feedback message **before** using the feedback command.')
            .setColor(0xFF9900);
        
        return await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    // Create buttons for feedback type selection
    const { ButtonBuilder, ButtonStyle } = require('discord.js');
    
    const docButton = new ButtonBuilder()
        .setCustomId('feedback_doc')
        .setLabel('📄 Full Google Doc Review')
        .setStyle(ButtonStyle.Primary);
    
    const commentButton = new ButtonBuilder()
        .setCustomId('feedback_comment')
        .setLabel('💬 In-line Comments Only')
        .setStyle(ButtonStyle.Secondary);
    
    const row = new ActionRowBuilder().addComponents(docButton, commentButton);
    
    const embed = new EmbedBuilder()
        .setTitle('Select Feedback Type ☝️')
        .setDescription('What type of feedback did you provide?')
        .addFields(
            { name: '📄 Full Google Doc Review', value: 'Comprehensive feedback with detailed analysis, suggestions, and overall assessment', inline: false },
            { name: '💬 In-line Comments Only', value: 'Quick comments and suggestions directly on the document', inline: false },
            { name: 'Important', value: 'Your feedback will be pending until the work\'s author validates it with `/feedback_valid`', inline: false }
        )
        .setColor(0x5865F2);
    
    const response = await interaction.reply({ 
        embeds: [embed], 
        components: [row], 
        ephemeral: true 
    });
    
    // Wait for button click
    try {
        const buttonInteraction = await response.awaitMessageComponent({ 
            time: 60000 
        });
        
        const feedbackType = buttonInteraction.customId === 'feedback_doc' ? 'doc' : 'comment';
        
        console.log(`Selected feedback type: ${feedbackType} for user ${user.id} in channel ${channel.id}`);
        
        // Store as pending feedback with better error handling
        try {
            await addPendingFeedback(user.id, channel.id, feedbackType, latestMessage.id);
            console.log(`Successfully added pending feedback for user ${user.id}`);
        } catch (dbError) {
            console.error('Database error when adding pending feedback:', dbError);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('Database Error ☝️')
                .setDescription('There was an error saving your feedback. Please try again.')
                .setColor(0xFF6B6B);
            
            await buttonInteraction.update({ embeds: [errorEmbed], components: [] });
            return;
        }
        
        const confirmEmbed = new EmbedBuilder()
            .setTitle('Feedback Logged as Pending ☝️')
            .setDescription(`Your **${feedbackType === 'doc' ? 'Full Google Doc Review' : 'In-line Comments'}** feedback has been logged and is awaiting validation.`)
            .addFields(
                { name: 'Next Step', value: 'The chamber owner or thread creator must use `/feedback_valid` to confirm your feedback type and quality.', inline: false },
                { name: 'Status', value: '⏳ **Pending Validation**', inline: true },
                { name: 'Type', value: feedbackType === 'doc' ? '📄 Full Document' : '💬 In-line Comments', inline: true }
            )
            .setColor(0xFF9900);
        
        await buttonInteraction.update({ embeds: [confirmEmbed], components: [] });
        
        // Send activity notification
        try {
            await sendActivityNotification(guild, 'feedback_command', {
                thread: channel,
                userId: user.id,
                feedbackType: feedbackType,
                messageUrl: `https://discord.com/channels/${guild.id}/${channel.id}`
            });
        } catch (notificationError) {
            console.error('Failed to send activity notification:', notificationError);
            // Don't fail the whole operation for this
        }
        
    } catch (error) {
        console.error('Feedback type selection timeout or error:', error);
        
        const timeoutEmbed = new EmbedBuilder()
            .setTitle('Selection Timeout ☝️')
            .setDescription('Feedback type selection timed out. Please try again.')
            .addFields({
                name: 'Error Details',
                value: `\`\`\`${error.message}\`\`\``,
                inline: false
            })
            .setColor(0xFF6B6B);
        
        try {
            await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
        } catch (editError) {
            console.error('Failed to edit reply after timeout:', editError);
        }
    }
}

async function handleFeedbackValidSlashCommand(interaction) {
    console.log(`Processing /feedback_valid command for ${interaction.user.displayName}`);
    
    const validator = interaction.user;
    const channel = interaction.channel;
    const guild = interaction.guild;
    const feedbackGiver = interaction.options.getUser('user');
    const feedbackType = interaction.options.getString('type');
    
    // Check if this is a thread
    if (!channel.isThread()) {
        const embed = new EmbedBuilder()
            .setTitle('Must Be Used in a Thread ☝️')
            .setDescription('This command can only be used in threads.')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // ANTI-FARMING CHECK: Prevent validating your own feedback
    if (validator.id === feedbackGiver.id) {
        const embed = new EmbedBuilder()
            .setTitle('Cannot Validate Your Own Feedback ☝️')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // ENHANCED PERMISSION CHECK: Thread owner OR Citadel channel owner
    let hasPermission = false;
    let permissionType = '';
    
    // Check if user is the thread creator
    if (channel.ownerId === validator.id) {
        hasPermission = true;
        permissionType = 'thread owner';
    }
    // Check if this is a Citadel channel thread and user owns the Citadel channel
    else if (channel.parent && channel.parent.type === 0) {
        // Check if parent channel is in a Citadel category and user owns it
        function normalizeText(text) {
            return text
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^\w\s]/g, '')
                .toLowerCase()
                .trim();
        }
        
        const citadelCategories = channel.guild.channels.cache.filter(ch => {
            if (ch.type !== 4) return false;
            
            const normalizedName = normalizeText(ch.name);
            return normalizedName.includes('citadel') || 
                   normalizedName.includes('the citadel') ||
                   ch.name.toLowerCase().includes('citadel') ||
                   ch.name.includes('𝐂𝐢𝐭𝐚𝐝𝐞𝐥') ||
                   ch.name.includes('𝒞𝒾𝓉𝒶𝒹𝑒𝓁') ||
                   ch.name.includes('ℭ𝔦𝔱𝔞𝔡𝔢𝔩');
        });
        
        // Check if this thread's parent channel is in a Citadel category
        const isInCitadel = citadelCategories.some(category => 
            channel.parent.parentId === category.id
        );
        
        if (isInCitadel) {
            // Check if the validator owns this Citadel channel
            const userCitadelChannel = await global.db.getUserCitadelChannel(validator.id);
            if (userCitadelChannel === channel.parent.id) {
                hasPermission = true;
                permissionType = 'Citadel channel owner';
            }
        }
    }
    
    if (!hasPermission) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Permissions ☝️')
            .setDescription('You can only validate feedback in:')
            .addFields({
                name: 'Permitted Actions',
                value: '• Threads you created\n• Threads in your own Citadel channel',
                inline: false
            })
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Check if there's pending feedback from this user
    const pendingFeedback = await getPendingFeedback(feedbackGiver.id, channel.id);
    
    if (!pendingFeedback) {
        const embed = new EmbedBuilder()
            .setTitle('No Pending Feedback Found ☝️')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Validate the feedback type matches what they submitted
    if (pendingFeedback.feedback_type !== feedbackType) {
        const embed = new EmbedBuilder()
            .setTitle('Feedback Type Mismatch ☝️')
            .addFields({
                name: 'Submitted Type',
                value: `${pendingFeedback.feedback_type === 'doc' ? '📄 Full Google Doc Review' : '💬 In-line Comments'}`,
                inline: true
            })
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Get the current monthly feedback count BEFORE adding the new one
    const monthlyFeedback = await global.db.getUserMonthlyFeedbackByType(feedbackGiver.id);

    // Add validated feedback to database (this will auto-increment monthly counts)
    await addValidatedFeedback(feedbackGiver.id, feedbackType, validator.id, channel.id);

    // Remove pending feedback
    await removePendingFeedback(feedbackGiver.id, channel.id);

    // Calculate what the NEW counts should be (current + 1)
    const newDocs = feedbackType === 'doc' ? monthlyFeedback.docs + 1 : monthlyFeedback.docs;
    const newComments = feedbackType === 'comment' ? monthlyFeedback.comments + 1 : monthlyFeedback.comments;
        
        // Check if they now meet monthly requirements
        const meetingRequirement = checkMonthlyRequirementMet(newDocs, newComments);
        const validatedCount = await getUserValidatedFeedbacks(feedbackGiver.id);
        
        // Check if they've unlocked new access levels
        let unlockedAccess = '';
        const member = await guild.members.fetch(feedbackGiver.id);
        
        if (hasLevel15Role(member) && checkCitadelRequirementMet(newDocs, newComments)) {
            // Check if they already have a citadel channel
            const existingChannel = await global.db.getUserCitadelChannel(feedbackGiver.id);
            if (!existingChannel) {
                unlockedAccess = '\n🏰 **NEW ACCESS UNLOCKED:** You can now create your own Citadel channel with `/citadel_channel`!';
            }
        } else if (hasLevel10Role(member) && checkBookshelfPostRequirementMet(newDocs, newComments)) {
            unlockedAccess = '\n📚 **NEW ACCESS UNLOCKED:** You can now post demo chapters in the bookshelf!';
        }
        
        const embed = new EmbedBuilder()
            .setTitle('✅ Feedback Validated!')
            .setColor(0x00FF00);
        
        if (unlockedAccess) {
            embed.addFields({ name: 'Achievement Unlocked!', value: unlockedAccess.trim(), inline: false });
        }
        
        await replyTemporary(interaction, { embeds: [embed], ephemeral: true }, 8000);
        
        // Send notification to feedback giver
        try {
            const dmChannel = await feedbackGiver.createDM();
            const dmEmbed = new EmbedBuilder()
                .setTitle('✅ Your Feedback Was Validated!')
                .setDescription(`Your **${feedbackType === 'doc' ? 'Full Google Doc Review' : 'In-line Comments'}** feedback in **${channel.name}** has been validated by the ${permissionType}.`)
                .addFields(
                    { name: 'Monthly Progress', value: `📄 Docs: ${newDocs} | 💬 Comments: ${newComments}`, inline: false },
                    { name: 'Requirement Status', value: meetingRequirement ? '✅ Monthly requirement met!' : `❌ Need: 2 docs OR 4 comments OR 1 doc + 2 comments`, inline: false },
                    { name: 'Total Validated', value: `${validatedCount} feedbacks`, inline: true }
                )
                .setColor(0x00FF00);
            
            if (unlockedAccess) {
                dmEmbed.addFields({ name: 'New Access!', value: unlockedAccess.trim(), inline: false });
            }
            
            await dmChannel.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            console.log('Could not send DM to feedback giver:', dmError.message);
        }
        
        // Send activity notification
        await sendActivityNotification(guild, 'feedback_validated', {
            thread: channel,
            validatorId: validator.id,
            feedbackGiverId: feedbackGiver.id,
            feedbackType: feedbackType,
            messageUrl: `https://discord.com/channels/${guild.id}/${channel.id}`
        });
}

async function handleFeedbackInvalidSlashCommand(interaction) {
    console.log(`Processing /feedback_invalid command for ${interaction.user.displayName}`);
    
    const validator = interaction.user;
    const channel = interaction.channel;
    const guild = interaction.guild;
    const feedbackGiver = interaction.options.getUser('user');
    const feedbackType = interaction.options.getString('type');
    
    // Check if this is a thread
    if (!channel.isThread()) {
        const embed = new EmbedBuilder()
            .setTitle('Must Be Used in a Thread ☝️')
            .setDescription('This command can only be used in threads.')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // ANTI-FARMING CHECK: Prevent invalidating your own feedback
    if (validator.id === feedbackGiver.id) {
        const embed = new EmbedBuilder()
            .setTitle('Cannot Invalidate Your Own Feedback ☝️')
            .setDescription('You cannot invalidate feedback that you gave yourself.')
            .addFields({
                name: 'Anti-Farming Protection',
                value: 'Only other users can invalidate feedback that you provided.',
                inline: false
            })
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // SMART PERMISSION CHECK: Different permissions for pending vs validated feedback
    let hasPermission = false;
    let permissionType = '';
    let isThreadOwner = false;
    let isChamberOwner = false;
    
    // Check if user is the thread creator
    if (channel.ownerId === validator.id) {
        isThreadOwner = true;
        hasPermission = true;
        permissionType = 'thread owner';
    }
    
    // Check if this is a Citadel channel thread and user owns the Citadel channel
    if (channel.parent && channel.parent.type === 0) {
        function normalizeText(text) {
            return text
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^\w\s]/g, '')
                .toLowerCase()
                .trim();
        }
        
        const citadelCategories = channel.guild.channels.cache.filter(ch => {
            if (ch.type !== 4) return false;
            
            const normalizedName = normalizeText(ch.name);
            return normalizedName.includes('citadel') || 
                   normalizedName.includes('the citadel') ||
                   ch.name.toLowerCase().includes('citadel') ||
                   ch.name.includes('𝐂𝐢𝐭𝐚𝐝𝐞𝐥') ||
                   ch.name.includes('𝒞𝒾𝓉𝒶𝒹𝑒𝓁') ||
                   ch.name.includes('ℭ𝔦𝔱𝔞𝔡𝔢𝔩');
        });
        
        const isInCitadel = citadelCategories.some(category => 
            channel.parent.parentId === category.id
        );
        
        if (isInCitadel) {
            const userCitadelChannel = await global.db.getUserCitadelChannel(validator.id);
            if (userCitadelChannel === channel.parent.id) {
                isChamberOwner = true;
                if (!hasPermission) {
                    hasPermission = true;
                    permissionType = 'Citadel channel owner';
                }
            }
        }
    }
    
    if (!hasPermission) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Permissions ☝️')
            .setDescription('You can only invalidate feedback in:')
            .addFields({
                name: 'Permitted Actions',
                value: '• Threads you created\n• Threads in your own Citadel channel',
                inline: false
            })
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    try {
        // First check for pending feedback
        const pendingFeedback = await getPendingFeedback(feedbackGiver.id, channel.id);
        
        if (pendingFeedback && pendingFeedback.feedback_type === feedbackType) {
            // PENDING FEEDBACK: Both thread owners and chamber owners can remove
            await removePendingFeedback(feedbackGiver.id, channel.id);
            
            const embed = new EmbedBuilder()
                .setTitle('✅ Pending Feedback Removed!')
                .setColor(0xFF9900);
            
            await replyTemporary(interaction, { embeds: [embed], ephemeral: true }, 8000);
            
            // Send notification to feedback giver
            try {
                const dmChannel = await feedbackGiver.createDM();
                const dmEmbed = new EmbedBuilder()
                    .setTitle('⚠️ Your Pending Feedback Was Removed')
                    .setDescription(`Your pending **${feedbackType === 'doc' ? 'Full Google Doc Review' : 'In-line Comments'}** feedback in **${channel.name}** was removed by the ${permissionType}.`)
                    .addFields({
                        name: 'What This Means',
                        value: 'Your feedback was not validated and you will not receive credit for it.',
                        inline: false
                    })
                    .setColor(0xFF9900);
                
                await dmChannel.send({ embeds: [dmEmbed] });
            } catch (dmError) {
                console.log('Could not send DM to feedback giver about removed pending feedback:', dmError.message);
            }
            
            console.log(`Pending feedback removed: ${feedbackGiver.displayName}'s ${feedbackType} feedback in ${channel.name} by ${permissionType}`);
            return;
        }
        
        // No pending feedback found, check for validated feedback
        const feedbackToInvalidate = await global.db.getRow(`
            SELECT id, validated_at FROM validated_feedback 
            WHERE user_id = ? AND thread_id = ? AND feedback_type = ?
            ORDER BY validated_at DESC 
            LIMIT 1
        `, [feedbackGiver.id, channel.id, feedbackType]);
        
        if (!feedbackToInvalidate) {
            const typeDisplay = feedbackType === 'doc' ? '📄 Full Google Doc Review' : '💬 In-line Comments';
            const embed = new EmbedBuilder()
                .setTitle('No Feedback Found ☝️')
                .setColor(0xFF9900);
            
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        }
        
        // VALIDATED FEEDBACK: Only thread owners can remove (no retroactive chamber owner invalidation)
        if (!isThreadOwner) {
            const embed = new EmbedBuilder()
                .setTitle('Cannot Invalidate Validated Feedback ☝️')
                .setColor(0xFF9900);
            
            return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
        }
        
        // Proceed with validated feedback invalidation (thread owner only)
        const currentValidated = await getUserValidatedFeedbacksByType(feedbackGiver.id);
        const currentMonthly = await getUserMonthlyFeedbackByType(feedbackGiver.id);
        
        // Remove the validated feedback
        await global.db.runSingle(
            'DELETE FROM validated_feedback WHERE id = ?',
            [feedbackToInvalidate.id]
        );
        
        // Update total feedback count
        const userData = await getUserData(feedbackGiver.id);
        await updateUserData(feedbackGiver.id, {
            total_feedback_all_time: Math.max(0, userData.total_feedback_all_time - 1)
        });
        
        // Update monthly feedback count
        const monthKey = global.db.getCurrentMonthKey();
        const newDocs = feedbackType === 'doc' ? Math.max(0, currentMonthly.docs - 1) : currentMonthly.docs;
        const newComments = feedbackType === 'comment' ? Math.max(0, currentMonthly.comments - 1) : currentMonthly.comments;
        
        await global.db.runSingle(
            'UPDATE monthly_feedback SET docs = ?, comments = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND month_key = ?',
            [newDocs, newComments, feedbackGiver.id, monthKey]
        );
        
        // Calculate new totals
        const newValidatedTotal = (currentValidated.docs + currentValidated.comments) - 1;
        const meetingRequirement = checkMonthlyRequirementMet(newDocs, newComments);
        
        const typeDisplay = feedbackType === 'doc' ? '📄 Full Google Doc Review' : '💬 In-line Comments';
        
        const embed = new EmbedBuilder()
            .setTitle('✅ Validated Feedback Invalidated!')
            .setDescription(`Successfully invalidated **${feedbackGiver.displayName}**'s ${typeDisplay} feedback.`)
            .addFields(
                { name: 'Authority', value: `Invalidated by thread owner`, inline: false },
                { name: 'Updated Monthly Stats', value: `📄 Docs: ${newDocs} | 💬 Comments: ${newComments}`, inline: false },
                { name: 'Monthly Requirement', value: meetingRequirement ? '✅ Still met' : '❌ No longer met', inline: true },
                { name: 'Total Validated', value: `${newValidatedTotal} feedbacks`, inline: true }
            )
            .setColor(0xFF6B6B);
        
        await replyTemporary(interaction, { embeds: [embed], ephemeral: true }, 8000);
        
        // Send notification to feedback giver
        try {
            const dmChannel = await feedbackGiver.createDM();
            const dmEmbed = new EmbedBuilder()
                .setTitle('⚠️ Your Validated Feedback Was Invalidated')
                .setDescription(`Your **${typeDisplay}** feedback in **${channel.name}** has been invalidated by the thread owner.`)
                .addFields(
                    { name: 'Updated Monthly Progress', value: `📄 Docs: ${newDocs} | 💬 Comments: ${newComments}`, inline: false },
                    { name: 'Requirement Status', value: meetingRequirement ? '✅ Monthly requirement still met' : `❌ Monthly requirement no longer met`, inline: false },
                    { name: 'Total Validated', value: `${newValidatedTotal} feedbacks`, inline: true }
                )
                .setColor(0xFF6B6B);
            
            await dmChannel.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            console.log('Could not send DM to feedback giver about invalidation:', dmError.message);
        }
        
        console.log(`Validated feedback invalidated: ${feedbackGiver.displayName}'s ${feedbackType} feedback in ${channel.name} by thread owner`);
        
    } catch (error) {
        console.error('Error invalidating feedback:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setTitle('Error Invalidating Feedback ☝️')
            .setDescription('There was an error invalidating the feedback. Please try again.')
            .setColor(0xFF6B6B);
        
        await replyTemporary(interaction, { embeds: [errorEmbed], ephemeral: true });
    }
}

// ===== PROGRESS COMMANDS =====
async function handleBalanceCommand(message) {
    const user = message.mentions.users.first() || message.author;
    const member = message.mentions.members.first() || message.member;
    const embed = await createBalanceEmbed(user, member, message.guild);
    await replyTemporaryMessage(message, { embeds: [embed] });
}

async function handleBalanceSlashCommand(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = interaction.options.getMember('user') || interaction.member;
    const embed = await createBalanceEmbed(user, member, interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

async function createBalanceEmbed(user, member, guild) {
    const userId = user.id;
    const userRecord = await getUserData(userId);
    const monthlyFeedback = await getUserMonthlyFeedbackByType(userId);
    const validatedFeedbacks = await getUserValidatedFeedbacksByType(userId);
    const monthlyRequirementMet = checkMonthlyRequirementMet(monthlyFeedback.docs, monthlyFeedback.comments);
    
    // Determine access level
    let accessLevel = '❌ **No Access** - Reach Level 5 for demo access';
    
    if (member && hasAccessToCitadelChannel(member) && checkCitadelRequirementMet(validatedFeedbacks.docs, validatedFeedbacks.comments)) {
        accessLevel = '🏰 **Citadel Channel Access** - Can create own channel';
    } else if (member && hasAccessToBookshelfPosting(member) && checkBookshelfPostRequirementMet(validatedFeedbacks.docs, validatedFeedbacks.comments)) {
        accessLevel = '📚 **Full Bookshelf Access** - Can post demo chapters';
    } else if (member && hasAccessToBookshelfDemo(member)) {
        accessLevel = '📖 **Demo Bookshelf Access** - Can view and give feedback';
    }
    
    return new EmbedBuilder()
        .setTitle(`${user.displayName}'s Literary Progress ☝️`)
        .addFields(
            { name: 'Monthly Feedback', value: `📄 ${monthlyFeedback.docs} docs | 💬 ${monthlyFeedback.comments} comments`, inline: true },
            { name: 'Monthly Quota', value: monthlyRequirementMet ? '✅ Met' : '❌ Not met', inline: true },
            { name: 'Validated Feedbacks', value: `📄 ${validatedFeedbacks.docs} docs | 💬 ${validatedFeedbacks.comments} comments`, inline: true },
            { name: 'Demo Posts Used', value: `📚 ${userRecord.demo_posts || 0}/${BOOKSHELF_DEMO_LIMIT}`, inline: true },
            { name: 'Access Level', value: accessLevel, inline: false },
        )
        .setColor(monthlyRequirementMet ? 0x00AA55 : 0xFF9900);
}

// ===== COLOR ROLE COMMANDS =====

async function handleColorRoleSlashCommand(interaction) {
    const user = interaction.user;
    const member = interaction.member;
    const guild = interaction.guild;
    
    // Check Level 15 requirement
    if (!hasLevel15Role(member)) {
        const embed = new EmbedBuilder()
            .setTitle('Level 15 Required ☝️')
            .setDescription('Color roles are reserved for our most distinguished **Level 15** members.')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // FIXED: Check DOC FEEDBACKS ONLY requirement (not total feedbacks)
    const validatedFeedbacks = await getUserValidatedFeedbacksByType(user.id);
    const docFeedbacks = validatedFeedbacks.docs; // Only count doc feedbacks
    
    if (docFeedbacks < 15) {
        const embed = new EmbedBuilder()
            .setTitle('Insufficient Validated Doc Feedbacks ☝️')
            .addFields({
                name: 'Current Progress',
                value: `• **Level 15**: ✅\n• **Doc Feedbacks**: ${docFeedbacks}/15`,
                inline: false
            },
            {
                name: 'How to Progress',
                value: 'Give quality **full Google Doc reviews** in bookshelf-discussion and Citadel channels, then ask authors to validate with `/feedback_valid` using the "📄 Full Google Doc Review" option.',
                inline: false
            })
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    // Create color selection menu
    const colorOptions = [];
    const colorItems = Object.entries(STORE_ITEMS).filter(([key, item]) => item.category === 'color');
    
    for (const [key, item] of colorItems.slice(0, 25)) { // Discord limit of 25 options
        colorOptions.push({
            label: item.name,
            description: item.description.substring(0, 100), // Discord limit
            value: key,
            emoji: item.emoji
        });
    }
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('color_role_select')
        .setPlaceholder('Choose your color role...')
        .addOptions(colorOptions);
    
    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    const embed = new EmbedBuilder()
        .setTitle('Select Your Color Role ☝️')
        .setDescription(`Congratulations! With **${docFeedbacks} validated doc feedbacks**, you've unlocked access to our color roles.`)
        .addFields({
            name: '🎨 Available Colors',
            value: 'Choose from our collection of distinguished color roles. Your previous color will be automatically replaced.',
            inline: false
        },
        {
            name: '✨ Colors of the Year',
            value: 'Many of these are official Pantone Color of the Year selections from various years.',
            inline: false
        })
        .setColor(0xFFD700);
    
    const response = await interaction.reply({ 
        embeds: [embed], 
        components: [row], 
        ephemeral: true 
    });
    
    // Wait for selection
    try {
        const selection = await response.awaitMessageComponent({ 
            time: 60000 
        });
        
        const selectedColorKey = selection.values[0];
        const selectedColor = STORE_ITEMS[selectedColorKey];
        
        // Check if they already have this color
        const currentlyHasThisColor = member.roles.cache.some(role => role.name === selectedColor.name);
        if (currentlyHasThisColor) {
            const alreadyHasEmbed = new EmbedBuilder()
                .setTitle('Color Already Active ☝️')
                .setDescription(`You already have the **${selectedColor.name}** color role.`)
                .setColor(selectedColor.color);
            
            await selection.update({ embeds: [alreadyHasEmbed], components: [] });
            return;
        }
        
        // Assign the color role
        try {
            await assignColorRole(member, guild, selectedColorKey);
            
            const successEmbed = new EmbedBuilder()
                .setTitle('Color Role Assigned ☝️')
                .addFields({
                    name: 'New Color',
                    value: `${selectedColor.emoji} **${selectedColor.name}**`,
                    inline: true
                },
                {
                    name: 'Achievement',
                    value: `Unlocked with ${docFeedbacks} validated doc feedbacks`,
                    inline: true
                })
                .setColor(selectedColor.color);
            
            await selection.update({ embeds: [successEmbed], components: [] });
            
            // Remove all previous color purchases and add new one
            await removeAllUserColorPurchases(user.id);
            await global.db.addPurchase(user.id, selectedColorKey);
            
        } catch (error) {
            console.error('Color role assignment failed:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('Color Assignment Failed ☝️')
                .setDescription('There was an error assigning your color role. Please try again or contact staff.')
                .setColor(0xFF6B6B);
            
            await selection.update({ embeds: [errorEmbed], components: [] });
        }
        
    } catch (error) {
        console.error('Color selection timeout or error:', error);
        
        const timeoutEmbed = new EmbedBuilder()
            .setTitle('Selection Timeout ☝️')
            .setDescription('Color selection timed out. Please use `/color_role` again to choose your color.')
            .setColor(0xFF6B6B);
        
        try {
            await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
        } catch (editError) {
            console.error('Failed to edit reply after timeout:', editError);
        }
    }
}

// ===== HALL OF FAME COMMANDS =====
async function handleHallOfFameSlashCommand(interaction) {
    const embed = await createHallOfFameEmbed(interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

async function createHallOfFameEmbed(guild) {
    try {
        const topContributors = await global.db.getTopContributors(10);
        
        if (topContributors.length === 0) {
            return new EmbedBuilder()
                .setTitle('Hall of Fame ☝️')
                .setDescription('No validated feedbacks yet. Be the first to give quality feedback and have it validated!')
                .setColor(0x2F3136);
        }
        
        let leaderboard = '';
        for (let i = 0; i < topContributors.length; i++) {
            const contributor = topContributors[i];
            try {
                const member = await guild.members.fetch(contributor.user_id);
                const rank = i + 1;
                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
                leaderboard += `${medal} **${member.displayName}** - ${contributor.total_feedback_all_time} validated feedback${contributor.total_feedback_all_time !== 1 ? 's' : ''}\n`;
            } catch (error) {
                continue;
            }
        }
        
        return new EmbedBuilder()
            .setTitle('Hall of Fame ☝️')
            .setDescription('The most dedicated feedback providers, ranked by validated contributions to our literary community.')
            .addFields({
                name: 'Top Contributors',
                value: leaderboard || 'No qualifying writers found.',
                inline: false
            })
            .setColor(0xFFD700)
            .setFooter({ text: 'Recognition based on validated feedback quality and consistency' });
            
    } catch (error) {
        console.error('Error creating hall of fame:', error);
        return new EmbedBuilder()
            .setTitle('Hall of Fame ☝️')
            .setDescription('Unable to load leaderboard at this time.')
            .setColor(0xFF6B6B);
    }
}

// ===== HELP COMMANDS =====
async function handleHelpSlashCommand(interaction) {
    const embed = createHelpEmbed(interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

function createHelpEmbed(guild) {
    const channels = getClickableChannelMentions(guild);
    const roles = getClickableRoleMentions(guild);
    
    return new EmbedBuilder()
        .setTitle('Essential Commands At Your Service ☝️')
        .addFields(
            { 
                name: '📝 How to Give & Log Feedback', 
                value: `**Step 1:** Give thoughtful feedback in ${channels.bookshelfDiscussion} or Citadel channels. The in-line comment option also entails general discussion of plot, character, etc. outside of a document.\n**Step 2:** Use \`/feedback\` and select your feedback type (Full Doc or Comments)\n**Step 3:** Wait for the author to validate your feedback with \`/feedback_valid\`\n**Step 4:** Earn validated feedback credit!`, 
                inline: false 
            },
            { 
                name: '📊 Monthly Requirements', 
                value: '📄 2 full Google Doc reviews OR\n💬 4 in-line comment feedbacks OR\n1 full Doc + 2 comments', 
                inline: false 
            },
            { 
                name: '🔓 Access Levels', 
                value: `• **${roles.level5}**: Demo bookshelf access (view only)\n• **${roles.level10}** + 2 Google Doc or 4 comment feedbacks: Post 2 demo chapters\n• **${roles.level15}**+ 3 docs OR 5 comments: Own Citadel channel(you must use your username as the channel name)`, 
                inline: false 
            },
            { 
                name: '👤 User Commands', 
                value: '`/progress` - Check your progress and access levels\n`/feedback` - Log your feedback contribution\n`/feedback_valid` - Validate someone\'s feedback (thread owners)\n`/feedback_invalid` - Invalidate/remove validated feedback (thread owners)\n`/citadel_channel` - Create your own channel (Level 15 + validated)\n`/hall_of_fame` - View top contributors\n`/color_role` - Choose a unique color role (Level 15 + 15 validated feedbacks required)', 
                inline: false 
            },
            { 
                name: '👑 For Thread Owners', 
                value: 'When someone gives you feedback, use `/feedback_valid @user type` to validate their contribution type and quality.', 
                inline: false 
            }
        )
        .setColor(0x5865F2)
        .setFooter({ text: 'Quality feedback builds our literary community' });
}

// ===== STAFF COMMANDS =====
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
    
    // Get all Level 5 members
    const level5Members = guild.members.cache.filter(member => hasLevel5Role(member));
    const totalLevel5 = level5Members.size;
    
    let monthlyContributors = 0;
    let fulfillmentList = '';
    let nonFulfillmentList = '';
    let pardonedList = '';
    let pardonedCount = 0;
    
    // Process each member with new feedback system
    for (const [userId, member] of level5Members) {
        const monthlyFeedback = await getUserMonthlyFeedbackByType(userId);
        const meetingRequirement = checkMonthlyRequirementMet(monthlyFeedback.docs, monthlyFeedback.comments);
        const isPardoned = await isUserPardoned(userId);
        const status = meetingRequirement ? '✅' : '❌';
        
        if (meetingRequirement) {
            monthlyContributors++;
            fulfillmentList += `${status} **${member.displayName}** (${monthlyFeedback.docs}D/${monthlyFeedback.comments}C)\n`;
        } else if (isPardoned) {
            pardonedCount++;
            pardonedList += `${status} **${member.displayName}** (${monthlyFeedback.docs}D/${monthlyFeedback.comments}C) - *Pardoned*\n`;
        } else {
            nonFulfillmentList += `${status} **${member.displayName}** (${monthlyFeedback.docs}D/${monthlyFeedback.comments}C)\n`;
        }
    }
    
    const contributionRate = totalLevel5 > 0 ? Math.round((monthlyContributors / totalLevel5) * 100) : 0;
    
    // Combine all details
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
            { name: 'Total Writers', value: `${totalMembers} souls`, inline: true },
            { name: 'Level 5+ Members', value: `${totalLevel5} writers`, inline: true },
            { name: 'Meeting Requirements', value: `${monthlyContributors} writers`, inline: true },
            { name: 'Participation Rate', value: `${contributionRate}%`, inline: true },
            { name: 'Pardoned This Month', value: `${pardonedCount} members`, inline: true },
            { name: 'Community Health', value: contributionRate >= 70 ? '✅ Flourishing' : contributionRate >= 50 ? '⚠️ Moderate' : '🔴 Needs attention', inline: true },
            { 
                name: 'New Requirements', 
                value: `**2 full docs** OR **4 comments** OR **1 doc + 2 comments**\n(D=Docs, C=Comments)`, 
                inline: false 
            },
            { name: 'Detailed Status', value: level5Details, inline: false }
        )
        .setColor(contributionRate >= 70 ? 0x00AA55 : contributionRate >= 50 ? 0xFF9900 : 0xFF4444)
        .setFooter({ text: `New feedback system in effect • ✅ = Meeting requirement • ❌ = Below requirement` });
    
    return embed;
}

// ===== STAFF FEEDBACK MANAGEMENT =====
async function handleFeedbackAddSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const feedbackType = interaction.options.getString('type'); // Get the selected type
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    
    // Add validated feedbacks with the specified type
    for (let i = 0; i < amount; i++) {
        await addValidatedFeedback(user.id, feedbackType, interaction.user.id, 'staff-override');
    }
    
    // Create a more descriptive embed
    const typeDisplay = feedbackType === 'doc' ? '📄 Full Google Doc Review' : '💬 In-line Comments';
    const embed = new EmbedBuilder()
        .setTitle('Validated Feedbacks Added ☝️')
        .setDescription(`Added **${amount}** validated **${typeDisplay}** feedback${amount !== 1 ? 's' : ''} to ${user.displayName}'s record.`)
        .addFields({
            name: 'Added',
            value: `${amount}x ${typeDisplay}`,
            inline: true
        }, {
            name: 'Staff Override',
            value: `Added by ${interaction.user.displayName}`,
            inline: true
        })
        .setColor(0x00AA55);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleFeedbackRemoveSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const feedbackType = interaction.options.getString('type');
    const amount = Math.max(1, interaction.options.getInteger('amount') || 1);
    
    try {
        // First, get current counts
        const currentValidated = await getUserValidatedFeedbacksByType(user.id);
        const currentTotal = currentValidated.docs + currentValidated.comments;
        
        if (currentTotal === 0) {
            const embed = new EmbedBuilder()
                .setTitle('No Feedbacks to Remove ☝️')
                .setDescription(`${user.displayName} has no validated feedbacks to remove.`)
                .setColor(0xFF9900);
            
            return await replyTemporary(interaction, { embeds: [embed] });
        }
        
        // Get the feedbacks that will be removed (so we can update monthly counts)
        let selectQuery, selectParams;
        
        if (feedbackType === 'any') {
            selectQuery = `
                SELECT id, feedback_type, validated_at FROM validated_feedback 
                WHERE user_id = ? 
                ORDER BY validated_at DESC 
                LIMIT ?`;
            selectParams = [user.id, amount];
        } else {
            selectQuery = `
                SELECT id, feedback_type, validated_at FROM validated_feedback 
                WHERE user_id = ? AND feedback_type = ?
                ORDER BY validated_at DESC 
                LIMIT ?`;
            selectParams = [user.id, feedbackType, amount];
        }
        
        // Get the feedbacks to be removed
        const feedbacksToRemove = await global.db.runQuery(selectQuery, selectParams);
        
        if (feedbacksToRemove.length === 0) {
            const typeDisplay = feedbackType === 'any' ? 'Any Type' : 
                              feedbackType === 'doc' ? '📄 Full Google Doc Review' : '💬 In-line Comments';
            
            const embed = new EmbedBuilder()
                .setTitle('No Matching Feedbacks Found ☝️')
                .setDescription(`${user.displayName} has no **${typeDisplay}** feedbacks to remove.`)
                .setColor(0xFF9900);
            
            return await replyTemporary(interaction, { embeds: [embed] });
        }
        
        const actualRemoved = feedbacksToRemove.length;
        
        // Count how many of each type are being removed
        let docsRemoved = 0;
        let commentsRemoved = 0;
        
        for (const feedback of feedbacksToRemove) {
            if (feedback.feedback_type === 'doc') {
                docsRemoved++;
            } else if (feedback.feedback_type === 'comment') {
                commentsRemoved++;
            }
        }
        
        // Remove the feedbacks
        const idsToRemove = feedbacksToRemove.map(f => f.id);
        const placeholders = idsToRemove.map(() => '?').join(',');
        
        await global.db.runSingle(
            `DELETE FROM validated_feedback WHERE id IN (${placeholders})`,
            idsToRemove
        );
        
        // Update total feedback count
        const userData = await getUserData(user.id);
        await updateUserData(user.id, {
            total_feedback_all_time: Math.max(0, userData.total_feedback_all_time - actualRemoved)
        });
        
        // Update monthly feedback counts - reduce from current month
        const monthKey = global.db.getCurrentMonthKey();
        const currentMonthly = await getUserMonthlyFeedbackByType(user.id);
        
        if (docsRemoved > 0 || commentsRemoved > 0) {
            const newDocs = Math.max(0, currentMonthly.docs - docsRemoved);
            const newComments = Math.max(0, currentMonthly.comments - commentsRemoved);
            
            await global.db.runSingle(
                'UPDATE monthly_feedback SET docs = ?, comments = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND month_key = ?',
                [newDocs, newComments, user.id, monthKey]
            );
            
            console.log(`Updated monthly feedback: docs ${currentMonthly.docs} -> ${newDocs}, comments ${currentMonthly.comments} -> ${newComments}`);
        }
        
        // Create response embed
        const typeDisplay = feedbackType === 'any' ? '🔄 Any Type' : 
                          feedbackType === 'doc' ? '📄 Full Google Doc Review' : '💬 In-line Comments';
        
        let removalDetails = '';
        if (feedbackType === 'any') {
            removalDetails = `${docsRemoved} docs + ${commentsRemoved} comments`;
        } else {
            removalDetails = `${actualRemoved}x ${typeDisplay}`;
        }
        
        const embed = new EmbedBuilder()
            .setTitle('Validated Feedbacks Removed ☝️')
            .setDescription(`Removed **${actualRemoved}** validated feedback${actualRemoved !== 1 ? 's' : ''} from ${user.displayName}'s record.`)
            .addFields({
                name: 'Removed',
                value: removalDetails,
                inline: true
            }, {
                name: 'Previous Total',
                value: `${currentTotal} feedbacks`,
                inline: true
            }, {
                name: 'New Total', 
                value: `${currentTotal - actualRemoved} feedbacks`,
                inline: true
            })
            .setColor(0xFF6B6B);
        
        // Add monthly impact if any
        if (docsRemoved > 0 || commentsRemoved > 0) {
            const newMonthlyTotal = Math.max(0, currentMonthly.docs - docsRemoved) + Math.max(0, currentMonthly.comments - commentsRemoved);
            embed.addFields({
                name: 'Monthly Feedback Impact',
                value: `Reduced monthly count by ${docsRemoved} docs + ${commentsRemoved} comments`,
                inline: false
            });
        }
        
        await replyTemporary(interaction, { embeds: [embed] });
        
        // Send DM to user
        try {
            const dmChannel = await user.createDM();
            const dmEmbed = new EmbedBuilder()
                .setTitle('⚠️ Validated Feedbacks Removed')
                .setDescription(`A staff member has removed **${actualRemoved}** validated feedback${actualRemoved !== 1 ? 's' : ''} from your record.`)
                .addFields({
                    name: 'Removed by Staff',
                    value: `${interaction.user.displayName}`,
                    inline: true
                }, {
                    name: 'Type Removed',
                    value: typeDisplay,
                    inline: true
                }, {
                    name: 'Impact',
                    value: `Total feedbacks: ${currentTotal} → ${currentTotal - actualRemoved}`,
                    inline: false
                })
                .setColor(0xFF6B6B);
            
            if (docsRemoved > 0 || commentsRemoved > 0) {
                dmEmbed.addFields({
                    name: 'Monthly Requirement',
                    value: 'Your monthly feedback count has also been reduced. Check `/progress` for current status.',
                    inline: false
                });
            }
            
            await dmChannel.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            console.log('Could not send DM to user about removed feedbacks:', dmError.message);
        }
        
    } catch (error) {
        console.error('Error removing feedbacks:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setTitle('Error Removing Feedbacks ☝️')
            .setDescription('There was an error removing the feedbacks. Please try again.')
            .addFields({
                name: 'Error Details',
                value: `\`\`\`${error.message}\`\`\``,
                inline: false
            })
            .setColor(0xFF6B6B);
        
        await replyTemporary(interaction, { embeds: [errorEmbed] });
    }
}

async function handleFeedbackResetSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    
    try {
        // Remove all validated feedbacks
        await global.db.db.run('DELETE FROM validated_feedback WHERE user_id = ?', [user.id]);
        
        // Remove any pending feedbacks
        await global.db.db.run('DELETE FROM pending_feedback WHERE user_id = ?', [user.id]);
        
        // Reset user progress
        await resetUserProgress(user.id, interaction.guild);
        
        const embed = new EmbedBuilder()
            .setTitle('Complete Feedback Reset ☝️')
            .setDescription(`All validated feedbacks, pending feedbacks, and user progress have been reset for ${user.displayName}.`)
            .setColor(0xFF6B6B);
        
        await replyTemporary(interaction, { embeds: [embed] });
    } catch (error) {
        console.error('Error resetting user:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setTitle('Reset Failed ☝️')
            .setDescription('There was an error resetting the user. Please try again.')
            .setColor(0xFF6B6B);
        
        await replyTemporary(interaction, { embeds: [errorEmbed] });
    }
}

// ===== PARDON COMMANDS =====
async function handlePardonSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const member = interaction.guild.members.cache.get(user.id);
    
    if (await isUserPardoned(user.id)) {
        const embed = new EmbedBuilder()
            .setTitle('Already Pardoned ☝️')
            .setDescription('This member has already been granted clemency for this month\'s requirements.')
            .setColor(0xFF9900);
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
    let reason = 'staff_discretion';
    let reasonDisplay = '👑 Staff Discretion';
    
    if (member && isLateJoiner(member)) {
        reason = 'late_joiner';
        reasonDisplay = '🕐 Late Joiner (Last Week)';
    }
    
    await pardonUser(user.id, reason);
    
    const embed = new EmbedBuilder()
        .setTitle('Pardon Granted ☝️')
        .setDescription(`${user.displayName} has been pardoned from this month's feedback requirements.`)
        .addFields(
            { name: 'Pardon Type', value: reasonDisplay, inline: true },
            { name: 'New Requirement', value: 'Pardoned members are exempt from: **2 docs** OR **4 comments** OR **1 doc + 2 comments**', inline: false }
        )
        .setColor(0x00AA55);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

async function handleUnpardonSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const user = interaction.options.getUser('user');
    const monthKey = getCurrentMonthKey();
    
    const success = await global.db.removePardon(user.id, monthKey);
    
    if (success) {
        const embed = new EmbedBuilder()
            .setTitle('Pardon Revoked ☝️')
            .setDescription(`The clemency granted to **${user.displayName}** has been rescinded.`)
            .setColor(0xFF6B6B);
        
        await replyTemporary(interaction, { embeds: [embed] });
    } else {
        const embed = new EmbedBuilder()
            .setTitle('No Pardon Found ☝️')
            .setDescription('This member currently holds no pardon for this month\'s requirements.')
            .setColor(0xFF9900);
        
        await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
}

async function handlePardonedLastMonthSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const lastMonthKey = getLastMonthKey();
    const pardonedUsers = await global.db.getPardonedUsersForMonth(lastMonthKey);
    
    if (pardonedUsers.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('No Pardons Last Month ☝️')
            .setDescription('No members were granted clemency last month.')
            .setColor(0x2F3136);
        
        return await replyTemporary(interaction, { embeds: [embed] });
    }
    
    let pardonList = '';
    for (const record of pardonedUsers.slice(0, 20)) {
        try {
            const member = await interaction.guild.members.fetch(record.user_id);
            const reasonDisplay = record.reason === 'late_joiner' ? '🕐' : '👑';
            pardonList += `${reasonDisplay} **${member.displayName}**\n`;
        } catch (error) {
            pardonList += `${record.reason === 'late_joiner' ? '🕐' : '👑'} *[Left Server]*\n`;
        }
    }
    
    const embed = new EmbedBuilder()
        .setTitle('Pardoned Members - Last Month ☝️')
        .addFields({
            name: `Total Pardoned: ${pardonedUsers.length}`,
            value: pardonList || 'No pardoned members found.',
            inline: false
        })
        .setColor(0x00AA55)
        .setFooter({ text: '👑 = Staff Discretion • 🕐 = Late Joiner' });
    
    await replyTemporary(interaction, { embeds: [embed] });
}

function isLateJoiner(member) {
    if (!member.joinedAt) return false;
    
    const now = new Date();
    const adjustedNow = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const lastDayOfMonth = new Date(adjustedNow.getFullYear(), adjustedNow.getMonth() + 1, 0);
    const oneWeekBeforeEnd = new Date(lastDayOfMonth.getTime() - (7 * 24 * 60 * 60 * 1000));
    
    return member.joinedAt >= oneWeekBeforeEnd;
}

// ===== SETUP BOOKSHELF COMMAND =====
async function handleSetupBookshelfSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const embed = new EmbedBuilder()
        .setTitle('Bookshelf System Deprecated ☝️')
        .setDescription('The old bookshelf purchase system has been replaced with automatic progression.')
        .addFields({
            name: 'New System',
            value: '• **Level 5**: Demo bookshelf access\n• **Level 10 + 2 Google Doc or 4 comment feedbacks**: Post demo chapters\n• **Level 15 + 3 validated feedbacks**: Own Citadel channel',
            inline: false
        })
        .setColor(0xFF9900);
    
    await replyTemporary(interaction, { embeds: [embed] });
}

// ===== PURGE COMMANDS =====
async function handlePurgeListSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    const embed = await createPurgeListEmbed(interaction.guild);
    await replyTemporary(interaction, { embeds: [embed] });
}

async function createPurgeListEmbed(guild) {
    const allMembers = await guild.members.fetch();
    const level5Members = allMembers.filter(member => hasLevel5Role(member));
    
    let purgeList = '';
    let purgeCount = 0;
    
    for (const [userId, member] of level5Members) {
        const monthlyFeedback = await getUserMonthlyFeedbackByType(userId);
        const isPardoned = await isUserPardoned(userId);
        const meetingRequirement = checkMonthlyRequirementMet(monthlyFeedback.docs, monthlyFeedback.comments);
        
        if (!meetingRequirement && !isPardoned && !isProtectedFromPurge(member)) {
            purgeCount++;
            if (purgeList.length < 900) {
                purgeList += `❌ **${member.displayName}** (${monthlyFeedback.docs}D/${monthlyFeedback.comments}C)\n`;
            }
        }
    }
    
    const embed = new EmbedBuilder()
        .setTitle('Monthly Purge List ☝️')
        .addFields({
            name: `🔥 To be Purged (${purgeCount})`,
            value: purgeList || '• None scheduled for purge',
            inline: false
        })
        .setColor(purgeCount > 0 ? 0xFF4444 : 0x00AA55)
        .setFooter({ text: 'Monthly requirement: 2 docs OR 4 comments OR 1 doc + 2 comments' });
    
    return embed;
}

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
            role.name.toLowerCase() === protectedRole.toLowerCase()
        )
    );
}

async function handleManualPurgeSlashCommand(interaction) {
    if (!hasStaffPermissions(interaction.member)) {
        return await sendStaffOnlyMessage(interaction, true);
    }
    
    await interaction.deferReply();
    
    const result = await performManualPurge(interaction.guild);
    const embed = createManualPurgeResultEmbed(result, interaction.guild);
    
    await interaction.editReply({ embeds: [embed] });
}

async function performManualPurge(guild) {
    const allMembers = await guild.members.fetch();
    let purgedMembers = [];
    let failedKicks = [];
    let protectedMembers = [];
    
    for (const [userId, member] of allMembers) {
        if (!hasLevel5Role(member)) continue;
        
        const monthlyFeedback = await getUserMonthlyFeedbackByType(userId);
        const isPardoned = await isUserPardoned(userId);
        const meetingRequirement = checkMonthlyRequirementMet(monthlyFeedback.docs, monthlyFeedback.comments);
        
        if (!meetingRequirement && !isPardoned) {
            if (isProtectedFromPurge(member)) {
                protectedMembers.push({
                    displayName: member.displayName,
                    id: userId,
                    docs: monthlyFeedback.docs,
                    comments: monthlyFeedback.comments,
                    reason: 'Staff/Admin permissions'
                });
                continue;
            }
            
            try {
                await member.kick(`Monthly purge - Failed to meet new feedback requirement (${monthlyFeedback.docs} docs, ${monthlyFeedback.comments} comments)`);
                purgedMembers.push({
                    displayName: member.displayName,
                    id: userId,
                    docs: monthlyFeedback.docs,
                    comments: monthlyFeedback.comments
                });
                
                await resetUserProgress(userId, guild);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                failedKicks.push({
                    displayName: member.displayName,
                    id: userId,
                    error: error.message
                });
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
    
    let purgedList = '';
    if (purgedMembers.length > 0) {
        purgedList = purgedMembers.slice(0, 10).map(member => 
            `• **${member.displayName}** (${member.docs}D/${member.comments}C)`
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
            `• **${member.displayName}** (${member.docs}D/${member.comments}C) - ${member.reason}`
        ).join('\n');
        
        if (protectedMembers.length > 5) {
            protectedList += `\n• *...and ${protectedMembers.length - 5} more*`;
        }
    } else {
        protectedList = '• No protected members found';
    }
    
    const embed = new EmbedBuilder()
        .setTitle('Manual Purge Completed ☝️')
        .setDescription('The monthly purge has been executed with the new feedback requirements.')
        .addFields(
            { name: `🔥 Successfully Purged (${totalPurged})`, value: purgedList, inline: false },
            { name: `🛡️ Protected from Purge (${totalProtected})`, value: protectedList, inline: false }
        )
        .setColor(totalFailed === 0 ? 0x00AA55 : 0xFF9900)
        .setTimestamp();
    
    if (totalFailed > 0) {
        let failedList = failedKicks.slice(0, 5).map(member => 
            `• **${member.displayName}** - ${member.error}`
        ).join('\n');
        
        if (failedKicks.length > 5) {
            failedList += `\n• *...and ${failedKicks.length - 5} more failures*`;
        }
        
        embed.addFields(
            { name: `Failed to Purge (${totalFailed})`, value: failedList, inline: false }
        );
    }
    
    embed.setFooter({ 
        text: `New requirements: 2 docs OR 4 comments OR 1 doc + 2 comments • ${totalPurged} removed • ${totalProtected} protected • ${totalFailed} failed • (D=Docs, C=Comments)` 
    });
    
    return embed;
}

// ===== POST RULES AND SERVER GUIDE =====
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
                value: `Upon earning access to our literary forums, you may participate in feedback exchange. New members must reach ${roles.level5} and provide **2 validated doc feedbacks OR 4 comment feedbacks OR 1 doc + 2 comment feedbacks** monthly. This ensures our community\'s integrity and meaningful contribution.`,
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

async function postServerGuide(channel) {
    const guild = channel.guild;
    const channels = getClickableChannelMentions(guild);
    const roles = getClickableRoleMentions(guild);

    const embed = new EmbedBuilder()
        .setTitle('Type&Draft Literary Community Guide ☝️')
        .addFields(
            {
                name: '🏛️ Welcome Halls',
                value: `${channels.reactionRoles} - Claim your roles with a simple reaction\n${channels.rulesChannel} - Our community covenant (read thoroughly)\n${channels.introductions} - Present yourself to our distinguished assembly\n${channels.bump} - Support our growth with \`/bump\``,
                inline: false
            },
            {
                name: '🏰 Courts',
                value: `${channels.ticket} - Private counsel with our esteemed staff\n${channels.botStuff} - Use the \`/help\` command to learn about our new feedback system`,
                inline: false
            },
            {
                name: '🍺 The Tavern',
                value: '• Quarters for discussion concerning daily life, hobbies, and interests',
                inline: false
            },
            {
                name: '✍️ Scriptorium',
                value: `${channels.writingChat} - General discourse on the craft\n${channels.writingHelp} - Community guidance for literary questions\n${channels.onePageCritique} - Submit short excerpts for detailed feedback\n${channels.snippetShowcase} - Display your finest work for admiration`,
                inline: false
            },
            {
                name: '🎪 Circus',
                value: `${channels.triggered} - Use a popular pictogram to share your most controversial writing opinions\n${channels.bookshelfMemes} - Share humorous jests about the works of your fellow scribes`,
                inline: false
            },
            {
                name: '📚 The Citadel',
                value: `**${roles.level5}** required for all feedback activities:\n${channels.bookshelfDiscussion} - Give thorough critique and use \`/feedback\` to log contributions\n${channels.bookshelf} - Demo area for **${roles.level10}** members with 2 validated feedbacks (2 posts max)\n• Personal channels**(NAMED AFTER OWN USERNAME)** for **${roles.level15}** members with 3+ additional validated feedbacks`,
                inline: false
            },
            {
                name: '🎯 Progression System',
                value: `• **${roles.level5}**: Access feedback forums\n• **${roles.level10}** + 2 Google Doc or 4 comment feedbacks: Post 2 demo chapters\n• **${roles.level15}** + 3 additional validated feedbacks: Own unlimited Citadel channel\n• **Monthly requirement**: 2 doc feedbacks OR 4 comment feedbacks OR 1 doc + 2 comments`,
                inline: false
            }
        )
        .setColor(0xFF8C00)
        .setFooter({ text: 'Quality feedback builds our thriving literary community' });

    await channel.send({ embeds: [embed] });
}

// ===== COMMANDS COMMAND =====
async function handleCommandsSlashCommand(interaction) {
    const embed = createAllCommandsEmbed();
    await replyTemporary(interaction, { embeds: [embed] });
}

function createAllCommandsEmbed() {
    return new EmbedBuilder()
        .setTitle('Staff Commands Directory ☝️')
        .addFields(
            { 
                name: '👑 New Feedback Management', 
                value: '`/feedback_add` - Add validated feedbacks to a user\n`/feedback_remove` - Remove validated feedbacks from a user\n`/feedback_reset` - Complete reset (includes validated feedbacks)\n`/stats` - View detailed server statistics with new system', 
                inline: false 
            },
            { 
                name: '👑 Server Administration', 
                value: '`/pardon` - Pardon a member from monthly feedback requirement\n`/unpardon` - Remove pardon from a member\n`/pardoned_last_month` - View last month\'s pardoned members\n`/purge_list` - View members who would be purged\n`/manual_purge` - Execute manual purge with new requirements\n`/post_server_guide` - Post updated server guide\n`/post_rules` - Post server rules', 
                inline: false 
            },
            { 
                name: '📊 Requirements', 
                value: '**Monthly quota**: 2 full docs OR 4 comments OR 1 doc + 2 comments\n**Access levels**: Level-based progression with validated feedback requirements', 
                inline: false 
            }
        )
        .setColor(0x2F3136)
        .setFooter({ text: 'Updated for new validated feedback system' });
}

// ===== FUN COMMANDS =====
async function getFacelessCooldown(userId) {
    return await global.db.getFacelessCooldown(userId);
}

async function setFacelessCooldown(userId) {
    await global.db.setFacelessCooldown(userId);
}

async function isOnFacelessCooldown(userId) {
    const lastUsed = await getFacelessCooldown(userId);
    const cooldownTime = 5 * 60 * 1000;
    const timeRemaining = (lastUsed + cooldownTime) - Date.now();
    
    if (timeRemaining > 0) {
        return {
            onCooldown: true,
            timeRemaining: Math.ceil(timeRemaining / 1000)
        };
    }
    
    return { onCooldown: false };
}

async function handleFacelessSlashCommand(interaction) {
    const userId = interaction.user.id;
    const confession = interaction.options.getString('confession');
    
    if (!hasLevel15Role(interaction.member)) {
        const embed = new EmbedBuilder()
            .setTitle(`**Level 15** Required ☝️`)
            .setDescription('The Many-Faced God only speaks with those who have proven their dedication to our literary realm.')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }
    
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
    
    const facelessPostscripts = [
        "A writer has no name, but has many secrets.",
        "The Many-Faced God hears all confessions.",
        "What is written in shadow need not burden the light.",
        "A secret shared is a burden halved, a name forgotten.",
        "The House of Black and White keeps all truths."
    ];
    
    const randomPostscript = facelessPostscripts[Math.floor(Math.random() * facelessPostscripts.length)];
    
    const confessionEmbed = new EmbedBuilder()
        .setTitle('🎭 Anonymous Confession 🎭')
        .setDescription(`*"${confession}"*`)
        .setColor(0x000000)
        .setFooter({ text: randomPostscript })
        .setTimestamp();
    
    try {
        const confessionMessage = await interaction.channel.send({ embeds: [confessionEmbed] });
        await setFacelessCooldown(userId);
        
        const confirmEmbed = new EmbedBuilder()
            .setTitle('🎭 Confession Delivered')
            .setDescription('Your words have been whispered to the shadows. No trace remains.')
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

async function handleShameSlashCommand(interaction) {
    const userId = interaction.user.id;
    const targetUser = interaction.options.getUser('target');
    const reason = interaction.options.getString('reason');
    
    if (!hasLevel15Role(interaction.member)) {
        const embed = new EmbedBuilder()
            .setTitle('Level 15 Required ☝️')
            .setDescription('Lord Varys only serves those who have proven their dedication to our literary realm.')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }

    if (targetUser.id === userId) {
        const embed = new EmbedBuilder()
            .setTitle('Self-Shaming Forbidden ☝️')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }

    if (targetUser.bot) {
        const embed = new EmbedBuilder()
            .setTitle('Bots Are Beyond Shame ☝️')
            .setColor(0xFF9900);
        
        return await replyTemporary(interaction, { embeds: [embed], ephemeral: true });
    }

    await interaction.deferReply();

    try {
        const imageUrl = 'https://media.giphy.com/media/Ob7p7lDT99cd2/giphy.gif';
        
        const shameEmbed = new EmbedBuilder()
            .setColor(0x8B0000)
            .setTitle('🔔 THE WALK OF SHAME 🔔')
            .addFields(
                { 
                    name: '⚔️ Accused by', 
                    value: `${interaction.user}`, 
                    inline: true 
                },
                { 
                    name: '👑 Condemned', 
                    value: `${targetUser}`, 
                    inline: true 
                },
                { 
                    name: '🔔 Royal Decree', 
                    value: '*Shame! Shame! Shame!*', 
                    inline: true 
                }
            )
            .setImage(imageUrl)
            .setFooter({ 
                text: 'Lord Varys, Master of Whisperers • The Crown remembers',
            })
            .setTimestamp();

        if (reason) {
            shameEmbed.addFields({
                name: '📜 Crime Against the Realm',
                value: `*"${reason}"*`,
                inline: false
            });
        }

        await interaction.editReply({ 
            content: `${targetUser} 🔔 **SHAME!**`,
            embeds: [shameEmbed] 
        });
        
    } catch (error) {
        console.error('Error posting Varys shame bell:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setTitle('The Little Birds Have Failed ☝️')
            .setDescription('Lord Varys\' network has encountered difficulties. Please try again.')
            .setColor(0xFF6B6B);
        
        await interaction.editReply({ embeds: [errorEmbed] });
    }
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
        .setDescription('I regret that an unforeseen complication has arisen while processing your request.')
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

// ===== BOT LOGIN =====
client.login(process.env.DISCORD_BOT2_TOKEN);

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
