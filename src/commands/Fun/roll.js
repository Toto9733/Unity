import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("lancer")
        .setDescription("Lance des dés en utilisant la notation standard (ex. : 2d20, 1d6 + 5).")
        .addStringOption((option) =>
            option
                .setName("notation")
                .setDescription("La notation des dés (ex. : 2d6, 1d20 + 4)")
                .setRequired(true)
                .setMaxLength(50),
        ),
    category: 'Fun',

    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const notation = interaction.options
            .getString("notation")
            .toLowerCase()
            .replace(/\s/g, "");

        const match = notation.match(/^(\d*)d(\d+)([\+\-]\d+)?$/);

        if (!match) {
            throw new TitanBotError(
                `Invalid dice notation: ${notation}`,
                ErrorTypes.USER_INPUT,
                'Notation invalide. Utilisez un format comme `1d20` ou `3d6+5`.'
            );
        }

        const numDice = parseInt(match[1] || "1", 10);
        const numSides = parseInt(match[2], 10);
        const modifier = parseInt(match[3] || "0", 10);

        if (numDice < 1 || numDice > 20) {
            throw new TitanBotError(
                `Too many dice requested: ${numDice}`,
                ErrorTypes.VALIDATION,
                'Veuillez garder le nombre de dés entre 1 et 20.'
            );
        }

        if (numSides < 1 || numSides > 1000) {
            throw new TitanBotError(
                `Invalid number of sides: ${numSides}`,
                ErrorTypes.VALIDATION,
                'Veuillez garder le nombre de faces entre 1 et 1000.'
            );
        }

        let rolls = [];
        let totalRoll = 0;

        for (let i = 0; i < numDice; i++) {
            const roll = Math.floor(Math.random() * numSides) + 1;
            rolls.push(roll);
            totalRoll += roll;
        }

        const finalTotal = totalRoll + modifier;

        const resultsDetail =
            numDice > 1 ? `**Lancers :** ${rolls.join(" + ")}\n` : "";
        const modifierText = modifier !== 0 ? `+ (${modifier})` : "";

        const embed = successEmbed(
            `🎲 Lancer de ${numDice}d${numSides}${modifier !== 0 ? match[3] : ""}`,
            `${resultsDetail}**Total du lancer :** ${totalRoll}${modifierText} = **${finalTotal}**`,
        );

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        logger.debug(`Commande de lancer exécutée par l'utilisateur ${interaction.user.id} avec la notation ${notation} sur le serveur ${interaction.guildId}`);
    },
};
