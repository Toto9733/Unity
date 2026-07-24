import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import EconomyService from '../../services/economyService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('promo')
        .setDescription('Utiliser un code promo pour obtenir des pièces')
        .addStringOption((option) =>
            option
                .setName('code')
                .setDescription('Le code promo à entrer')
                .setRequired(true),
        ),
    category: 'Economy',

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const codeInput = interaction.options.getString('code').trim().toLowerCase();
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const client = interaction.client;

            // Définis tes codes valides et leurs montants ici
            const validCodes = {
                'unity': 10000,'start': 5000,
                'vip': 20000,
            };

            if (!validCodes[codeInput]) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.VALIDATION,
                    message: 'Ce code promo est invalide ou a expiré.',
                });
            }

            const reward = validCodes[codeInput];

            // Utilise la méthode addMoney de ton service d'économie
            await EconomyService.addMoney(client, guildId, userId, reward, 'promo_code_' + codeInput);

            return await interaction.editReply({
                embeds: [
                    successEmbed(
                        'Code promo validé !',
                        `Félicitations ! Tu as utilisé le code **${codeInput.toUpperCase()}** et tu as reçu **${reward.toLocaleString()}** pièces 🪙.`,
                    ),
                ],
            });
        } catch (error) {
            console.error('Erreur lors de la commande promo :', error);
            return await replyUserError(interaction, {
                type: ErrorTypes.UNKNOWN,
                message: error.userMessage || 'Une erreur est survenue lors de l\'utilisation du code promo.',
            });
        }
    },
};
