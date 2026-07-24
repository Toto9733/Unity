
import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getTicketPermissionContext } from '../../utils/ticket/ticketPermissions.js';
import { updateTicketPriority } from '../../services/ticket.js';

export default {
    data: new SlashCommandBuilder()
        .setName("priority")
        .setDescription("Définit le niveau de priorité du ticket de support actuel.")
        .addStringOption((option) =>
            option
                .setName("level")
                .setDescription("Le niveau de priorité pour le ticket.")
                .setRequired(true)
                .addChoices(
                    { name: "Urgent", value: "urgent" },
                    { name: "Élevé", value: "high" },
                    { name: "Moyen", value: "medium" },
                    { name: "Faible", value: "low" },
                    { name: "Aucun", value: "none" },
                ),
            )
        .setDMPermission(false),
    category: "Ticket",

    async execute(interaction, guildConfig, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) {
            return;
        }

        const permissionContext = await getTicketPermissionContext({ client, interaction });
        if (!permissionContext.ticketData) {
            return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Cette commande ne peut être utilisée que dans un salon de ticket valide.' });
        }

        if (!permissionContext.canManageTicket) {
            return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'Vous avez besoin de la permission `Gérer les salons` ou du rôle du staff des tickets configuré pour modifier la priorité du ticket.' });
        }

        const priorityLevel = interaction.options.getString("level");
        await updateTicketPriority(interaction.channel, priorityLevel, interaction.user);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                successEmbed(
                    "Priorité mise à jour",
                    `La priorité du ticket a été définie sur **${priorityLevel.toUpperCase()}**.`,
                ),
            ],
        });

        logger.info('Priorité du ticket mise à jour avec succès', {
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            channelId: interaction.channel.id,
            channelName: interaction.channel.name,
            guildId: interaction.guildId,
            priority: priorityLevel,
            commandName: 'priority'
        });
    },
};

```
