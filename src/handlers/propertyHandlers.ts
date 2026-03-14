import { Socket } from 'socket.io';
import { rooms, propertyBuildings, pendingPurchases, animatingPlayers, broadcastToRoom, emitRooms } from '../state/gameState.js';
import { calculateRent, hasColorMonopoly } from '../services/gameLogic.js';
import { returnAssetsToBank } from '../services/assetService.js';
import { propertyRentData } from '../utils/constants.js';

export const registerPropertyHandlers = (socket: Socket) => {

  // Buy Property
  socket.on("buy-property", ({ roomName, uid, propertyIndex, price }) => {
    const room = rooms[roomName];
    if (!room) return;

    if (!pendingPurchases[roomName]) {
      pendingPurchases[roomName] = new Set();
    }

    if (pendingPurchases[roomName].has(propertyIndex)) {
      socket.emit("error", "Property purchase is already in progress");
      return;
    }

    const isAlreadyOwned = room.players.some((p) =>
      p.inventory.properties.includes(propertyIndex)
    );
    if (isAlreadyOwned) {
      socket.emit("error", "Property already owned");
      return;
    }

    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    if (player.money < price) {
      socket.emit("error", "Not enough money");
      return;
    }

    pendingPurchases[roomName].add(propertyIndex);

    player.money -= price;
    player.inventory.properties.push(propertyIndex);

    console.log(`✅ Player ${player.name} bought property ${propertyIndex} for $${price}`);

    pendingPurchases[roomName].delete(propertyIndex);

    broadcastToRoom(roomName, "property-bought", {
      uid,
      propertyIndex,
      price,
    });

    emitRooms();

    // Pass turn to next player
    const currentIndex = room.players.findIndex((p) => p.uid === uid);
    let nextIndex = (currentIndex + 1) % room.players.length;
    let loops = 0;
    while ((room.players[nextIndex]?.surrendered || room.players[nextIndex]?.bankrupt) && loops < room.players.length) {
      nextIndex = (nextIndex + 1) % room.players.length;
      loops++;
    }
    
    room.players = room.players.map((p, i) => ({
      ...p,
      isActive: i === nextIndex,
    }));

    room.lastTurnTimestamp = Date.now();
    broadcastToRoom(roomName, "next-turn", {
      nextPlayerUid: room.players[nextIndex].uid,
      nextPlayerIndex: nextIndex,
      lastTurnTimestamp: room.lastTurnTimestamp,
      turnDuration: room.players[nextIndex].disconnected ? 10 : 30,
      serverTime: Date.now(),
    });

    broadcastToRoom(roomName, "move-result", {
      uid,
      from: player.position,
      to: player.position,
      money: player.money,
      nextPlayerUid: room.players[nextIndex].uid,
    });

    emitRooms();
  });

  // Build Hotel
  socket.on("build-hotel", ({ roomName, uid, propertyIndex, cost }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    if (!player.inventory.properties.includes(propertyIndex)) {
      socket.emit("error", "You don't own this property");
      return;
    }

    if (!propertyBuildings[roomName]) {
      propertyBuildings[roomName] = {};
    }

    if (propertyBuildings[roomName][propertyIndex] === 5) {
      socket.emit("error", "Hotel already built on this property");
      return;
    }

    if (player.money < cost) {
      socket.emit("error", "Not enough money to build hotel");
      return;
    }

    const propertyInfo = propertyRentData[propertyIndex];
    if (!propertyInfo) {
      socket.emit("error", "Cannot build hotel on this property");
      return;
    }

    const hasMonopoly = hasColorMonopoly(room, uid, propertyInfo.color);
    if (!hasMonopoly) {
      socket.emit("error", "You need monopoly to build hotel");
      return;
    }

    player.money -= cost;
    propertyBuildings[roomName][propertyIndex] = 5;

    console.log(`🏨 Player ${player.name} built hotel on property ${propertyIndex} for Ks ${cost}`);

    broadcastToRoom(roomName, "hotel-built", {
      uid,
      propertyIndex,
      cost,
    });

    emitRooms();
  });

  // Build House
  socket.on("build-house", ({ roomName, uid, propertyIndex, cost }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    if (!player.inventory.properties.includes(propertyIndex)) {
      socket.emit("error", "You don't own this property");
      return;
    }

    if (!propertyBuildings[roomName]) {
      propertyBuildings[roomName] = {};
    }

    const currentLevel = propertyBuildings[roomName][propertyIndex] || 0;

    if (currentLevel >= 5) {
      socket.emit("error", "Maximum buildings reached - hotel already built (level 5)");
      return;
    }

    if (player.money < cost) {
      socket.emit("error", "Not enough money to build house");
      return;
    }

    const propertyInfo = propertyRentData[propertyIndex];
    if (!propertyInfo) {
      socket.emit("error", "Cannot build house on this property");
      return;
    }

    const hasMonopoly = hasColorMonopoly(room, uid, propertyInfo.color);
    if (!hasMonopoly) {
      socket.emit("error", "You need monopoly to build houses");
      return;
    }

    const newLevel = currentLevel + 1;
    player.money -= cost;
    propertyBuildings[roomName][propertyIndex] = newLevel;

    const isHotel = newLevel === 5;
    console.log(`🏠 Player ${player.name} built ${isHotel ? 'hotel' : 'house ' + newLevel} on property ${propertyIndex} for $${cost}`);

    broadcastToRoom(roomName, "house-built", {
      uid,
      propertyIndex,
      houseCount: newLevel >= 5 ? 4 : newLevel,
      hasHotel: isHotel,
      cost,
    });

    emitRooms();
  });

  // Sell property to bank
  socket.on("sell-property-to-bank", ({ roomName, uid, propertyIndex }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    const propIndex = player.inventory.properties.indexOf(propertyIndex);
    if (propIndex === -1) return;

    // Calculate sell price (half of original)
    let origPrice = 0;
    if (propertyIndex <= 10) origPrice = propertyIndex * 20;
    else if (propertyIndex <= 20) origPrice = propertyIndex * 15;
    else if (propertyIndex <= 30) origPrice = propertyIndex * 12;
    else origPrice = propertyIndex * 10;
    const sellPrice = Math.floor(origPrice / 2);

    player.inventory.properties.splice(propIndex, 1);
    player.money += sellPrice;

    // Remove buildings
    if (propertyBuildings[roomName]?.[propertyIndex] !== undefined) {
      delete propertyBuildings[roomName][propertyIndex];
    }

    broadcastToRoom(roomName, "property-sold-to-bank", {
      uid,
      propertyIndex,
      sellPrice,
      money: player.money,
    });

    emitRooms();
  });

  // Animation tracking
  socket.on("animation-complete", ({ roomName, uid }) => {
    if (!animatingPlayers[roomName]) {
      animatingPlayers[roomName] = new Set();
    }
    animatingPlayers[roomName].delete(uid);
    console.log(`✅ Animation complete for player ${uid} in ${roomName}`);
  });

  socket.on("animation-start", ({ roomName, uid }) => {
    if (!animatingPlayers[roomName]) {
      animatingPlayers[roomName] = new Set();
    }
    animatingPlayers[roomName].add(uid);
    console.log(`🎬 Animation started for player ${uid} in ${roomName}`);
  });
};
