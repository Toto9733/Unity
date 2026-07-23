import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    LabelBuilder,
    ChannelType,
} from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed, successEmbed, infoEmbed, warningEmbed, buildUserErrorEmbed } from '../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { getGuildConfig, setConfigValue } from '../../services/config/guildConfig.js';
import ConfigService from '../../services/config/configService.js';
import { logger } from '../../utils/logger.js';
import { botConfig, getCommandPrefix } from '../../config/bot.js';

const DASHBOARD_CUSTOM_ID = 'config_select';
const WIZARD_BUTTON_ID = 'config_wizard';
const activeWizardSessions = new Set();

const DM_DISABLED_HELP = [
    '1. Faites un clic droit sur le nom de ce serveur (sur mobile : appuyez sur le nom du serveur en haut).',
    '2. Ouvrez les **Paramètres de confidentialité**.',
    '3. Activez **Autoriser les messages privés provenant des membres du serveur**.',
    '4. Cliquez à nouveau sur **Démarrer l\'assistant de configuration**.',
].join('\n');

async function notifyWizardStarted(buttonInteraction) {
    await buttonInteraction.followUp({
        embeds: [infoEmbed(
            'Assistant de configuration démarré',
            'Vérifiez vos messages privés — je vous y ai envoyé la première question de configuration.\n\nRépondez à chaque question dans ce message privé. Tapez `skip` pour conserver la valeur actuelle.',
        )],
        flags: MessageFlags.Ephemeral,
    }).catch(() => {});
}

async function notifyWizardDmBlocked(buttonInteraction) {
    await replyUserError(buttonInteraction, {
        type: ErrorTypes.USER_INPUT,
        message: `Je n'ai pas pu vous envoyer de message privé. Activez les messages privés pour ce serveur, puis réessayez.\n\n${DM_DISABLED_HELP}`,
    }).catch(() => {});
}

function formatChannelMention(guild, channelId) {
    if (!channelId) {
        return '`Non défini`';
    }
    const channel = guild.channels.cache.get(channelId);
    return channel ? `<#${channelId}>` : `#${channelId}`;
}

function formatRoleMention(guild, roleId) {
    if (!roleId) {
        return '`Non défini`';
    }
    const role = guild.roles.cache.get(roleId);
    return role ? `<@&${roleId}>` : `@${roleId}`;
}

function getBotPresenceText() {
    const activity = botConfig.presence?.activities?.[0];
    if (!activity?.name) {
        return '`Non configuré`';
    }

    const typeLabels = ['Joue à', 'Streame', 'Écoute', 'Regarde', '', 'Participe à'];
    const typeLabel = typeLabels[activity.type];
    if (!typeLabel) {
        return activity.name;
    }

    return `${typeLabel} **${activity.name}**`;
}

function getThemeColorLines() {
    const colors = botConfig.embeds.colors;
    return [
        `🎨 Primaire \`${colors.primary}\` · Succès \`${colors.success}\``,
        `⚠️ Avertissement \`${colors.warning}\` · Erreur \`${colors.error}\``,
    ].join('\n');
}

function buildDashboardEmbed(config, guild) {
    const setupDone = config.setupWizardCompleted;

    return createEmbed({
        title: '⚙️ Configuration du serveur',
        description: `Paramètres principaux pour **${guild.name}**. Choisissez une option ci-dessous ou lancez l'assistant de configuration.`,
        color: 'info',
        fields: [
            {
                name: '⌨️ Préfixe du serveur',
                value: `\`${config.prefix || getCommandPrefix()}\``,
                inline: true,
            },
            {
                name: '🛡️ Rôle de modération',
                value: formatRoleMention(guild, config.modRole),
                inline: true,
            },
            {
                name: '📋 Salon des journaux (Logs)',
                value: formatChannelMention(guild, config.logging?.channels?.audit),
                inline: true,
            },
            {
                name: '💚 Statut du bot',
                value: getBotPresenceText(),
                inline: false,
            },
            {
                name: '🎨 Thème des embeds',
                value: `${getThemeColorLines()}\n-# Les couleurs sont définies dans la configuration du bot et s'appliquent globalement.`,
                inline: false,
            },
            {
                name: '⚡ Accès aux commandes',
                value: 'Utilisez `/commands dashboard` pour activer ou désactiver les commandes et sous-commandes.',
                inline: false,
            },
            {
                name: `${setupDone ? '✅' : '📝'} Configuration`,
                value: setupDone
                    ? 'Assistant de configuration terminé — relancez-le à tout moment pour mettre à jour les paramètres.'
                    : 'Lancez l\'assistant de configuration pour configurer rapidement votre serveur.',
                inline: false,
            },
        ],
        footer: 'Le tableau de bord se ferme après 10 minutes d\'inactivité',
    });
}

function buildSettingsSelect(guildId) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${DASHBOARD_CUSTOM_ID}:${guildId}`)
            .setPlaceholder('⚙️ Sélectionnez un paramètre à modifier...')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Préfixe du serveur')
                    .setDescription('Modifier le préfixe des commandes textuelles')
                    .setValue('prefix')
                    .setEmoji('⌨️'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Rôle de modération')
                    .setDescription('Rôle utilisé pour les commandes de modération')
                    .setValue('modRole')
                    .setEmoji('🛡️'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Salon des journaux')
                    .setDescription('Salon pour les messages de journalisation du système')
                    .setValue('logChannelId')
                    .setEmoji('📋'),
            ),
    );
}

function buildButtonRow(config, guildId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${WIZARD_BUTTON_ID}:${guildId}`)
            .setLabel(config.setupWizardCompleted ? 'Relancer l\'assistant de configuration' : 'Démarrer l\'assistant de configuration')
            .setEmoji('📝')
            .setStyle(config.setupWizardCompleted ? ButtonStyle.Secondary : ButtonStyle.Success),
    );
}

function extractId(value) {
    if (!value || typeof value !== 'string') return null;

    const channelMention = value.match(/<#!?(\d{17,19})>/);
    if (channelMention) return channelMention[1];

    const roleMention = value.match(/<@&(\d{17,19})>/);
    if (roleMention) return roleMention[1];

    const digits = value.match(/^(\d{17,19})$/);
    if (digits) return digits[1];

    return null;
}

async function askQuestion(dmChannel, userId, prompt, stepNumber, totalSteps) {
    await dmChannel.send({
        embeds: [createEmbed({
            title: `Question de configuration ${stepNumber}/${totalSteps}`,
            description: prompt,
            color: 'primary',
        })],
    });

    const collected = await dmChannel.awaitMessages({
        filter: (message) => message.author.id === userId && !message.author.bot,
        max: 1,
        time: 180_000,
    }).catch(() => null);

    if (!collected || !collected.size) {
        await dmChannel.send({
            embeds: [buildUserErrorEmbed(ErrorTypes.RATE_LIMIT, 'Vous n\'avez pas répondu à temps. Relancez l\'assistant de configuration lorsque vous serez prêt.')],
        });
        return null;
    }

    const answer = collected.first().content.trim();
    if (answer.toLowerCase() === 'cancel') {
        await dmChannel.send({
            embeds: [infoEmbed('Configuration annulée', 'Assistant de configuration arrêté. Vos réponses enregistrées sont toujours appliquées.')],
        });
        return { cancelled: true };
    }

    return { answer };
}

function formatSavedAck(key, value, guild) {
    if (key === 'prefix') {
        return `Préfixe du serveur enregistré : \`${value}\`.`;
    }

    if (key === 'logChannelId') {
        if (value === null) {
            return 'Salon des journaux effacé.';
        }
        const channel = guild.channels.cache.get(value);
        return `Salon des journaux enregistré : ${channel ?? `<#${value}>`}.`;
    }

    if (key === 'modRole') {
        if (value === null) {
            return 'Rôle de modération effacé.';
        }
        const role = guild.roles.cache.get(value);
        return `Rôle de modération enregistré : ${role ?? `<@&${value}>`}.`;
    }

    return 'Paramètre enregistré.';
}

async function validateGuildChannelId(guild, channelId) {
    const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
        throw new Error('Ce salon n\'a pas été trouvé sur ce serveur ou n\'est pas un salon textuel.');
    }
    return channel.id;
}

async function validateGuildRoleId(guild, roleId) {
    const role = guild.roles.cache.get(roleId) ?? await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
        throw new Error('Ce rôle n\'a pas été trouvé sur ce serveur.');
    }
    return role.id;
}

async function refreshDashboard(rootInteraction, config, guild) {
    const embed = buildDashboardEmbed(config, guild);
    const components = [buildButtonRow(config, guild.id), buildSettingsSelect(guild.id)];
    await InteractionHelper.safeEditReply(rootInteraction, { embeds: [embed], components }).catch(() => {});
}

async function runSetupWizard(buttonInteraction, config, guild, client, rootInteraction) {
    const user = buttonInteraction.user;

    if (activeWizardSessions.has(user.id)) {
        await buttonInteraction.followUp({
            embeds: [warningEmbed('Configuration déjà en cours', 'Vous avez déjà un assistant de configuration ouvert dans vos messages privés. Répondez-y pour continuer, ou tapez `cancel` pour l\'arrêter.')],
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
    }

    activeWizardSessions.add(user.id);

    let dmChannel;

    try {
        dmChannel = await user.createDM();
    } catch (error) {
        logger.warn('Échec de la création du salon de MP pour l\'assistant de configuration', { userId: user.id, error: error.message });
        await notifyWizardDmBlocked(buttonInteraction);
        return;
    } finally {
        if (!dmChannel) {
            activeWizardSessions.delete(user.id);
        }
    }

    const prompts = [
        {
            key: 'prefix',
            skipMessage: 'Conservation du préfixe de serveur actuel.',
            question: 'Quel préfixe de commande ce serveur doit-il utiliser ?\nActuel : `' + (config.prefix || getCommandPrefix()) + '`\nRépondez `skip` pour le conserver, ou `cancel` pour arrêter.',
            parse: async (answer) => {
                const normalized = answer.trim();
                if (normalized.toLowerCase() === 'skip') return undefined;
                if (/\s/.test(normalized) || normalized.length < 1 || normalized.length > 10) {
                    throw new Error('Le préfixe doit comporter entre 1 et 10 caractères et ne contenir aucun espace.');
                }
                return normalized;
            },
        },
        {
            key: 'logChannelId',
            skipMessage: 'Conservation du salon des journaux actuel.',
            question: 'Quel salon doit recevoir les journaux du bot ?\nEnvoyez une mention de salon, un ID de salon, `none` pour effacer, `skip` pour conserver la valeur actuelle, ou `cancel` pour arrêter.',
            parse: async (answer) => {
                const normalized = answer.trim();
                if (normalized.toLowerCase() === 'skip') return undefined;
                if (normalized.toLowerCase() === 'none') return null;
                const id = extractId(normalized);
                if (!id) throw new Error('Fournissez une mention de salon ou un ID valide de ce serveur.');
                return validateGuildChannelId(guild, id);
            },
        },
        {
            key: 'modRole',
            skipMessage: 'Conservation du rôle de modération actuel.',
            question: 'Quel rôle les modérateurs doivent-ils avoir ?\nEnvoyez une mention de rôle, un ID de rôle, `none` pour effacer, `skip` pour conserver la valeur actuelle, ou `cancel` pour arrêter.',
            parse: async (answer) => {
                const normalized = answer.trim();
                if (normalized.toLowerCase() === 'skip') return undefined;
                if (normalized.toLowerCase() === 'none') return null;
                const id = extractId(normalized);
                if (!id) throw new Error('Fournissez une mention de rôle ou un ID valide de ce serveur.');
                return validateGuildRoleId(guild, id);
            },
        },
    ];

    const changes = {};
    const errors = [];
    let wizardCancelled = false;

    try {
        try {
            await dmChannel.send({
                embeds: [createEmbed({
                    title: '📝 Assistant de configuration',
                    description: 'Répondez à chaque question dans ce message privé.\n\n• Tapez `skip` pour conserver la valeur actuelle\n• Tapez `cancel` pour arrêter l\'assistant',
                    color: 'info',
                })],
            });
        } catch (error) {
            logger.warn('Échec de l\'envoi du MP de l\'assistant de configuration', { userId: user.id, error: error.message });
            await notifyWizardDmBlocked(buttonInteraction);
            return;
        }

        await notifyWizardStarted(buttonInteraction);

        for (let index = 0; index < prompts.length; index++) {
            const prompt = prompts[index];
            let answered = false;

            while (!answered) {
                const result = await askQuestion(
                    dmChannel,
                    user.id,
                    prompt.question,
                    index + 1,
                    prompts.length,
                );

                if (result === null) {
                    wizardCancelled = true;
                    answered = true;
                    break;
                }

                if (result.cancelled) {
                    wizardCancelled = true;
                    answered = true;
                    break;
                }

                try {
                    const value = await prompt.parse(result.answer);

                    if (value === undefined) {
                        await dmChannel.send({
                            embeds: [infoEmbed('Ignoré', prompt.skipMessage)],
                        });
                    } else {
                        await ConfigService.updateSetting(client, guild.id, prompt.key, value, user.id);
                        changes[prompt.key] = value;
                        await dmChannel.send({
                            embeds: [successEmbed('Enregistré', formatSavedAck(prompt.key, value, guild))],
                        });

                        try {
                            const updatedConfig = await getGuildConfig(client, guild.id);
                            await refreshDashboard(rootInteraction, updatedConfig, guild);
                        } catch (refreshError) {
                            logger.debug('Échec du rafraîchissement du tableau de bord pendant l\'assistant de configuration', { error: refreshError.message });
                        }
                    }

                    answered = true;
                } catch (error) {
                    errors.push(`• ${prompt.key}: ${error.message}`);
                    await dmChannel.send({
                        embeds: [buildUserErrorEmbed(ErrorTypes.VALIDATION, `${error.message}\n\nVeuillez répondre à nouveau avec une réponse valide, \`skip\` ou \`cancel\`.`)],
                    });
                }
            }

            if (wizardCancelled) {
                break;
            }
        }

        if (!wizardCancelled) {
            try {
                await setConfigValue(client, guild.id, 'setupWizardCompleted', true);
            } catch (error) {
                logger.warn('Échec de l\'enregistrement du drapeau setupWizardCompleted', { guildId: guild.id, error: error.message });
            }
        }

        const summaryTitle = wizardCancelled
            ? (Object.keys(changes).length > 0 ? 'Configuration arrêtée' : 'Configuration annulée')
            : (errors.length > 0 ? 'Configuration terminée' : 'Configuration terminée');

        const summaryBody = wizardCancelled
            ? (Object.keys(changes).length > 0
                ? `Configuration arrêtée prématurément. **${Object.keys(changes).length}** paramètre(s) enregistré(s) avant l'arrêt.`
                : 'L\'assistant de configuration s\'est arrêté avant qu\'aucun changement ne soit enregistré.')
            : (Object.keys(changes).length > 0
                ? `Mise à jour de **${Object.keys(changes).length}** paramètre(s).${errors.length > 0 ? ' Certaines réponses ont nécessité des nouvelles tentatives.' : ''}`
                : 'Aucun changement n\'a été appliqué.');

        const summaryEmbed = createEmbed({
            title: wizardCancelled ? `⚠️ ${summaryTitle}` : `✅ ${summaryTitle}`,
            description: summaryBody,
            color: wizardCancelled ? 'warning' : (errors.length > 0 ? 'warning' : 'success'),
        });

        if (errors.length > 0) {
            const uniqueErrors = [...new Set(errors)];
            summaryEmbed.addFields({ name: 'Problèmes', value: uniqueErrors.join('\n').slice(0, 1024) });
        }

        await dmChannel.send({ embeds: [summaryEmbed] });

        try {
            const updatedConfig = await getGuildConfig(client, guild.id);
            await refreshDashboard(rootInteraction, updatedConfig, guild);
        } catch (error) {
            logger.debug('Échec du rafraîchissement du tableau de bord après la fin de l\'assistant', { error: error.message });
        }
    } finally {
        activeWizardSessions.delete(user.id);
    }
}

async function showSettingModal(selectInteraction, guildId, setting) {
    const modalCustomId = `config_wizard_modal:${setting}:${guildId}`;

    if (setting === 'logChannelId') {
        const modal = new ModalBuilder()
            .setCustomId(modalCustomId)
            .setTitle('📋 Mettre à jour le salon des journaux');

        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('log_channel')
            .setPlaceholder('Sélectionnez un salon textuel...')
            .setMinValues(1)
            .setMaxValues(1)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true);

        const channelLabel = new LabelBuilder()
            .setLabel('Salon des journaux')
            .setDescription('Salon où les messages de journalisation du système seront envoyés')
            .setChannelSelectMenuComponent(channelSelect);

        modal.addLabelComponents(channelLabel);
        await selectInteraction.showModal(modal);
        return;
    }

    if (setting === 'modRole') {
        const modal = new ModalBuilder()
            .setCustomId(modalCustomId)
            .setTitle('🛡️ Mettre à jour le rôle de modération');

        const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId('mod_role')
            .setPlaceholder('Sélectionnez un rôle de modération...')
            .setMinValues(1)
            .setMaxValues(1)
            .setRequired(true);

        const roleLabel = new LabelBuilder()
            .setLabel('Rôle de modération')
            .setDescription('Rôle utilisé pour les commandes de modération')
            .setRoleSelectMenuComponent(roleSelect);

        modal.addLabelComponents(roleLabel);
        await selectInteraction.showModal(modal);
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(modalCustomId)
        .setTitle('Mettre à jour le préfixe du serveur');

    const textInput = new TextInputBuilder()
        .setCustomId('value')
        .setLabel('Nouveau préfixe (1-10 caractères, sans espace)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(10);

    modal.addComponents(new ActionRowBuilder().addComponents(textInput));
    await selectInteraction.showModal(modal);
}

function resolveSettingModalValue(setting, submitted) {
    if (setting === 'logChannelId') {
        const channelId = submitted.fields.getField('log_channel')?.values?.[0];
        if (!channelId) {
            throw new Error('Veuillez sélectionner un salon des journaux.');
        }
        return channelId;
    }

    if (setting === 'modRole') {
        const roleId = submitted.fields.getField('mod_role')?.values?.[0];
        if (!roleId) {
            throw new Error('Veuillez sélectionner un rôle de modération.');
        }
        return roleId;
    }

    const prefix = submitted.fields.getTextInputValue('value')?.trim();
    if (!prefix || prefix.length < 1 || prefix.length > 10 || /\s/.test(prefix)) {
        throw new Error('Le préfixe doit comporter entre 1 et 10 caractères et ne contenir aucun espace.');
    }
    return prefix;
}

function buildSettingSuccessMessage(setting, value, guild) {
    if (setting === 'logChannelId') {
        const channel = guild.channels.cache.get(value);
        return `Salon des journaux défini sur ${channel ?? `<#${value}>`}.`;
    }

    if (setting === 'modRole') {
        const role = guild.roles.cache.get(value);
        return `Rôle de modération défini sur ${role ?? `<@&${value}>`}.`;
    }

    return `Préfixe du serveur défini sur \`${value}\`.`;
}

async function handleSettingModalSubmit(selectInteraction, rootInteraction, setting, guildId, client) {
    const modalCustomId = `config_wizard_modal:${setting}:${guildId}`;

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: (modalInteraction) =>
                modalInteraction.customId === modalCustomId &&
                modalInteraction.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) {
        return;
    }

    try {
        const value = resolveSettingModalValue(setting, submitted);
        await ConfigService.updateSetting(client, guildId, setting, value, submitted.user.id);

        await submitted.reply({
            embeds: [successEmbed('Configuration mise à jour', buildSettingSuccessMessage(setting, value, submitted.guild))],
            flags: MessageFlags.Ephemeral,
        });

        const updatedConfig = await getGuildConfig(client, guildId);
        await refreshDashboard(rootInteraction, updatedConfig, submitted.guild);
    } catch (error) {
        logger.error('Erreur lors de la soumission de la modale de configuration :', error);
        await replyUserError(submitted, {
            type: ErrorTypes.CONFIGURATION,
            message: error.message || 'Veuillez réessayer.',
        }).catch(() => {});
    }
}

export default {
    slashOnly: true,
    data: new SlashCommandBuilder()
        .setName('configwizard')
        .setDescription('Ouvrir le tableau de bord de configuration du serveur et l\'assistant de configuration')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),
    category: 'Core',

    async execute(interaction) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferSuccess) {
                return;
            }

            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return replyUserError(interaction, {
                    type: ErrorTypes.PERMISSION,
                    message: 'Vous avez besoin de la permission **Gérer le serveur** pour utiliser cette commande.',
                });
            }

            const guildConfig = await getGuildConfig(interaction.client, interaction.guildId);
            const embed = buildDashboardEmbed(guildConfig, interaction.guild);
            const components = [buildButtonRow(guildConfig, interaction.guildId), buildSettingsSelect(interaction.guildId)];

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed], components });

            const replyMessage = await interaction.fetchReply().catch(() => null);
            if (!replyMessage) {
                return;
            }

            const collectorFilter = (componentInteraction) =>
                componentInteraction.user.id === interaction.user.id &&
                componentInteraction.customId.includes(`:${interaction.guildId}`);

            const componentCollector = replyMessage.createMessageComponentCollector({
                filter: collectorFilter,
                time: 600_000,
            });

            componentCollector.on('collect', async (componentInteraction) => {
                try {
                    if (componentInteraction.isButton()) {
                        await componentInteraction.deferUpdate();

                        if (componentInteraction.customId.startsWith(`${WIZARD_BUTTON_ID}:`)) {
                            const latestConfig = await getGuildConfig(interaction.client, interaction.guildId);
                            await runSetupWizard(componentInteraction, latestConfig, interaction.guild, interaction.client, interaction);
                        }
                        return;
                    }

                    if (componentInteraction.isStringSelectMenu()) {
                        const selected = componentInteraction.values[0];
                        await showSettingModal(componentInteraction, interaction.guildId, selected);
                        await handleSettingModalSubmit(
                            componentInteraction,
                            interaction,
                            selected,
                            interaction.guildId,
                            interaction.client,
                        );
                    }
                } catch (error) {
                    logger.error('Erreur d\'interaction avec le tableau de bord de configuration :', error);
                    await replyUserError(componentInteraction, {
                        type: ErrorTypes.UNKNOWN,
                        message: 'Échec du traitement de votre sélection. Veuillez réessayer.',
                    }).catch(() => {});
                }
            });
        } catch (error) {
            logger.error('Erreur de la commande config :', error);
            await replyUserError(interaction, {
                type: ErrorTypes.CONFIGURATION,
                message: 'Échec de l\'ouverture du tableau de bord de configuration. Veuillez réessayer.',
            });
        }
    },
};
