import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getUserLevelData, getLevelingConfig, getXpForLevel } from '../../services/leveling/leveling.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
  data: new SlashCommandBuilder()
    .setName('rang')
    .setDescription("Vérifie votre rang et niveau ou celui d'un autre utilisateur")
    .addUserOption((option) =>
      option
        .setName('utilisateur')
        .setDescription("L'utilisateur dont vous voulez vérifier le rang")
        .setRequired(false)
    )
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

    const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
    const member = await interaction.guild.members
      .fetch(targetUser.id)
      .catch(() => null);

    if (!member) {
      throw new TitanBotError(
        `Utilisateur ${targetUser.id} introuvable sur le serveur`,
        ErrorTypes.USER_INPUT,
        "Impossible de trouver l'utilisateur spécifié sur ce serveur."
      );
    }

    const userData = await getUserLevelData(client, interaction.guildId, targetUser.id);

    const safeUserData = {
      level: userData?.level ?? 0,
      xp: userData?.xp ?? 0,
      totalXp: userData?.totalXp ?? 0
    };

    const xpNeeded = getXpForLevel(safeUserData.level + 1);
    const progress = xpNeeded > 0 ? Math.floor((safeUserData.xp / xpNeeded) * 100) : 0;
    const progressBar = createProgressBar(progress, 20);

    const embed = new EmbedBuilder()
      .setTitle(`Rang de ${member.displayName}`)
      .setThumbnail(member.displayAvatarURL({ dynamic: true }))
      .addFields(
        {
          name: 'Niveau',
          value: safeUserData.level.toString(),
          inline: true
        },
        {
          name: 'XP',
          value: `${safeUserData.xp}/${xpNeeded}`,
          inline: true
        },
        {
          name: 'XP Totale',
          value: safeUserData.totalXp.toString(),
          inline: true
        },
        {
          name: `Progression vers le niveau ${safeUserData.level + 1}`,
          value: `${progressBar} ${progress}%`
        }
      )
      .setColor('#2ecc71')
      .setTimestamp();

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    logger.debug(`Vérification du rang pour l'utilisateur ${targetUser.id} sur le serveur ${interaction.guildId}`);
  }
};

function createProgressBar(percentage, length = 10) {
  if (percentage < 0 || percentage > 100) {
    percentage = Math.max(0, Math.min(100, percentage));
  }
  const filled = Math.round((percentage / 100) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}
