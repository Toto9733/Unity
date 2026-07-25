import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, MessageFlags, ComponentType, EmbedBuilder, LabelBuilder, CheckboxBuilder, TextDisplayBuilder } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { createError, TitanBotError, ErrorTypes, replyUserError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createReactionRoleMessage, hasDangerousPermissions, getAllReactionRoleMessages, deleteReactionRoleMessage } from '../../services/reactionRoleService.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import {
    getReactionRolePanelStatus,
    formatPanelStatusField,
} from '../../utils/panelStatus.js';
import { startDashboardSession } from '../../utils/dashboardSession.js';
import { getReactionRoleKey } from '../../utils/database/keys.js';

const DASHBOARD_EPHEMERAL = MessageFlags.Ephemeral;
const SELECT_OPTION_LABEL_LIMIT = 100;
const SELECT_OPTION_DESCRIPTION_LIMIT = 100;

function truncateText(value, maxLength) {
    const text = String(value ?? '');
    return text.length > maxLength ? text.substring(0, maxLength) : text;
}

export default {
    data: new SlashCommandBuilder()
        .setName('reactroles')
        .setDescription('Gérer l\'attribution des rôles par réaction')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Configurer un nouveau panneau de rôles par réaction')
                .addChannelOption(option => 
                    option.setName('channel')
                        .setDescription('Le salon où envoyer le message de rôles par réaction')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('title')
                        .setDescription('Titre du panneau de rôles par réaction')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('Description du panneau de rôles par réaction')
                        .setRequired(true)
                )
                .addRoleOption(option =>
                    option.setName('role1')
                        .setDescription('Premier rôle à ajouter')
                        .setRequired(true)
                )
                .addRoleOption(option =>
                    option.setName('role2')
                        .setDescription('Deuxième rôle à ajouter')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('role3')
                        .setDescription('Troisième rôle à ajouter')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('role4')
                        .setDescription('Quatrième rôle à ajouter')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('role5')
                        .setDescription('Cinquième rôle à ajouter')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('dashboard')
                .setDescription('Gérer et configurer vos panneaux de rôles par réaction')
                .addStringOption(option =>
                    option
                        .setName('panel')
                        .setDescription('Sélectionner un panneau de rôles par réaction à gérer')
                        .setRequired(false)
                        .setAutocomplete(true)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'setup') {
            await handleSetup(interaction);
        } else if (subcommand === 'dashboard') {
            const selectedPanelId = interaction.options.getString('panel');
            await handleDashboard(interaction, selectedPanelId);
        }
    },

    async autocomplete(interaction) {
        if (interaction.commandName !== 'reactroles') return;
        if (interaction.options.getSubcommand() !== 'dashboard') return;

        try {
            const guildId = interaction.guild.id;
            const client = interaction.client;
            const guild = interaction.guild;

            let panels;
            try {
                panels = await getAllReactionRoleMessages(client, guildId);
            } catch {
                await interaction.respond([]).catch(() => {});
                return;
            }

            if (!panels?.length) {
                await interaction.respond([]).catch(() => {});
                return;
            }

            const choices = [];
            for (const panel of panels) {
                if (!panel.messageId || !panel.channelId) continue;

                const channel = guild.channels.cache.get(panel.channelId);
                if (!channel) continue;

                const cachedTitle = channel.messages?.cache?.get(panel.messageId)?.embeds?.[0]?.title;
                const roleCount = Array.isArray(panel.roles) ? panel.roles.length : 0;
                const label = cachedTitle
                    ? `${cachedTitle} (#${channel.name})`
                    : `#${channel.name} · ${roleCount} rôle${roleCount === 1 ? '' : 's'}`;

                choices.push({ name: label.substring(0, 100), value: panel.messageId });
                if (choices.length >= 25) break;
            }

            await interaction.respond(choices).catch(() => {});
        } catch {
            await interaction.respond([]).catch(() => {});
        }
    }
};

async function handleSetup(interaction) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) return;
    
    logger.info(`Configuration des rôles par réaction initiée par ${interaction.user.tag} sur le serveur ${interaction.guild.name}`);
    
    const channel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');

    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
        throw createError(
            `Type de salon invalide : ${channel.type}`,
            ErrorTypes.VALIDATION,
            'Veuillez sélectionner un salon textuel ou d\'annonces.',
            { channelType: channel.type }
        );
    }

    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw createError(
            'Permission Gérer les rôles manquante pour le bot',
            ErrorTypes.PERMISSION,
            'J\'ai besoin de la permission "Gérer les rôles" pour configurer les rôles par réaction.',
            { permission: 'ManageRoles' }
        );
    }
    
    if (!channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
        throw createError(
            `Le bot ne peut pas envoyer de messages dans ${channel.name}`,
            ErrorTypes.PERMISSION,
            `Je n'ai pas la permission d'envoyer des messages dans ${channel}.`,
            { channelId: channel.id }
        );
    }

    const existingPanels = await getAllReactionRoleMessages(interaction.client, interaction.guildId);
    if (existingPanels && existingPanels.length >= 5) {
        throw createError(
            'Limite de panneaux atteinte',
            ErrorTypes.VALIDATION,
            'Votre serveur a atteint le maximum de 5 panneaux de rôles par réaction. Supprimez un panneau existant pour en créer un nouveau.',
            { maxPanels: 5, currentPanels: existingPanels.length }
        );
    }

    const roles = [];
    const roleValidationErrors = [];
    const seenRoleIds = new Set();
    
    for (let i = 1; i <= 5; i++) {
        const role = interaction.options.getRole(`role${i}`);
        if (role) {
            if (seenRoleIds.has(role.id)) {
                roleValidationErrors.push(`**${role.name}** - Ce rôle a été sélectionné plusieurs fois`);
                continue;
            }

            if (role.position >= interaction.guild.members.me.roles.highest.position) {
                roleValidationErrors.push(`**${role.name}** - Le rôle de mon bot est positionné plus bas que ce rôle dans la hiérarchie et ne peut pas l'attribuer`);
                continue;
            }
            
            if (hasDangerousPermissions(role)) {
                roleValidationErrors.push(`**${role.name}** - Ce rôle possède des permissions dangereuses (Administrateur, Gérer le serveur, etc.)`);
                continue;
            }
            
            if (role.managed) {
                roleValidationErrors.push(`**${role.name}** - C'est un rôle géré (rôle d'intégration/bot)`);
                continue;
            }
            
            if (role.id === interaction.guild.id) {
                roleValidationErrors.push(`**${role.name}** - Impossible d'utiliser le rôle @everyone`);
                continue;
            }
            
            seenRoleIds.add(role.id);
            roles.push(role);
        }
    }
    
    if (roleValidationErrors.length > 0) {
        const errorMsg = `Les rôles suivants ne peuvent pas être ajoutés :\n${roleValidationErrors.join('\n')}`;
        
        if (roles.length === 0) {
            throw createError(
                'Aucun rôle valide fourni',
                ErrorTypes.VALIDATION,
                errorMsg,
                { errors: roleValidationErrors }
            );
        }
        
        await interaction.followUp({
            embeds: [warningEmbed('Avertissement de validation des rôles', errorMsg)],
            flags: MessageFlags.Ephemeral
        });
    }

    if (roles.length < 1) {
        throw createError(
            'Aucun rôle fourni',
            ErrorTypes.VALIDATION,
            'Vous devez fournir au moins un rôle valide.',
            {}
        );
    }

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('reaction_roles')
            .setPlaceholder('Sélectionnez vos rôles')
            .setMinValues(0)
            .setMaxValues(roles.length)
            .addOptions(
                roles.map(role => ({
                    label: truncateText(role.name, SELECT_OPTION_LABEL_LIMIT),
                    description: truncateText(`Ajouter/retirer le rôle ${role.name}`, SELECT_OPTION_DESCRIPTION_LIMIT),
                    value: role.id,
                    emoji: '🎭'
                }))
            )
    );

    const panelEmbed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(getColor('info'))
        .addFields({
            name: 'Rôles disponibles',
            value: roles.map(role => `• ${role}`).join('\n')
        })
        .setFooter({ text: 'Sélectionnez vos rôles dans le menu déroulant ci-dessous' });

    const message = await channel.send({
        embeds: [panelEmbed],
        components: [row]
    });

    const roleIds = roles.map(role => role.id);
    try {
        await createReactionRoleMessage(
            interaction.client,
            interaction.guildId,
            channel.id,
            message.id,
            roleIds
        );
    } catch (saveError) {
        await message.delete().catch(() => {});
        throw saveError;
    }

    logger.info(`Message de rôles par réaction créé : ${message.id} avec ${roles.length} rôles par ${interaction.user.tag}`);

    try {
        await logEvent({
            client: interaction.client,
            guildId: interaction.guildId,
            eventType: EVENT_TYPES.REACTION_ROLE_CREATE,
            data: {
                description: `Panneau de rôles par réaction créé par ${interaction.user.tag}`,
                userId: interaction.user.id,
                channelId: channel.id,
                fields: [
                    {
                        name: 'Titre',
                        value: title,
                        inline: false
                    },
                    {
                        name: 'Salon',
                        value: channel.toString(),
                        inline: true
                    },
                    {
                        name: 'Rôles',
                        value: `${roles.length} rôles`,
                        inline: true
                    },
                    {
                        name: 'Liste des rôles',
                        value: roles.map(r => r.toString()).join(','),
                        inline: false
                    },
                    {
                        name: 'Lien du message',
                        value: message.url,
                        inline: false
                    }
                ]
            }
        });
    } catch (logError) {
        logger.warn('Échec de l\'enregistrement de la création du rôle par réaction :', logError);
    }

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [successEmbed('Succès', `✅ Panneau de rôles par réaction créé dans ${channel} !\n\n${message.url}`)]
    });
}

async function fetchPanelDiscordMessage(guild, panelData) {
    try {
        const channel = guild.channels.cache.get(panelData.channelId);
        if (!channel) return null;
        return await channel.messages.fetch(panelData.messageId).catch(() => null);
    } catch {
        return null;
    }
}

async function rebuildLivePanelMessage(guild, panelData) {
    try {
        const channel = guild.channels.cache.get(panelData.channelId);
        if (!channel) return;
        const msg = await channel.messages.fetch(panelData.messageId).catch(() => null);
        if (!msg || !msg.embeds[0]) return;

        const roleObjects = panelData.roles
            .map(id => guild.roles.cache.get(id))
            .filter(Boolean);

        if (roleObjects.length === 0) return;

        const currentEmbed = msg.embeds[0];
        const updatedEmbed = EmbedBuilder.from(currentEmbed);
        const fields = currentEmbed.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
        const roleFieldIdx = fields.findIndex(f => f.name === 'Available Roles' || f.name === 'Rôles disponibles');
        const newRoleValue = roleObjects.map(r => `• ${r}`).join('\n');
        if (roleFieldIdx !== -1) {
            fields[roleFieldIdx] = { name: 'Rôles disponibles', value: newRoleValue, inline: false };
        } else {
            fields.push({ name: 'Rôles disponibles', value: newRoleValue, inline: false });
        }
        updatedEmbed.setFields(fields);

        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('reaction_roles')
                .setPlaceholder('Sélectionnez vos rôles')
                .setMinValues(0)
                .setMaxValues(roleObjects.length)
                .addOptions(
                    roleObjects.map(r => ({
                        label: r.name.substring(0, 100),
                        description: `Ajouter/retirer le rôle ${r.name}`.substring(0, 100),
                        value: r.id,
                        emoji: '🎭',
                    })),
                ),
        );

        await msg.edit({ embeds: [updatedEmbed], components: [selectRow] });
    } catch (error) {
        logger.warn('Impossible de reconstruire le panneau de rôles par réaction en direct :', error.message);
    }
}

async function showPanelDashboard(interaction, panelData, discordMsg, guildId, guild, client, panelStatus = null) {
    if (!panelStatus && client) {
        panelStatus = await getReactionRolePanelStatus(client, guild, panelData);
        if (panelStatus.recoveredId) {
            await migrateReactionRoleMessageId(client, guildId, panelData, panelStatus.recoveredId);
            discordMsg = panelStatus.message || discordMsg;
        }
    }

    const payload = buildReactionRoleDashboardPayload(panelData, discordMsg, guildId, guild, panelStatus);
    await InteractionHelper.safeEditReply(interaction, { ...payload, flags: DASHBOARD_EPHEMERAL });
}

function buildReactionRoleDashboardPayload(panelData, discordMsg, guildId, guild, panelStatus = null) {
    const channel = guild.channels.cache.get(panelData.channelId);
    const title = discordMsg?.embeds?.[0]?.title ?? 'Panneau sans titre';
    const roleList =
        panelData.roles.length > 0
            ? panelData.roles.map(id => `<@&${id}>`).join(',')
            : '`Aucun`';

    const showRepost = panelStatus?.exists === false && panelStatus?.reason === 'panel_deleted';

    const embed = new EmbedBuilder()
        .setTitle('Tableau de bord des rôles par réaction')
        .setDescription(
            `**Titre :** ${title}\n\nSélectionnez une option ci-dessous pour modifier un paramètre.${discordMsg ? `\n[Cliquez ici pour voir le panneau](${discordMsg.url})` : ''}`,
        )
        .setColor(getColor('info'))
        .addFields(
            { name: 'Statut du panneau', value: formatPanelStatusField(panelStatus), inline: false },
            { name: 'Salon', value: channel ? `<#${channel.id}>` : '`Introuvable`', inline: true },
            { name: 'Rôles', value: `\`${panelData.roles.length} / 25\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Liste des rôles', value: roleList, inline: false },
        )
        .setFooter({ text: 'Le tableau de bord se ferme après 10 minutes d\'inactivité' })
        .setTimestamp();

    const buttons = [];

    if (showRepost) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`rr_repost_${guildId}`)
                .setLabel('Republication du panneau')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📌'),
        );
    }

    buttons.push(
        new ButtonBuilder()
            .setCustomId(`rr_edit_text_${guildId}`)
            .setLabel('Modifier le texte')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('✏️'),
        new ButtonBuilder()
            .setCustomId(`rr_delete_${guildId}`)
            .setLabel('Supprimer le panneau')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️'),
    );

    const optionsSelect = new StringSelectMenuBuilder()
        .setCustomId(`rr_opts_${guildId}`)
        .setPlaceholder('Sélectionnez une action...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Ajouter un rôle')
                .setDescription('Ajouter un rôle à ce panneau (jusqu\'à 25 au total)')
                .setValue('add_role')
                .setEmoji('➕'),
            ...(panelData.roles.length > 0
                ? [
                      new StringSelectMenuOptionBuilder()
                          .setLabel('Retirer un rôle')
                          .setDescription('Retirer un rôle de ce panneau')
                          .setValue('remove_role')
                          .setEmoji('➖'),
                  ]
                : []),
        );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(buttons),
            new ActionRowBuilder().addComponents(optionsSelect),
        ],
    };
}

async function migrateReactionRoleMessageId(client, guildId, panelData, newMessageId) {
    if (!newMessageId || panelData.messageId === newMessageId) return;
    const oldKey = getReactionRoleKey(guildId, panelData.messageId);
    panelData.messageId = newMessageId;
    await client.db.set(getReactionRoleKey(guildId, newMessageId), panelData);
    await client.db.delete(oldKey).catch(() => {});
}

async function repostReactionRolePanel(guild, panelData, client, guildId, fallbackEmbed = null) {
    const channel = await guild.channels.fetch(panelData.channelId).catch(() => null);
    if (!channel) {
        throw createError(
            'Panel channel missing',
            ErrorTypes.CONFIGURATION,
            // 🔄 Traduit : "Le salon du panneau configuré n'existe plus."
            'Le salon du panneau configuré n\'existe plus.',
        );
    }

    const roleObjects = panelData.roles.map(id => guild.roles.cache.get(id)).filter(Boolean);
    if (roleObjects.length === 0) {
        throw createError(
            'No valid roles',
            ErrorTypes.VALIDATION,
            // 🔄 Traduit : "Ce panneau ne contient plus de rôles valides à republier."
            'Ce panneau ne contient plus de rôles valides à republier.',
        );
    }

    // 🔄 Traduit par défaut : "Rôles par réaction" et "Sélectionnez vos rôles via le menu ci-dessous."
    const title = fallbackEmbed?.title || 'Rôles par réaction';
    const description = fallbackEmbed?.description || 'Sélectionnez vos rôles via le menu ci-dessous.';

    const panelEmbed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(getColor('info'))
        .addFields({
            // 🔄 Traduit : "Rôles disponibles"
            name: 'Rôles disponibles',
            value: roleObjects.map(role => `• ${role}`).join('\n'),
        });

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('reaction_roles')
            // 🔄 Traduit : "Sélectionnez vos rôles"
            .setPlaceholder('Sélectionnez vos rôles')
            .setMinValues(0)
            .setMaxValues(roleObjects.length)
            .addOptions(
                roleObjects.map(role => ({
                    label: role.name.substring(0, 100),
                    // 🔄 Traduit : "Ajouter/retirer le rôle [Nom]"
                    description: `Ajouter/retirer le rôle ${role.name}`.substring(0, 100),
                    value: role.id,
                    emoji: '🎭',
                })),
            ),
    );

    const sent = await channel.send({ embeds: [panelEmbed], components: [row] });
    await migrateReactionRoleMessageId(client, guildId, panelData, sent.id);
    return sent;
}

async function handleDashboard(interaction, selectedPanelId) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: DASHBOARD_EPHEMERAL });
    if (!deferSuccess) return;

    const client = interaction.client;
    const guildId = interaction.guild.id;
    const guild = interaction.guild;

    const panels = await getAllReactionRoleMessages(client, guildId);
    if (!panels?.length) {
        throw createError(
            'No panels',
            ErrorTypes.CONFIGURATION,
            // 🔄 Traduit : "Aucun panneau de rôles par réaction trouvé. Utilisez d'abord `/reactroles setup`."
            'Aucun panneau de rôles par réaction trouvé. Utilisez d\'abord `/reactroles setup`.',
        );
    }

    let panelData = selectedPanelId ? panels.find(p => p.messageId === selectedPanelId) : null;
    if (!panelData) {
        if (panels.length === 1) {
            panelData = panels[0];
        } else {
            throw createError(
                'Panel required',
                ErrorTypes.VALIDATION,
                // 🔄 Traduit : "Plusieurs panneaux existent. Choisissez-en un en utilisant l'option **panel**."
                'Plusieurs panneaux existent. Choisissez-en un en utilisant l\'option **panel**.',
            );
        }
    }

    let panelStatus = await getReactionRolePanelStatus(client, guild, panelData);
    if (panelStatus.recoveredId) {
        await migrateReactionRoleMessageId(client, guildId, panelData, panelStatus.recoveredId);
        panelStatus = await getReactionRolePanelStatus(client, guild, panelData);
    }

    const discordMsg = panelStatus.message || (await fetchPanelDiscordMessage(guild, panelData));
    const payload = buildReactionRoleDashboardPayload(panelData, discordMsg, guildId, guild, panelStatus);

    await startDashboardSession({
        interaction,
        ...payload,
        flags: DASHBOARD_EPHEMERAL,
        selectMenuId: `rr_opts_${guildId}`,
        buttonMatcher: (customId) =>
            customId === `rr_edit_text_${guildId}` ||
            customId === `rr_delete_${guildId}` ||
            customId === `rr_repost_${guildId}`,
        onSelect: async (selectInteraction) => {
            const selectedOption = selectInteraction.values[0];
            if (selectedOption === 'add_role') {
                await handleAddRole(selectInteraction, interaction, panelData, guildId, guild, client);
            } else if (selectedOption === 'remove_role') {
                await handleRemoveRole(selectInteraction, interaction, panelData, panels, guildId, guild, client);
            }
        },
        onButton: async (btnInteraction) => {
            if (btnInteraction.customId === `rr_repost_${guildId}`) {
                await btnInteraction.deferUpdate();
                const fallbackEmbed = discordMsg?.embeds?.[0];
                const newMsg = await repostReactionRolePanel(
                    guild,
                    panelData,
                    client,
                    guildId,
                    fallbackEmbed,
                );
                await btnInteraction.followUp({
                    // 🔄 Traduit : "Panneau republié" et "Panneau de rôles par réaction restauré dans [Salon]."
                    embeds: [successEmbed('Panneau republié', `Panneau de rôles par réaction restauré dans ${newMsg.channel}.`)],
                    flags: MessageFlags.Ephemeral,
                });
                await showPanelDashboard(
                    interaction,
                    panelData,
                    newMsg,
                    guildId,
                    guild,
                    client,
                    { exists: true, message: newMsg },
                );
                return;
            }

            if (btnInteraction.customId === `rr_edit_text_${guildId}`) {
                await handleEditText(btnInteraction, interaction, panelData, guildId, guild, client);
                return;
            }

            if (btnInteraction.customId === `rr_delete_${guildId}`) {
                await handleDeletePanel(btnInteraction, interaction, panelData, panels, guildId, guild, client);
            }
        },
    });
}

async function handleEditText(buttonInteraction, rootInteraction, panelData, guildId, guild, client) {
    const channel = guild.channels.cache.get(panelData.channelId);
    const discordMsg = channel
        ? await channel.messages.fetch(panelData.messageId).catch(() => null)
        : null;

    const currentTitle = discordMsg?.embeds?.[0]?.title ?? '';
    const currentDesc = discordMsg?.embeds?.[0]?.description ?? '';

    const modal = new ModalBuilder()
        .setCustomId('rr_edit_text')
        // 🔄 Traduit : "Modifier le texte du panneau"
        .setTitle('Modifier le texte du panneau')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('panel_title')
                    // 🔄 Traduit : "Titre"
                    .setLabel('Titre')
                    .setStyle(TextInputStyle.Short)
                    .setValue(currentTitle)
                    .setMaxLength(256)
                    .setMinLength(1)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('panel_description')
                    // 🔄 Traduit : "Description"
                    .setLabel('Description')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(currentDesc)
                    .setMaxLength(2048)
                    .setMinLength(1)
                    .setRequired(true),
            ),
        );

    try {
        await buttonInteraction.showModal(modal);
    } catch (error) {
        logger.error('Error showing edit text modal:', error);
        await replyUserError(buttonInteraction, {
            type: ErrorTypes.UNKNOWN,
            // 🔄 Traduit : "Échec de l'affichage de la modale de modification du texte. Veuillez réessayer."
            message: 'Échec de l\'affichage de la modale de modification du texte. Veuillez réessayer.',
        }).catch(() => {});
        return;
    }

    const submitted = await buttonInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'rr_edit_text' && i.user.id === buttonInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newTitle = submitted.fields.getTextInputValue('panel_title').trim();
    const newDescription = submitted.fields.getTextInputValue('panel_description').trim();

    if (discordMsg) {
        const roleObjects = panelData.roles
            .map(id => guild.roles.cache.get(id))
            .filter(Boolean);
        const updatedEmbed = EmbedBuilder.from(discordMsg.embeds[0])
            .setTitle(newTitle)
            .setDescription(newDescription);
        if (roleObjects.length > 0) {
            const fields = discordMsg.embeds[0].fields?.map(f => ({ name: f.name, value: f.value, inline: f.inline })) || [];
            // 🔄 Clé interne gardée en anglais (correspondance structurelle)
            const roleFieldIdx = fields.findIndex(f => f.name === 'Available Roles');
            const newRoleValue = roleObjects.map(r => `• ${r}`).join('\n');
            if (roleFieldIdx !== -1) {
                fields[roleFieldIdx] = { name: 'Rôles disponibles', value: newRoleValue, inline: false };
            } else {
                fields.push({ name: 'Rôles disponibles', value: newRoleValue, inline: false });
            }
            updatedEmbed.setFields(fields);
        }
        await discordMsg.edit({ embeds: [updatedEmbed] }).catch(() => {});
    }

    await submitted.reply({
        // 🔄 Traduit : "Panneau mis à jour" et "Le titre et la description ont été mis à jour."
        embeds: [successEmbed('Panneau mis à jour', 'Le titre et la description ont été mis à jour.')],
        flags: MessageFlags.Ephemeral,
    });

    const refreshedMsg = channel
        ? await channel.messages.fetch(panelData.messageId).catch(() => null)
        : null;
    await showPanelDashboard(rootInteraction, panelData, refreshedMsg, guildId, guild, client);
}

async function handleAddRole(selectInteraction, rootInteraction, panelData, guildId, guild, client) {
    await selectInteraction.deferUpdate();

    if (panelData.roles.length >= 25) {
        await replyUserError(selectInteraction, {
            type: ErrorTypes.VALIDATION,
            // 🔄 Traduit : "Ce panneau a déjà atteint le maximum de 25 rôles."
            message: 'Ce panneau a déjà atteint le maximum de 25 rôles.',
        });
        return;
    }

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('rr_add_role_pick')
        // 🔄 Traduit : "Sélectionnez un rôle à ajouter..."
        .setPlaceholder('Sélectionnez un rôle à ajouter...')
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                // 🔄 Traduit : "Ajouter un rôle"
                .setTitle('Ajouter un rôle')
                .setDescription(
                    // 🔄 Traduit : "**Rôles actuels :** ...\n\nSélectionnez un rôle à ajouter à ce panneau."
                    `**Rôles actuels :** ${panelData.roles.length}/25\n\nSélectionnez un rôle à ajouter à ce panneau.`,
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(roleSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'rr_add_role_pick',
        time: 60_000,
        max: 1,
    });

    roleCollector.on('collect', async roleInteraction => {
        await roleInteraction.deferUpdate();
        const role = roleInteraction.roles.first();

        if (panelData.roles.includes(role.id)) {
            await replyUserError(roleInteraction, {
                type: ErrorTypes.VALIDATION,
                // 🔄 Traduit : "[Rôle] est déjà présent sur ce panneau."
                message: `${role} est déjà présent sur ce panneau.`,
            });
            return;
        }
        if (role.id === guild.id) {
            await replyUserError(roleInteraction, {
                type: ErrorTypes.VALIDATION,
                // 🔄 Traduit : "Vous ne pouvez pas utiliser @everyone."
                message: 'Vous ne pouvez pas utiliser @everyone.',
            });
            return;
        }
        if (role.managed) {
            await replyUserError(roleInteraction, {
                type: ErrorTypes.VALIDATION,
                // 🔄 Traduit : "Les rôles gérés / de bots ne peuvent pas être utilisés."
                message: 'Les rôles gérés / de bots ne peuvent pas être utilisés.',
            });
            return;
        }
        if (hasDangerousPermissions(role)) {
            await replyUserError(roleInteraction, {
                type: ErrorTypes.PERMISSION,
                // 🔄 Traduit : "Ce rôle possède des permissions sensibles (Administrateur, Gérer le serveur, etc.) et ne peut pas être utilisé."
                message: 'Ce rôle possède des permissions sensibles (Administrateur, Gérer le serveur, etc.) et ne peut pas être utilisé.',
            });
            return;
        }
        if (role.position >= guild.members.me.roles.highest.position) {
            await replyUserError(roleInteraction, {
                type: ErrorTypes.PERMISSION,
                // 🔄 Traduit : "Ce rôle est situé au-dessus de mon rôle le plus élevé dans la hiérarchie. Veuillez placer mon rôle au-dessus d'abord."
                message: 'Ce rôle est situé au-dessus de mon rôle le plus élevé dans la hiérarchie. Veuillez placer mon rôle au-dessus d\'abord.',
            });
            return;
        }

        panelData.roles.push(role.id);
        const key = getReactionRoleKey(guildId, panelData.messageId);
        await client.db.set(key, panelData);

        await rebuildLivePanelMessage(guild, panelData);

        await roleInteraction.followUp({
            // 🔄 Traduit : "Rôle ajouté" et "[Rôle] a été ajouté au panneau."
            embeds: [successEmbed('Rôle ajouté', `${role} a été ajouté au panneau.`)],
            flags: MessageFlags.Ephemeral,
        });

        const channel = guild.channels.cache.get(panelData.channelId);
        const discordMsg = channel
            ? await channel.messages.fetch(panelData.messageId).catch(() => null)
            : null;
        await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild, client);
    });

    roleCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            replyUserError(selectInteraction, {
                type: ErrorTypes.RATE_LIMIT,
                // 🔄 Traduit : "Aucun rôle sélectionné. Aucune modification n'a été apportée."
                message: 'Aucun rôle sélectionné. Aucune modification n\'a été apportée.',
            }).catch(() => {});
        }
    });
}

async function handleRemoveRole(selectInteraction, rootInteraction, panelData, panels, guildId, guild, client) {
    await selectInteraction.deferUpdate();

    const roleOptions = panelData.roles
        .map(id => {
            const role = guild.roles.cache.get(id);
            return role ? { label: role.name.substring(0, 100), value: id } : null;
        })
        .filter(Boolean);

    if (roleOptions.length === 0) {
        await replyUserError(selectInteraction, {
            type: ErrorTypes.USER_INPUT,
            // 🔄 Traduit : "Les rôles de ce panneau n'existent plus sur le serveur."
            message: 'Les rôles de ce panneau n\'existent plus sur le serveur.',
        });
        return;
    }

    const removeSelect = new StringSelectMenuBuilder()
        .setCustomId('rr_remove_role_pick')
        // 🔄 Traduit : "Sélectionnez un rôle à retirer..."
        .setPlaceholder('Sélectionnez un rôle à retirer...')
        .setMaxValues(1)
        .addOptions(
            roleOptions.map(r =>
                new StringSelectMenuOptionBuilder().setLabel(r.label).setValue(r.value).setEmoji('🎭'),
            ),
        );

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                // 🔄 Traduit : "Retirer un rôle" et "Sélectionnez le rôle que vous souhaitez retirer de ce panneau."
                .setTitle('Retirer un rôle')
                .setDescription('Sélectionnez le rôle que vous souhaitez retirer de ce panneau.')
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(removeSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const removeCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'rr_remove_role_pick',
        time: 60_000,
        max: 1,
    });

    removeCollector.on('collect', async removeInteraction => {
        await removeInteraction.deferUpdate();
        const roleId = removeInteraction.values[0];
        const role = guild.roles.cache.get(roleId);

        panelData.roles = panelData.roles.filter(id => id !== roleId);

        if (panelData.roles.length === 0) {
            const channel = guild.channels.cache.get(panelData.channelId);
            if (channel) {
                const msg = await channel.messages.fetch(panelData.messageId).catch(() => null);
                if (msg) await msg.delete().catch(() => {});
            }
            await deleteReactionRoleMessage(client, guildId, panelData.messageId);

            await removeInteraction.followUp({
                embeds: [
                    successEmbed(
                        '✅ Rôle retiré',
                        // 🔄 Traduit : "C'était le dernier rôle du panneau. Le panneau a été supprimé."
                        'C\'était le dernier rôle du panneau. Le panneau a été supprimé.',
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });

            const panelIndex = panels.findIndex(p => p.messageId === panelData.messageId);
            if (panelIndex > -1) {
                panels.splice(panelIndex, 1);
            }

            if (panels.length === 0) {
                await InteractionHelper.safeEditReply(rootInteraction, {
                    embeds: [
                        new EmbedBuilder()
                            // 🔄 Traduit : "Tableau de bord des rôles par réaction" et "Aucun panneau restant. Utilisez `/reactroles setup` pour en créer un."
                            .setTitle('Tableau de bord des rôles par réaction')
                            .setDescription('Aucun panneau restant. Utilisez `/reactroles setup` pour en créer un.')
                            .setColor(getColor('info')),
                    ],
                    components: [],
                    flags: DASHBOARD_EPHEMERAL,
                });
            } else {
                await InteractionHelper.safeEditReply(rootInteraction, {
                    embeds: [
                        new EmbedBuilder()
                            // 🔄 Traduit : "Panneau supprimé. Exécutez `/reactroles dashboard` pour gérer un autre panneau."
                            .setTitle('Tableau de bord des rôles par réaction')
                            .setDescription('Panneau supprimé. Exécutez `/reactroles dashboard` pour gérer un autre panneau.')
                            .setColor(getColor('success')),
                    ],
                    components: [],
                    flags: DASHBOARD_EPHEMERAL,
                });
            }
        } else {
            const key = getReactionRoleKey(guildId, panelData.messageId);
            await client.db.set(key, panelData);
            await rebuildLivePanelMessage(guild, panelData);

            await removeInteraction.followUp({
                embeds: [
                    successEmbed(
                        '✅ Rôle retiré',
                        // 🔄 Traduit : "[Rôle] a été retiré du panneau."
                        `${role ? role.toString() : `<@&${roleId}>`} a été retiré du panneau.`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });

            const channel = guild.channels.cache.get(panelData.channelId);
            const discordMsg = channel
                ? await channel.messages.fetch(panelData.messageId).catch(() => null)
                : null;
            await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild, client);
        }
    });

    removeCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            replyUserError(selectInteraction, {
                type: ErrorTypes.RATE_LIMIT,
                // 🔄 Traduit : "Aucun rôle sélectionné. Aucune modification n'a été apportée."
                message: 'Aucun rôle sélectionné. Aucune modification n\'a été apportée.',
            }).catch(() => {});
        }
    });
}

async function handleDeletePanel(btnInteraction, rootInteraction, panelData, panels, guildId, guild, client) {
    const channel = guild.channels.cache.get(panelData.channelId);
    const discordMsg = channel
        ? await channel.messages.fetch(panelData.messageId).catch(() => null)
        : null;
    // 🔄 Traduit : "ce panneau"
    const title = discordMsg?.embeds?.[0]?.title ?? 'ce panneau';

    const deleteModal = new ModalBuilder()
        .setCustomId('rr_delete_confirm_modal')
        // 🔄 Traduit : "Supprimer le panneau de rôles par réaction"
        .setTitle('Supprimer le panneau de rôles par réaction');

    const deleteWarningText = new TextDisplayBuilder()
        // 🔄 Traduit : "⚠️ Vous êtes sur le point de supprimer définitivement le panneau **[Titre]**. Cela supprimera le message Discord ainsi que toutes les assignations de rôles associées."
        .setContent(`⚠️ Vous êtes sur le point de supprimer définitivement le panneau **${title}**. Cela supprimera le message Discord ainsi que toutes les assignations de rôles associées.`);

    const deleteCheckbox = new CheckboxBuilder()
        .setCustomId('delete_confirmation')
        .setDefault(false);

    const deleteCheckboxLabel = new LabelBuilder()
        // 🔄 Traduit : "Je confirme — cette action est irréversible"
        .setLabel('Je confirme — cette action est irréversible')
        .setCheckboxComponent(deleteCheckbox);

    deleteModal
        .addTextDisplayComponents(deleteWarningText)
        .addLabelComponents(deleteCheckboxLabel);

    await btnInteraction.showModal(deleteModal);

    const submitted = await btnInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'rr_delete_confirm_modal' && i.user.id === btnInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) {
        await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild, client);
        return;
    }

    const confirmed = submitted.fields.getCheckbox('delete_confirmation');

    if (!confirmed) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Vous devez cocher la case de confirmation pour supprimer le panneau.' });
        await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild, client);
        return;
    }

    await submitted.deferUpdate();

    if (discordMsg) {
        await discordMsg.delete().catch(() => {});
    }
    await deleteReactionRoleMessage(client, guildId, panelData.messageId);

    try {
        await logEvent({
            client,
            guildId,
            eventType: EVENT_TYPES.REACTION_ROLE_DELETE,
            data: {
                // 🔄 Traduit : "Panneau de rôles par réaction supprimé par [Tag]"
                description: `Panneau de rôles par réaction supprimé par ${submitted.user.tag}`,
                userId: submitted.user.id,
                channelId: panelData.channelId,
                fields: [
                    { name: 'Panneau', value: title, inline: true },
                    // 🔄 Traduit : "Inconnu"
                    { name: 'Salon', value: channel ? channel.toString() : 'Inconnu', inline: true },
                ],
            },
        });
    } catch (logErr) {
        logger.warn('Failed to log reaction role deletion:', logErr);
    }

    await submitted.followUp({
        // 🔄 Traduit : "Panneau supprimé" et "**[Titre]** a été supprimé."
        embeds: [successEmbed('Panneau supprimé', `**${title}** a été supprimé.`)],
        flags: MessageFlags.Ephemeral,
    });

    const panelIndex = panels.findIndex(p => p.messageId === panelData.messageId);
    if (panelIndex > -1) {
        panels.splice(panelIndex, 1);
    }

    if (panels.length === 0) {
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [
                new EmbedBuilder()
                    .setTitle('Tableau de bord des rôles par réaction')
                    .setDescription('Aucun panneau restant. Utilisez `/reactroles setup` pour en créer un.')
                    .setColor(getColor('info')),
            ],
            components: [],
            flags: DASHBOARD_EPHEMERAL,
        });
    } else {
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [
                new EmbedBuilder()
                    .setTitle('Tableau de bord des rôles par réaction')
                    .setDescription('Panneau supprimé. Exécutez `/reactroles dashboard` pour gérer un autre panneau.')
                    .setColor(getColor('success')),
            ],
            components: [],
            flags: DASHBOARD_EPHEMERAL,
        });
    }
}
