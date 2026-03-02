import { Player } from '../types/index.js';
import { rooms, propertyBuildings, broadcastToRoom } from '../state/gameState.js';

export const returnAssetsToBank = (roomName: string, player: Player) => {
  const room = rooms[roomName];
  if (!room) return;

  const propertiesToReturn = [...player.inventory.properties];
  const chanceCards = [...player.inventory.chanceCards];
  const communityCards = [...player.inventory.communityChestCards];

  player.inventory.properties = [];
  player.inventory.chanceCards = [];
  player.inventory.communityChestCards = [];

  if (propertyBuildings[roomName]) {
    propertiesToReturn.forEach(propIndex => {
      if (propertyBuildings[roomName][propIndex] !== undefined) {
        delete propertyBuildings[roomName][propIndex];
      }
    });
  }

  console.log(`🏦 Assets returned to bank from ${player.name}: ${propertiesToReturn.length} properties, ${chanceCards.length} chance cards, ${communityCards.length} community cards`);

  broadcastToRoom(roomName, "assets-returned-to-bank", {
    uid: player.uid,
    name: player.name,
    properties: propertiesToReturn,
    message: `${player.name}'s assets have been returned to the bank and are now available for purchase`,
  });

  return { properties: propertiesToReturn, chanceCards, communityCards };
};
