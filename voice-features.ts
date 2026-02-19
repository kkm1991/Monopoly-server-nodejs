/**
 * =========================================================
 * VOICE FEATURES BACKEND - Add to server.ts
 * =========================================================
 * 
 * Add this code inside the io.on("connection", (socket) => { ... }) block
 * Place it before the disconnect handler
 */

// ================= VOICE FEATURES =================
// Store voice channel participants per room (lightweight, no audio data)
const voiceChannels: Record<string, Set<string>> = {};

// Store voice message chunks temporarily (cleared after broadcast)
const voiceMessageChunks: Record<string, { chunks: Buffer[]; timestamp: number }> = {};

// Voice channel join
socket.on("voice-join", ({ roomName, uid, name }: { roomName: string; uid: string; name: string }) => {
  if (!voiceChannels[roomName]) {
    voiceChannels[roomName] = new Set();
  }
  
  // Add user to voice channel
  voiceChannels[roomName].add(uid);
  socket.join(`voice-${roomName}`);
  
  console.log(`🎤 ${name} joined voice channel in ${roomName}`);
  
  // Notify all users in the room about voice channel update
  io.to(roomName).emit("voice-channel-update", {
    roomName,
    participants: Array.from(voiceChannels[roomName]),
    joined: { uid, name }
  });
  
  // Notify existing voice participants to initiate WebRTC connection
  socket.to(`voice-${roomName}`).emit("voice-peer-join", {
    uid,
    name,
    socketId: socket.id
  });
});

// Voice signaling for WebRTC (offer/answer/ICE candidates)
socket.on("voice-signal", ({
  roomName,
  targetUid,
  signal
}: {
  roomName: string;
  targetUid: string;
  signal: {
    type: "offer" | "answer" | "ice-candidate";
    data: unknown;
    fromUid: string;
  };
}) => {
  // Find target socket by uid
  const room = rooms[roomName];
  if (!room) return;
  
  const targetPlayer = room.players.find((p) => p.uid === targetUid);
  if (!targetPlayer) return;
  
  // Forward signal to target
  io.to(targetPlayer.socketId).emit("voice-signal", {
    fromUid: signal.fromUid,
    type: signal.type,
    data: signal.data
  });
});

// Voice channel leave
socket.on("voice-leave", ({ roomName, uid, name }: { roomName: string; uid: string; name: string }) => {
  if (voiceChannels[roomName]) {
    voiceChannels[roomName].delete(uid);
    socket.leave(`voice-${roomName}`);
    
    console.log(`🎤 ${name} left voice channel in ${roomName}`);
    
    // Notify room about voice channel update
    io.to(roomName).emit("voice-channel-update", {
      roomName,
      participants: Array.from(voiceChannels[roomName]),
      left: { uid, name }
    });
    
    // Notify other voice participants
    socket.to(`voice-${roomName}`).emit("voice-peer-leave", { uid });
    
    // Clean up empty voice channels
    if (voiceChannels[roomName].size === 0) {
      delete voiceChannels[roomName];
    }
  }
});

// Mute/unmute status
socket.on("voice-mute", ({
  roomName,
  uid,
  muted
}: {
  roomName: string;
  uid: string;
  muted: boolean;
}) => {
  socket.to(`voice-${roomName}`).emit("voice-mute", { uid, muted });
});

// ================= VOICE MESSAGE FEATURE =================
// Handle voice message upload (chunked for memory efficiency)
socket.on("voice-message-start", ({
  roomName,
  messageId,
  uid,
  name,
  duration
}: {
  roomName: string;
  messageId: string;
  uid: string;
  name: string;
  duration: number; // seconds
}) => {
  // Initialize storage for this voice message
  voiceMessageChunks[messageId] = {
    chunks: [],
    timestamp: Date.now()
  };
  
  // Notify room that voice message recording started (optional UI feedback)
  socket.to(roomName).emit("voice-message-recording", { uid, name });
});

// Receive voice message chunks
socket.on("voice-message-chunk", ({
  messageId,
  chunk,
  isLast
}: {
  messageId: string;
  chunk: ArrayBuffer;
  isLast: boolean;
}) => {
  if (!voiceMessageChunks[messageId]) return;
  
  // Store chunk
  voiceMessageChunks[messageId].chunks.push(Buffer.from(chunk));
  
  // If last chunk, broadcast complete message
  if (isLast) {
    const fullBuffer = Buffer.concat(voiceMessageChunks[messageId].chunks);
    
    // Clean up chunks immediately to free memory
    delete voiceMessageChunks[messageId];
    
    // Broadcast to room (sender included for confirmation)
    const roomName = Object.keys(rooms).find((r) =>
      rooms[r].players.some((p) => p.socketId === socket.id)
    );
    
    if (roomName) {
      io.to(roomName).emit("voice-message", {
        messageId,
        senderUid: rooms[roomName].players.find((p) => p.socketId === socket.id)?.uid,
        audioData: fullBuffer.toString("base64"), // Send as base64
        timestamp: Date.now()
      });
    }
  }
});

// Cleanup old voice message chunks periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 minutes
  
  Object.keys(voiceMessageChunks).forEach((messageId) => {
    if (now - voiceMessageChunks[messageId].timestamp > maxAge) {
      delete voiceMessageChunks[messageId];
    }
  });
}, 5 * 60 * 1000);

// ================= DISCONNECT CLEANUP =================
// In the existing disconnect handler, add:
// (Place this inside socket.on("disconnect", () => { ... }))

// Clean up voice channel participation
for (const roomName in voiceChannels) {
  const room = rooms[roomName];
  if (room) {
    const player = room.players.find((p) => p.socketId === socket.id);
    if (player && voiceChannels[roomName].has(player.uid)) {
      voiceChannels[roomName].delete(player.uid);
      
      io.to(roomName).emit("voice-channel-update", {
        roomName,
        participants: Array.from(voiceChannels[roomName]),
        left: { uid: player.uid, name: player.name }
      });
      
      socket.to(`voice-${roomName}`).emit("voice-peer-leave", { uid: player.uid });
      
      if (voiceChannels[roomName].size === 0) {
        delete voiceChannels[roomName];
      }
    }
  }
}

/**
 * =========================================================
 * INTEGRATION INSTRUCTIONS
 * =========================================================
 * 
 * 1. Add the voice channel tracking variable at module level (near top):
 *    const voiceChannels: Record<string, Set<string>> = {};
 * 
 * 2. Add the voice message chunks storage:
 *    const voiceMessageChunks: Record<string, { chunks: Buffer[]; timestamp: number }> = {};
 * 
 * 3. Place all socket.on handlers inside io.on("connection", (socket) => { ... })
 *    Recommended location: After "decline-jail-card-offer" handler, before "disconnect"
 * 
 * 4. Add cleanup code in the existing disconnect handler
 * 
 * 5. No additional packages needed - uses built-in Socket.IO
 * 
 * 6. Memory optimization:
 *    - Voice messages are chunked and cleared immediately after broadcast
 *    - Voice channels only store uid strings, no audio data
 *    - Periodic cleanup of stale voice message chunks
 */
