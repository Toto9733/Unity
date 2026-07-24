import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const EMBED_DESCRIPTION_LIMIT = 4096;

export default {
    data: new SlashCommandBuilder()
    .setName("combat")
    .setDescription("Lance un combat textuel simulé en 1v1.")
    .addUserOption((option) =>
      option
        .setName("adversaire")
        .setDescription("L'utilisateur à affronter.")
        .setRequired(true),
    ),
  category: 'Loisir',

  async execute(interaction, config, client) {
    await InteractionHelper.safeDefer(interaction);

    const challenger = interaction.user;
    const opponent = interaction.options.getUser("adversaire");

    if (challenger.id === opponent.id) {
      const embed = warningEmbed(
        "⚔️ Défi invalide",
        `**${challenger.username}**, vous ne pouvez pas vous battre vous-même ! C'est un match nul avant même d'avoir commencé.`
      );
      return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }

    if (opponent.bot) {
      const embed = warningEmbed(
        "⚔️ Adversaire invalide",
        "Vous ne pouvez pas vous battre contre des bots ! Défiez une vraie personne à la place."
      );
      return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }

    const winner = rand(0, 1) === 0 ? challenger : opponent;
    const loser = winner.id === challenger.id ? opponent : challenger;
    const rounds = rand(3, 7);
    const damage = rand(10, 50);

    const log = [];
    log.push(
      `💥 **${challenger.username}** défie **${opponent.username}** en duel ! (Meilleur de ${rounds} rounds)`,
    );

    for (let i = 1; i <= rounds; i++) {
      const attacker = rand(0, 1) === 0 ? challenger : opponent;
      const target = attacker.id === challenger.id ? opponent : challenger;
      const action = [
        "lance un coup de poing sauvage",
        "inflige un coup critique",
        "utilise un sort faible",
        "pare et contre-attaque",
      ][rand(0, 3)];
      log.push(
        `\n**Round ${i} :** ${attacker.username} ${action} sur ${target.username} pour ${rand(1, damage)} de dégâts !`,
      );
    }

    const outcomeText = log.join("\n");
    const winnerText = `👑 **${winner.username}** a vaincu ${loser.username} et remporte la victoire !`;
    const fullDescription = `${outcomeText}\n\n${winnerText}`;

    const description = fullDescription.length <= EMBED_DESCRIPTION_LIMIT
      ? fullDescription
      : `${fullDescription.slice(0, EMBED_DESCRIPTION_LIMIT - 15)}\n\n...`;

    const embed = successEmbed(
      "🏆 Duel terminé !",
      description
    );

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    logger.debug(`Commande combat exécutée entre ${challenger.id} et ${opponent.id} sur le serveur ${interaction.guildId}`);
  },
};
