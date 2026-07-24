```javascript
import { PermissionsBitField } from 'discord.js';
import { successEmbed } from '../../../utils/embeds.js';
import { getGuildConfig, setGuildConfig } from '../../../services/config/guildConfig.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';

export default {
    async execute(interaction, config, client) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'Tu as besoin de la permission **Gérer le serveur** pour définir le rôle premium.' });
        }

        const role = interaction.options.getRole('role');
        const guildId = interaction.guildId;

        try {
            const currentConfig = await getGuildConfig(client, guildId);
            currentConfig.premiumRoleId = role.id;
            await setGuildConfig(client, guildId, currentConfig);

            return InteractionHelper.safeReply(interaction, {
                embeds: [successEmbed('Rôle premium défini', `Le **rôle de la boutique premium** a été défini sur ${role.toString()}. Les membres qui achèteront l'article du rôle premium se verront attribuer ce rôle.`)],
                ephemeral: true,
            });
        } catch (error) {
            logger.error('Erreur shop_config_setrole :', error);
            return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Impossible d\'enregistrer la configuration du serveur.' });
        }
    },
};

```
