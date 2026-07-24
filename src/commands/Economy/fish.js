import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const FISH_COOLDOWN = 45 * 60 * 1000; 
const BASE_MIN_REWARD = 300;
const BASE_MAX_REWARD = 900;
const FISHING_ROD_MULTIPLIER = 1.5;

const FISH_TYPES = [
    { name: 'Goujon', emoji: '🐟', rarity: 'commun' },
    { name: 'Saumon', emoji: '🐟', rarity: 'commun' },
    { name: 'Truite', emoji: '🐟', rarity: 'commun' },
    { name: 'Thon', emoji: '🐠', rarity: 'peu commun' },
    { name: 'Espadon', emoji: '🐠', rarity: 'peu commun' },
    { name: 'Poulpe', emoji: '🐙', rarity: 'rare' },
    { name: 'Homard', emoji: '🦞', rarity: 'rare' },
    { name: 'Requins', emoji: '🦈', rarity: 'épique' },
    { name: 'Baleine', emoji: '🐋', rarity: 'légendaire' },
];

const CATCH_MESSAGES = [
    "Vous lancez votre ligne dans les eaux cristallines...",
    "Vous attendez patiemment pendant que votre flotteur dérive...",
    "Après quelques minutes d'attente, vous sentez une secousse...",
    "L'eau ondule alors qu'un poisson mord à l'hameçon...",
    "Vous remontez votre prise avec une précision d'expert...",
];

export default {
    data: new SlashCommandBuilder()
        .setName('pecher')
        .setDescription('Aller à la pêche pour attraper des poissons et gagner de l\'argent'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const now = Date.now();

            const userData = await getEconomyData(client, guildId, userId);
            const lastFish = userData.lastFish || 0;
            const hasFishingRod = userData.inventory["fishing_rod"] || 0;

            if (now < lastFish + FISH_COOLDOWN) {
                const remaining = lastFish + FISH_COOLDOWN - now;
                const hours = Math.floor(remaining / (1000 * 60 * 60));
                const minutes = Math.floor(
                    (remaining % (1000 * 60 * 60)) / (1000 * 60),
                );

                throw createError(
                    "Fishing cooldown active",
                    ErrorTypes.RATE_LIMIT,
                    `Vous êtes trop fatigué(e) pour pêcher en ce moment. Reposez-vous pendant **${hours}h ${minutes}m** avant de pêcher à nouveau.`,
                    { remaining, cooldownType: 'fish' }
                );
            }

            const rand = Math.random();
            let fishCaught;
            
            if (rand < 0.5) {
                fishCaught = FISH_TYPES.filter(f => f.rarity === 'commun')[Math.floor(Math.random() * 3)];
            } else if (rand < 0.75) {
                fishCaught = FISH_TYPES.filter(f => f.rarity === 'peu commun')[Math.floor(Math.random() * 2)];
            } else if (rand < 0.9) {
                fishCaught = FISH_TYPES.filter(f => f.rarity === 'rare')[Math.floor(Math.random() * 2)];
            } else if (rand < 0.98) {
                fishCaught = FISH_TYPES.find(f => f.rarity === 'épique');
            } else {
                fishCaught = FISH_TYPES.find(f => f.rarity === 'légendaire');
            }

            const baseEarned = Math.floor(
                Math.random() * (BASE_MAX_REWARD - BASE_MIN_REWARD + 1)
            ) + BASE_MIN_REWARD;

            let finalEarned = baseEarned;
            let multiplierMessage = "";

            if (hasFishingRod > 0) {
                finalEarned = Math.floor(baseEarned * FISHING_ROD_MULTIPLIER);
                multiplierMessage = `\n🎣 **Bonus de canne à pêche : +50%**`;
            }

            const catchMessage = CATCH_MESSAGES[Math.floor(Math.random() * CATCH_MESSAGES.length)];

            userData.wallet += finalEarned;
            userData.lastFish = now;

            await setEconomyData(client, guildId, userId, userData);

            const rarityColors = {
                commun: '#95A5A6',
                'peu commun': '#2ECC71',
                rare: '#3498DB',
                épique: '#9B59B6',
                légendaire: '#F1C40F'
            };

            const embed = createEmbed({
                title: 'Pêche réussie !',
                description: `${catchMessage}\n\nVous avez attrapé un(e) **${fishCaught.emoji} ${fishCaught.name}** ! Vous l'avez vendu pour **${finalEarned.toLocaleString()} pièces** !${multiplierMessage}`,
                color: rarityColors[fishCaught.rarity]
            })
                .addFields(
                    {
                        name: "Nouveau solde en espèces",
                        value: `${userData.wallet.toLocaleString()} pièces`,
                        inline: true,
                    },
                    {
                        name: "Rareté",
                        value: fishCaught.rarity.charAt(0).toUpperCase() + fishCaught.rarity.slice(1),
                        inline: true,
                    }
                )
                .setFooter({ text: `Prochaine partie de pêche disponible dans 45 minutes.` });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'pecher' })
};
