import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { checkUserPermissions } from '../../utils/permissionGuard.js';
import { addLevels, getLevelingConfig } from '../../services/leveling/leveling.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
  data: new SlashCommandBuilder()
    .setName('niveauxajouter')
    .setDescription("Ajoute des niveaux à un utilisateur")
    .addUserOption((option) =>
      option
        .setName('utilisateur')
        .setDescription("L'utilisateur à qui ajouter des niveaux")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('niveaux')
        .setDescription('Nombre de niveaux à ajouter')
        .setRequired(true)
        .setMinValue(1)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  category: 'Niveaux',

  async execute(interaction, config, client) {
    await InteractionHelper.safeDefer(interaction);

    const hasPermission = await checkUserPermissions(
      interaction,
      PermissionFlagsBits.ManageGuild,
      "Vous avez besoin de la permission Gérer le serveur pour utiliser cette commande."
    );
    if (!hasPermission) return;

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

    const targetUser = interaction.options.getUser('utilisateur');
    const levelsToAdd = interaction.options.getInteger('niveaux');

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      throw new TitanBotError(
        `Utilisateur ${targetUser.id} introuvable sur ce serveur`,
        ErrorTypes.USER_INPUT,
        "L'utilisateur spécifié n'est pas sur ce serveur."
      );
    }

    const userData = await addLevels(client, interaction.guildId, targetUser.id, levelsToAdd);

    await InteractionHelper.safeEditReply(interaction, {
      embeds: [
        createEmbed({
          title: 'Niveaux ajoutés',
          description: `${levelsToAdd} niveau(x) ajouté(s) avec succès à ${targetUser.tag}.\n**Nouveau niveau :** ${userData.level}`,
          color: 'success'
        })
      ]
    });

    logger.info(
      `[ADMIN] L'utilisateur ${interaction.user.tag} a ajouté ${levelsToAdd} niveaux à ${targetUser.tag} sur le serveur ${interaction.guildId}`
    );
  }
};
