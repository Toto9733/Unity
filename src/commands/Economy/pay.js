import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, addMoney, removeMoney, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import EconomyService from '../../services/economyService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('payer')
        .setDescription('Payer un autre utilisateur avec votre argent liquide')
        .addUserOption(option =>
            option
                .setName('utilisateur')
                .setDescription('Utilisateur à payer')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('montant')
                .setDescription('Montant à payer')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const senderId = interaction.user.id;
            const receiver = interaction.options.getUser("utilisateur");
            const amount = interaction.options.getInteger("montant");
            const guildId = interaction.guildId;

            logger.debug(`[ECONOMY] Commande payer initiée`, { 
                senderId, 
                receiverId: receiver.id,
                amount,
                guildId
            });

            if (receiver.bot) {
                throw createError(
                    "Cannot pay bot",
                    ErrorTypes.VALIDATION,
                    "Vous ne pouvez pas payer un bot.",
                    { receiverId: receiver.id, isBot: true }
                );
            }
            
            if (receiver.id === senderId) {
                throw createError(
                    "Cannot pay self",
                    ErrorTypes.VALIDATION,
                    "Vous ne pouvez pas vous payer vous-même.",
                    { senderId, receiverId: receiver.id }
                );
            }
            
            if (amount <= 0) {
                throw createError(
                    "Invalid payment amount",
                    ErrorTypes.VALIDATION,
                    "Le montant doit être supérieur à zéro.",
                    { amount, senderId }
                );
            }

            const [senderData, receiverData] = await Promise.all([
                getEconomyData(client, guildId, senderId),
                getEconomyData(client, guildId, receiver.id)
            ]);

            if (!senderData) {
                throw createError(
                    "Failed to load sender economy data",
                    ErrorTypes.DATABASE,
                    "Impossible de charger vos données économiques. Veuillez réessayer plus tard.",
                    { userId: senderId, guildId }
                );
            }
            
            if (!receiverData) {
                throw createError(
                    "Failed to load receiver economy data",
                    ErrorTypes.DATABASE,
                    "Impossible de charger les données économiques du destinataire. Veuillez réessayer plus tard.",
                    { userId: receiver.id, guildId }
                );
            }

            const result = await EconomyService.transferMoney(
                client, 
                guildId, 
                senderId, 
                receiver.id, 
                amount
            );

            const updatedSenderData = await getEconomyData(client, guildId, senderId);
            const updatedReceiverData = await getEconomyData(client, guildId, receiver.id);

            const embed = successEmbed(
                'Paiement réussi',
                `Vous avez payé avec succès **${receiver.username}** d'un montant de **${amount.toLocaleString()}** pièces !`
            )
                .addFields(
                    {
                        name: "Montant du paiement",
                        value: `${amount.toLocaleString()} pièces`,
                        inline: true,
                    },
                    {
                        name: "Votre nouveau solde",
                        value: `${updatedSenderData.wallet.toLocaleString()} pièces`,
                        inline: true,
                    },
                )
                .setFooter({
                    text: `Payé à ${receiver.tag}`,
                    iconURL: receiver.displayAvatarURL(),
                });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

            logger.info(`[ECONOMY] Paiement envoyé avec succès`, {
                senderId,
                receiverId: receiver.id,
                amount,
                senderBalance: updatedSenderData.wallet,
                receiverBalance: updatedReceiverData.wallet
            });

            try {
                const receiverEmbed = createEmbed({ 
                    title: "Paiement reçu !", 
                    description: `${interaction.user.username} vous a payé **${amount.toLocaleString()}** pièces.` 
                }).addFields({
                    name: "Votre nouvel argent liquide",
                    value: `${updatedReceiverData.wallet.toLocaleString()} pièces`,
                    inline: true,
                });
                await receiver.send({ embeds: [receiverEmbed] });
            } catch (e) {
                    logger.warn(`Impossible d'envoyer un MP à l'utilisateur ${receiver.id}: ${e.message}`);
            }
    }, { command: 'payer' })
};
