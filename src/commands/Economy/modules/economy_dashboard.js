import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
    LabelBuilder,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
} from 'discord.js';
import { getColor, BotConfig } from '../../../config/bot.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes, replyUserError } from '../../../utils/errorHandler.js';
import { getEconomyPrefix } from '../../../utils/database.js';
import { addMoney, removeMoney } from '../../../utils/economy.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function buildDashboardEmbed(guild, client) {
    const currencySymbol = BotConfig.economy.currency.symbol;
    const currencyName = BotConfig.economy.currency.name;

    let totalInCirculation = 0;
    let userCount = 0;

    try {
        const economyKeys = await client.db.list(getEconomyPrefix(guild.id));

        if (economyKeys && economyKeys.length > 0) {
            for (const key of economyKeys) {
                const userId = key.split(':').pop();

                const member = await guild.members.fetch(userId).catch(() => null);
                if (member?.user?.bot) continue;

                const userData = await client.db.get(key, {});
                if (userData) {
                    totalInCirculation += (userData.wallet || 0) + (userData.bank || 0);
                    userCount++;
                }
            }
        }
    } catch (error) {
        logger.error('Erreur lors du calcul des statistiques de l\'économie :', error);
    }

    const avgBalance = userCount > 0 ? Math.floor(totalInCirculation / userCount) : 0;

    return new EmbedBuilder()
        .setTitle('💰 Tableau de bord de l\'économie')
        .setDescription(`Gère le système d'économie pour **${guild.name}**.\nSélectionne une option ci-dessous pour effectuer une action.`)
        .setColor(getColor('economy'))
        .addFields(
            { name: '💰 Total en circulation', value: `\`${currencySymbol}${totalInCirculation.toLocaleString()}\``, inline: true },
            { name: '👥 Utilisateurs actifs', value: `\`${userCount.toLocaleString()}\``, inline: true },
            { name: '📊 Solde moyen', value: `\`${currencySymbol}${avgBalance.toLocaleString()}\``, inline: true },
            { name: '💱 Symbole de la monnaie', value: `\`${currencySymbol}\``, inline: true },
            { name: '📝 Nom de la monnaie', value: `\`${currencyName}\``, inline: true },
        )
        .setFooter({ text: 'Le tableau de bord se ferme après 10 minutes d\'inactivité' })
        .setTimestamp();
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`economy_dashboard_${guildId}`)
        .setPlaceholder('Sélectionne une action...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Ajouter de la monnaie')
                .setDescription('Ajouter de la monnaie au portefeuille ou à la banque d\'un utilisateur')
                .setValue('add_currency')
                .setEmoji('💰'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Retirer de la monnaie')
                .setDescription('Retirer de la monnaie du portefeuille ou de la banque d\'un utilisateur')
                .setValue('remove_currency')
                .setEmoji('💸'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Changer le symbole de la monnaie')
                .setDescription('Changer le symbole de la monnaie (ex: $, €, £)')
                .setValue('change_currency')
                .setEmoji('💱'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Changer le nom de la monnaie')
                .setDescription('Changer le nom de la monnaie (ex: pièces, crédits)')
                .setValue('change_name')
                .setEmoji('📝'),
        );
}

async function refreshDashboard(rootInteraction, guild, client) {
    const selectMenu = buildSelectMenu(guild.id);
    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [await buildDashboardEmbed(guild, client)],
        components: [
            new ActionRowBuilder().addComponents(selectMenu),
        ],
    }).catch(() => {});
}

async function updateConfigFile(currencySymbol, currencyName) {
    try {
        const configPath = path.join(__dirname, '../../../config/bot.js');
        let configContent = await fs.readFile(configPath, 'utf-8');

        configContent = configContent.replace(
            /symbol:\s*"[^"]*"/,
            `symbol: "${currencySymbol}"`
        );

        configContent = configContent.replace(
            /name:\s*"[^"]*",\s*\/\/\s*Currency display name/,
            `name: "${currencyName}", // Currency display name`
        );

        configContent = configContent.replace(
            /namePlural:\s*"[^"]*",\s*\/\/\s*Plural display name/,
            `namePlural: "${currencyName}s", // Plural display name`
        );
        
        await fs.writeFile(configPath, configContent, 'utf-8');
        logger.info('Fichier de configuration mis à jour avec succès');
        return true;
    } catch (error) {
        logger.error('Erreur lors de la mise à jour du fichier de configuration :', error);
        return false;
    }
}

export default {
    prefixOnly: false,
    async execute(interaction, config, client) {
        try {
            const guild = interaction.guild;
            const selectMenu = buildSelectMenu(guild.id);
            const selectRow = new ActionRowBuilder().addComponents(selectMenu);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [await buildDashboardEmbed(guild, client)],
                components: [selectRow],
            });

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id && i.customId === `economy_dashboard_${guild.id}`,
                time: 600_000,
            });

            collector.on('collect', async selectInteraction => {
                const selectedOption = selectInteraction.values[0];
                try {
                    switch (selectedOption) {
                        case 'add_currency':
                            await handleAddCurrency(selectInteraction, interaction, guild, client);
                            break;
                        case 'remove_currency':
                            await handleRemoveCurrency(selectInteraction, interaction, guild, client);
                            break;
                        case 'change_currency':
                            await handleChangeCurrency(selectInteraction, interaction, guild);
                            break;
                        case 'change_name':
                            await handleChangeName(selectInteraction, interaction, guild);
                            break;
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Erreur de validation du tableau de bord de l'économie : ${error.message}`);
                    } else {
                        logger.error('Erreur inattendue dans le tableau de bord de l\'économie :', error);
                    }

                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || 'Une erreur est survenue lors du traitement de votre sélection.'
                            : 'Une erreur inattendue est survenue lors du traitement de votre demande.';

                    if (!selectInteraction.replied && !selectInteraction.deferred) {
                        await selectInteraction.deferUpdate().catch(() => {});
                    }

                    await replyUserError(selectInteraction, {
                        type: ErrorTypes.UNKNOWN,
                        message: errorMessage,
                    }).catch(() => {});
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    const timeoutEmbed = new EmbedBuilder()
                        .setTitle('Tableau de bord expiré')
                        .setDescription('Ce tableau de bord a été fermé en raison d\'une inactivité. Veuillez relancer la commande pour continuer.')
                        .setColor(getColor('error'));
                    
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [timeoutEmbed],
                        components: [],
                    }).catch(() => {});
                }
            });
        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Erreur inattendue dans economy_dashboard :', error);
            throw new TitanBotError(
                `Échec du tableau de bord de l'économie : ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Impossible d\'ouvrir le tableau de bord de l\'économie.',
            );
        }
    },
};

async function handleAddCurrency(selectInteraction, rootInteraction, guild, client) {
    const modal = new ModalBuilder()
        .setCustomId(`economy_add_currency_${guild.id}`)
        .setTitle('Ajouter de la monnaie');

    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('target_user')
        .setPlaceholder('Sélectionne un utilisateur...')
        .setMinValues(1)
        .setMaxValues(1)
        .setRequired(true);

    const userLabel = new LabelBuilder()
        .setLabel('Utilisateur cible')
        .setDescription('Utilisateur à qui ajouter de la monnaie')
        .setUserSelectMenuComponent(userSelect);

    const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('Montant à ajouter')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('100')
        .setMinLength(1)
        .setMaxLength(10)
        .setRequired(true);

    const typeInput = new TextInputBuilder()
        .setCustomId('type')
        .setLabel('Type (wallet ou bank)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('wallet')
        .setMinLength(1)
        .setMaxLength(5)
        .setRequired(true);

    modal.addLabelComponents(userLabel);
    modal.addComponents(
        new ActionRowBuilder().addComponents(amountInput),
        new ActionRowBuilder().addComponents(typeInput),
    );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `economy_add_currency_${guild.id}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const userId = submitted.fields.getUserSelectMenuValue('target_user')?.[0];
    const amount = parseInt(submitted.fields.getTextInputValue('amount').trim(), 10);
    const type = submitted.fields.getTextInputValue('type').trim().toLowerCase();

    if (!userId) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Veuillez sélectionner un utilisateur cible.' });
        return;
    }

    if (isNaN(amount) || amount <= 0) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Le montant doit être un nombre positif.' });
        return;
    }

    if (type !== 'wallet' && type !== 'bank') {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Le type doit être "wallet" ou "bank".' });
        return;
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
        await replyUserError(submitted, { type: ErrorTypes.USER_INPUT, message: 'L\'utilisateur spécifié n\'est pas sur ce serveur.' });
        return;
    }

    if (member.user.bot) {
        await replyUserError(submitted, { type: ErrorTypes.UNKNOWN, message: 'Les bots n\'ont pas de compte d\'économie.' });
        return;
    }

    const { newBalance } = await addMoney(client, guild.id, userId, amount, type);

    const currencySymbol = BotConfig.economy.currency.symbol;

    await submitted.reply({
        embeds: [successEmbed('Monnaie ajoutée', `Ajout réussi de ${currencySymbol}${amount.toLocaleString()} au ${type} de ${member.user.tag}.\n**Nouveau solde :** ${currencySymbol}${newBalance.toLocaleString()}`)],
        flags: MessageFlags.Ephemeral,
    });

    logger.info(`[ECONOMY_DASHBOARD] Monnaie ajoutée`, {
        adminId: submitted.user.id,
        targetUserId: userId,
        amount,
        type,
        newBalance,
    });

    await refreshDashboard(rootInteraction, guild, client);
}

async function handleRemoveCurrency(selectInteraction, rootInteraction, guild, client) {
    const modal = new ModalBuilder()
        .setCustomId(`economy_remove_currency_${guild.id}`)
        .setTitle('Retirer de la monnaie');

    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('target_user')
        .setPlaceholder('Sélectionne un utilisateur...')
        .setMinValues(1)
        .setMaxValues(1)
        .setRequired(true);

    const userLabel = new LabelBuilder()
        .setLabel('Utilisateur cible')
        .setDescription('Utilisateur à qui retirer de la monnaie')
        .setUserSelectMenuComponent(userSelect);

    const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('Montant à retirer')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('100')
        .setMinLength(1)
        .setMaxLength(10)
        .setRequired(true);

    const typeInput = new TextInputBuilder()
        .setCustomId('type')
        .setLabel('Type (wallet ou bank)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('wallet')
        .setMinLength(1)
        .setMaxLength(5)
        .setRequired(true);

    modal.addLabelComponents(userLabel);
    modal.addComponents(
        new ActionRowBuilder().addComponents(amountInput),
        new ActionRowBuilder().addComponents(typeInput),
    );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `economy_remove_currency_${guild.id}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const userId = submitted.fields.getUserSelectMenuValue('target_user')?.[0];
    const amount = parseInt(submitted.fields.getTextInputValue('amount').trim(), 10);
    const type = submitted.fields.getTextInputValue('type').trim().toLowerCase();

    if (!userId) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Veuillez sélectionner un utilisateur cible.' });
        return;
    }

    if (isNaN(amount) || amount <= 0) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Le montant doit être un nombre positif.' });
        return;
    }

    if (type !== 'wallet' && type !== 'bank') {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Le type doit être "wallet" ou "bank".' });
        return;
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
        await replyUserError(submitted, { type: ErrorTypes.USER_INPUT, message: 'L\'utilisateur spécifié n\'est pas sur ce serveur.' });
        return;
    }

    if (member.user.bot) {
        await replyUserError(submitted, { type: ErrorTypes.UNKNOWN, message: 'Les bots n\'ont pas de compte d\'économie.' });
        return;
    }

    const { newBalance } = await removeMoney(client, guild.id, userId, amount, type);

    const currencySymbol = BotConfig.economy.currency.symbol;

    await submitted.reply({
        embeds: [successEmbed('Monnaie retirée', `Retrait réussi de ${currencySymbol}${amount.toLocaleString()} du ${type} de ${member.user.tag}.\n**Nouveau solde :** ${currencySymbol}${newBalance.toLocaleString()}`)],
        flags: MessageFlags.Ephemeral,
    });

    logger.info(`[ECONOMY_DASHBOARD] Monnaie retirée`, {
        adminId: submitted.user.id,
        targetUserId: userId,
        amount,
        type,
        newBalance,
    });

    await refreshDashboard(rootInteraction, guild, client);
}

async function handleChangeCurrency(selectInteraction, rootInteraction, guild) {
    const modal = new ModalBuilder()
        .setCustomId(`economy_change_currency_${guild.id}`)
        .setTitle('Changer le symbole de la monnaie');

    const symbolInput = new TextInputBuilder()
        .setCustomId('currency_symbol')
        .setLabel('Nouveau symbole de la monnaie')
        .setStyle(TextInputStyle.Short)
        .setValue(BotConfig.economy.currency.symbol)
        .setPlaceholder('$')
        .setMinLength(1)
        .setMaxLength(3)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(symbolInput));

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `economy_change_currency_${guild.id}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newSymbol = submitted.fields.getTextInputValue('currency_symbol').trim();

    if (newSymbol.length === 0 || newSymbol.length > 3) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Le symbole de la monnaie doit contenir entre 1 et 3 caractères.' });
        return;
    }

    const success = await updateConfigFile(newSymbol, BotConfig.economy.currency.name);

    if (!success) {
        await replyUserError(submitted, { type: ErrorTypes.UNKNOWN, message: 'Impossible de mettre à jour le fichier de configuration. Veuillez vérifier les logs.' });
        return;
    }

    await submitted.reply({
        embeds: [successEmbed('Symbole de la monnaie mis à jour', `Le symbole de la monnaie a été changé en **${newSymbol}**.\n\n**Remarque :** Le bot doit être redémarré pour que les modifications prennent effet.`)],
        flags: MessageFlags.Ephemeral,
    });

    logger.info(`[ECONOMY_DASHBOARD] Symbole de la monnaie modifié`, {
        adminId: submitted.user.id,
        oldSymbol: BotConfig.economy.currency.symbol,
        newSymbol
    });
}

async function handleChangeName(selectInteraction, rootInteraction, guild) {
    const modal = new ModalBuilder()
        .setCustomId(`economy_change_name_${guild.id}`)
        .setTitle('Changer le nom de la monnaie');

    const nameInput = new TextInputBuilder()
        .setCustomId('currency_name')
        .setLabel('Nouveau nom de la monnaie')
        .setStyle(TextInputStyle.Short)
        .setValue(BotConfig.economy.currency.name)
        .setPlaceholder('pièces')
        .setMinLength(1)
        .setMaxLength(20)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(nameInput));

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === `economy_change_name_${guild.id}` && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newName = submitted.fields.getTextInputValue('currency_name').trim();

    if (newName.length === 0 || newName.length > 20) {
        await replyUserError(submitted, { type: ErrorTypes.VALIDATION, message: 'Le nom de la monnaie doit contenir entre 1 et 20 caractères.' });
        return;
    }

    const success = await updateConfigFile(BotConfig.economy.currency.symbol, newName);

    if (!success) {
        await replyUserError(submitted, { type: ErrorTypes.UNKNOWN, message: 'Impossible de mettre à jour le fichier de configuration. Veuillez vérifier les logs.' });
        return;
    }

    await submitted.reply({
        embeds: [successEmbed('Nom de la monnaie mis à jour', `Le nom de la monnaie a été changé en **${newName}**.\n\n**Remarque :** Le bot doit être redémarré pour que les modifications prennent effet.`)],
        flags: MessageFlags.Ephemeral,
    });

    logger.info(`[ECONOMY_DASHBOARD] Nom de la monnaie modifié`, {
        adminId: submitted.user.id,
        oldName: BotConfig.economy.currency.name,
        newName
    });
}
