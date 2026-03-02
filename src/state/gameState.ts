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

// Default rooms configuration
export const DEFAULT_ROOM_NAMES = ["Room 1", "Room 2", "Room 3", "Room 4", "Room 5"];

// Helper functions
export const isDefaultRoom = (roomName: string): boolean => {
  return DEFAULT_ROOM_NAMES.includes(roomName);
};

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
    deduplicatedRooms[roomName] = {
      ...room,
      players: deduplicatePlayers(room.players),
    };
  }
  ioInstance.emit("update-rooms", deduplicatedRooms);
};

export const emitRoomsToSocket = (socket: Socket) => {
  if (!ioInstance) return;
  
  const deduplicatedRooms: Record<string, any> = {};
  for (const [roomName, room] of Object.entries(rooms)) {
    deduplicatedRooms[roomName] = {
      ...room,
      players: deduplicatePlayers(room.players),
    };
  }
  socket.emit("update-rooms", deduplicatedRooms);
};

export const broadcastToRoom = (roomName: string, event: string, data: any) => {
  if (!ioInstance) return;
  ioInstance.to(roomName).emit(event, data);
};
