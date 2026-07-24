Voici la version entièrement traduite en français de ton fichier **`xpSystem.js`**, incluant tous les messages de journalisation (logs), les descriptions d'erreurs et les commentaires :

javascript
// xpSystem.js

import { logger } from '../../utils/logger.js';
import { getLevelingConfig, getXpForLevel, getUserLevelData, saveUserLevelData } from './leveling.js';
import { logEvent, EVENT_TYPES } from '../loggingService.js';
import { formatLogLine } from '../../utils/logging/logEmbeds.js';
import { Mutex } from '../../utils/mutex.js';
import { wrapServiceBoundary } from '../../utils/errorHandler.js';

/**
 * Attribue de l'XP à un membre. Retourne null si l'XP est ignorée (système désactivé / montant invalide).
 * Lève une erreur en cas de problème de stockage ou d'échec inattendu.
 */
export const addXp = wrapServiceBoundary(async function addXp(client, guild, member, xpToAdd) {
  const lockKey = `leveling:${guild.id}:${member.user.id}`;
  return await Mutex.runExclusive(lockKey, async () => {
    if (!xpToAdd || xpToAdd <= 0) {
      return null;
    }

    const config = await getLevelingConfig(client, guild.id);

    if (!config.enabled) {
      return null;
    }

    const levelData = await getUserLevelData(client, guild.id, member.user.id);

    levelData.xp += xpToAdd;
    levelData.totalXp += xpToAdd;
    levelData.lastMessage = Date.now();

    let xpNeededForNextLevel = getXpForLevel(levelData.level);
    let didLevelUp = false;
    const initialLevel = levelData.level;

    while (levelData.xp >= xpNeededForNextLevel && levelData.level < 1000) {
      levelData.xp -= xpNeededForNextLevel;
      levelData.level += 1;
      didLevelUp = true;
      xpNeededForNextLevel = getXpForLevel(levelData.level);

      logger.info(`🎉 ${member.user.tag} est passé au niveau ${levelData.level} sur le serveur ${guild.name}`);

      if (config.roleRewards && config.roleRewards[levelData.level]) {
        await awardRoleReward(guild, member, config.roleRewards[levelData.level], levelData.level);
      }
    }

    if (didLevelUp) {
      if (config.announceLevelUp) {
        await sendLevelUpAnnouncement(guild, member, levelData, config);
      }

      try {
        await logEvent({
          client,
          guildId: guild.id,
          eventType: EVENT_TYPES.LEVELING_LEVELUP,
          data: {
            title: 'Montée de niveau',
            lines: [
              formatLogLine('Membre', `${member.user.tag} (\`${member.user.id}\`)`),
              formatLogLine('Nouveau niveau', levelData.level.toString()),
              formatLogLine('Niveaux gagnés', (levelData.level - initialLevel).toString()),
              formatLogLine('XP total', levelData.totalXp.toString()),
            ],
            userId: member.user.id,
          },
        });
      } catch (logError) {
        logger.debug("Échec de l'enregistrement de l'événement de niveau :", logError.message);
      }
    }

    await saveUserLevelData(client, guild.id, member.user.id, levelData);

    return {
      level: levelData.level,
      xp: levelData.xp,
      totalXp: levelData.totalXp,
      xpNeeded: getXpForLevel(levelData.level + 1),
      leveledUp: didLevelUp,
    };
  });
}, {
  service: 'xpSystem',
  operation: 'addXp',
  userMessage: "Impossible d'attribuer l'XP. Veuillez réessayer.",
});

async function awardRoleReward(guild, member, roleId, level) {
  try {
    const role = guild.roles.cache.get(roleId);

    if (!role) {
      logger.warn(`Rôle ${roleId} introuvable pour la récompense du niveau ${level} sur le serveur ${guild.id}`);
      return;
    }

    if (member.roles.cache.has(roleId)) {
      return;
    }

    await member.roles.add(role, `Récompense du niveau ${level}`);
    logger.info(`✅ Rôle ${role.name} attribué à ${member.user.tag} pour avoir atteint le niveau ${level}`);
  } catch (error) {
    logger.error(`Échec de l'attribution de la récompense de rôle à l'utilisateur ${member.user.id} :`, error);
  }
}

async function sendLevelUpAnnouncement(guild, member, levelData, config) {
  try {
    const levelUpChannel = config.levelUpChannel
      ? guild.channels.cache.get(config.levelUpChannel)
      : guild.systemChannel;

    if (!levelUpChannel || !levelUpChannel.isTextBased()) {
      return;
    }

    const permissions = levelUpChannel.permissionsFor(guild.members.me);
    if (!permissions || !permissions.has(['SendMessages', 'EmbedLinks'])) {
      logger.warn(`Permissions manquantes pour envoyer le message de montée de niveau dans ${levelUpChannel.id}`);
      return;
    }

    const message = config.levelUpMessage
      .replace(/{user}/g, member.toString())
      .replace(/{level}/g, levelData.level)
      .replace(/{xp}/g, levelData.xp)
      .replace(/{xpNeeded}/g, getXpForLevel(levelData.level + 1));

    await levelUpChannel.send(message).catch(error => {
      logger.error(`Échec de l'envoi du message de montée de niveau dans le salon ${levelUpChannel.id} :`, error);
    });
  } catch (error) {
    logger.error("Erreur lors de l'envoi de l'annonce de montée de niveau :", error);
  }
}

```
