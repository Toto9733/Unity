import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getGuildConfig, setGuildConfig } from '../../services/config/guildConfig.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

import ticketConfig from './modules/ticket_dashboard.js';

export default {
    data: new SlashCommandBuilder()
        .setName("ticket")
        .setDescription("Gère le système de tickets du serveur.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand((subcommand) =>
            subcommand
                .setName("setup")
                .setDescription(
                    "Configure le panneau de création de tickets dans un salon spécifié.",
                )
                .addChannelOption((option) =>
                    option
                        .setName("panel_channel")
                        .setDescription(
                            "Le salon où le panneau de tickets sera envoyé.",
                        )
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName("panel_message")
                        .setDescription(
                            "Le message principal / la description du panneau de tickets.",
                        )
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName("button_label")
                        .setDescription(
                            "Le texte du bouton de création de ticket (par défaut : Créer un ticket)",
                        )
                        .setRequired(false),
                )
                .addChannelOption((option) =>
                    option
                        .setName("category")
                        .setDescription(
                            "La catégorie où les nouveaux tickets seront créés (optionnel).",
                        )
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false),
                )
                .addChannelOption((option) =>
                    option
                        .setName("closed_category")
                        .setDescription(
                            "La catégorie où les tickets fermés seront déplacés (optionnel).",
                        )
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false),
                )
                .addRoleOption((option) =>
                    option
                        .setName("staff_role")
                        .setDescription(
                            "Le rôle qui peut accéder aux tickets (optionnel).",
                        )
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName("max_tickets_per_user")
                        .setDescription("Nombre maximum de tickets qu'un utilisateur peut créer (par défaut : 3)")
                        .setMinValue(1)
                        .setMaxValue(10)
                        .setRequired(false),
                )
                .addBooleanOption((option) =>
                    option
                        .setName("dm_on_close")
                        .setDescription("Envoyer un MP à l'utilisateur lorsque son ticket est fermé (par défaut : true)")
                        .setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("dashboard")
                .setDescription("Ouvre le tableau de bord interactif du système de tickets"),
        ),
    category: "ticket",

    async execute(interaction, config, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) {
            return;
        }

        if (
            !interaction.member.permissions.has(
                PermissionFlagsBits.ManageChannels,
            )
        ) {
            logger.warn('Ticket command permission denied', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'ticket'
            });
            return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'Vous avez besoin de la permission `Gérer les salons` pour cette action.' });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === "dashboard") {
            return ticketConfig.execute(interaction, config, client);
        }

        if (subcommand === "setup") {
            const existingConfig = await getGuildConfig(client, interaction.guildId);
            if (existingConfig?.ticketPanelChannelId) {
                return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `Ce serveur a déjà un système de tickets configuré (panneau dans <#${existingConfig.ticketPanelChannelId}>).\n\nUn seul système de tickets est pris en charge par serveur. Utilisez \`/ticket dashboard\` pour modifier ou mettre à jour la configuration existante, ou sélectionnez **Supprimer le système** dans le tableau de bord pour le supprimer et recommencer à zéro.` });
            }

            const panelChannel =
                interaction.options.getChannel("panel_channel");
            const categoryChannel = interaction.options.getChannel("category");
            const closedCategoryChannel = interaction.options.getChannel("closed_category");
            const staffRole = interaction.options.getRole("staff_role");
            const panelMessage = interaction.options.getString("panel_message") || "Cliquez sur le bouton ci-dessous pour créer un ticket de support.";
            const buttonLabel =
                interaction.options.getString("button_label") ||
                "Créer un ticket";
            const maxTicketsPerUser = interaction.options.getInteger("max_tickets_per_user") || 3;
            const dmOnClose = interaction.options.getBoolean("dm_on_close") !== false;

            const setupEmbed = createEmbed({ 
                title: "Support - Tickets", 
                description: panelMessage,
                color: getColor('info')
            });

            const ticketButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("create_ticket")
                    .setLabel(buttonLabel)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji("📩"),
            );

            try {
                const sentPanel = await panelChannel.send({
                    embeds: [setupEmbed],
                    components: [ticketButton],
                });

                if (client.db && interaction.guildId) {
                    const currentConfig = existingConfig;
                    currentConfig.ticketCategoryId = categoryChannel ? categoryChannel.id : null;
                    currentConfig.ticketClosedCategoryId = closedCategoryChannel ? closedCategoryChannel.id : null;
                    currentConfig.ticketStaffRoleId = staffRole ? staffRole.id : null;
                    currentConfig.ticketPanelChannelId = panelChannel.id;
                    currentConfig.ticketPanelMessageId = sentPanel?.id || null;
                    currentConfig.ticketPanelMessage = panelMessage;
                    currentConfig.ticketButtonLabel = buttonLabel;
                    currentConfig.maxTicketsPerUser = maxTicketsPerUser;
                    currentConfig.dmOnClose = dmOnClose;

                    await setGuildConfig(client, interaction.guildId, currentConfig);
                    logger.info('Ticket configuration saved', {
                        guildId: interaction.guildId,
                        categoryId: categoryChannel?.id,
                        closedCategoryId: closedCategoryChannel?.id,
                        staffRoleId: staffRole?.id,
                        maxTickets: maxTicketsPerUser,
                        dmOnClose: dmOnClose,
                    });
                } else {
                    logger.error('Ticket setup: database unavailable, panel sent but configuration was NOT saved', {
                        guildId: interaction.guildId,
                    });
                }

                let successMessage = `Le panneau de création de tickets a été envoyé dans ${panelChannel}.`;
                
                if (categoryChannel) {
                    successMessage += `\nLes nouveaux tickets seront créés dans la catégorie **${categoryChannel.name}**.`;
                } else {
                    successMessage += '\nLes nouveaux tickets seront créés dans une nouvelle catégorie "Tickets".';
                }
                
                if (closedCategoryChannel) {
                    successMessage += `\nLes tickets fermés seront déplacés dans **${closedCategoryChannel.name}**.`;
                }
                
                if (staffRole) {
                    successMessage += `\nLe rôle **${staffRole.name}** aura accès aux tickets.`;
                }
                
                successMessage += `\n\n**Max de tickets par utilisateur :** ${maxTicketsPerUser}\n**MP à la fermeture :** ${dmOnClose ? 'Activé' : 'Désactivé'}`;

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        successEmbed(
                            "Panneau de tickets configuré",
                            successMessage,
                        ),
                    ],
                });

                logger.info('Ticket panel setup completed', {
                    userId: interaction.user.id,
                    userTag: interaction.user.tag,
                    guildId: interaction.guildId,
                    panelChannelId: panelChannel.id,
                    categoryId: categoryChannel?.id,
                    closedCategoryId: closedCategoryChannel?.id,
                    staffRoleId: staffRole?.id,
                    maxTickets: maxTicketsPerUser,
                    dmOnClose: dmOnClose,
                    commandName: 'ticket_setup'
                });

                const logEmbed = createEmbed({
                    title: "Configuration du système de tickets (Journal)",
                    description: `Le panneau de tickets a été configuré dans ${panelChannel} par ${interaction.user}.`,
                    color: getColor('warning')
                })
                    .addFields(
                        {
                            name: "Salon du panneau",
                            value: panelChannel.toString(),
                            inline: true,
                        },
                        {
                            name: "Catégorie des tickets",
                            value: categoryChannel
                                ? categoryChannel.toString()
                                : "Aucune spécifiée.",
                            inline: true,
                        },
                        {
                            name: "Catégorie fermée",
                            value: closedCategoryChannel
                                ? closedCategoryChannel.toString()
                                : "Aucune spécifiée.",
                            inline: true,
                        },
                        {
                            name: "Rôle du staff",
                            value: staffRole
                                ? staffRole.toString()
                                : "Aucun spécifié.",
                            inline: true,
                        },
                        {
                            name: "Max de tickets par utilisateur",
                            value: maxTicketsPerUser.toString(),
                            inline: true,
                        },
                        {
                            name: "MP à la fermeture",
                            value: dmOnClose ? 'Activé' : 'Désactivé',
                            inline: true,
                        },
                        {
                            name: "Modérateur",
                            value: `${interaction.user.tag} (${interaction.user.id})`,
                            inline: false,
                        },
                    );

            } catch (error) {
                logger.error('Ticket setup error', {
                    error: error.message,
                    stack: error.stack,
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'ticket_setup'
                });
                if (interaction.deferred || interaction.replied) {
                    await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Impossible d\'envoyer le panneau de tickets ou d\'enregistrer la configuration. Vérifiez les permissions du bot (notamment la permission d\'envoyer des messages dans le salon cible) et la connexion à la base de données.' }).catch(err => {
                        logger.error('Failed to send error reply', {
                            error: err.message,
                            guildId: interaction.guildId
                        });
                    });
                } else {
                    await handleInteractionError(interaction, error, {
                        commandName: 'ticket_setup',
                        source: 'ticket_setup_command'
                    });
                }
            }
        }
    }
};
