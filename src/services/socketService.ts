import { Server, Socket } from "socket.io";

let ioInstance: Server | null = null;

export const initSocketService = (io: Server) => {
  ioInstance = io;
};

export const getIO = (): Server => {
  if (!ioInstance) {
    throw new Error("Socket.io not initialized. Call initSocketService first.");
  }
  return ioInstance;
};

// Helpful broadcasts
export const broadcastToRoom = (roomName: string, event: string, payload: any) => {
  getIO().to(roomName).emit(event, payload);
};

export const emitToSocket = (socketId: string, event: string, payload: any) => {
  getIO().to(socketId).emit(event, payload);
};
