import { PermissionsBitField, EmbedBuilder, MessageFlags } from 'discord.js';
import { getGuildConfig, setGuildConfig } from '../../../services/config/guildConfig.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';

export default {
    async execute(interaction, config, client) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('Permission refusée')
                .setDescription("Tu as besoin de la permission **Gérer le serveur** pour configurer le salon des anniversaires.");
            return InteractionHelper.safeReply(interaction, {
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
            });
        }

        try {
            const channel = interaction.options.getChannel('channel');
            const guildId = interaction.guildId;
            const guildConfig = await getGuildConfig(client, guildId);

            if (channel) {
                guildConfig.birthdayChannelId = channel.id;
                await setGuildConfig(client, guildId, guildConfig);
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle("Annonces d'anniversaire activées")
                    .setDescription(`Les annonces d'anniversaire seront désormais publiées dans ${channel}.`);
                return InteractionHelper.safeReply(interaction, {
                    embeds: [embed],
                    flags: MessageFlags.Ephemeral,
                });
            } else {
                guildConfig.birthdayChannelId = null;
                await setGuildConfig(client, guildId, guildConfig);
                const embed = new EmbedBuilder()
                    .setColor(0xFFFF00)
                    .setTitle("Annonces d'anniversaire désactivées")
                    .setDescription("Aucun salon fourni — les annonces d'anniversaire ont été désactivées.");
                return InteractionHelper.safeReply(interaction, {
                    embeds: [embed],
                    flags: MessageFlags.Ephemeral,
                });
            }
        } catch (error) {
            logger.error('birthday_setchannel error:', error);
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle("⚠️ Erreur de configuration")
                .setDescription("Impossible d'enregistrer la configuration du salon des anniversaires.");
            return InteractionHelper.safeReply(interaction, {
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
