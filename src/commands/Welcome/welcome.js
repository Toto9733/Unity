import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } from 'discord.js';
import { getWelcomeConfig, updateWelcomeConfig } from '../../utils/database.js';
import { formatWelcomeMessage, truncateForEmbedField } from '../../utils/welcome.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ErrorTypes, replyUserError } from '../../utils/errorHandler.js';

export default {
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Configurer le système de bienvenue')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Configurer le message de bienvenue')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Le salon où envoyer les messages de bienvenue')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Message de bienvenue. Variables : {user}, {username}, {server}, {memberCount}')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('image')
                        .setDescription('URL de l\'image à inclure dans le message de bienvenue')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('ping')
                        .setDescription('Indique s\'il faut mentionner (ping) l\'utilisateur dans le message de bienvenue')
                        .setRequired(false))),

    async execute(interaction) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction);
            if (!deferSuccess) {
                logger.warn(`Échec du différé pour l'interaction welcome`, {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'welcome'
                });
                return;
            }
        } catch (deferError) {
            logger.error(`Erreur lors du différé de welcome`, { error: deferError.message });
            return;
        }

        const { options, guild, client } = interaction;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'Vous avez besoin de la permission **Gérer le serveur** pour utiliser `/welcome`.' });
        }

        const subcommand = options.getSubcommand();

        if (subcommand === 'setup') {
            const channel = options.getChannel('channel');
            const message = options.getString('message');
            const image = options.getString('image');
            const ping = options.getBoolean('ping') ?? false;

            const existingConfig = await getWelcomeConfig(client, guild.id);
            if (existingConfig?.channelId) {
                logger.info(`[Welcome] Configuration bloquée car elle existe déjà dans le salon ${existingConfig.channelId} pour le serveur ${guild.id}`);
                return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `Le message de bienvenue est déjà configuré pour <#${existingConfig.channelId}>. Utilisez **/greet dashboard** pour personnaliser le salon, le message, le ping ou l'image.` });
            }
            
            if (!message || message.trim().length === 0) {
                logger.warn(`[Welcome] Message vide fourni par ${interaction.user.tag} dans ${guild.name}`);
                return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Le message de bienvenue ne peut pas être vide' });
            }

            if (image) {
                try {
                    new URL(image);
                } catch (e) {
                    logger.warn(`[Welcome] URL d'image invalide fournie par ${interaction.user.tag} : ${image}`);
                    return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Veuillez fournir une URL d\'image valide (doit commencer par http:// ou https://)' });
                }
            }

            try {
                await updateWelcomeConfig(client, guild.id, {
                    enabled: true,
                    channelId: channel.id,
                    welcomeMessage: message,
                    welcomeImage: image || undefined,
                    welcomePing: ping
                });

                logger.info(`[Welcome] Configuration définie par ${interaction.user.tag} pour le serveur ${guild.name} (${guild.id})`);

                const previewMessage = formatWelcomeMessage(message, {
                    user: interaction.user,
                    guild
                });

                const embed = new EmbedBuilder()
                    .setColor(getColor('success'))
                    .setTitle('Système de bienvenue configuré')
                    .setDescription(`Les messages de bienvenue seront désormais envoyés dans ${channel}`)
                    .addFields(
                        { name: 'Aperçu du message', value: truncateForEmbedField(previewMessage) },
                        { name: 'Mentionner l\'utilisateur', value: ping ? 'Oui' : 'Non' },
                        { name: 'Statut', value: 'Activé' }
                    )
                    .setFooter({ text: 'Astuce : Utilisez /greet dashboard pour personnaliser les paramètres de bienvenue' });

                if (image) {
                    embed.setImage(image);
                }

                await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            } catch (error) {
                logger.error(`[Welcome] Échec de la configuration du système de bienvenue pour le serveur ${guild.id}:`, error);
                await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Une erreur est survenue lors de la configuration du système de bienvenue. Veuillez réessayer.' });
            }
        }
    },
};
