
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { checkUserPermissions } from '../../utils/permissionGuard.js';
import { setUserLevel, getLevelingConfig } from '../../services/leveling/leveling.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('level')
        .setDescription("Gère le système de niveaux")
        .addSubcommand((subcommand) =>
            subcommand
                .setName('set')
                .setDescription("Définit le niveau d'un utilisateur à une valeur spécifique")
                .addUserOption((option) =>
                    option
                        .setName('utilisateur')
                        .setDescription("L'utilisateur dont il faut définir le niveau")
                        .setRequired(true)
                )
                .addIntegerOption((option) =>
                    option
                        .setName('niveau')
                        .setDescription('Le niveau à attribuer')
                        .setRequired(true)
                        .setMinValue(0)
                )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),
    category: 'Niveaux',

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'set') {
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
            const newLevel = interaction.options.getInteger('niveau');

            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!member) {
                throw new TitanBotError(
                    `Utilisateur ${targetUser.id} introuvable sur ce serveur`,
                    ErrorTypes.USER_INPUT,
                    "L'utilisateur spécifié n'est pas sur ce serveur."
                );
            }

            const userData = await setUserLevel(client, interaction.guildId, targetUser.id, newLevel);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    createEmbed({
                        title: 'Niveau modifié',
                        description: `Le niveau de ${targetUser.tag} a été défini avec succès à **${newLevel}**.\n**XP Totale :** ${userData.totalXp}`,
                        color: 'success'
                    })
                ]
            });

            logger.info(
                `[ADMIN] L'utilisateur ${interaction.user.tag} a défini le niveau de ${targetUser.tag} à ${newLevel} sur le serveur ${interaction.guildId}`
            );
        }
    }
};
