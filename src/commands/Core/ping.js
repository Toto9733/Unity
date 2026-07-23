import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Vérifie la latence du bot et la vitesse de l'API"),

    async prefixExecute(interaction) {
        try {
            const startTime = Date.now();
            const pingingMessage = await interaction.reply({ content: 'Calcul du ping...' });

            const latency = Date.now() - startTime;
            const apiLatency = Math.max(0, Math.round(interaction.client.ws.ping));

            const embed = createEmbed({ title: 'Pong !', description: null }).addFields(
                { name: 'Latence du Bot', value: `${latency}ms`, inline: true },
                { name: "Latence de l'API", value: `${apiLatency}ms`, inline: true },
            );

            await pingingMessage.edit({ content: null, embeds: [embed] });
        } catch (error) {
            logger.error('Erreur de la commande prefix ping :', error);
            if (!interaction.replied && !interaction._replyMessage) {
                await interaction.channel.send({
                    embeds: [createEmbed({ title: 'Erreur système', description: "Impossible de déterminer la latence pour le moment.", color: 'error' })],
                }).catch(() => {});
            }
        }
    },

    async execute(interaction) {
        logger.info('execute appelé - vérification si commande slash ou prefix');
        logger.info(`execute - has _commandStartTime: ${!!interaction._commandStartTime}, createdTimestamp: ${interaction.createdTimestamp}`);
        
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Le différé de l'interaction ping a échoué`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'ping'
            });
            return;
        }

        try {
            await InteractionHelper.safeEditReply(interaction, {
                content: "Calcul du ping...",
            });

            const startTime = interaction._commandStartTime || interaction.createdTimestamp;
            logger.info(`execute - utilisation de startTime: ${startTime}, type: ${interaction._commandStartTime ? 'prefix' : 'slash'}`);
            const latency = Math.max(0, Date.now() - startTime);
            const apiLatency = Math.max(0, Math.round(interaction.client.ws.ping));
            logger.info(`execute - latence calculée : ${latency}ms, apiLatency : ${apiLatency}ms`);

            const embed = createEmbed({ title: "Pong !", description: null }).addFields(
                { name: "Latence du Bot", value: `${latency}ms`, inline: true },
                { name: "Latence de l'API", value: `${apiLatency}ms`, inline: true },
            );

            await InteractionHelper.safeEditReply(interaction, {
                content: null,
                embeds: [embed],
            });
        } catch (error) {
            logger.error('Erreur de la commande ping :', error);
            try {
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [createEmbed({ title: 'Erreur système', description: "Impossible de déterminer la latence pour le moment.", color: 'error' })],
                    flags: MessageFlags.Ephemeral,
                });
            } catch (replyError) {
                logger.error("Échec de l'envoi de la réponse d'erreur :", replyError);
            }
        }
    },
};
