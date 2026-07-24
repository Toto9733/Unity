import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("pileouface")
        .setDescription("Lance une pièce (Pile ou Face) en pariant de l'argent.")
        .addStringOption(option =>
            option
                .setName("choix")
                .setDescription("Pile ou Face")
                .setRequired(true)
                .addChoices(
                    { name: 'Pile', value: 'pile' },
                    { name: 'Face', value: 'face' }
                )
        )
        .addIntegerOption(option =>
            option
                .setName("montant")
                .setDescription("Le montant à parier")
                .setRequired(true)
                .setMinValue(1)
        ),
    category: 'Économie',

    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const userChoice = interaction.options.getString("choix");
        const betAmount = interaction.options.getInteger("montant");

        const userData = await getEconomyData(client, guildId, userId);

        if (userData.wallet < betAmount) {
            const embed = warningEmbed(
                "Fonds insuffisants",
                `Vous avez besoin de **$${betAmount.toLocaleString()}** pour placer ce pari, mais vous n'avez que **$${userData.wallet.toLocaleString()}** en espèces.`
            );
            return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }

        const result = Math.random() < 0.5 ? "pile" : "face";
        const resultDisplay = result === "pile" ? "Pile" : "Face";
        const emoji = result === "pile" ? "🪙" : "🔮";

        const won = userChoice === result;

        if (won) {
            userData.wallet += betAmount;
        } else {
            userData.wallet -= betAmount;
        }

        await setEconomyData(client, guildId, userId, userData);

        const description = `La pièce est tombée sur... **${resultDisplay}** ${emoji} !\n\n` +
            (won 
                ? `🎉 Vous avez gagné **$${betAmount.toLocaleString()}** !` 
                : `💸 Vous avez perdu **$${betAmount.toLocaleString()}**.`);

        const embed = successEmbed(
            won ? "Victoire !" : "Défaite !",
            description
        ).addFields({
            name: "Nouveau solde",
            value: `$${userData.wallet.toLocaleString()}`,
            inline: true,
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        logger.debug(`Commande pileouface avec pari exécutée par l'utilisateur ${userId} sur le serveur ${guildId}`);
    },
};
