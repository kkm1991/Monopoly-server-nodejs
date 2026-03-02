import { Room } from '../types/index.js';

// Centralize game state
export const rooms: Record<string, Room> = {};
export const gameTimers: Record<string, NodeJS.Timeout> = {};
export const propertyBuildings: Record<string, Record<number, number>> = {};
export const voiceChannels: Record<string, Set<string>> = {};
export const voiceMessageChunks: Record<string, { chunks: Buffer[]; timestamp: number }> = {};
export const processingBots = new Set<string>();
export const pendingPurchases: Record<string, Set<number>> = {};
export const activeAuctions: Record<string, { propertyIndex: number; currentBid: number; highestBidder: string | null; bids: Array<{ uid: string; name: string; amount: number }>; active: boolean; endTime: number }> = {};
