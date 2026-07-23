import { getColor, getDefaultApplicationQuestions } from '../../config/bot.js';
import { SlashCommandBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, withErrorHandling, createError, ErrorTypes, replyUserError } from '../../utils/errorHandler.js';
import ApplicationService from '../../services/applicationService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logEvent, EVENT_TYPES, resolveApplicationLogChannel } from '../../services/loggingService.js';
import { formatLogLine, resolveUserAuthor } from '../../utils/logging/logEmbeds.js';
import { getGuildConfig } from '../../services/config/guildConfig.js';
import { 
    getApplicationSettings, 
    getUserApplications, 
    createApplication, 
    getApplication,
    getApplicationRoles,
    updateApplication,
    getApplicationRoleSettings
} from '../../utils/database.js';

function getApplicationStatusPresentation(statusValue) {
    const normalized = typeof statusValue === 'string' ? statusValue.trim().toLowerCase() : 'unknown';
    const statusLabel =
        normalized === 'pending' ? 'En cours' :
        normalized === 'approved' ? 'Acceptée' :
        normalized === 'denied' ? 'Refusée' :
        'Inconnu';
    const statusEmoji =
        normalized === 'pending' ? '🟡' :
        normalized === 'approved' ? '🟢' :
        normalized === 'denied' ? '🔴' :
        '⚪';

    return { normalized, statusLabel, statusEmoji };
}

export default {
    slashOnly: true,
    data: new SlashCommandBuilder()
        .setName("apply")
        .setDescription("Gérer les candidatures aux rôles")
        .addSubcommand((subcommand) =>
            subcommand
                .setName("submit")
                .setDescription("Soumettre une candidature pour un rôle")
                .addStringOption((option) =>
                    option
                        .setName("application")
                        .setDescription("La candidature que vous souhaitez soumettre")
                        .setRequired(true)
                        .setAutocomplete(true),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("status")
                .setDescription("Vérifier le statut de votre candidature")
                .addStringOption((option) =>
                    option
                        .setName("id")
                        .setDescription("ID de la candidature (laisser vide pour tout voir)")
                        .setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("list")
                .setDescription("Lister les candidatures disponibles"),
        ),

    category: "Community",

    execute: withErrorHandling(async (interaction) => {
        if (!interaction.inGuild()) {
            return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Cette commande ne peut être utilisée que sur un serveur.' });
        }

        const { options, guild, member } = interaction;
        const subcommand = options.getSubcommand();

        if (subcommand !== "submit") {
            const isListCommand = subcommand === "list";
            await InteractionHelper.safeDefer(interaction, { flags: isListCommand ? [] : ["Ephemeral"] });
        }

        logger.info(`Commande apply exécutée : ${subcommand}`, {
            userId: interaction.user.id,
            guildId: guild.id,
            subcommand
        });

        const settings = await getApplicationSettings(
            interaction.client,
            guild.id,
        );
        
        if (!settings.enabled) {
            throw createError(
                'Candidatures désactivées',
                ErrorTypes.CONFIGURATION,
                'Les candidatures sont actuellement désactivées sur ce serveur.',
                { guildId: guild.id }
            );
        }

        if (subcommand === "submit") {
            await handleSubmit(interaction, settings);
        } else if (subcommand === "status") {
            await handleStatus(interaction);
        } else if (subcommand === "list") {
            await handleList(interaction);
        }
    }, { type: 'command', commandName: 'apply' })
};

export async function handleApplicationModal(interaction) {
    if (!interaction.isModalSubmit()) return;
    
    const customId = interaction.customId;
    if (!customId.startsWith('app_modal_')) return;
    
    const roleId = customId.split('_')[2];
    
    const applicationRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
    const applicationRole = applicationRoles.find(appRole => appRole.roleId === roleId);
    
    if (!applicationRole) {
        return await replyUserError(interaction, { type: ErrorTypes.CONFIGURATION, message: 'Configuration de la candidature introuvable.' });
    }
    
    const role = interaction.guild.roles.cache.get(roleId);
    
    if (!role) {
        return await replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: 'Rôle introuvable.' });
    }
    
    const answers = [];
    const settings = await getApplicationSettings(interaction.client, interaction.guild.id);

    let questions = settings.questions?.length ? settings.questions : getDefaultApplicationQuestions();
    const roleSettings = await getApplicationRoleSettings(interaction.client, interaction.guild.id, roleId);
    if (roleSettings.questions && roleSettings.questions.length > 0) {
        questions = roleSettings.questions;
    }
    
    for (let i = 0; i < questions.length; i++) {
        const answer = interaction.fields.getTextInputValue(`q${i}`);
        answers.push({
            question: questions[i],
            answer: answer
        });
    }
    
    try {
        const application = await ApplicationService.submitApplication(interaction.client, {
            guildId: interaction.guild.id,
            userId: interaction.user.id,
            roleId: roleId,
            roleName: applicationRole.name,
            username: interaction.user.tag,
            avatar: interaction.user.displayAvatarURL(),
            answers: answers
        });
        
        const embed = successEmbed(
            'Candidature soumise',
            `Votre candidature pour **${applicationRole.name}** a été soumise avec succès !\n\n` +
            `ID de la candidature : \`${application.id}\`\n` +
            `Vous pouvez vérifier le statut avec \`/apply status id:${application.id}\``
        );
        
        await InteractionHelper.safeEditReply(interaction, { embeds: [embed], flags: ["Ephemeral"] });
        
        const settings = await getApplicationSettings(interaction.client, interaction.guild.id);
        const roleSettings = await getApplicationRoleSettings(interaction.client, interaction.guild.id, roleId);
        const guildConfig = await getGuildConfig(interaction.client, interaction.guild.id);

        const logChannelId = resolveApplicationLogChannel(guildConfig, roleSettings, settings);

        if (logChannelId) {
            const logMessage = await logEvent({
                client: interaction.client,
                guildId: interaction.guild.id,
                eventType: EVENT_TYPES.APPLICATION_SUBMIT,
                channelId: logChannelId,
                data: {
                    title: 'Candidature soumise',
                    lines: [
                        formatLogLine('Candidat', `<@${interaction.user.id}> (${interaction.user.tag})`),
                        formatLogLine('Candidature', applicationRole.name),
                        formatLogLine('Rôle', role.name),
                        formatLogLine('ID de la candidature', `\`${application.id}\``),
                    ],
                    inlineFields: [
                        { name: 'Statut', value: '🟡 En cours', inline: true },
                    ],
                    author: await resolveUserAuthor(interaction.client, interaction.user.id),
                },
            });

            if (logMessage) {
                await updateApplication(interaction.client, interaction.guild.id, application.id, {
                    logMessageId: logMessage.id,
                    logChannelId,
                });
            }
        }
        
    } catch (error) {
        logger.error('Erreur lors de la création de la candidature :', {
            error: error.message,
            userId: interaction.user.id,
            guildId: interaction.guild.id,
            roleId,
            stack: error.stack
        });
        
        await handleInteractionError(interaction, error, {
            type: 'modal',
            handler: 'application_submission'
        });
    }
}

async function handleList(interaction) {
    try {
        const applicationRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
        
        if (applicationRoles.length === 0) {
            return await replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: 'Aucune candidature n\'est disponible actuellement.' });
        }

        const embed = createEmbed({
            title: "Candidatures disponibles",
            description: "Voici les rôles pour lesquels vous pouvez candidater :"
        });

        applicationRoles.forEach((appRole, index) => {
            const role = interaction.guild.roles.cache.get(appRole.roleId);
            embed.addFields({
                name: `${index + 1}. ${appRole.name}`,
                value: `**Rôle :** ${role ? `<@&${appRole.roleId}>` : 'Rôle introuvable'}\n` +
                        `**Candidater avec :** \`/apply submit application:"${appRole.name}"\``,
                inline: false
            });
        });

        embed.setFooter({
            text: "Utilisez /apply submit application:<nom> pour candidater à l'un de ces rôles."
        });

        return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
        logger.error('Erreur lors du listage des candidatures :', {
            error: error.message,
            guildId: interaction.guild.id,
            stack: error.stack
        });
        
        throw createError(
            'Échec du chargement des candidatures',
            ErrorTypes.DATABASE,
            'Échec du chargement des candidatures. Veuillez réessayer plus tard.',
            { guildId: interaction.guild.id }
        );
    }
}

async function handleSubmit(interaction, settings) {
    const applicationName = interaction.options.getString("application");
    const member = interaction.member;

    const applicationRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
    
    const applicationRole = applicationRoles.find(appRole => 
        appRole.name.toLowerCase() === applicationName.toLowerCase()
    );

    if (!applicationRole) {
        return await replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: 'Utilisez `/apply list` pour voir les candidatures disponibles.' });
    }

    const userApps = await getUserApplications(
        interaction.client,
        interaction.guild.id,
        interaction.user.id,
    );
    const pendingApp = userApps.find((app) => app.status === "pending");

    if (pendingApp) {
        return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Vous avez déjà une candidature en cours. Veuillez attendre qu\'elle soit examinée.' });
    }

    const role = interaction.guild.roles.cache.get(applicationRole.roleId);
    if (!role) {
        return await replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: 'Le rôle pour cette candidature n\'existe plus.' });
    }

    const modal = new ModalBuilder()
        .setCustomId(`app_modal_${applicationRole.roleId}`)
        .setTitle(`Candidature pour ${applicationRole.name}`);

    let questions = settings.questions?.length ? settings.questions : getDefaultApplicationQuestions();
    const roleSettings = await getApplicationRoleSettings(interaction.client, interaction.guild.id, applicationRole.roleId);
    if (roleSettings.questions && roleSettings.questions.length > 0) {
        questions = roleSettings.questions;
    }

    questions.forEach((question, index) => {
        const input = new TextInputBuilder()
            .setCustomId(`q${index}`)
            .setLabel(
                question.length > 45
                    ? `${question.substring(0, 42)}...`
                    : question,
            )
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000);

        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);
    });

    await interaction.showModal(modal);
}

async function handleStatus(interaction) {
    const appId = interaction.options.getString("id");

    if (appId) {
        const application = await getApplication(
            interaction.client,
            interaction.guild.id,
            appId,
        );

        if (!application || application.userId !== interaction.user.id) {
            return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'Candidature introuvable ou vous n\'avez pas la permission de la voir.' });
        }

        const submittedAt = application?.createdAt ? new Date(application.createdAt) : null;
        const submittedAtDisplay = submittedAt && !Number.isNaN(submittedAt.getTime())
            ? submittedAt.toLocaleString()
            : 'Date inconnue';
        const statusView = getApplicationStatusPresentation(application.status);
        const embed = createEmbed({
            title: `Candidature #${application.id} - ${application.roleName || 'Rôle inconnu'}`,
            description:
                `**ID de la candidature :** \`${application.id}\`\n` +
                `**Statut :** ${statusView.statusEmoji} ${statusView.statusLabel}\n` +
                `**Soumise le :** ${submittedAtDisplay}`
        });

        return InteractionHelper.safeEditReply(interaction, { embeds: [embed], flags: ["Ephemeral"] });
    } else {
        const applications = await getUserApplications(
            interaction.client,
            interaction.guild.id,
            interaction.user.id,
        );

        if (applications.length === 0) {
            return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Vous n\'avez soumis aucune candidature pour le moment.' });
        }

        const recentApplications = applications
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
            .slice(0, 10);

        const embed = createEmbed({
            title: "Vos candidatures",
            description: `Affichage de ${recentApplications.length} candidature(s) récente(s).`
        });

        recentApplications.forEach((application) => {
            const submittedAt = application?.createdAt ? new Date(application.createdAt) : null;
            const submittedAtDisplay = submittedAt && !Number.isNaN(submittedAt.getTime())
                ? submittedAt.toLocaleDateString()
                : 'Date inconnue';
            const statusView = getApplicationStatusPresentation(application.status);

            embed.addFields({
                name: `${statusView.statusEmoji} ${application.roleName || 'Rôle inconnu'} (${statusView.statusLabel})`,
                value:
                    `**ID :** \`${application.id}\`\n` +
                    `**Statut :** ${statusView.statusEmoji} ${statusView.statusLabel}\n` +
                    `**Soumise le :** ${submittedAtDisplay}`,
                inline: true,
            });
        });

        if (applications.length > recentApplications.length) {
            embed.setFooter({ text: `Affichage des ${recentApplications.length} dernières candidatures sur ${applications.length}.` });
        }

        return InteractionHelper.safeEditReply(interaction, { embeds: [embed], flags: ["Ephemeral"] });
    }
}
