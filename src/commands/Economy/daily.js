import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { getGuildConfig } from '../../services/config/guildConfig.js';
import { formatDuration } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { botConfig } from '../../config/bot.js';

const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;
const DAILY_AMOUNT = botConfig.economy?.dailyAmount ?? 100;
const PREMIUM_BONUS_PERCENTAGE = 0.1;

export default {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription("Récupérez votre récompense en espèces quotidienne"),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const now = Date.now();

            logger.debug(`[ECONOMY] Récompense quotidienne démarrée pour ${userId}`, { userId, guildId });

            const userData = await getEconomyData(client, guildId, userId);
            
            if (!userData) {
                throw createError(
                    "Failed to load economy data for daily",
                    ErrorTypes.DATABASE,
                    "Échec du chargement de vos données économiques. Veuillez réessayer plus tard.",
                    { userId, guildId }
                );
            }
            
            const lastDaily = userData.lastDaily || 0;

            if (now < lastDaily + DAILY_COOLDOWN) {
                const timeRemaining = lastDaily + DAILY_COOLDOWN - now;
                throw createError(
                    "Daily cooldown active",
                    ErrorTypes.RATE_LIMIT,
                    `Vous devez attendre avant de récupérer votre récompense quotidienne à nouveau. Réessayez dans **${formatDuration(timeRemaining)}**.`,
                    { timeRemaining, cooldownType: 'daily' }
                );
            }

            const guildConfig = await getGuildConfig(client, guildId);
            const PREMIUM_ROLE_ID = guildConfig.premiumRoleId;

            let earned = DAILY_AMOUNT;
            let bonusMessage = "";
            let hasPremiumRole = false;

            if (
                PREMIUM_ROLE_ID &&
                interaction.member &&
                interaction.member.roles.cache.has(PREMIUM_ROLE_ID)
            ) {
                const bonusAmount = Math.floor(
                    DAILY_AMOUNT * PREMIUM_BONUS_PERCENTAGE,
                );
                earned += bonusAmount;
                bonusMessage = `\n✨ **Bonus Premium :** +$${bonusAmount.toLocaleString()}`;
                hasPremiumRole = true;
            }

            userData.wallet = (userData.wallet || 0) + earned;
            userData.lastDaily = now;

            await setEconomyData(client, guildId, userId, userData);

            logger.info(`[ECONOMY_TRANSACTION] Quotidien récupéré`, {
                userId,
                guildId,
                amount: earned,
                newWallet: userData.wallet,
                hasPremium: hasPremiumRole,
                timestamp: new Date().toISOString()
            });

            const embed = successEmbed(
                "✅ Récompense quotidienne récupérée !",
                `Vous avez récupéré votre récompense quotidienne de **$${earned.toLocaleString()}** !${bonusMessage}`
            )
                .addFields({
                    name: "Nouveau solde en espèces",
                    value: `$${userData.wallet.toLocaleString()}`,
                    inline: true,
                })
                .setFooter({
                    text: hasPremiumRole
                        .valueOf()
                        ? `Prochaine réclamation dans 24 heures. (Premium actif)`
                        : `Prochaine réclamation dans 24 heures.`,
                });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'daily' })
};
