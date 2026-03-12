import { Server, Socket } from 'socket.io';
import { Room, Player } from '../types/index.js';

// In-memory game state
export const rooms: Record<string, Room> = {};
export const gameTimers: Record<string, NodeJS.Timeout> = {};
export const propertyBuildings: Record<string, Record<number, number>> = {};
export const voiceChannels: Record<string, Set<string>> = {};
export const voiceMessageChunks: Record<string, { chunks: Buffer[]; timestamp: number }> = {};
export const processingBots = new Set<string>();
export const pendingPurchases: Record<string, Set<number>> = {};
export const activeAuctions: Record<string, {
  propertyIndex: number;
  currentBid: number;
  highestBidder: string | null;
  bids: Array<{ uid: string; name: string; amount: number }>;
  active: boolean;
  endTime: number;
}> = {};
export const animatingPlayers: Record<string, Set<string>> = {};

// Helper functions

export const deduplicatePlayers = <T extends { uid: string }>(players: T[]): T[] => {
  return players.reduce((acc: T[], player) => {
    if (!acc.find(p => p.uid === player.uid)) {
      acc.push(player);
    }
    return acc;
  }, []);
};

// Game state emitter helper
let ioInstance: Server | null = null;

export const setIO = (io: Server) => {
  ioInstance = io;
};

export const getIO = (): Server => {
  if (!ioInstance) {
    throw new Error('IO not initialized');
  }
  return ioInstance;
};

export const emitRooms = () => {
  if (!ioInstance) return;
  
  const deduplicatedRooms: Record<string, any> = {};
  for (const [roomName, room] of Object.entries(rooms)) {
    // Hide finished rooms from the lobby list
    if (room.status === "finished") continue;
    
    deduplicatedRooms[roomName] = {
      ...room,
      players: deduplicatePlayers(room.players),
    };
  }
  ioInstance.emit("update-rooms", { rooms: deduplicatedRooms, serverTime: Date.now() });
};

export const emitRoomsToSocket = (socket: Socket) => {
  if (!ioInstance) return;
  
  const deduplicatedRooms: Record<string, any> = {};
  for (const [roomName, room] of Object.entries(rooms)) {
    // Hide finished rooms from the lobby list
    if (room.status === "finished") continue;
    
    deduplicatedRooms[roomName] = {
      ...room,
      players: deduplicatePlayers(room.players),
    };
  }
  socket.emit("update-rooms", { rooms: deduplicatedRooms, serverTime: Date.now() });
};

export const broadcastToRoom = (roomName: string, event: string, data: any) => {
  if (!ioInstance) return;
  ioInstance.to(roomName).emit(event, data);
};
