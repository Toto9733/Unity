import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
// Importe ici ta fonction pour ajouter de l'argent aux utilisateurs (ex: addBalance)
// import { addBalance } from '../../services/economyService.js';

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

            // Définis tes codes valides ici (tu pourras les stocker en base de données plus tard)
            const validCodes = {
                'unity': 10000,
            };

            if (!validCodes[codeInput]) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.VALIDATION,
                    message: 'Ce code promo est invalide ou a expiré.',
                });
            }

            const reward = validCodes[codeInput];

            // TODO: Ajoute ici l'appel à ta fonction d'économie pour créditer l'utilisateur
            // await addBalance(guildId, userId, reward);

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
                message: 'Une erreur est survenue lors de l\'utilisation du code promo.',
            });
        }
    },
};
