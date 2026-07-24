import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getLeaderboard, getLevelingConfig, getXpForLevel } from '../../services/leveling/leveling.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
  data: new SlashCommandBuilder()
    .setName('classement')
    .setDescription("Affiche le classement des niveaux du serveur")
    .setDMPermission(false),
  category: 'Niveaux',

  async execute(interaction, config, client) {
    await InteractionHelper.safeDefer(interaction);

    const levelingConfig = await getLevelingConfig(client, interaction.guildId);

    if (!levelingConfig?.enabled) {
      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          new EmbedBuilder()
            .setColor('#f1c40f')
            .setDescription('Le système de niveaux est actuellement désactivé sur ce serveur.')
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const leaderboard = await getLeaderboard(client, interaction.guildId, 10);

    if (leaderboard.length === 0) {
      throw new TitanBotError(
        'No leaderboard data found',
        ErrorTypes.DATABASE,
        'Aucune donnée de niveau trouvée pour le moment. Commencez à discuter pour gagner de l\'XP !'
      );
    }

    const embed = new EmbedBuilder()
      .setTitle('Classement des niveaux')
      .setColor('#2ecc71')
      .setDescription("Top 10 des membres les plus actifs sur ce serveur :")
      .setTimestamp();

    const leaderboardText = await Promise.all(
      leaderboard.map(async (user, index) => {
        try {
          const member = await interaction.guild.members.fetch(user.userId).catch(() => null);
          const userMention = member?.user.toString() || `<@${user.userId}>`;
          const xpForNextLevel = getXpForLevel(user.level + 1);

          let rankPrefix = `${index + 1}.`;
          if (index === 0) rankPrefix = '🥇';
          else if (index === 1) rankPrefix = '🥈';
          else if (index === 2) rankPrefix = '🥉';
          else rankPrefix = `**${index + 1}.**`;

          return `${rankPrefix} ${userMention} - Niveau ${user.level} (${user.xp}/${xpForNextLevel} XP)`;
        } catch {
          return `**${index + 1}.** Erreur lors du chargement de l'utilisateur ${user.userId}`;
        }
      })
    );

    embed.addFields({
      name: 'Classement',
      value: leaderboardText.join('\n')
    });

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    logger.debug(`Classement affiché pour le serveur ${interaction.guildId}`);
  }
};
