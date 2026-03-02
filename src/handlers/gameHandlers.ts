import { Socket } from 'socket.io';
import { rooms, gameTimers, propertyBuildings, broadcastToRoom, emitRooms } from '../state/gameState.js';
import { endGame, startGameTimer, checkWinCondition, hasColorMonopoly, nearestCell, nearestUtility } from '../services/gameLogic.js';
import { returnAssetsToBank } from '../services/assetService.js';

// Card decks
let chanceDeck: number[] = [];
let communityDeck: number[] = [];

const shuffleDeck = (deck: number[]) => {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
};

export const initDecks = () => {
  chanceDeck = Array.from({ length: 16 }, (_, i) => i + 1);
  communityDeck = Array.from({ length: 16 }, (_, i) => i + 1);
  shuffleDeck(chanceDeck);
  shuffleDeck(communityDeck);
};

const drawCard = (deck: number[]): number => {
  if (deck.length === 0) {
    const newDeck = Array.from({ length: 16 }, (_, i) => i + 1);
    shuffleDeck(newDeck);
    deck.push(...newDeck);
  }
  return deck.pop()!;
};

export const registerGameHandlers = (socket: Socket) => {

  // Start game
  socket.on("start-game", async ({ roomName }) => {
    const room = rooms[roomName];
    if (!room || room.players.length < 2) {
      socket.emit("error", "Need at least 2 players to start");
      return;
    }

    // Deduplicate players
    const uniquePlayers = room.players.reduce((acc: any[], p: any) => {
      if (!acc.find(existing => existing.uid === p.uid)) {
        acc.push(p);
      }
      return acc;
    }, []);

    if (uniquePlayers.length < 2) {
      socket.emit("error", "Need at least 2 unique players");
      return;
    }

    // Set first player as active (human if available, otherwise first bot)
    const firstHumanIndex = uniquePlayers.findIndex((p: any) => !p.isBot);
    const startingIndex = firstHumanIndex !== -1 ? firstHumanIndex : 0;

    room.players = uniquePlayers.map((p: any, i: number) => ({
      ...p,
      isActive: i === startingIndex,
      position: 0,
      money: 1500,
      inventory: { chanceCards: [], communityChestCards: [], properties: [] },
    }));

    room.status = "in-game";
    room.minDurationMet = false;
    room.statsUpdated = false;
    room.gameStartTime = Date.now();

    // Clear buildings
    propertyBuildings[roomName] = {};

    initDecks();
    startGameTimer(roomName);

    broadcastToRoom(roomName, "game-started", {
      roomName,
      players: room.players,
      firstPlayerUid: room.players[startingIndex].uid,
    });

    emitRooms();
  });

  // Player move (dice roll)
  socket.on("player-move", ({ roomName, uid }) => {
    const room = rooms[roomName];
    if (!room || room.status !== "in-game") return;

    const player = room.players.find((p) => p.uid === uid);
    if (!player || player.inCardDraw || !player.isActive) return;

    const dice = Math.floor(Math.random() * 6) + 1;
    broadcastToRoom(roomName, "dice-rolled", { uid, dice });

    const oldPos = player.position;
    let newPos = (player.position + dice) % 40;

    let sentToJail = false;
    if (newPos === 30) {
      const hasJailCard = player.inventory.chanceCards.includes(7) || 
                          player.inventory.communityChestCards.includes(5);
      if (hasJailCard) {
        player.inventory.chanceCards = player.inventory.chanceCards.filter(id => id !== 7);
        player.inventory.communityChestCards = player.inventory.communityChestCards.filter(id => id !== 5);
        broadcastToRoom(roomName, "jail-card-used", {
          uid: player.uid,
          message: `${player.name} used a Get Out of Jail Free card!`,
        });
      } else {
        sentToJail = true;
        newPos = 10;
      }
    }

    player.position = newPos;

    if (!sentToJail && newPos < oldPos) {
      broadcastToRoom(roomName, "collect-money", { uid, reason: "dice" });
      player.money += 200;
    }

    if (player.position === 4) player.money -= 200;
    if (player.position === 38) player.money -= 100;

    const chancePositions = [7, 22, 36];
    const communityPositions = [2, 17, 33];

    if (chancePositions.includes(player.position)) {
      player.inCardDraw = true;
      broadcastToRoom(roomName, "before-draw", { type: "chance", uid });
    } else if (communityPositions.includes(player.position)) {
      player.inCardDraw = true;
      broadcastToRoom(roomName, "before-draw", { type: "community", uid });
    } else {
      // No card draw - pass turn immediately
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

      const nextPlayer = room.players[nextIndex];

      broadcastToRoom(roomName, "move-result", {
        uid,
        from: oldPos,
        to: player.position,
        money: player.money,
        nextPlayerUid: nextPlayer.uid,
      });

      broadcastToRoom(roomName, "next-turn", {
        nextPlayerUid: nextPlayer.uid,
        nextPlayerIndex: nextIndex,
      });

      emitRooms();
    }
  });

  // Show card effect
  socket.on("show-card-effect", ({ roomName, uid }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    if (!player || !player.inCardDraw) return;

    const chancePositions = [7, 22, 36];
    const communityPositions = [2, 17, 33];

    if (chancePositions.includes(player.position)) {
      const cardId = drawCard(chanceDeck);
      broadcastToRoom(roomName, "draw-card", { type: "chance", uid, cardId });
    } else if (communityPositions.includes(player.position)) {
      const cardId = drawCard(communityDeck);
      broadcastToRoom(roomName, "draw-card", { type: "community", uid, cardId });
    }
  });

  // Confirm card effect
  socket.on("confirm-card-effect", ({ roomName, uid, deckType, cardId }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    player.inCardDraw = false;

    // Apply card effects based on card ID
    applyCardEffect(roomName, uid, deckType, cardId);
  });

  // Surrender
  socket.on("surrender", ({ roomName, uid }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    player.surrendered = true;
    player.isActive = false;

    returnAssetsToBank(roomName, player);

    broadcastToRoom(roomName, "player-surrendered", { uid, name: player.name });

    const winCheck = checkWinCondition(roomName);
    if (winCheck.hasWinner && winCheck.winner) {
      endGame(roomName, winCheck.winner, "last-standing");
    } else {
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

      broadcastToRoom(roomName, "next-turn", {
        nextPlayerUid: room.players[nextIndex].uid,
        nextPlayerIndex: nextIndex,
      });

      emitRooms();
    }
  });

  // Pay debt
  socket.on("pay-debt", ({ roomName, uid, ownerUid, amount, propertyIndex }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    const owner = room.players.find((p) => p.uid === ownerUid);
    if (!player || !owner) return;

    if (player.money >= amount) {
      player.money -= amount;
      owner.money += amount;

      broadcastToRoom(roomName, "debt-paid", {
        fromUid: uid,
        toUid: ownerUid,
        amount,
        propertyIndex,
      });

      // Pass turn
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

      broadcastToRoom(roomName, "next-turn", {
        nextPlayerUid: room.players[nextIndex].uid,
        nextPlayerIndex: nextIndex,
      });

      emitRooms();
    }
  });

  // Declare bankruptcy
  socket.on("declare-bankruptcy", ({ roomName, uid, ownerUid, debtAmount }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    const owner = room.players.find((p) => p.uid === ownerUid);
    if (!player) return;

    const amountPaid = player.money;
    player.money = 0;
    player.bankrupt = true;
    player.isActive = false;

    if (owner) {
      owner.money += amountPaid;
    }

    returnAssetsToBank(roomName, player);

    broadcastToRoom(roomName, "player-bankrupt", {
      uid,
      name: player.name,
      debtAmount,
      paidAmount: amountPaid,
      ownerUid,
      ownerName: owner?.name,
    });

    const winCheck = checkWinCondition(roomName);
    if (winCheck.hasWinner && winCheck.winner) {
      endGame(roomName, winCheck.winner, "last-standing");
    } else {
      // Pass turn
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

      broadcastToRoom(roomName, "next-turn", {
        nextPlayerUid: room.players[nextIndex].uid,
        nextPlayerIndex: nextIndex,
      });

      emitRooms();
    }
  });

  // Jail card decision
  socket.on("jail-card-decision", ({ roomName, uid, useCard }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    if (useCard) {
      // Use get out of jail card
      if (player.inventory.chanceCards.includes(7)) {
        player.inventory.chanceCards = player.inventory.chanceCards.filter(id => id !== 7);
      } else if (player.inventory.communityChestCards.includes(5)) {
        player.inventory.communityChestCards = player.inventory.communityChestCards.filter(id => id !== 5);
      }

      broadcastToRoom(roomName, "jail-card-used", {
        uid,
        message: `${player.name} used a Get Out of Jail Free card!`,
      });
    } else {
      // Go to jail
      player.position = 10;
      broadcastToRoom(roomName, "player-moved", { uid, position: 10, reason: "jail" });
    }
  });
};

// Card effects
const applyCardEffect = (roomName: string, uid: string, type: "chance" | "community", cardId: number) => {
  const room = rooms[roomName];
  if (!room) return;

  const player = room.players.find((p) => p.uid === uid);
  if (!player) return;

  // Store old position before applying effect
  const oldPos = player.position;

  const effects: Record<string, (player: any, room: any) => void> = {
    // Chance effects
    1: (p) => { p.position = 0; p.money += 200; }, // Advance to GO
    2: (p) => { p.money -= 50; }, // Bank pays you dividend
    3: (p) => { // Advance to nearest railroad
      const railroads = [5, 15, 25, 35];
      const next = railroads.find(r => r > p.position) || railroads[0];
      p.position = next;
    },
    4: (p) => { p.position = 10; }, // Go to jail
    5: (p) => { p.inventory.chanceCards.push(7); }, // Get out of jail free
    // Add more chance effects...
    
    // Community Chest effects
    17: (p) => { p.money += 100; }, // Inheritance
    18: (p) => { p.money -= 50; }, // Doctor's fees
    19: (p) => { p.money += 50; }, // Bank error in your favor
    20: (p) => { p.position = 10; }, // Go to jail
    21: (p) => { p.inventory.communityChestCards.push(5); }, // Get out of jail free
    // Add more community effects...
  };

  const effectKey = type === "chance" ? cardId : cardId + 16;
  const effect = effects[effectKey];
  
  if (effect) {
    effect(player, room);
    
    // Check if position changed and emit move-result for animation
    if (player.position !== oldPos) {
      console.log(`🎴 Card effect moved player ${player.name} from ${oldPos} to ${player.position}`);
      broadcastToRoom(roomName, "move-result", {
        uid,
        from: oldPos,
        to: player.position,
        money: player.money,
        nextPlayerUid: uid, // Still current player's turn
        isCardEffect: true, // Flag to indicate this is from a card
      });
    }
    
    broadcastToRoom(roomName, "card-effect-applied", { uid, type, cardId });
    emitRooms();
  }

  // Pass turn after card effect
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

  broadcastToRoom(roomName, "next-turn", {
    nextPlayerUid: room.players[nextIndex].uid,
    nextPlayerIndex: nextIndex,
  });

  emitRooms();
};
