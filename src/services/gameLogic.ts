import { Room, Player } from '../types/index.js';
import { rooms, gameTimers } from './gameState.js';
import { updatePlayerStats, rewardPlayers } from './dbService.js';
import { broadcastToRoom } from './socketService.js';
import { propertyRentData, colorGroups } from '../utils/constants.js';

export const findPropertyOwner = (room: Room, propertyIndex: number): Player | null => {
  return room.players.find((p) => p.inventory?.properties?.includes(propertyIndex)) || null;
};

export const hasColorMonopoly = (room: Room, playerUid: string, color: string): boolean => {
  const propertiesInColor = colorGroups[color];
  if (!propertiesInColor) return false;
  
  const player = room.players.find(p => p.uid === playerUid);
  if (!player) return false;
  
  return propertiesInColor.every(idx => player.inventory?.properties?.includes(idx));
};

export const calculateRent = (
  room: Room, 
  propertyIndex: number, 
  roomName: string,
  diceRoll: number = 0,
  buildingLevel: number = 0
): { rentAmount: number; owner: Player | null; hasMonopoly: boolean; hasHotel: boolean; baseRent: number; buildingLevel: number; houseCount: number } => {
  const rentInfo = propertyRentData[propertyIndex];
  if (!rentInfo) {
    return { rentAmount: 0, owner: null, hasMonopoly: false, hasHotel: false, baseRent: 0, buildingLevel: 0, houseCount: 0 };
  }
  
  const owner = findPropertyOwner(room, propertyIndex);
  if (!owner) {
    return { rentAmount: 0, owner: null, hasMonopoly: false, hasHotel: false, baseRent: 0, buildingLevel: 0, houseCount: 0 };
  }
  
  const hasMonopoly = hasColorMonopoly(room, owner.uid, rentInfo.color);
  const hasHotel = buildingLevel === 5;
  const houseCount = buildingLevel > 0 && buildingLevel < 5 ? buildingLevel : 0;
  
  const originalBaseRent = rentInfo.rent;
  let baseRent = rentInfo.rent;
  if (hasHotel) {
    baseRent = rentInfo.hotelRent;
  } else if (houseCount > 0) {
    baseRent = rentInfo.houseRents[houseCount - 1];
  }
  
  if (rentInfo.color === "rail") {
    const railroadsOwned = owner.inventory.properties.filter(p => [5, 15, 25, 35].includes(p)).length;
    baseRent = 25 * Math.pow(2, railroadsOwned - 1);
  }
  
  if (rentInfo.color === "utility") {
    const multiplier = hasMonopoly ? 10 : 4;
    baseRent = multiplier * diceRoll;
  }
  
  // Monopoly 2x bonus only applies to base rent (no houses/hotels)
  // When houses or hotels are built, the rent values already reflect the higher amounts
  const hasBuildings = hasHotel || houseCount > 0;
  const rentAmount = (hasMonopoly && !hasBuildings && rentInfo.color !== "utility" && rentInfo.color !== "rail") ? baseRent * 2 : baseRent;
  return { rentAmount, owner, hasMonopoly, hasHotel, baseRent: originalBaseRent, buildingLevel, houseCount };
};

export const railroads = [5, 15, 25, 35];
export const nearestCell = (current: number) => {
  for (const r of railroads) {
    if (r > current) {
      return r;
    }
  }
  return railroads[0]; // wrap around
};

export const utilities = [12, 28];
export const nearestUtility = (current: number) => {
  for (const u of utilities) {
    if (u > current) {
      return u;
    }
  }
  return utilities[0]; // wrap around
};

export const checkWinCondition = (roomName: string): { hasWinner: boolean; winner?: Player } => {
  const room = rooms[roomName];
  if (!room || room.status !== "in-game") return { hasWinner: false };

  if (!room.minDurationMet) return { hasWinner: false };

  const activePlayers = room.players.filter(p => !p.surrendered && !p.bankrupt);
  if (activePlayers.length === 1) {
    return { hasWinner: true, winner: activePlayers[0] };
  }

};

export const endGame = async (roomName: string, winner: Player, reason: "last-standing" | "time-limit") => {
  const room = rooms[roomName];
  if (!room) return;

  if (room.status === "finished" && room.winner) {
    console.log(`\u26a0\ufe0f Game already ended in ${roomName}, skipping duplicate endGame call`);
    return;
  }

  if (room.statsUpdated) {
    console.log(`\u26a0\ufe0f Player stats already updated for ${roomName}, skipping`);
    return;
  }
  
  room.statsUpdated = true;

  const now = new Date().toISOString();
  
  const gameStartTime = room.gameStartTime || Date.now();
  const gameDurationSeconds = Math.floor((Date.now() - gameStartTime) / 1000);

  room.status = "finished";
  room.winner = winner.uid;

  if (gameTimers[roomName]) {
    clearTimeout(gameTimers[roomName]);
    delete gameTimers[roomName];
  }
  if (gameTimers[roomName + "_duration"]) {
    clearTimeout(gameTimers[roomName + "_duration"]);
    delete gameTimers[roomName + "_duration"];
  }

  const playerData = room.players.map(p => ({
    uid: p.uid,
    name: p.name,
    money: p.money,
    position: p.position,
    properties: p.inventory.properties?.length || 0,
    surrendered: p.surrendered || false,
    isWinner: p.uid === winner.uid,
  }));

  broadcastToRoom(roomName, "game-ended", {
    winner: {
      uid: winner.uid,
      name: winner.name,
      money: winner.money,
      properties: winner.inventory.properties?.length || 0,
    },
    reason,
    roomName,
    gameDurationSeconds,
    minDurationMet: room.minDurationMet || false,
    totalPlayers: room.players.length,
    players: playerData,
    endedAt: now,
  });

  console.log(`\ud83c\udfc6 Game ended in ${roomName}! Winner: ${winner.name} (${reason})`);
  console.log(`\u23f1\ufe0f Game duration: ${gameDurationSeconds}s | Min duration met: ${room.minDurationMet || false}`);

  const gameTimestamp = room.gameStartTime || Date.now();
  const gameId = `${roomName}_${gameTimestamp}_${winner.uid}`;
  console.log(`\ud83c\udfae Updating stats with game ID: ${gameId}`);
  
  await updatePlayerStats(
    { uid: winner.uid, name: winner.name },
    room.players.map(p => ({ uid: p.uid, name: p.name, money: p.money, surrendered: p.surrendered })),
    gameId
  );

  const coinsCost = room.gameRules?.coinsCost ?? 50;
  const { winnerReward } = await rewardPlayers(winner.uid, room.players, coinsCost);
  
  if (winnerReward > 0) {
    broadcastToRoom(roomName, "coins-awarded", { amount: winnerReward, winnerUid: winner.uid });
  }
};

export const startGameTimer = (roomName: string) => {
  const room = rooms[roomName];
  if (!room) return;

  room.gameStartTime = Date.now();

  if (gameTimers[roomName]) {
    clearTimeout(gameTimers[roomName]);
  }
  if (gameTimers[roomName + "_duration"]) {
    clearTimeout(gameTimers[roomName + "_duration"]);
  }

  // Minimum duration timer (1 min) to qualify for rankings
  gameTimers[roomName] = setTimeout(() => {
    const room = rooms[roomName];
    if (!room || room.status !== "in-game") return;
    
    room.minDurationMet = true; 
    console.log(`⏱️ Minimum 1-minute duration met for ${roomName} - games now qualify for rankings`);
    
    const activePlayers = room.players.filter(p => !p.surrendered && !p.bankrupt);
    if (activePlayers.length === 1) {
      endGame(roomName, activePlayers[0], "last-standing");
    }
  }, 1 * 60 * 1000); 

  // Custom Game Rules Timer
  const customTimerMinutes = room.gameRules?.timer;
  if (customTimerMinutes && customTimerMinutes !== "unlimited") {
    const timerMs = (customTimerMinutes as number) * 60 * 1000;
    
    gameTimers[roomName + "_duration"] = setTimeout(() => {
      const room = rooms[roomName];
      if (!room || room.status !== "in-game") return;

      console.log(`⏱️ Custom timer (${customTimerMinutes}m) ended for ${roomName}`);
      
      const activePlayers = room.players.filter(p => !p.surrendered && !p.bankrupt);
      if (activePlayers.length === 0) return;
      
      let wealthiestPlayer = activePlayers[0];
      let maxWealth = -1;
      
      for (const player of activePlayers) {
        // Calculate total wealth (money + roughly 100 per property for tie-breaking)
        const wealth = player.money + (player.inventory?.properties?.length || 0) * 100;
        if (wealth > maxWealth) {
          maxWealth = wealth;
          wealthiestPlayer = player;
        }
      }
      
      endGame(roomName, wealthiestPlayer, "time-limit");
      
    }, timerMs);
    console.log(`⏱️ Custom game timer started: ${customTimerMinutes} minutes for ${roomName}`);
  }

  console.log(`⏱️ 1-minute minimum duration timer started for ${roomName}`);
};
