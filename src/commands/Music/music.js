
import { SlashCommandBuilder } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    skipTrack,
    stopPlayback,
    pausePlayback,
    resumePlayback,
    shuffleQueue,
    setLoopMode,
    setVolume,
    seekTrack,
    removeFromQueue,
    moveInQueue,
    clearQueue,
    setTwentyFourSeven,
    leaveVoiceChannel,
    replyMusicSuccess,
} from '../../services/music/musicActions.js';
import { deferMusicCommand } from '../../services/music/prefixSupport.js';

export default {
    category: 'Music',
    data: new SlashCommandBuilder()
        .setName('music')
        .setDescription('Gérer la lecture, la file d\'attente et les paramètres de la session vocale')
        .addSubcommand((sub) =>
            sub.setName('pause').setDescription('Mettre en pause la lecture'),
        )
        .addSubcommand((sub) =>
            sub.setName('resume').setDescription('Reprendre la lecture'),
        )
        .addSubcommand((sub) =>
            sub.setName('skip').setDescription('Passer la piste en cours'),
        )
        .addSubcommand((sub) =>
            sub.setName('stop').setDescription('Arrêter la lecture et vider la file d\'attente'),
        )
        .addSubcommand((sub) =>
            sub.setName('shuffle').setDescription('Mélanger la file d\'attente'),
        )
        .addSubcommand((sub) =>
            sub
                .setName('loop')
                .setDescription('Définir le mode de répétition')
                .addStringOption((opt) =>
                    opt
                        .setName('mode')
                        .setDescription('Mode de répétition')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Désactivé', value: 'none' },
                            { name: 'Piste', value: 'track' },
                            { name: 'File d\'attente', value: 'queue' },
                        ),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName('volume')
                .setDescription('Définir le volume de lecture')
                .addIntegerOption((opt) =>
                    opt.setName('level').setDescription('Volume (0-100)').setRequired(true).setMinValue(0).setMaxValue(100),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName('seek')
                .setDescription('Aller à une position spécifique de la piste en cours')
                .addIntegerOption((opt) =>
                    opt.setName('seconds').setDescription('Position en secondes').setRequired(true).setMinValue(0),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName('remove')
                .setDescription('Retirer une piste de la file d\'attente')
                .addIntegerOption((opt) =>
                    opt.setName('position').setDescription('Position dans la file d\'attente').setRequired(true).setMinValue(1),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName('move')
                .setDescription('Déplacer une piste dans la file d\'attente')
                .addIntegerOption((opt) =>
                    opt.setName('from').setDescription('Position actuelle').setRequired(true).setMinValue(1),
                )
                .addIntegerOption((opt) =>
                    opt.setName('to').setDescription('Nouvelle position').setRequired(true).setMinValue(1),
                ),
        )
        .addSubcommand((sub) =>
            sub.setName('clear').setDescription('Vider la file d\'attente'),
        )
        .addSubcommand((sub) =>
            sub.setName('leave').setDescription('Déconnecter le bot du salon vocal'),
        )
        .addSubcommand((sub) =>
            sub
                .setName('247')
                .setDescription('Activer ou désactiver le mode 24/7 (rester dans le salon vocal en cas d\'inactivité)')
                .addBooleanOption((opt) =>
                    opt.setName('enabled').setDescription('Activer ou désactiver le mode 24/7').setRequired(true),
                ),
        ),

    async execute(interaction, config, client) {
        await deferMusicCommand(interaction);
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'pause': {
                const embed = await pausePlayback(client, interaction);
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'resume': {
                const embed = await resumePlayback(client, interaction);
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'skip': {
                const embed = await skipTrack(client, interaction);
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'stop': {
                const embed = await stopPlayback(client, interaction);
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'shuffle': {
                const embed = await shuffleQueue(client, interaction);
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'loop': {
                const embed = await setLoopMode(client, interaction, interaction.options.getString('mode'));
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'volume': {
                const embed = await setVolume(client, interaction, interaction.options.getInteger('level'));
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'seek': {
                const embed = await seekTrack(client, interaction, interaction.options.getInteger('seconds'));
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'remove': {
                const embed = await removeFromQueue(client, interaction, interaction.options.getInteger('position'));
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'move': {
                const embed = await moveInQueue(
                    client,
                    interaction,
                    interaction.options.getInteger('from'),
                    interaction.options.getInteger('to'),
                );
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'clear': {
                const embed = await clearQueue(client, interaction);
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case 'leave': {
                const embed = await leaveVoiceChannel(client, interaction);
                await replyMusicSuccess(interaction, embed);
                break;
            }
            case '247': {
                const embed = await setTwentyFourSeven(client, interaction, interaction.options.getBoolean('enabled'));
                await replyMusicSuccess(interaction, embed);
                break;
            }
            default:
                await InteractionHelper.safeEditReply(interaction, {
                    content: 'Sous-commande musicale inconnue.',
                });
        }
    },
};
