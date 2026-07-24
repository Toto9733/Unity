import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const SLUT_COOLDOWN = 45 * 60 * 1000;

const SLUT_ACTIVITIES = [
    { name: "Stream Cam", min: 120, max: 450, risk: 0.2 },
    { name: "Session de Danse Privée", min: 220, max: 700, risk: 0.25 },
    { name: "Hôte(sse) de Club VIP", min: 320, max: 900, risk: 0.3 },
    { name: "Réservation de Compagnon VIP", min: 550, max: 1400, risk: 0.35 },
    { name: "Live Exclusif", min: 850, max: 2200, risk: 0.4 },
];

const POSITIVE_OUTCOMES = [
    "Votre stream a explosé et les pourboires ont afflué.",
    "Une réservation VIP a payé bien au-dessus de la moyenne.",
    "Votre service de nuit s'est avéré complet et très rentable.",
    "Des demandes premium sont passées et vos gains ont grimpé.",
];

const FINE_OUTCOMES = [
    "La sécurité du lieu vous a infligé une amende de conformité.",
    "Un signalement de modération a déclenché des frais de plateforme.",
    "Vous avez été repéré(e) et avez dû payer une pénalité.",
];

const ROBBED_OUTCOMES = [
    "Une rétrofacturation de faux acheteur a effacé une partie de vos gains.",
    "Une fausse réservation a nettoyé une tranche de votre argent.",
    "Vous vous êtes fait piéger par un faux compte et avez perdu de l'argent.",
];

const LOSS_OUTCOMES = [
    "La prestation a fait un flop et vous avez dû couvrir les frais de fonctionnement.",
    "Vous avez gaspillé votre budget en préparatifs sans aucun retour.",
    "Le shift a tourné au vinaigre et vous a mis(e) dans le rouge.",
];

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function resolveOutcome(activity, wallet) {
    const successChance = Math.max(0.35, 0.55 - activity.risk * 0.2);
    const fineChance = 0.22;
    const robbedChance = 0.2;
    const roll = Math.random();

    if (roll < successChance) {
        const amount = randomInt(activity.min, activity.max);
        return {
            type: 'payout',
            delta: amount,
            message: randomChoice(POSITIVE_OUTCOMES),
            title: `${activity.name} - Gain`
        };
    }

    const remainingAfterSuccess = roll - successChance;

    if (remainingAfterSuccess < fineChance) {
        const maxFine = Math.min(wallet, Math.max(150, Math.floor(activity.max * 0.4)));
        const minFine = Math.min(maxFine, Math.max(50, Math.floor(activity.min * 0.2)));
        const amount = maxFine > 0 ? randomInt(minFine, maxFine) : 0;
        return {
            type: 'fine',
            delta: -amount,
            message: randomChoice(FINE_OUTCOMES),
            title: `${activity.name} - Amende`
        };
    }

    if (remainingAfterSuccess < fineChance + robbedChance) {
        const maxRobbed = Math.min(wallet, Math.max(200, Math.floor(wallet * 0.35)));
        const minRobbed = Math.min(maxRobbed, Math.max(75, Math.floor(wallet * 0.1)));
        const amount = maxRobbed > 0 ? randomInt(minRobbed, maxRobbed) : 0;
        return {
            type: 'robbed',
            delta: -amount,
            message: randomChoice(ROBBED_OUTCOMES),
            title: `${activity.name} - Volé(e)`
        };
    }

    const maxLoss = Math.min(wallet, Math.max(100, Math.floor(activity.max * 0.3)));
    const minLoss = Math.min(maxLoss, Math.max(40, Math.floor(activity.min * 0.15)));
    const amount = maxLoss > 0 ? randomInt(minLoss, maxLoss) : 0;
    return {
        type: 'loss',
        delta: -amount,
        message: randomChoice(LOSS_OUTCOMES),
        title: `${activity.name} - Perte`
    };
}

export default {
    data: new SlashCommandBuilder()
        .setName('salope')
        .setDescription('Faire des petits boulots louches pour gagner de l\'argent (ou tout perdre)'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const now = Date.now();

            logger.debug(`[ECONOMY] Commande salope lancée pour ${userId}`, { userId, guildId });

            const userData = await getEconomyData(client, guildId, userId);

            if (!userData) {
                throw createError(
                    "Failed to load economy data for salope command",
                    ErrorTypes.DATABASE,
                    "Impossible de charger vos données économiques. Veuillez réessayer plus tard.",
                    { userId, guildId }
                );
            }

            const lastSlut = userData.lastSlut || 0;

            if (now - lastSlut < SLUT_COOLDOWN) {
                const remainingTime = lastSlut + SLUT_COOLDOWN - now;
                throw createError(
                    "Slut cooldown active",
                    ErrorTypes.RATE_LIMIT,
                    `Vous devez attendre avant de pouvoir recommencer ! Réessayez dans **${Math.ceil(remainingTime / 60000)}** minutes.`,
                    { timeRemaining: remainingTime, cooldownType: 'salope' }
                );
            }

            const activity = randomChoice(SLUT_ACTIVITIES);

            const outcome = resolveOutcome(activity, userData.wallet || 0);

            userData.lastSlut = now;
            userData.totalSluts = (userData.totalSluts || 0) + 1;
            userData.totalSlutEarnings = (userData.totalSlutEarnings || 0) + Math.max(0, outcome.delta);
            userData.totalSlutLosses = (userData.totalSlutLosses || 0) + Math.max(0, -outcome.delta);

            if (outcome.type !== 'payout') {
                userData.failedSluts = (userData.failedSluts || 0) + 1;
            }

            userData.wallet = Math.max(0, (userData.wallet || 0) + outcome.delta);

            await setEconomyData(client, guildId, userId, userData);

            logger.info(`[ECONOMY_TRANSACTION] Activité salope résolue`, {
                userId,
                guildId,
                activity: activity.name,
                outcomeType: outcome.type,
                amountDelta: outcome.delta,
                newWallet: userData.wallet,
                timestamp: new Date().toISOString()
            });

            const amountLabel = `${outcome.delta >= 0 ? '+' : '-'}${Math.abs(outcome.delta).toLocaleString()} pièces`;
            const summaryLines = [
                `${outcome.message}`,
                `💸 **Résultat net :** ${amountLabel}`,
                `💳 **Solde actuel :** ${userData.wallet.toLocaleString()} pièces`,
                `📊 **Total des sessions :** ${userData.totalSluts}`,
                `💵 **Total gagné :** ${(userData.totalSlutEarnings || 0).toLocaleString()} pièces`,
                `🧾 **Total perdu :** ${(userData.totalSlutLosses || 0).toLocaleString()} pièces`
            ];

            const embed = createEmbed({
                title: outcome.title,
                description: summaryLines.join('\n'),
                color: outcome.delta >= 0 ? 'success' : 'error',
                timestamp: true
            });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'salope' })
};
