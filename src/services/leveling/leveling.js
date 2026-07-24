// leveling.js

import { EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getGuildConfig, setGuildConfig } from '../config/guildConfig.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { addXp } from './xpSystem.js';
import { getUserLevelKey } from '../../utils/database/keys.js';

const BASE_XP = 100;
const XP_MULTIPLIER = 1.5;
const MAX_LEVEL = 1000;
const MIN_LEVEL = 0;

export function getXpForLevel(level) {
  if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) {
    throw new TitanBotError(
      `Invalid level: ${level}. Must be between ${MIN_LEVEL} and ${MAX_LEVEL}`,
      ErrorTypes.VALIDATION,
      'Le niveau doit être un nombre valide.'
    );
  }
  return 5 * Math.pow(level, 2) + 50 * level + 50;
}

export function getLevelFromXp(xp) {
  if (!Number.isInteger(xp) || xp < 0) {
    throw new TitanBotError(
      `Invalid XP: ${xp}`,
      ErrorTypes.VALIDATION,
      "L'XP doit être un nombre positif ou nul."
    );
  }

  let level = 0;
  let xpNeeded = 0;
  
  while (xp >= getXpForLevel(level) && level < MAX_LEVEL) {
    xpNeeded = getXpForLevel(level);
    xp -= xpNeeded;
    level++;
  }
  
  return {
    level: Math.min(level, MAX_LEVEL),
    currentXp: xp,
    xpNeeded: getXpForLevel(Math.min(level, MAX_LEVEL))
  };
}

export function calculateTotalXp(level, currentXp = 0) {
  let total = currentXp;
  for (let i = 0; i < level; i++) {
    total += getXpForLevel(i);
  }
  return total;
}

export async function getLeaderboard(client, guildId, limit = 10) {
  try {
    if (!guildId || typeof guildId !== 'string') {
      throw new TitanBotError(
        'Invalid guild ID',
        ErrorTypes.VALIDATION,
        "L'ID du serveur est requis."
      );
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      limit = Math.min(Math.max(limit, 1), 100);
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      logger.warn(`Serveur ${guildId} introuvable dans le cache`);
      return [];
    }
    
    const members = await guild.members.fetch().catch(error => {
      logger.error(`Échec de la récupération des membres pour le serveur ${guildId} :`, error);
      return new Map();
    });

    const leaderboard = [];
    
    for (const [userId, member] of members) {
      if (member.user.bot) continue;
      
      const data = await getUserLevelData(client, guildId, userId);
      if (data && (data.totalXp > 0 || data.level > 0)) {
        leaderboard.push({
          userId,
          username: member.user.username,
          discriminator: member.user.discriminator,
          ...data
        });
      }
    }
    
    leaderboard.sort((a, b) => b.totalXp - a.totalXp);
    
    leaderboard.forEach((entry, index) => {
      entry.rank = index + 1;
    });
    
    return leaderboard.slice(0, limit);
    
  } catch (error) {
    logger.error('Erreur lors de la récupération du classement :', error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Échec de la récupération du classement : ${error.message}`,
      ErrorTypes.DATABASE,
      'Impossible de récupérer le classement pour le moment.'
    );
  }
}

export function createLeaderboardEmbed(leaderboard, guild) {
  const embed = new EmbedBuilder()
    .setTitle(`🏆 Classement de ${guild.name}`)
    .setColor('#2ecc71')
    .setTimestamp();
    
  if (!leaderboard || leaderboard.length === 0) {
    embed.setDescription("Aucun utilisateur dans le classement pour le moment !");
    return embed;
  }
  
  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);
  
  const top3Text = top3.map((user, index) => {
    const medal = ['🥇', '🥈', '🥉'][index];
    return `${medal} **#${user.rank}** ${user.username} - Niveau ${user.level} (${user.totalXp} XP)`;
  }).join('\n');
  
  const restText = rest.map(user => {
    return `**#${user.rank}** ${user.username} - Niveau ${user.level} (${user.totalXp} XP)`;
  }).join('\n');
  
  embed.setDescription(
    `**Meilleurs membres**\n${top3Text}${restText ? '\n\n' + restText : ''}`
  );
  
  return embed;
}

export async function getLevelingConfig(client, guildId) {
  try {
    const guildConfig = await getGuildConfig(client, guildId);
    return guildConfig.leveling || {
      enabled: true,
      xpPerMessage: { min: 15, max: 25 },
      xpCooldown: 20,
      levelUpMessage: '{user} est passé au niveau {level} !',
      levelUpChannel: null,
      ignoredChannels: [],
      ignoredRoles: [],
      blacklistedUsers: [],
      roleRewards: {},
      announceLevelUp: true,
      xpMultiplier: 1
    };
  } catch (error) {
    logger.error(`Erreur lors de la récupération de la configuration des niveaux pour le serveur ${guildId} :`, error);
    return {
      enabled: true,
      xpPerMessage: { min: 15, max: 25 },
      xpCooldown: 20,
      levelUpMessage: '{user} est passé au niveau {level} !',
      levelUpChannel: null,
      ignoredChannels: [],
      ignoredRoles: [],
      blacklistedUsers: [],
      roleRewards: {},
      announceLevelUp: true,
      xpMultiplier: 1
    };
  }
}

export async function getUserLevelData(client, guildId, userId) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError(
        "L'ID du serveur et l'ID de l'utilisateur sont requis",
        ErrorTypes.VALIDATION
      );
    }

    const key = getUserLevelKey(guildId, userId);
    const data = await client.db.get(key);
    
    if (!data) {
      return {
        xp: 0,
        level: 0,
        totalXp: 0,
        lastMessage: 0,
        rank: 0
      };
    }
    
    return {
      xp: Math.max(0, data.xp || 0),
      level: Math.max(0, Math.min(data.level || 0, MAX_LEVEL)),
      totalXp: Math.max(0, data.totalXp || 0),
      lastMessage: data.lastMessage || 0,
      rank: data.rank || 0
    };
  } catch (error) {
    logger.error(`Erreur lors de la récupération des données de niveau de l'utilisateur ${userId} :`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Échec de la récupération des données utilisateur : ${error.message}`,
      ErrorTypes.DATABASE,
      'Impossible de récupérer les données de niveau pour le moment.'
    );
  }
}

export async function saveUserLevelData(client, guildId, userId, data) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError(
        "L'ID du serveur et l'ID de l'utilisateur sont requis",
        ErrorTypes.VALIDATION
      );
    }

    if (!data || typeof data !== 'object') {
      throw new TitanBotError(
        'Données de niveau utilisateur invalides',
        ErrorTypes.VALIDATION
      );
    }

    const sanitizedData = {
      xp: Math.max(0, Number(data.xp) || 0),
      level: Math.max(0, Math.min(Number(data.level) || 0, MAX_LEVEL)),
      totalXp: Math.max(0, Number(data.totalXp) || 0),
      lastMessage: Number(data.lastMessage) || 0,
      rank: Number(data.rank) || 0
    };

    const key = getUserLevelKey(guildId, userId);
    await client.db.set(key, sanitizedData);
  } catch (error) {
    logger.error(`Erreur lors de la sauvegarde des données de niveau de l'utilisateur ${userId} :`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Échec de la sauvegarde des données utilisateur : ${error.message}`,
      ErrorTypes.DATABASE,
      'Impossible de sauvegarder les données de niveau pour le moment.'
    );
  }
}

export async function saveLevelingConfig(client, guildId, config) {
  try {
    if (!guildId || !config) {
      throw new TitanBotError(
        "L'ID du serveur et la configuration sont requis",
        ErrorTypes.VALIDATION
      );
    }

    const guildConfig = await getGuildConfig(client, guildId);

    if (config.xpCooldown && (config.xpCooldown < 0 || config.xpCooldown > 3600)) {
      throw new TitanBotError(
        "Le délai d'attente XP doit être compris entre 0 et 3600 secondes",
        ErrorTypes.VALIDATION,
        'Le délai doit être compris entre 0 et 3600 secondes.'
      );
    }

    if (config.xpRange && (config.xpRange.min < 1 || config.xpRange.max < 1 || config.xpRange.min > config.xpRange.max)) {
      throw new TitanBotError(
        'Configuration de la plage XP invalide',
        ErrorTypes.VALIDATION,
        "L'XP minimum doit être inférieure à l'XP maximum, et les deux doivent être positifs."
      );
    }

    guildConfig.leveling = config;
    await setGuildConfig(client, guildId, guildConfig);
    
    logger.info(`Configuration des niveaux mise à jour pour le serveur ${guildId}`);
  } catch (error) {
    logger.error(`Erreur lors de la sauvegarde de la configuration des niveaux pour le serveur ${guildId} :`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Échec de la sauvegarde de la configuration : ${error.message}`,
      ErrorTypes.DATABASE,
      'Impossible de sauvegarder la configuration pour le moment.'
    );
  }
}

export async function addLevels(client, guildId, userId, levels) {
  try {
    const levelingConfig = await getLevelingConfig(client, guildId);
    if (!levelingConfig?.enabled) {
      throw new TitanBotError(
        'Le système de niveaux est désactivé sur ce serveur',
        ErrorTypes.CONFIGURATION,
        'Le système de niveaux est actuellement désactivé sur ce serveur.'
      );
    }

    if (!Number.isInteger(levels) || levels <= 0) {
      throw new TitanBotError(
        `Nombre de niveaux invalide : ${levels}`,
        ErrorTypes.VALIDATION,
        'Vous devez ajouter un nombre positif de niveaux.'
      );
    }

    const userData = await getUserLevelData(client, guildId, userId);
    const newLevel = userData.level + levels;

    if (newLevel > MAX_LEVEL) {
      throw new TitanBotError(
        `Le niveau ${newLevel} dépasse le niveau maximum ${MAX_LEVEL}`,
        ErrorTypes.VALIDATION,
        `Le niveau maximum est ${MAX_LEVEL}.`
      );
    }

    const newXp = 0;
    const newTotalXp = calculateTotalXp(newLevel, newXp);

    userData.level = newLevel;
    userData.xp = newXp;
    userData.totalXp = newTotalXp;

    await saveUserLevelData(client, guildId, userId, userData);
    
    logger.info(`${levels} niveau(x) ajouté(s) à l'utilisateur ${userId} sur le serveur ${guildId}`);
    return userData;
  } catch (error) {
    logger.error(`Erreur lors de l'ajout de niveaux pour l'utilisateur ${userId} :`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Échec de l'ajout de niveaux : ${error.message}`,
      ErrorTypes.DATABASE,
      "Impossible d'ajouter des niveaux pour le moment."
    );
  }
}

export async function removeLevels(client, guildId, userId, levels) {
  try {
    const levelingConfig = await getLevelingConfig(client, guildId);
    if (!levelingConfig?.enabled) {
      throw new TitanBotError(
        'Le système de niveaux est désactivé sur ce serveur',
        ErrorTypes.CONFIGURATION,
        'Le système de niveaux est actuellement désactivé sur ce serveur.'
      );
    }

    if (!Number.isInteger(levels) || levels <= 0) {
      throw new TitanBotError(
        `Nombre de niveaux invalide : ${levels}`,
        ErrorTypes.VALIDATION,
        'Vous devez retirer un nombre positif de niveaux.'
      );
    }

    const userData = await getUserLevelData(client, guildId, userId);
    const newLevel = Math.max(MIN_LEVEL, userData.level - levels);

    const newXp = 0;
    const newTotalXp = calculateTotalXp(newLevel, newXp);

    userData.level = newLevel;
    userData.xp = newXp;
    userData.totalXp = newTotalXp;

    await saveUserLevelData(client, guildId, userId, userData);
    
    logger.info(`${levels} niveau(x) retiré(s) à l'utilisateur ${userId} sur le serveur ${guildId}`);
    return userData;
  } catch (error) {
    logger.error(`Erreur lors du retrait de niveaux pour l'utilisateur ${userId} :`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Échec du retrait de niveaux : ${error.message}`,
      ErrorTypes.DATABASE,
      'Impossible de retirer des niveaux pour le moment.'
    );
  }
}

export async function setUserLevel(client, guildId, userId, level) {
  try {
    const levelingConfig = await getLevelingConfig(client, guildId);
    if (!levelingConfig?.enabled) {
      throw new TitanBotError(
        'Le système de niveaux est désactivé sur ce serveur',
        ErrorTypes.CONFIGURATION,
        'Le système de niveaux est actuellement désactivé sur ce serveur.'
      );
    }

    if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
      throw new TitanBotError(
        `Niveau invalide : ${level}`,
        ErrorTypes.VALIDATION,
        `Le niveau doit être compris entre ${MIN_LEVEL} et ${MAX_LEVEL}.`
      );
    }

    const userData = await getUserLevelData(client, guildId, userId);
    
    const newXp = 0;
    const newTotalXp = calculateTotalXp(level, newXp);

    userData.level = level;
    userData.xp = newXp;
    userData.totalXp = newTotalXp;

    await saveUserLevelData(client, guildId, userId, userData);
    
    logger.info(`Niveau défini à ${level} pour l'utilisateur ${userId} sur le serveur ${guildId}`);
    return userData;
  } catch (error) {
    logger.error(`Erreur lors de la définition du niveau pour l'utilisateur ${userId} :`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Échec de la définition du niveau : ${error.message}`,
      ErrorTypes.DATABASE,
      'Impossible de définir le niveau pour le moment.'
    );
  }
}

export async function deleteUserLevelData(client, guildId, userId) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError(
        "L'ID du serveur et l'ID de l'utilisateur sont requis",
        ErrorTypes.VALIDATION
      );
    }

    const key = getUserLevelKey(guildId, userId);
    await client.db.delete(key);
    
    logger.debug(`Données de niveau supprimées pour l'utilisateur ${userId} sur le serveur ${guildId}`);
  } catch (error) {
    logger.error(`Erreur lors de la suppression des données de niveau pour l'utilisateur ${userId} :`, error);
    if (error instanceof TitanBotError) throw error;
    logger.warn(`Impossible de supprimer les données de niveau pour l'utilisateur ${userId} sur le serveur ${guildId}`);
  }
}
