import { Socket } from 'socket.io';
import { rooms, emitRooms, emitRoomsToSocket, broadcastToRoom } from '../state/gameState.js';
import { fetchPlayerWins, fetchPlayerEconomy } from '../services/dbService.js';

export const registerRoomHandlers = (socket: Socket) => {
  
  // Get all rooms
  socket.on("get-rooms", () => {
    emitRoomsToSocket(socket);
  });

  // Create a new room
  socket.on("create-room", async ({ roomName, maxPlayers, user }) => {
    if (!roomName || rooms[roomName]) {
      socket.emit("error", "Room invalid or already exists");
      return;
    }

    const playerWins = await fetchPlayerWins(user.uid);
    const economyAndCosmetics = await fetchPlayerEconomy(user.uid);

    rooms[roomName] = {
      name: roomName,
      creatorUid: user.uid,
      players: [
        {
          uid: user.uid,
          name: user.name,
          socketId: socket.id,
          identifier: user.identifier,
          money: 1500,
          position: 0,
          inCardDraw: false,
          isActive: false,
          color: user.color || "",
          wins: playerWins,
          equippedItems: {
            dice_skin: economyAndCosmetics.dice_skin,
            board_theme: economyAndCosmetics.board_theme,
            avatar: economyAndCosmetics.avatar,
          },
          inventory: {
            chanceCards: [],
            communityChestCards: [],
            properties: [],
          },
        },
      ],
      maxPlayers,
      status: "waiting",
    };

    socket.join(roomName);
    emitRooms();
    socket.emit("room-created", roomName);
  });

  // Join existing room
  socket.on("join-room", async ({ roomName, user }) => {
    const room = rooms[roomName];
    if (!room) {
      socket.emit("error", "Room does not exist");
      return;
    }

    // Check for reconnection
    const disconnectedPlayer = room.players.find((p) => p.uid === user.uid && p.disconnected);
    if (disconnectedPlayer) {
      disconnectedPlayer.disconnected = false;
      disconnectedPlayer.socketId = socket.id;

      const economyAndCosmetics = await fetchPlayerEconomy(user.uid);
      disconnectedPlayer.equippedItems = {
        dice_skin: economyAndCosmetics.dice_skin,
        board_theme: economyAndCosmetics.board_theme,
        avatar: economyAndCosmetics.avatar,
      };

      socket.join(roomName);
      emitRooms();
      socket.emit("room-joined", roomName);
      socket.emit("player-reconnected", {
        uid: disconnectedPlayer.uid,
        name: disconnectedPlayer.name,
        message: "Welcome back! You have rejoined the game.",
      });
      
      socket.to(roomName).emit("player-reconnected-notification", {
        uid: disconnectedPlayer.uid,
        name: disconnectedPlayer.name,
        message: `${disconnectedPlayer.name} has reconnected to the game`,
      });
      return;
    }

    if (room.players.some((p) => p.uid === user.uid)) {
      socket.emit("error", "You are already in this room");
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit("error", "Room full");
      return;
    }

    const playerWins = await fetchPlayerWins(user.uid);
    const economyAndCosmetics = await fetchPlayerEconomy(user.uid);

    room.players.push({
      uid: user.uid,
      name: user.name,
      identifier: user.identifier,
      socketId: socket.id,
      money: 1500,
      position: 0,
      inCardDraw: false,
      isActive: false,
      color: user.color || "",
      wins: playerWins,
      equippedItems: {
        dice_skin: economyAndCosmetics.dice_skin,
        board_theme: economyAndCosmetics.board_theme,
        avatar: economyAndCosmetics.avatar,
      },
      inventory: {
        chanceCards: [],
        communityChestCards: [],
        properties: [],
      },
    });

    socket.join(roomName);
    emitRooms();
    socket.emit("room-joined", roomName);
  });

  // Leave room
  socket.on("leave-room", async ({ roomName, uid }) => {
    const room = rooms[roomName];
    if (!room) return;

    const leavingPlayer = room.players.find(p => p.uid === uid);
    
    if (leavingPlayer && room.status === "in-game") {
      // Return assets handled by game logic
      const { returnAssetsToBank } = await import('../services/assetService.js');
      returnAssetsToBank(roomName, leavingPlayer);
    }
    
    room.players = room.players.filter((p) => p.uid !== uid);
    socket.leave(roomName);

    // Delete rooms when empty
    if (room.players.length === 0) {
      delete rooms[roomName];
    }

    // Check for game end
    if (room.status === "in-game") {
      const { checkWinCondition, endGame } = await import('../services/gameLogic.js');
      const winCheck = checkWinCondition(roomName);
      if (winCheck.hasWinner && winCheck.winner) {
        endGame(roomName, winCheck.winner, "last-standing");
      }
    }

    emitRooms();
  });

  // Delete room
  socket.on("delete-room", ({ roomName }) => {
    delete rooms[roomName];
    emitRooms();
  });

  // Kick player
  socket.on("kick-player", ({ roomName, targetUid, user }) => {
    const room = rooms[roomName];
    if (!room) return;
    if (room.status !== "waiting") return;
    if (room.creatorUid !== user.uid) return;
    if (user.uid === targetUid) return;

    const targetPlayer = room.players.find(p => p.uid === targetUid);
    if (!targetPlayer) return;

    room.players = room.players.filter((p) => p.uid !== targetUid);

    const targetSocket = socket.nsp.sockets.get(targetPlayer.socketId);
    if (targetSocket) {
      targetSocket.leave(roomName);
      targetSocket.emit("kicked-from-room", { roomName });
    }

    emitRooms();
  });
};
