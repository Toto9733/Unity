import { EmbedBuilder } from 'discord.js';
import { getUpcomingBirthdays } from '../../../services/birthdayService.js';
import { deleteBirthday } from '../../../utils/database.js';
import { logger } from '../../../utils/logger.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
export default {
    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const next5 = await getUpcomingBirthdays(client, interaction.guildId, 5);

        if (next5.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle("Aucun anniversaire trouvé")
                .setDescription("Aucun anniversaire n'a encore été configuré sur ce serveur. Utilise `/birthday set` pour ajouter des anniversaires !");
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed]
            });
        }

        let displayIndex = 0;
        for (const birthday of next5) {
            const member = await interaction.guild.members.fetch(birthday.userId).catch(() => null);
            if (!member) {
                deleteBirthday(client, interaction.guildId, birthday.userId).catch(() => null);
                continue;
            }
            displayIndex++;

            let timeUntil = '';
            if (birthday.daysUntil === 0) {
                timeUntil = "🎉 **Aujourd'hui !**";
            } else if (birthday.daysUntil === 1) {
                timeUntil = "📅 **Demain !**";
            } else {
                timeUntil = `Dans ${birthday.daysUntil} jour${birthday.daysUntil > 1 ? 's' : ''}`;
            }
        }

        if (displayIndex === 0) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle("Aucun prochain anniversaire")
                .setDescription("Aucun prochain anniversaire trouvé pour les membres actuels du serveur.");
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed]
            });
        }

        let birthdayList = `🎂 **Prochains anniversaires**\n\nVoici les 5 prochains anniversaires sur ${interaction.guild.name} :\n\n`;
        displayIndex = 0;
        for (const birthday of next5) {
            const member = await interaction.guild.members.fetch(birthday.userId).catch(() => null);
            if (!member) {
                continue;
            }
            displayIndex++;

            let timeUntil = '';
            if (birthday.daysUntil === 0) {
                timeUntil = "🎉 **Aujourd'hui !**";
            } else if (birthday.daysUntil === 1) {
                timeUntil = "📅 **Demain !**";
            } else {
                timeUntil = `Dans ${birthday.daysUntil} jour${birthday.daysUntil > 1 ? 's' : ''}`;
            }

            birthdayList += `${displayIndex}. **${member.displayName}**\n<@${birthday.userId}>\n📅 **Date :** ${birthday.day} ${birthday.monthName}\n⏰ **Temps :** ${timeUntil}\n\n`;
        }

        birthdayList += `Utilise /birthday set pour ajouter ton anniversaire !`;

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle("Les 5 prochains anniversaires")
            .setDescription(birthdayList);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed]
        });

        logger.info('Next birthdays retrieved successfully', {
            userId: interaction.user.id,
            guildId: interaction.guildId,
            upcomingCount: displayIndex,
            commandName: 'next_birthdays'
        });
    }
};
