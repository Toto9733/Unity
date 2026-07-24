import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { getUserBalance, updateUserBalance } from '../../../utils/database.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { logger } from '../../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('pileouface')
        .setDescription('Pariez de l\'argent sur un jeu de pile ou face !')
        .addIntegerOption(option =>
            option
                .setName('montant')
                .setDescription('Le montant à parier')
                .setRequired(true)
                .setMinValue(1),
        )
        .addStringOption(option =>
            option
                .setName('choix')
                .setDescription('Choisissez pile ou face')
                .setRequired(true)
                .addChoices(
                    { name: 'Pile', value: 'pile' },
                    { name: 'Face', value: 'face' },
                ),
        ),

    async execute(interaction, config, client) {
        const amount = interaction.options.getInteger('montant');
        const choice = interaction.options.getString('choix');
        const userId = interaction.user.id;
        const guildId = interaction.guild.id;

        const balance = await getUserBalance(client, guildId, userId);
        if (balance < amount) {
            throw new TitanBotError(
                'Solde insuffisant',
                ErrorTypes.ECONOMY,
                `Vous n'avez pas assez d'argent pour parier **${amount}** pièces. Votre solde actuel est de **${balance}** pièces.`,
            );
        }

        await updateUserBalance(client, guildId, userId, -amount);

        const embed = new EmbedBuilder()
            .setTitle('🪙 Pile ou Face')
            .setDescription(`Vous avez parié **${amount}** pièces sur **${choice.toUpperCase()}**.\n\nLa pièce est en train de tourner...`)
            .setColor(getColor('info'))
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        setTimeout(async () => {
            try {
                const result = Math.random() < 0.5 ? 'pile' : 'face';
                const won = result === choice;
                let newBalance;

                if (won) {
                    const winnings = amount * 2;
                    newBalance = await updateUserBalance(client, guildId, userId, winnings);
                } else {
                    newBalance = await getUserBalance(client, guildId, userId);
                }

                const resultEmbed = new EmbedBuilder()
                    .setTitle('🪙 Résultat du Pile ou Face')
                    .setDescription(
                        `La pièce est tombée sur : **${result.toUpperCase()}** !\n\n` +
                        (won
                            ? `🎉 **Gagné !** Vous remportez **${amount * 2}** pièces.\nNouveau solde : **${newBalance}** pièces.`
                            : `❌ **Perdu !** Vous avez perdu votre mise de **${amount}** pièces.\nNouveau solde : **${newBalance}** pièces.`),
                    )
                    .setColor(won ? getColor('success') : getColor('error'))
                    .setTimestamp();

                await interaction.editReply({ embeds: [resultEmbed] });
            } catch (error) {
                logger.error('Erreur dans le timer du pile ou face :', error);
            }
        }, 2500);
    },
};
