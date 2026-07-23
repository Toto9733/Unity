import { SlashCommandBuilder, MessageFlags, ChannelType } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

import birthdaySet from './modules/birthday_set.js';
import birthdayInfo from './modules/birthday_info.js';
import birthdayList from './modules/birthday_list.js';
import birthdayRemove from './modules/birthday_remove.js';
import nextBirthdays from './modules/next_birthdays.js';
import birthdaySetchannel from './modules/birthday_setchannel.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName('birthday')
        .setDescription('Système de gestion des anniversaires')
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Enregistrer ton anniversaire')
                .addIntegerOption(option =>
                    option
                        .setName('month')
                        .setDescription('Mois de naissance (1-12)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(12)
                )
                .addIntegerOption(option =>
                    option
                        .setName('day')
                        .setDescription('Jour de naissance (1-31)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(31)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription("Afficher les informations d'anniversaire d'un utilisateur")
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription("L'utilisateur dont tu veux voir l'anniversaire")
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Lister tous les anniversaires du serveur')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Supprimer ton anniversaire')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('next')
                .setDescription("Afficher les prochains anniversaires à venir")
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setchannel')
                .setDescription("Définir ou désactiver le salon des annonces d'anniversaire (Gérer le serveur requis)")
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Le salon textuel pour les annonces. Laisse vide pour désactiver.')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
        ),

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'set':
                return await birthdaySet.execute(interaction, config, client);
            case 'info':
                return await birthdayInfo.execute(interaction, config, client);
            case 'list':
                return await birthdayList.execute(interaction, config, client);
            case 'remove':
                return await birthdayRemove.execute(interaction, config, client);
            case 'next':
                return await nextBirthdays.execute(interaction, config, client);
            case 'setchannel':
                return await birthdaySetchannel.execute(interaction, config, client);
            default:
                return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Sous-commande inconnue' });
        }
    }
};
