import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: '../monopoloy-project/.env.local' });

import { updatePlayerStats, fetchPlayerWins, fetchPlayerEconomy, rewardPlayers } from './src/services/dbService.js';

const app = express();
const CLIENT_API_URL = process.env.CLIENT_API_URL || "http://127.0.0.1:3000";

// Client API URL for storing player stats
// const CLIENT_API_URL = process.env.CLIENT_API_URL || "http://127.0.0.1:3000"; // This line is a duplicate and can be removed if not intended. Keeping it as per original document structure.

// ================= DATABASE / PERSISTENCE =================
// Using client-side Neon PostgreSQL via API calls

// API endpoint to get player rankings (for dashboard) - proxy to client API
app.get("/api/rankings", async (req, res) => {
  try {
    const response = await fetch(`${CLIENT_API_URL}/api/rankings`, {
      headers: {
        "x-api-key": process.env.SERVER_API_KEY || "myanmarpoly-secret-key-2026"
      }
    });
    if (!response.ok) throw new Error("Failed to fetch from client API");
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error proxying rankings:", error);
    res.status(500).json({ error: "Failed to fetch rankings" });
  }
});

// API endpoint to get individual player stats - proxy to client API
app.get("/api/player/:uid/stats", async (req, res) => {
  const { uid } = req.params;
  try {
    const response = await fetch(`${CLIENT_API_URL}/api/rankings`, {
      headers: {
        "x-api-key": process.env.SERVER_API_KEY || "myanmarpoly-secret-key-2026"
      }
    });
    if (!response.ok) throw new Error("Failed to fetch from client API");
    const data = await response.json();
    const player = data.rankings?.find((r: any) => r.uid === uid);
    if (!player) {
      return res.status(404).json({ error: "Player not found" });
    }
    res.json({ uid, ...player });
  } catch (error) {
    console.error("Error proxying player stats:", error);
    res.status(500).json({ error: "Failed to fetch player stats" });
  }
});

const PORT = process.env.PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || "development";
// Voice feature tracking (module level)
const voiceChannels: Record<string, Set<string>> = {};
const voiceMessageChunks: Record<string, { chunks: Buffer[]; timestamp: number }> = {};

// Configure CORS based on environment
const corsOrigins = NODE_ENV === "production" 
  ? (process.env.CORS_ORIGINS?.split(",") || [
      "https://monopoly-project-phi.vercel.app",
      "https://www.myanmarpoly.online",
      "https://myanmarpoly.online"
    ])
  : "*";

// Apply CORS middleware to Express app for HTTP API endpoints
app.use(cors({
  origin: corsOrigins,
  methods: ["GET", "POST"],
  credentials: true
}));

 

const server = createServer((req, res) => {
  // Health check endpoint for Render.com
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      status: "healthy", 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: NODE_ENV
    }));
    return;
  }
  
  // Root endpoint
  if (req.url === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      message: "Monopoly Socket Server",
      version: "1.0.0",
      status: "running"
    }));
    return;
  }
  
  // Pass all other requests to Express app (handles /api/rankings, /api/player/*)
  app(req, res);
});

const io = new Server(server, {
  cors: { 
    origin: corsOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket", "polling"],
  // Aggressive ping settings to keep Render connection alive
  pingTimeout: 120000,  // 2 minutes - longer than Render's idle timeout
  pingInterval: 30000,  // 30 seconds - frequent keep-alive pings
  // Connection recovery settings
  connectTimeout: 60000,
  maxHttpBufferSize: 1e6,
  // Allow upgrade from polling to websocket for reliability
  allowUpgrades: true,
  perMessageDeflate: false // Disable compression to reduce overhead
});

import { initSocketService, broadcastToRoom } from './src/services/socketService.js';
initSocketService(io);

const chanceDeck = [...Array(16)].map((_, i) => i + 1);
const communityDeck = [...Array(16)].map((_, i) => i + 1);
const drawCard = (deck: number[]) => {
  if (deck.length === 0) {
    // Refill deck if empty
    for (let i = 1; i <= 16; i++) deck.push(i);
    console.log("Deck refilled!");
  }
  const index = Math.floor(Math.random() * deck.length);
  console.log("random Card generated: " + deck[index]);
  return deck.splice(index, 1)[0];
};

// Chance (ကံစမ်းမဲ) ကတ်များ၏ Logic
import { propertyRentData, colorGroups } from './src/utils/constants.js';
import { Player, CardOffer, Room } from './src/types/index.js';

// In-memory rooms
const rooms: Record<string, Room> = {};

// Game timer tracking
const gameTimers: Record<string, NodeJS.Timeout> = {};

// Helper to deduplicate players in a room by uid
const deduplicatePlayers = <T extends { uid: string }>(players: T[]): T[] => {
  return players.reduce((acc: T[], player) => {
    if (!acc.find(p => p.uid === player.uid)) {
      acc.push(player);
    }
    return acc;
  }, []);
};

// Helper to emit rooms with deduplicated players
const emitRooms = () => {
  const deduplicatedRooms: Record<string, any> = {};
  for (const [roomName, room] of Object.entries(rooms)) {
    deduplicatedRooms[roomName] = {
      ...room,
      players: deduplicatePlayers(room.players),
    };
  }
  io.emit("update-rooms", deduplicatedRooms);
};

// Helper to emit rooms to a specific socket
const emitRoomsToSocket = (socket: any) => {
  const deduplicatedRooms: Record<string, any> = {};
  for (const [roomName, room] of Object.entries(rooms)) {
    deduplicatedRooms[roomName] = {
      ...room,
      players: deduplicatePlayers(room.players),
    };
  }
  socket.emit("update-rooms", deduplicatedRooms);
};

// Property Buildings tracking (0 = none, 1-4 = houses, 5 = hotel)
const propertyBuildings: Record<string, Record<number, number>> = {};

// Active auctions tracking - MUST be at module level to be shared across all sockets
const activeAuctions: Record<string, {
  propertyIndex: number;
  currentBid: number;
  highestBidder: string | null;
  bids: Array<{ uid: string; name: string; amount: number }>;
  active: boolean;
  endTime: number;
}> = {};

// Pending property purchases tracking - prevents race conditions
const pendingPurchases: Record<string, Set<number>> = {};

// Animation tracking - tracks which players are currently animating
const animatingPlayers: Record<string, Set<string>> = {};

// Turn cooldown tracking - prevents immediate re-triggering after turn changes
const turnCooldowns: Record<string, number> = {};




import { calculateRent, checkWinCondition, hasColorMonopoly, nearestCell, nearestUtility, railroads, utilities, findPropertyOwner, endGame, startGameTimer } from './src/services/gameLogic.js';
import { registerTradeHandlers } from './src/controllers/tradeController.js';

const chanceEffects: Record<number, (player: Player, room: Room) => void> = {
  1: (p, room) => {
    // စတင် (GO) သို့ တိုက်ရိုက်သွားပါ
    p.position = 0;
    p.money += 200;
    io.to(room.name).emit("collect-money", { uid: p.uid, reason: "card" });
  },
  2: (p, room) => {
    // ပုဂံ သို့ သွားပါ (Pass GO = get 200)
    if (p.position > 34) {
      p.money += 200; // Passed GO
      io.to(room.name).emit("collect-money", { uid: p.uid, reason: "card" });
    }
    p.position = 34;
  },
  3: (p, room) => {
    // မေမြို့ သို့ သွားပါ (Pass GO = get 200)
    if (p.position > 24) {
      p.money += 200; // Passed GO
      io.to(room.name).emit("collect-money", { uid: p.uid, reason: "card" });
    }
    p.position = 24;
  },
  4: (p) => {
    // အနီးဆုံး လျှပ်စစ်/ရေပေးဝေရေးဌာနသို့ သွားပါ
    p.position = nearestUtility(p.position);
  },
  5: (p) => {
    // အနီးဆုံး ဘူတာ/ဆိပ်ကမ်း သို့ သွားပါ
    p.position = nearestCell(p.position);
  },
  6: (p) => {
    // ဘဏ်မှ အတိုးရငွေ ၅၀ ပေါင်းထည့်ပေးပါ
    p.money += 50;
  },
  7: (p) => {
    // အချုပ်ခန်းမှ အခမဲ့ထွက်ခွင့်ကတ်ကို inventory ထဲ ထည့်ပါ
    p.inventory.chanceCards.push(7);
  },
  8: (p, room) => {
    // လက်ရှိနေရာမှ ၃ ကွက် နောက်ဆုတ်ပါ
    p.position = (p.position - 3 + 40) % 40;

    // Check new position effects
    if (p.position === 0) {
      // Landed on GO (from 3) -> Collect 200
      p.money += 200;
      io.to(room.name).emit("collect-money", { uid: p.uid, reason: "card" });
    } else if (p.position === 33) {
      // Landed on Community Chest (from 36) -> Draw Card
      p.inCardDraw = true;
      io.to(room.name).emit("before-draw", {
        type: "community",
        uid: p.uid,
      });
      console.log(
        `Player ${p.name} moved back to Community Chest -> Triggering draw`,
      );
    } else if (p.position === 38) {
      // Landed on Luxury Tax (from 1) -> Pay 100
      p.money -= 100;
      io.to(room.name).emit("tax-paid", { uid: p.uid, amount: 100 });
    } else if (p.position === 4) {
      // Landed on Income Tax (from 7) -> Pay 200
      p.money -= 200;
      io.to(room.name).emit("tax-paid", { uid: p.uid, amount: 200 });
    }
  },
  9: (p) => {
    // အချုပ်ခန်းသို့ တိုက်ရိုက်သွားပါ
    p.position = 10;
  },
  10: (p) => {
    // အိမ်/ဟိုတယ် ပြုပြင်စရိတ် ၂၅ နှုတ်ပါ
    p.money -= 25;
  },
  11: (p) => {
    // ဒဏ်ကြေး ၁၅ နှုတ်ပါ
    p.money -= 15;
  },
  12: (p) => {
    // မင်္ဂလာဒုံလေဆိပ် သို့ သွားပါ
    p.position = 35;
  },
  13: (p) => {
    // ရန်ကုန် သို့ သွားပါ
    p.position = 39;
  },
  14: (p, room) => {
    // ဥက္ကဋ္ဌဖြစ်၍ အခြားသူများကို တစ်ဦးလျှင် ၅၀ စီ ပေးပါ
    const others = room.players.filter((pl: Player) => pl.uid !== p.uid);
    p.money -= 50 * others.length;
    others.forEach((pl: Player) => (pl.money += 50));
  },
  15: (p) => {
    // အဆောက်အဦးချေးငွေ သက်တမ်းစေ့၍ ၁၅၀ ရပါ
    p.money += 150;
  },
  16: (p) => {
    // ပြိုင်ပွဲနိုင်၍ ၁၀၀ ရပါ
    p.money += 100;
  },
};

// Community Chest (ပဟေဠိ) ကတ်များ၏ Logic
const communityEffects: Record<number, (player: Player, room: Room) => void> = {
  1: (p, room) => {
    // စတင် (GO) သို့ တိုက်ရိုက်သွားပါ
    p.position = 0;
    p.money += 200;
    io.to(room.name).emit("collect-money", { uid: p.uid, reason: "card" });
  },
  2: (p) => {
    // ဘဏ်အမှားကြောင့် ၂၀၀ ရပါ
    p.money += 200;
  },
  3: (p) => {
    // ဆရာဝန်ခ ၅၀ ပေးဆောင်ပါ
    p.money -= 50;
  },
  4: (p) => {
    // ရှယ်ယာရောင်းရငွေ ၅၀ ရပါ
    p.money += 50;
  },
  5: (p) => {
    // အချုပ်ခန်းမှ အခမဲ့ထွက်ခွင့်ကတ်ကို inventory ထဲ ထည့်ပါ
    p.inventory.communityChestCards.push(5);
  },
  6: (p) => {
    // အချုပ်ခန်းသို့ တိုက်ရိုက်သွားပါ
    p.position = 10;
  },
  7: (p, room) => {
    // အော်ပရာပွဲအတွက် အခြားသူများဆီမှ ၅၀ စီ ရယူပါ
    const others = room.players.filter((pl: Player) => pl.uid !== p.uid);
    p.money += 50 * others.length;
    others.forEach((pl: Player) => (pl.money -= 50));
  },
  8: (p) => {
    // အားလပ်ရက်စုငွေ ၁၀၀ ရပါ
    p.money += 100;
  },
  9: (p) => {
    // အခွန်ပြန်အမ်းငွေ ၂၀ ရပါ
    p.money += 20;
  },
  10: (p, room) => {
    // မွေးနေ့လက်ဆောင်အဖြစ် အခြားသူများဆီမှ ၁၀ စီ ရယူပါ
    const others = room.players.filter((pl: Player) => pl.uid !== p.uid);
    p.money += 10 * others.length;
    others.forEach((pl: Player) => (pl.money -= 10));
  },
  11: (p) => {
    // အာမခံကြေး ၁၀၀ ရပါ
    p.money += 100;
  },
  12: (p) => {
    // ဆေးရုံစရိတ် ၁၀၀ ပေးဆောင်ပါ
    p.money -= 100;
  },
  13: (p) => {
    // ကျောင်းလစာ ၅၀ ပေးဆောင်ပါ
    p.money -= 50;
  },
  14: (p) => {
    // အတိုင်ပင်ခံကြေး ၂၅ ရပါ
    p.money += 25;
  },
  15: (p) => {
    // အလှမယ်ပြိုင်ပွဲဆုကြေး ၁၀ ရပါ
    p.money += 10;
  },
  16: (p) => {
    // အမွေရငွေ ၁၀၀ ရပါ
    p.money += 100;
  },
};
/**
 * ကတ်များ၏ အကျိုးသက်ရောက်မှုကို လက်တွေ့အသုံးချသော Function
 * @param roomName - လက်ရှိအခန်းအမည်
 * @param uid - ကတ်ဆွဲသော player ၏ ID
 * @param deckType - Chance (ကံစမ်းမဲ) သို့မဟုတ် Community (ပဟေဠိ)
 * @param cardId - ဆွဲလိုက်သော ကတ်၏ နံပါတ် (ID)
 */
const applyCardEffect = (
  roomName: string,
  uid: string,
  deckType: string,
  cardId: number,
) => {
  // ၁။ အခန်း (Room) ရှိမရှိ အရင်စစ်မည်
  const room = rooms[roomName];
  if (!room) return;

  // ၂။ ကတ်ဆွဲသည့် Player ကို ရှာမည်
  const player = room.players.find((p) => p.uid === uid);
  if (!player) return;

  // ၃။ Deck အမျိုးအစားအလိုက် အသုံးပြုမည့် Logic Map ကို ရွေးချယ်မည်
  // Chance ဖြစ်လျှင် chanceEffects ကိုသုံးပြီး၊ မဟုတ်လျှင် communityEffects ကိုသုံးမည်
  const effectMap = deckType === "chance" ? chanceEffects : communityEffects;

  // ၄။ Card ID နှင့် ကိုက်ညီသော Logic ရှိမရှိ စစ်ဆေးပြီး Run မည်
  if (effectMap[cardId]) {
    const oldPos = player.position;

    // Reset inCardDraw BEFORE applying effect.
    // This allows the effect (e.g. Card 8) to set it back to true if a new draw is triggered.
    player.inCardDraw = false;

    // သက်ဆိုင်ရာ function ထဲသို့ player နှင့် room data များ ပေးပို့လိုက်သည်
    effectMap[cardId](player, room);

    console.log(
      `✅ Applied ${deckType} card ID ${cardId} for player ${player.name}`,
    );
    console.log(player);

    // If position changed, emit move-result so client animates it
    if (player.position !== oldPos) {
      // Find next player index to match the move-result format (even though turn passes later)
      // Actually, we plan to pass turn AFTER this function based on the client call.
      // But move-result expects a nextPlayerUid.
      // Let's calculate who WOULD be next.
      const currentIndex = room.players.findIndex((p) => p.uid === uid);
      const nextIndex = (currentIndex + 1) % room.players.length;

      // Check for backward movement (Card 8: Go Back 3 Spaces)
      let isBackward = false;
      if (deckType === "chance" && cardId === 8) {
        isBackward = true;
      }

      let nextUid = room.players[nextIndex].uid;
      // If player triggered another draw (e.g. Chance -> Community), turn stays with them
      if (player.inCardDraw) {
        nextUid = player.uid;
      }

      io.to(roomName).emit("move-result", {
        uid,
        from: oldPos,
        to: player.position,
        money: player.money,
        nextPlayerUid: nextUid, // Correctly anticipate turn pass or stay
        isBackward,
      });

      // ================= RENT PAYMENT FOR CARD MOVEMENTS =================
      // Check if landed on owned property and pay rent (for cards that move to properties)
      // Skip rent check for: GO (0), Jail (10), Chance/Community positions
      const skipRentPositions = [0, 10, 2, 7, 17, 22, 33, 36]; // GO, Jail, Chance, Community
      if (!skipRentPositions.includes(player.position)) {
        const cardBuildingLevel = propertyBuildings[roomName]?.[player.position] || 0;
        const rentResult = calculateRent(room, player.position, roomName, 0, cardBuildingLevel); // dice=0 for card movement
        
        if (rentResult.owner && rentResult.owner.uid !== player.uid && rentResult.rentAmount > 0) {
          // Check if player has enough money
          if (player.money < rentResult.rentAmount) {
            // Player cannot pay full rent - check if they have assets to sell
            const hasProperties = player.inventory.properties.length > 0;
            const totalPropertiesValue = player.inventory.properties.reduce((sum: number, propIdx: number) => {
              let origPrice = 0;
              if (propIdx <= 10) origPrice = propIdx * 20;
              else if (propIdx <= 20) origPrice = propIdx * 15;
              else if (propIdx <= 30) origPrice = propIdx * 12;
              else origPrice = propIdx * 10;
              return sum + Math.floor(origPrice / 2); // Sell price is half
            }, 0);
            
            const canPayBySelling = totalPropertiesValue >= (rentResult.rentAmount - player.money);
            
            if (hasProperties && canPayBySelling) {
              // Player has properties to sell - emit force-sell event
              console.log(`🏦 ${player.name} needs to sell properties to pay Ks ${rentResult.rentAmount} rent from card (has Ks ${player.money})`);
              
              io.to(roomName).emit("force-sell-required", {
                uid: player.uid,
                debtAmount: rentResult.rentAmount - player.money,
                totalRent: rentResult.rentAmount,
                ownerUid: rentResult.owner.uid,
                propertyIndex: player.position,
                hasHotel: rentResult.hasHotel,
                hasMonopoly: rentResult.hasMonopoly,
              });
              
              io.to(roomName).emit("update-rooms", rooms);
              return; // Stop here - wait for player to sell
            } else {
              // Player has no properties or not enough - go bankrupt
              const amountPaid = player.money;
              player.money = 0;
              player.bankrupt = true;
              rentResult.owner.money += amountPaid;
              
              console.log(`💀 ${player.name} is BANKRUPT from card! Couldn't pay Ks ${rentResult.rentAmount}, paid Ks ${amountPaid}`);
              
              io.to(roomName).emit("player-bankrupt", {
                uid: player.uid,
                name: player.name,
                debtAmount: rentResult.rentAmount - amountPaid,
                paidAmount: amountPaid,
                ownerUid: rentResult.owner.uid,
                ownerName: rentResult.owner.name,
              });
              
              io.to(roomName).emit("rent-paid", {
                fromUid: player.uid,
                toUid: rentResult.owner.uid,
                propertyIndex: player.position,
                amount: amountPaid,
                hasHotel: rentResult.hasHotel,
                hasMonopoly: rentResult.hasMonopoly,
                isPartial: true,
                isBankruptcy: true,
                baseRent: rentResult.baseRent,
                buildingLevel: rentResult.buildingLevel,
                houseCount: rentResult.houseCount,
              });
              
              // Check for winner
              const winCheck = checkWinCondition(roomName);
              if (winCheck.hasWinner && winCheck.winner) {
                endGame(roomName, winCheck.winner, "last-standing");
              }
            }
          } else {
            // Pay full rent
            player.money -= rentResult.rentAmount;
            rentResult.owner.money += rentResult.rentAmount;
            
            console.log(`💰 ${player.name} paid Ks ${rentResult.rentAmount} rent to ${rentResult.owner.name} from card ${rentResult.hasHotel ? '(with hotel)' : ''} ${rentResult.hasMonopoly ? '(monopoly bonus)' : ''}`);
            
            io.to(roomName).emit("rent-paid", {
              fromUid: player.uid,
              toUid: rentResult.owner.uid,
              propertyIndex: player.position,
              amount: rentResult.rentAmount,
              hasHotel: rentResult.hasHotel,
              hasMonopoly: rentResult.hasMonopoly,
              isPartial: false,
              isFromCard: true,
              baseRent: rentResult.baseRent,
              buildingLevel: rentResult.buildingLevel,
              houseCount: rentResult.houseCount,
            });
          }
        }
      }
    }

    // player.inCardDraw = false; // Moved to before effect application
  } else {
    // logic မရှိသေးသော ကတ်နံပါတ်ဆိုလျှင် log ထုတ်ပြမည်
    console.log(`⚠️ No logic defined for ${deckType} card ID: ${cardId}`);
  }

  // ၅။ အပြောင်းအလဲများပြီးနောက် Room State ကို Update လုပ်ရန်အတွက်
  // ဒီ function ပြီးရင်
  io.to(roomName).emit("update-rooms", rooms);
};



// Helper function to return player assets to bank
const returnAssetsToBank = (roomName: string, player: Player) => {
  const room = rooms[roomName];
  if (!room) return;

  // Get all properties to return
  const propertiesToReturn = [...player.inventory.properties];
  const chanceCards = [...player.inventory.chanceCards];
  const communityCards = [...player.inventory.communityChestCards];

  // Clear player's inventory
  player.inventory.properties = [];
  player.inventory.chanceCards = [];
  player.inventory.communityChestCards = [];

  // Remove buildings from all properties
  if (propertyBuildings[roomName]) {
    propertiesToReturn.forEach(propIndex => {
      if (propertyBuildings[roomName][propIndex] !== undefined) {
        delete propertyBuildings[roomName][propIndex];
      }
    });
  }

  console.log(`🏦 Assets returned to bank from ${player.name}: ${propertiesToReturn.length} properties, ${chanceCards.length} chance cards, ${communityCards.length} community cards`);

  // Emit event to notify all players that assets are back to bank
  io.to(roomName).emit("assets-returned-to-bank", {
    uid: player.uid,
    name: player.name,
    properties: propertiesToReturn,
    message: `${player.name}'s assets have been returned to the bank and are now available for purchase`,
  });

  return { properties: propertiesToReturn, chanceCards, communityCards };
};





io.on("connection", (socket) => {
  // Send all rooms on new connection
  emitRoomsToSocket(socket);

  // Lobby requests current rooms
  socket.on("get-rooms", () => {
    emitRoomsToSocket(socket);
  });

  // Create a new room
  socket.on("create-room", async ({ roomName, maxPlayers, user }) => {
    if (!roomName || rooms[roomName]) {
      socket.emit("error", "Room invalid or already exists");
      return;
    }

    // Fetch player's wins and economy/cosmetics from database
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

    // Check if player was previously disconnected (reconnecting)
    const disconnectedPlayer = room.players.find((p) => p.uid === user.uid && p.disconnected);
    if (disconnectedPlayer) {
      // Reconnect the player
      disconnectedPlayer.disconnected = false;
      disconnectedPlayer.socketId = socket.id;

      // Refresh their cosmetics returning from the shop
      const economyAndCosmetics = await fetchPlayerEconomy(user.uid);
      disconnectedPlayer.equippedItems = {
        dice_skin: economyAndCosmetics.dice_skin,
        board_theme: economyAndCosmetics.board_theme,
        avatar: economyAndCosmetics.avatar,
      };

      console.log(`🔌 Player ${disconnectedPlayer.name} reconnected to ${roomName}`);
      
      socket.join(roomName);
      emitRooms();
      socket.emit("room-joined", roomName);
      socket.emit("player-reconnected", {
        uid: disconnectedPlayer.uid,
        name: disconnectedPlayer.name,
        message: "Welcome back! You have rejoined the game.",
      });
      
      // Notify other players
      io.to(roomName).emit("player-reconnected-notification", {
        uid: disconnectedPlayer.uid,
        name: disconnectedPlayer.name,
        message: `${disconnectedPlayer.name} has reconnected to the game`,
      });
      return;
    }

    // Check if player already exists (not disconnected)
    const exists = room.players.some((p) => p.uid === user.uid);
    if (exists) {
      socket.emit("error", "You are already in this room");
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit("error", "Room full");
      return;
    }

    // Fetch player's wins and economy/cosmetics from database
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

  // Add bot to room (only in waiting status)
  socket.on("add-bot", ({ roomName, botDifficulty }) => {
    const room = rooms[roomName];
    if (!room) return;
    if (room.status !== "waiting") {
      socket.emit("error", "Can only add bots before the game starts");
      return;
    }
    if (room.players.length >= room.maxPlayers) {
      socket.emit("error", "Room is full");
      return;
    }

    const botId = `bot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const botName = `Bot (${botDifficulty})`;

    room.players.push({
      uid: botId,
      name: botName,
      identifier: botId,
      socketId: "bot",
      money: 1500,
      position: 0,
      inCardDraw: false,
      isActive: false,
      color: "gray",
      isBot: true,
      botDifficulty: botDifficulty || "medium",
      wins: 0,
      inventory: {
        chanceCards: [],
        communityChestCards: [],
        properties: [],
      },
    });

    emitRooms();
  });

  // Remove bot from room
  socket.on("remove-bot", ({ roomName, botUid }) => {
    const room = rooms[roomName];
    if (!room) return;

    // Remove bot from processing set if it's currently taking a turn
    const botKey = `${roomName}_${botUid}`;
    if (processingBots.has(botKey)) {
      processingBots.delete(botKey);
    }

    // Pass turn to next player if the bot was active
    const botPlayer = room.players.find((p) => p.uid === botUid);
    if (botPlayer && botPlayer.isActive && room.status === "in-game") {
      passBotTurn(roomName, botUid);
    }

    room.players = room.players.filter((p) => p.uid !== botUid);
    io.to(roomName).emit("update-rooms", rooms);
    
    // Check if the game needs to end after bot removal
    if (room.status === "in-game") {
      const activeRealPlayers = room.players.filter(p => !p.surrendered && !p.bankrupt);
      if (activeRealPlayers.length <= 1) {
        const winCheck = checkWinCondition(roomName);
        if (winCheck.hasWinner && winCheck.winner) {
          endGame(roomName, winCheck.winner, "last-standing");
        }
      }
    }
  });

  // Leave room
  socket.on("leave-room", ({ roomName, uid }) => {
    const room = rooms[roomName];
    if (!room) return;

    const leavingPlayer = room.players.find(p => p.uid === uid);
    
    // Save the full player list BEFORE removing the leaving player (for stats)
    const allPlayersBeforeLeave = room.players.map(p => ({ 
      uid: p.uid, name: p.name, money: p.money, 
      surrendered: p.surrendered || false, bankrupt: p.bankrupt || false,
      isBot: p.isBot,
      position: p.position || 0,
      properties: p.inventory?.properties?.length || 0,
    }));
    const totalPlayersBeforeLeave = room.players.length;
    
    // Return assets to bank if game is in progress and player is leaving
    if (leavingPlayer && room.status === "in-game") {
      returnAssetsToBank(roomName, leavingPlayer);
    }
    
    room.players = room.players.filter((p) => p.uid !== uid);
    socket.leave(roomName);

    // Delete room when empty
    if (room.players.length === 0) {
      delete rooms[roomName];
      console.log(`🗑️ Room "${roomName}" deleted - no players left`);
    }

    // Check if game should end (player left during active game)
    // Only proceed if stats haven't been updated yet (prevent double-processing from endGame)
    if (room && room.status === "in-game" && !room.statsUpdated) {
      const activePlayers = room.players.filter(p => !p.surrendered && !p.bankrupt);
      if (activePlayers.length === 1) {
        const winner = activePlayers[0];
        room.status = "finished";
        room.winner = winner.uid;
        if (gameTimers[roomName]) { clearTimeout(gameTimers[roomName]); delete gameTimers[roomName]; }
        if (gameTimers[roomName + "_duration"]) { clearTimeout(gameTimers[roomName + "_duration"]); delete gameTimers[roomName + "_duration"]; }
        
        console.log(`🏆 Game ended in ${roomName}! Winner: ${winner.name} (last-standing after player left)`);
        
        const gameDurationSeconds = Math.floor((Date.now() - (room.gameStartTime || Date.now())) / 1000);
        io.to(roomName).emit("game-ended", {
          winner: { uid: winner.uid, name: winner.name, money: winner.money, properties: winner.inventory.properties?.length || 0 },
          reason: "last-standing",
          roomName,
          gameDurationSeconds,
          minDurationMet: room.minDurationMet || false,
          totalPlayers: totalPlayersBeforeLeave,
          players: allPlayersBeforeLeave.map(p => ({ ...p, isWinner: p.uid === winner.uid })),
          endedAt: new Date().toISOString(),
        });
        
        if (!room.statsUpdated) {
          room.statsUpdated = true;
          const gameId = `${roomName}_${room.gameStartTime || Date.now()}_${winner.uid}`;
          console.log(`📊 Updating stats (leave-room). Winner: ${winner.name}. All players:`, allPlayersBeforeLeave.map(p => `${p.name}(${p.uid.slice(0,8)})`).join(', '));
          updatePlayerStats(
            { uid: winner.uid, name: winner.name }, 
            allPlayersBeforeLeave,
            gameId
          );
          const coinsCost = room.gameRules?.coinsCost ?? 0;
          if (coinsCost > 0) {
            rewardPlayers(winner.uid, allPlayersBeforeLeave, coinsCost, room.originalPlayerCount).then(({ winnerReward }) => {
              if (winnerReward > 0) broadcastToRoom(roomName, "coins-awarded", { amount: winnerReward, winnerUid: winner.uid });
            });
          }
        }
      }
    }

    emitRooms();
  });

  // ================= Surrender (Stop playing but watch) =================
  socket.on("surrender", ({ roomName, uid }) => {
    const room = rooms[roomName];
    if (!room || room.status !== "in-game") {
      socket.emit("error", "Cannot surrender - game not in progress");
      return;
    }

    const player = room.players.find((p) => p.uid === uid);
    if (!player) {
      socket.emit("error", "Player not found");
      return;
    }

    // Return all assets to bank before surrendering
    returnAssetsToBank(roomName, player);

    // Mark player as surrendered
    player.surrendered = true;
    player.isActive = false;

    console.log(`🏳️ ${player.name} surrendered in ${roomName}`);

    // Broadcast surrender to all players
    io.to(roomName).emit("player-surrendered", {
      uid: player.uid,
      name: player.name,
      message: `${player.name} has surrendered and is now watching`,
    });

    // Check if game should end - inline check using local rooms
    // Only proceed if stats haven't been updated yet (prevent double-processing from endGame)
    const activePlayers = room.players.filter(p => !p.surrendered && !p.bankrupt);
    if (activePlayers.length === 1 && !room.statsUpdated) {
      const winner = activePlayers[0];
      console.log(`\ud83c\udfc6 Game ended in ${roomName}! Winner: ${winner.name} (last-standing after surrender)`);
      
      room.status = "finished";
      room.winner = winner.uid;
      
      // Clear timers
      if (gameTimers[roomName]) {
        clearTimeout(gameTimers[roomName]);
        delete gameTimers[roomName];
      }
      if (gameTimers[roomName + "_duration"]) {
        clearTimeout(gameTimers[roomName + "_duration"]);
        delete gameTimers[roomName + "_duration"];
      }
      
      const now = new Date().toISOString();
      const gameDurationSeconds = Math.floor((Date.now() - (room.gameStartTime || Date.now())) / 1000);
      
      const playerData = room.players.map(p => ({
        uid: p.uid,
        name: p.name,
        money: p.money,
        position: p.position,
        properties: p.inventory.properties?.length || 0,
        surrendered: p.surrendered || false,
        isWinner: p.uid === winner.uid,
      }));

      io.to(roomName).emit("game-ended", {
        winner: {
          uid: winner.uid,
          name: winner.name,
          money: winner.money,
          properties: winner.inventory.properties?.length || 0,
        },
        reason: "last-standing",
        roomName,
        gameDurationSeconds,
        minDurationMet: room.minDurationMet || false,
        totalPlayers: room.players.length,
        players: playerData,
        endedAt: now,
      });

      // Update stats and reward
      if (!room.statsUpdated) {
        room.statsUpdated = true;
        const gameTimestamp = room.gameStartTime || Date.now();
        const gameId = `${roomName}_${gameTimestamp}_${winner.uid}`;
        
        const allPlayers = room.players.map(p => ({ uid: p.uid, name: p.name, money: p.money, surrendered: p.surrendered, isBot: p.isBot }));
        console.log(`📊 Updating stats for game ${gameId}. Winner: ${winner.name}. All players:`, allPlayers.map(p => `${p.name}(${p.uid.slice(0,8)})`).join(', '));
        
        updatePlayerStats(
          { uid: winner.uid, name: winner.name },
          allPlayers,
          gameId
        );
        
        const coinsCost = room.gameRules?.coinsCost ?? 0;
        console.log(`💰 Coins cost for this game: ${coinsCost}. Total players: ${room.players.length}`);
        if (coinsCost > 0) {
          const expectedWinnerReward = (room.originalPlayerCount || room.players.length) * coinsCost;
          console.log(`💰 Expected winner reward: ${expectedWinnerReward} (${room.originalPlayerCount || room.players.length} players × ${coinsCost} coins)`);
          rewardPlayers(winner.uid, room.players, coinsCost, room.originalPlayerCount).then(({ winnerReward }) => {
            console.log(`💰 Actual winner reward: ${winnerReward}`);
            if (winnerReward > 0) {
              broadcastToRoom(roomName, "coins-awarded", { amount: winnerReward, winnerUid: winner.uid });
            }
          });
        }
      }
    } else {
      // Pass turn to next active player if current player surrendered
      const currentIndex = room.players.findIndex((p) => p.uid === uid);
      const nextIndex = (currentIndex + 1) % room.players.length;
      
      // Find next non-surrendered player
      let nextPlayerIndex = nextIndex;
      let loops = 0;
      while ((room.players[nextPlayerIndex]?.surrendered || room.players[nextPlayerIndex]?.bankrupt) && loops < room.players.length) {
        nextPlayerIndex = (nextPlayerIndex + 1) % room.players.length;
        loops++;
      }
      
      if (!room.players[nextPlayerIndex]?.surrendered && !room.players[nextPlayerIndex]?.bankrupt) {
        room.players = room.players.map((p, i) => ({
          ...p,
          isActive: i === nextPlayerIndex,
        }));
        
        // Emit explicit next-turn event for reliable turn synchronization
        io.to(roomName).emit("next-turn", {
          nextPlayerUid: room.players[nextPlayerIndex].uid,
          nextPlayerIndex: nextPlayerIndex,
        });
      }
      
      io.to(roomName).emit("update-rooms", rooms);
    }
  });

  // ================= Declare Bankruptcy (Lost but watch) =================
  socket.on("declare-bankruptcy", ({ roomName, uid, ownerUid, debtAmount }) => {
    const room = rooms[roomName];
    if (!room || room.status !== "in-game") {
      socket.emit("error", "Cannot declare bankruptcy - game not in progress");
      return;
    }

    const player = room.players.find((p) => p.uid === uid);
    const owner = room.players.find((p) => p.uid === ownerUid);
    if (!player) {
      socket.emit("error", "Player not found");
      return;
    }

    // Return all assets to bank before bankruptcy
    returnAssetsToBank(roomName, player);

    // Mark player as bankrupt
    const amountPaid = player.money;
    player.money = 0;
    player.bankrupt = true;
    player.isActive = false;
    
    if (owner) {
      owner.money += amountPaid;
    }

    console.log(`💀 ${player.name} declared BANKRUPTCY! Paid Ks ${amountPaid} to ${owner?.name || 'bank'}`);

    // Broadcast bankruptcy to all players
    io.to(roomName).emit("player-bankrupt", {
      uid: player.uid,
      name: player.name,
      debtAmount: debtAmount - amountPaid,
      paidAmount: amountPaid,
      ownerUid: ownerUid,
      ownerName: owner?.name || "Bank",
    });

    // Check if game should end - inline check using local rooms
    // Only proceed if stats haven't been updated yet (prevent double-processing from endGame)
    const activePlayers = room.players.filter(p => !p.surrendered && !p.bankrupt);
    if (activePlayers.length === 1 && !room.statsUpdated) {
      const winner = activePlayers[0];
      console.log(`\ud83c\udfc6 Game ended in ${roomName}! Winner: ${winner.name} (last-standing after bankruptcy)`);
      
      room.status = "finished";
      room.winner = winner.uid;
      
      if (gameTimers[roomName]) { clearTimeout(gameTimers[roomName]); delete gameTimers[roomName]; }
      if (gameTimers[roomName + "_duration"]) { clearTimeout(gameTimers[roomName + "_duration"]); delete gameTimers[roomName + "_duration"]; }
      
      const gameDurationSeconds = Math.floor((Date.now() - (room.gameStartTime || Date.now())) / 1000);
      io.to(roomName).emit("game-ended", {
        winner: { uid: winner.uid, name: winner.name, money: winner.money, properties: winner.inventory.properties?.length || 0 },
        reason: "last-standing",
        roomName,
        gameDurationSeconds,
        minDurationMet: room.minDurationMet || false,
        totalPlayers: room.players.length,
        players: room.players.map(p => ({ uid: p.uid, name: p.name, money: p.money, position: p.position, properties: p.inventory.properties?.length || 0, surrendered: p.surrendered || false, bankrupt: p.bankrupt || false, isWinner: p.uid === winner.uid })),
        endedAt: new Date().toISOString(),
      });
      
      if (!room.statsUpdated) {
        room.statsUpdated = true;
        const gameId = `${roomName}_${room.gameStartTime || Date.now()}_${winner.uid}`;
        updatePlayerStats({ uid: winner.uid, name: winner.name }, room.players.map(p => ({ uid: p.uid, name: p.name, money: p.money, surrendered: p.surrendered })), gameId);
        const coinsCost = room.gameRules?.coinsCost ?? 0;
        if (coinsCost > 0) {
          rewardPlayers(winner.uid, room.players, coinsCost).then(({ winnerReward }) => {
            if (winnerReward > 0) broadcastToRoom(roomName, "coins-awarded", { amount: winnerReward, winnerUid: winner.uid });
          });
        }
      }
    } else {
      // Pass turn to next active player
      const currentIndex = room.players.findIndex((p) => p.uid === uid);
      const nextIndex = (currentIndex + 1) % room.players.length;
      
      // Find next non-surrendered/non-bankrupt player
      let nextPlayerIndex = nextIndex;
      let loops = 0;
      while ((room.players[nextPlayerIndex]?.surrendered || room.players[nextPlayerIndex]?.bankrupt) && loops < room.players.length) {
        nextPlayerIndex = (nextPlayerIndex + 1) % room.players.length;
        loops++;
      }
      
      if (!room.players[nextPlayerIndex]?.surrendered && !room.players[nextPlayerIndex]?.bankrupt) {
        room.players = room.players.map((p, i) => ({
          ...p,
          isActive: i === nextPlayerIndex,
        }));
        
        // Emit explicit next-turn event for reliable turn synchronization
        io.to(roomName).emit("next-turn", {
          nextPlayerUid: room.players[nextPlayerIndex].uid,
          nextPlayerIndex: nextPlayerIndex,
        });
      }
      
      io.to(roomName).emit("update-rooms", rooms);
    }
  });

  // ================= Pay Debt After Selling Properties =================
  socket.on("pay-debt", ({ roomName, uid, ownerUid, amount, propertyIndex }) => {
    const room = rooms[roomName];
    if (!room || room.status !== "in-game") {
      socket.emit("error", "Cannot pay debt - game not in progress");
      return;
    }

    const player = room.players.find((p) => p.uid === uid);
    const owner = room.players.find((p) => p.uid === ownerUid);
    if (!player) {
      socket.emit("error", "Player not found");
      return;
    }

    // Check if player has enough money to pay
    if (player.money < amount) {
      socket.emit("error", "Not enough money to pay debt");
      return;
    }

    // Deduct money from player and pay owner
    player.money -= amount;
    if (owner) {
      owner.money += amount;
    }

    console.log(`💰 ${player.name} paid Ks ${amount} debt to ${owner?.name || 'bank'}`);

    // Emit rent-paid event to show payment
    io.to(roomName).emit("rent-paid", {
      fromUid: player.uid,
      toUid: ownerUid,
      propertyIndex: propertyIndex,
      amount: amount,
      isPartial: false,
      isDebtPayment: true,
    });

    // Pass turn to next player
    const currentIndex = room.players.findIndex((p) => p.uid === uid);
    const nextIndex = (currentIndex + 1) % room.players.length;
    
    // Find next non-surrendered/non-bankrupt player
    let nextPlayerIndex = nextIndex;
    let loops = 0;
    while ((room.players[nextPlayerIndex]?.surrendered || room.players[nextPlayerIndex]?.bankrupt) && loops < room.players.length) {
      nextPlayerIndex = (nextPlayerIndex + 1) % room.players.length;
      loops++;
    }
    
    if (!room.players[nextPlayerIndex]?.surrendered && !room.players[nextPlayerIndex]?.bankrupt) {
      room.players = room.players.map((p, i) => ({
        ...p,
        isActive: i === nextPlayerIndex,
      }));
    }

    // Emit explicit next-turn event for reliable turn synchronization
    io.to(roomName).emit("next-turn", {
      nextPlayerUid: room.players[nextPlayerIndex]?.uid || uid,
      nextPlayerIndex: nextPlayerIndex,
    });

    io.to(roomName).emit("move-result", {
      uid,
      from: player.position,
      to: player.position,
      money: player.money,
      nextPlayerUid: room.players[nextPlayerIndex]?.uid || uid,
    });

    io.to(roomName).emit("update-rooms", rooms);
  });

  // Kick player (only room creator, only before game starts)
  socket.on("kick-player", ({ roomName, uid }) => {
    const room = rooms[roomName];
    if (!room) return;
    if (room.status !== "waiting") return;
    
    // Only the creator can kick
    if (room.creatorUid !== socket.data?.uid) {
      // Fallback: check if the kicker is the first player
      const kickerPlayer = room.players.find(p => p.socketId === socket.id);
      if (!kickerPlayer || (room.creatorUid && room.creatorUid !== kickerPlayer.uid)) return;
    }

    const targetPlayer = room.players.find(p => p.uid === uid);
    if (!targetPlayer) return;

    room.players = room.players.filter((p) => p.uid !== uid);

    // Notify the kicked player
    const targetSocket = io.sockets.sockets.get(targetPlayer.socketId);
    if (targetSocket) {
      targetSocket.leave(roomName);
      targetSocket.emit("kicked-from-room", { roomName });
    }

    emitRooms();
    console.log(`\ud83d\udeab ${targetPlayer.name} was kicked from ${roomName}`);
  });

  // Delete room
  socket.on("delete-room", ({ roomName }) => {
    delete rooms[roomName];
    emitRooms();
  });

  // ================= Animation Complete Handler =================
socket.on("animation-complete", ({ roomName, uid }) => {
  if (!animatingPlayers[roomName]) {
    animatingPlayers[roomName] = new Set();
  }
  animatingPlayers[roomName].delete(uid);
  console.log(`✅ Animation complete for player ${uid} in ${roomName}`);
});

// ================= Animation Start Handler =================
socket.on("animation-start", ({ roomName, uid }) => {
  if (!animatingPlayers[roomName]) {
    animatingPlayers[roomName] = new Set();
  }
  animatingPlayers[roomName].add(uid);
  console.log(`🎬 Animation started for player ${uid} in ${roomName}`);
});

// ================= Pay Debt =================
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

// ================= Declare Bankruptcy =================
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

// ================= Jail Card Decision =================
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

  socket.on("start-game", async ({ roomName, gameRules }) => {
    const room = rooms[roomName];
    if (!room || room.players.length < 2) {
      socket.emit("error", "Need at least 2 players to start the game");
      return;
    }

    // Apply game rules if provided
    if (gameRules) {
      room.gameRules = gameRules;
    }

    const coinsCost = room.gameRules?.coinsCost ?? 0;

    // Deduplicate players by uid BEFORE any operations (prevent double coin deduction)
    const uniquePlayers = room.players.reduce((acc: any[], p: any) => {
      if (!acc.find(existing => existing.uid === p.uid)) {
        acc.push(p);
      }
      return acc;
    }, []);
    
    if (uniquePlayers.length !== room.players.length) {
      console.log(`⚠️ Removed ${room.players.length - uniquePlayers.length} duplicate players from room ${roomName} BEFORE coin deduction`);
      room.players = uniquePlayers;
    }

    // Deduct coins from all players if entry fee is set
    if (coinsCost > 0) {
      // Check balances first
      for (const p of room.players) {
        if (!p.isBot) {
          const economy = await fetchPlayerEconomy(p.uid);
          if (economy.coins < coinsCost) {
            socket.emit("error", `Player ${p.name} doesn't have enough coins (${coinsCost})!`);
            return;
          }
        }
      }
      // Deduct coins
      const { deductCoins } = await import('./src/services/dbService.js');
      for (const p of room.players) {
        if (!p.isBot) {
          const originalBalance = (await fetchPlayerEconomy(p.uid)).coins;
          await deductCoins(p.uid, coinsCost);
          const newBalance = originalBalance - coinsCost;
          // Emit dialog notification to each player individually
          io.to(p.socketId || roomName).emit("coin-deduction-dialog", {
            playerName: p.name,
            originalBalance,
            deductedAmount: coinsCost,
            newBalance,
            message: `💰 ${p.name} မှ မူလ ${originalBalance} coins မှ ${coinsCost} coins နှုတ်ယူခြင်း\nကျန်ရှိ ${newBalance} coins`,
          });
        }
      }
      broadcastToRoom(roomName, "coins-deducted", { amount: coinsCost });
    }

    const startingMoney = room.gameRules?.startingMoney ?? 1500;

    room.status = "in-game";
    room.gameStartTime = Date.now();
    room.winner = undefined;
    room.minDurationMet = false;
    room.statsUpdated = false;
    room.originalPlayerCount = room.players.length; // Store original count for prize calculation
    
    // Fetch wins for all players from the database
    const playerWinsPromises = room.players.map((p) => fetchPlayerWins(p.uid));
    const playerWins = await Promise.all(playerWinsPromises);
    
    // Set first human player as active (or first bot if no humans)
    const firstHumanIndex = room.players.findIndex((p: any) => !p.isBot);
    const startingIndex = firstHumanIndex !== -1 ? firstHumanIndex : 0;

    room.players = room.players.map((p, i) => ({
      ...p,
      isActive: i === startingIndex,
      money: startingMoney,
      position: 0,
      inCardDraw: false,
      surrendered: false,
      bankrupt: false,
      wins: playerWins[i],
      inventory: {
        chanceCards: [],
        communityChestCards: [],
        properties: [],
      },
    }));

    // Clear buildings
    propertyBuildings[roomName] = {};

    // Start game timers (inline - using local rooms, NOT gameState.ts rooms)
    // ---- Minimum duration timer (1 min) for ranking qualification ----
    if (gameTimers[roomName]) { clearTimeout(gameTimers[roomName]); }
    if (gameTimers[roomName + "_duration"]) { clearTimeout(gameTimers[roomName + "_duration"]); }
    
    gameTimers[roomName] = setTimeout(() => {
      const r = rooms[roomName];
      if (!r || r.status !== "in-game") return;
      
      r.minDurationMet = true;
      console.log(`⏱️ Minimum 1-minute duration met for ${roomName} - games now qualify for rankings`);
      
      // Check if someone already won while waiting for min duration
      const activePlayersNow = r.players.filter(p => !p.surrendered && !p.bankrupt);
      if (activePlayersNow.length === 1) {
        const w = activePlayersNow[0];
        r.status = "finished";
        r.winner = w.uid;
        const dur = Math.floor((Date.now() - (r.gameStartTime || Date.now())) / 1000);
        io.to(roomName).emit("game-ended", {
          winner: { uid: w.uid, name: w.name, money: w.money, properties: w.inventory.properties?.length || 0 },
          reason: "last-standing", roomName, gameDurationSeconds: dur,
          minDurationMet: true, totalPlayers: r.players.length,
          players: r.players.map(p => ({ uid: p.uid, name: p.name, money: p.money, position: p.position, properties: p.inventory.properties?.length || 0, surrendered: p.surrendered || false, isWinner: p.uid === w.uid })),
          endedAt: new Date().toISOString(),
        });
        if (!r.statsUpdated) {
          r.statsUpdated = true;
          const gId = `${roomName}_${r.gameStartTime || Date.now()}_${w.uid}`;
          updatePlayerStats({ uid: w.uid, name: w.name }, r.players.map(p => ({ uid: p.uid, name: p.name, money: p.money, surrendered: p.surrendered })), gId);
          const cc = r.gameRules?.coinsCost ?? 0;
          if (cc > 0) {
            rewardPlayers(w.uid, r.players, cc, r.originalPlayerCount).then(({ winnerReward }) => {
              if (winnerReward > 0) broadcastToRoom(roomName, "coins-awarded", { amount: winnerReward, winnerUid: w.uid });
            });
          }
        }
      }
    }, 1 * 60 * 1000);
    console.log(`⏱️ 1-minute minimum duration timer started for ${roomName}`);

    // ---- Custom Game Rules Timer ----
    const customTimerMinutes = room.gameRules?.timer;
    if (customTimerMinutes && customTimerMinutes !== "unlimited") {
      const timerMs = (customTimerMinutes as number) * 60 * 1000;
      gameTimers[roomName + "_duration"] = setTimeout(() => {
        const r = rooms[roomName];
        if (!r || r.status !== "in-game") return;
        console.log(`⏱️ Custom timer (${customTimerMinutes}m) ended for ${roomName}`);
        
        const activeP = r.players.filter(p => !p.surrendered && !p.bankrupt);
        if (activeP.length === 0) return;
        
        let wealthiest = activeP[0];
        let maxW = -1;
        for (const p of activeP) {
          const wealth = p.money + (p.inventory?.properties?.length || 0) * 100;
          if (wealth > maxW) { maxW = wealth; wealthiest = p; }
        }
        
        r.status = "finished";
        r.winner = wealthiest.uid;
        const dur = Math.floor((Date.now() - (r.gameStartTime || Date.now())) / 1000);
        io.to(roomName).emit("game-ended", {
          winner: { uid: wealthiest.uid, name: wealthiest.name, money: wealthiest.money, properties: wealthiest.inventory.properties?.length || 0 },
          reason: "time-limit", roomName, gameDurationSeconds: dur,
          minDurationMet: r.minDurationMet || false, totalPlayers: r.players.length,
          players: r.players.map(p => ({ uid: p.uid, name: p.name, money: p.money, position: p.position, properties: p.inventory.properties?.length || 0, surrendered: p.surrendered || false, isWinner: p.uid === wealthiest.uid })),
          endedAt: new Date().toISOString(),
        });
        if (!r.statsUpdated) {
          r.statsUpdated = true;
          const gId = `${roomName}_${r.gameStartTime || Date.now()}_${wealthiest.uid}`;
          updatePlayerStats({ uid: wealthiest.uid, name: wealthiest.name }, r.players.map(p => ({ uid: p.uid, name: p.name, money: p.money, surrendered: p.surrendered })), gId);
          const cc = r.gameRules?.coinsCost ?? 0;
          if (cc > 0) {
            rewardPlayers(wealthiest.uid, r.players, cc, r.originalPlayerCount).then(({ winnerReward }) => {
              if (winnerReward > 0) broadcastToRoom(roomName, "coins-awarded", { amount: winnerReward, winnerUid: wealthiest.uid });
            });
          }
        }
      }, timerMs);
      console.log(`⏱️ Custom game timer started: ${customTimerMinutes} minutes for ${roomName}`);
    }

    // Emit explicit next-turn event for reliable turn synchronization when game starts
    io.to(roomName).emit("next-turn", {
      nextPlayerUid: room.players[startingIndex].uid,
      nextPlayerIndex: startingIndex,
    });

    io.to(roomName).emit("update-rooms", rooms);
    console.log(`\ud83c\udfae Game started in ${roomName} with ${room.players.length} players (Starting money: ${startingMoney}, Entry fee: ${coinsCost})`);
    console.log(`\ud83c\udfc6 Player wins loaded:`, room.players.map(p => `${p.name}: ${p.wins}`).join(', '));
  });

  // ================= Player Move (Dice Roll) =================
  socket.on("player-move", ({ roomName, uid }) => {
    const room = rooms[roomName];
    if (!room) return;

    const dice = Math.floor(Math.random() * 6) + 1;
    // const dice = 2;
    // ✅ Broadcast dice value to all players
    io.to(roomName).emit("dice-rolled", {
      uid,
      dice,
    });

    const currentIndex = room.players.findIndex((p) => p.uid === uid);
    if (currentIndex === -1) return;
    const player = room.players[currentIndex];

    // Move player
    const oldPos = player.position;
    let newPos = (player.position + dice) % 40;

    //Go to jail check First
    const goToJailPosition = 30;
    const jailPosition = 10;

    let sentToJail = false;

    if (newPos === goToJailPosition) {
      // Check if player has "Get Out of Jail Free" card
      const hasJailCard = player.inventory.chanceCards.includes(7) || 
                          player.inventory.communityChestCards.includes(5);
      
      if (hasJailCard) {
        // Ask player if they want to use the card
        player.pendingJailDecision = true;
        io.to(roomName).emit("jail-card-prompt", {
          uid: player.uid,
          message: "အချုပ်ခန်းသို့သွားရန် ကျသည်။ 'အချုပ်ခန်းမှ အခမဲ့ထွက်ခွင့်' ကတ်ကို သုံးလိုပါသလား?"
        });
        
        // Emit move result but stay at current position (don't go to jail yet)
        io.to(roomName).emit("move-result", {
          uid,
          from: oldPos,
          to: newPos, // Still show they landed on Go To Jail
          money: player.money,
          nextPlayerUid: uid, // Still current player's turn until they decide
        });
        
        io.to(roomName).emit("update-rooms", rooms);
        return; // Stop here, wait for player decision
      } else {
        // No jail card, send to jail immediately
        sentToJail = true;
        newPos = jailPosition;
      }
    }
    player.position = newPos;

    // Collect $200 if passed Go // Jail သွားရင် Go ကိုဖြတ်တယ်ဆိုပြီး $200 မရပါ

    if (!sentToJail && newPos < oldPos) {
      // If player has reached "Go", collect $200
      io.to(roomName).emit("collect-money", {
        uid: player.uid,
        reason: "dice"
      });
      player.money += 200;
    }

    // Income tax on position 38 and 4
    if (player.position === 4) {
      player.money -= 200;
    } else if (player.position === 38) {
      player.money -= 100;
    }

    // ၂။ Game Logic (Move player)
    const chancePositions = [7, 22, 36];
    const communityPositions = [2, 17, 33];

    // Check if player lands on Chance/Community Chest
    if (chancePositions.includes(player.position)) {
      player.inCardDraw = true;
      io.to(roomName).emit("before-draw", {
        type: "chance",
        uid: player.uid,
      });

      // Emit move result but keep current player active
      io.to(roomName).emit("move-result", {
        uid,
        from: oldPos,
        to: player.position,
        money: player.money,
        nextPlayerUid: uid, // Still current player's turn
      });

      io.to(roomName).emit("update-rooms", rooms);
      return; // Stop here, do not pass turn
    }

    if (communityPositions.includes(player.position)) {
      player.inCardDraw = true;
      io.to(roomName).emit("before-draw", {
        type: "community",
        uid: player.uid,
      });

      // Emit move result but keep current player active
      io.to(roomName).emit("move-result", {
        uid,
        from: oldPos,
        to: player.position,
        money: player.money,
        nextPlayerUid: uid, // Still current player's turn
      });

      io.to(roomName).emit("update-rooms", rooms);
      return; // Stop here, do not pass turn
    }

    // ================= RENT PAYMENT LOGIC =================
    // Check if landed property is owned and pay rent
    const moveBuildingLevel = propertyBuildings[roomName]?.[player.position] || 0;
    const rentResult = calculateRent(room, player.position, roomName, dice, moveBuildingLevel);
    
    if (rentResult.owner && rentResult.owner.uid !== player.uid && rentResult.rentAmount > 0) {
      // Check if player has enough money
      if (player.money < rentResult.rentAmount) {
        // Player cannot pay full rent - check if they have assets to sell
        const hasProperties = player.inventory.properties.length > 0;
        const totalPropertiesValue = player.inventory.properties.reduce((sum: number, propIdx: number) => {
          const propInfo = propertyRentData[propIdx];
          let origPrice = 0;
          if (propIdx <= 10) origPrice = propIdx * 20;
          else if (propIdx <= 20) origPrice = propIdx * 15;
          else if (propIdx <= 30) origPrice = propIdx * 12;
          else origPrice = propIdx * 10;
          return sum + Math.floor(origPrice / 2); // Sell price is half
        }, 0);
        
        const canPayBySelling = totalPropertiesValue >= (rentResult.rentAmount - player.money);
        
        if (hasProperties && canPayBySelling) {
          // Player has properties to sell - emit force-sell event
          console.log(`🏦 ${player.name} needs to sell properties to pay Ks ${rentResult.rentAmount} rent (has Ks ${player.money})`);
          
          io.to(roomName).emit("force-sell-required", {
            uid: player.uid,
            debtAmount: rentResult.rentAmount - player.money,
            totalRent: rentResult.rentAmount,
            ownerUid: rentResult.owner.uid,
            propertyIndex: player.position,
            hasHotel: rentResult.hasHotel,
            hasMonopoly: rentResult.hasMonopoly,
          });
          
          // DON'T pass turn - player must sell properties first
          io.to(roomName).emit("move-result", {
            uid,
            from: oldPos,
            to: player.position,
            money: player.money,
            nextPlayerUid: uid, // Stay on current player
          });
          
          io.to(roomName).emit("update-rooms", rooms);
          return; // Stop here - wait for player to sell
        } else {
          // Player has no properties or not enough - go bankrupt
          const amountPaid = player.money;
          player.money = 0;
          player.bankrupt = true;
          rentResult.owner.money += amountPaid;
          
          console.log(`💀 ${player.name} is BANKRUPT! Couldn't pay Ks ${rentResult.rentAmount}, paid Ks ${amountPaid}`);
          
          io.to(roomName).emit("player-bankrupt", {
            uid: player.uid,
            name: player.name,
            debtAmount: rentResult.rentAmount - amountPaid,
            paidAmount: amountPaid,
            ownerUid: rentResult.owner.uid,
            ownerName: rentResult.owner.name,
          });
          
          io.to(roomName).emit("rent-paid", {
            fromUid: player.uid,
            toUid: rentResult.owner.uid,
            propertyIndex: player.position,
            amount: amountPaid,
            hasHotel: rentResult.hasHotel,
            hasMonopoly: rentResult.hasMonopoly,
            isPartial: true,
            isBankruptcy: true,
            baseRent: rentResult.baseRent,
            buildingLevel: rentResult.buildingLevel,
            houseCount: rentResult.houseCount,
          });
          
          // Check for winner
          const winCheck = checkWinCondition(roomName);
          if (winCheck.hasWinner && winCheck.winner) {
            endGame(roomName, winCheck.winner, "last-standing");
          }
        }
      } else {
        // Pay full rent
        player.money -= rentResult.rentAmount;
        rentResult.owner.money += rentResult.rentAmount;
        
        console.log(`💰 ${player.name} paid Ks ${rentResult.rentAmount} rent to ${rentResult.owner.name} ${rentResult.hasHotel ? '(with hotel)' : ''} ${rentResult.hasMonopoly ? '(monopoly bonus)' : ''}`);
        
        io.to(roomName).emit("rent-paid", {
          fromUid: player.uid,
          toUid: rentResult.owner.uid,
          propertyIndex: player.position,
          amount: rentResult.rentAmount,
          hasHotel: rentResult.hasHotel,
          hasMonopoly: rentResult.hasMonopoly,
          isPartial: false,
          baseRent: rentResult.baseRent,
          buildingLevel: rentResult.buildingLevel,
          houseCount: rentResult.houseCount,
        });
      }
    }

    // Pass turn to next player (ONLY if not drawing a card)
    // Find next non-surrendered/non-bankrupt player
    let nextPlayerIndex = (currentIndex + 1) % room.players.length;
    let loops = 0;
    while ((room.players[nextPlayerIndex]?.surrendered || room.players[nextPlayerIndex]?.bankrupt) && loops < room.players.length) {
      nextPlayerIndex = (nextPlayerIndex + 1) % room.players.length;
      loops++;
    }
    
    room.players = room.players.map((p, i) => ({
      ...p,
      isActive: i === nextPlayerIndex,
    }));

    // Emit explicit next-turn event for reliable turn synchronization
    io.to(roomName).emit("next-turn", {
      nextPlayerUid: room.players[nextPlayerIndex].uid,
      nextPlayerIndex: nextPlayerIndex,
    });

    // last move Result
    io.to(roomName).emit("move-result", {
      uid,
      from: oldPos,
      to: player.position,
      money: player.money,
      nextPlayerUid: room.players[nextPlayerIndex].uid,
    });

    // Broadcast updated state
    io.to(roomName).emit("update-rooms", rooms);
  });

  // ၁။ Socket Listeners တွေကို အပြင်မှာ တစ်ခါပဲ ထားပါ
  socket.on("show-card-effect", ({ roomName, uid }) => {
    const room = rooms[roomName];
    if (room.name !== roomName) return;

    const player = room.players.find((p) => p.uid === uid);

    if (!player) return;

    // ကစားသမား ရောက်နေတဲ့ နေရာပေါ် မူတည်ပြီး ဘယ် Deck သုံးမလဲ ဆုံးဖြတ်မယ်
    let cardId;
    let type;
    const chancePositions = [7, 22, 36];
    const communityPositions = [2, 17, 33];
    if (chancePositions.includes(player.position)) {
      cardId = drawCard(chanceDeck);
      // cardId = 7;
      type = "chance";

      console.log(player);
    } else if (communityPositions.includes(player.position)) {
      cardId = drawCard(communityDeck);
      // cardId=5;
      type = "community";

      console.log(player);
    }

    if (cardId !== undefined) {
      io.to(roomName).emit("draw-card", { type, uid, cardId });
    }
  });

  // client ဘက်က chance နဲ့ community card ကိုရရှိကြောင်း စောင့်ကြည့်ပြီးမှ applyCardEffect ကိုလုပ်မယ်
  socket.on("confirm-card-effect", ({ roomName, uid, deckType, cardId }) => {
    console.log(`🎴 confirm-card-effect received: ${deckType} card ${cardId} for uid ${uid}`);
    
    applyCardEffect(roomName, uid, deckType, cardId);

    const room = rooms[roomName];
    if (!room) {
      console.log(`❌ Room ${roomName} not found in confirm-card-effect`);
      return;
    }
    
    const player = room.players.find((p) => p.uid === uid);
    console.log(`👤 Player after applyCardEffect: ${player?.name}, inCardDraw: ${player?.inCardDraw}`);

    // If the effect triggered another draw (e.g. Chance 8 -> Community Chest),
    // do NOT pass the turn yet.
    if (player && player.inCardDraw) {
      console.log(`⏹️ Turn NOT passing - player still in card draw`);
      return;
    }

    //Now that the effect (like moving to yangon) is applied,
    //we can broadcast the new postion and pass the turn to the next player
    const currentIndex = room.players.findIndex((p) => p.uid === uid);
    console.log(`🔄 Passing turn from player at index ${currentIndex} (uid: ${uid})`);
    
    // Find next non-surrendered/non-bankrupt player
    let nextIndex = (currentIndex + 1) % room.players.length;
    let loops = 0;
    while ((room.players[nextIndex]?.surrendered || room.players[nextIndex]?.bankrupt) && loops < room.players.length) {
      nextIndex = (nextIndex + 1) % room.players.length;
      loops++;
    }
    
    console.log(`🎯 Next player index: ${nextIndex}, uid: ${room.players[nextIndex]?.uid}, name: ${room.players[nextIndex]?.name}`);
    
    room.players = room.players.map((p, i) => ({
      ...p,
      isActive: i === nextIndex,
    }));
    
    // Verify the active flags
    const activePlayers = room.players.filter(p => p.isActive);
    console.log(`✅ Active players count: ${activePlayers.length}, active uid: ${activePlayers[0]?.uid}`);
    
    // Emit explicit next-turn event for reliable turn synchronization
    io.to(roomName).emit("next-turn", {
      nextPlayerUid: room.players[nextIndex].uid,
      nextPlayerIndex: nextIndex,
    });
    
    io.to(roomName).emit("update-rooms", rooms);
    console.log(`📤 Emitted next-turn and update-rooms for room ${roomName}`);
  });

  // ================= Buy Property =================
  socket.on("buy-property", ({ roomName, uid, propertyIndex, price }) => {
    const room = rooms[roomName];
    if (!room) return;

    // Initialize pending purchases for this room if not exists
    if (!pendingPurchases[roomName]) {
      pendingPurchases[roomName] = new Set();
    }

    // Check if property is already being purchased (race condition protection)
    if (pendingPurchases[roomName].has(propertyIndex)) {
      socket.emit("error", "Property purchase is already in progress");
      return;
    }

    // Check if property is already owned (double-check on server)
    const isAlreadyOwned = room.players.some((p) =>
      p.inventory.properties.includes(propertyIndex)
    );
    if (isAlreadyOwned) {
      socket.emit("error", "Property already owned");
      return;
    }

    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    // Check if player has enough money
    if (player.money < price) {
      socket.emit("error", "Not enough money");
      return;
    }

    // Add to pending purchases to prevent race conditions
    pendingPurchases[roomName].add(propertyIndex);

    // Deduct money and add property to inventory
    player.money -= price;
    player.inventory.properties.push(propertyIndex);

    console.log(`✅ Player ${player.name} bought property ${propertyIndex} for $${price}`);
    console.log(`📦 Player inventory now:`, player.inventory);

    // Remove from pending purchases after successful purchase
    pendingPurchases[roomName].delete(propertyIndex);

    // Broadcast to all players in the room
    io.to(roomName).emit("property-bought", {
      uid,
      propertyIndex,
      price,
    });

    // Update room state - include full room data with inventory
    console.log(`📤 Broadcasting room update for ${roomName}`);
    console.log(`📦 Player ${player.name} inventory:`, JSON.stringify(player.inventory));
    io.to(roomName).emit("update-rooms", rooms);

    // Pass turn to next player
    const currentIndex = room.players.findIndex((p) => p.uid === uid);
    
    // Find next non-surrendered/non-bankrupt player
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

    // Emit explicit next-turn event for reliable turn synchronization
    io.to(roomName).emit("next-turn", {
      nextPlayerUid: room.players[nextIndex].uid,
      nextPlayerIndex: nextIndex,
    });

    io.to(roomName).emit("move-result", {
      uid,
      from: player.position,
      to: player.position,
      money: player.money,
      nextPlayerUid: room.players[nextIndex].uid,
    });

    io.to(roomName).emit("update-rooms", rooms);
  });

  // ================= Build Hotel =================
  socket.on("build-hotel", ({ roomName, uid, propertyIndex, cost }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    // Check if player owns the property
    if (!player.inventory.properties.includes(propertyIndex)) {
      socket.emit("error", "You don't own this property");
      return;
    }

    // Initialize hotels for room if not exists
    if (!propertyBuildings[roomName]) {
      propertyBuildings[roomName] = {};
    }

    // Check if hotel already exists (level 5)
    if (propertyBuildings[roomName][propertyIndex] === 5) {
      socket.emit("error", "Hotel already built on this property");
      return;
    }

    // Check if player has enough money
    if (player.money < cost) {
      socket.emit("error", "Not enough money to build hotel");
      return;
    }

    // Check if player has monopoly (required to build hotel)
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

    // Build hotel (level 5)
    player.money -= cost;
    propertyBuildings[roomName][propertyIndex] = 5;

    console.log(`🏨 Player ${player.name} built hotel on property ${propertyIndex} for Ks ${cost}`);

    // Broadcast to all players
    io.to(roomName).emit("hotel-built", {
      uid,
      propertyIndex,
      cost,
    });

    io.to(roomName).emit("update-rooms", rooms);
  });

  // ================= Build House =================
  socket.on("build-house", ({ roomName, uid, propertyIndex, cost }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    // Check if player owns the property
    if (!player.inventory.properties.includes(propertyIndex)) {
      socket.emit("error", "You don't own this property");
      return;
    }

    // Initialize buildings for room if not exists
    if (!propertyBuildings[roomName]) {
      propertyBuildings[roomName] = {};
    }

    const currentLevel = propertyBuildings[roomName][propertyIndex] || 0;

    // Check if maximum reached (level 5 = hotel is the max)
    if (currentLevel >= 5) {
      socket.emit("error", "Maximum buildings reached - hotel already built (level 5)");
      return;
    }

    // Check if player has enough money
    if (player.money < cost) {
      socket.emit("error", "Not enough money to build house");
      return;
    }

    // Check if player has monopoly (required to build houses)
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

    // Build house (increment level by 1)
    const newLevel = currentLevel + 1;
    player.money -= cost;
    propertyBuildings[roomName][propertyIndex] = newLevel;

    const isHotel = newLevel === 5;
    console.log(`🏠 Player ${player.name} built ${isHotel ? 'hotel' : 'house ' + newLevel} on property ${propertyIndex} for $${cost}`);

    // Broadcast to all players
    io.to(roomName).emit("house-built", {
      uid,
      propertyIndex,
      houseCount: newLevel >= 5 ? 4 : newLevel,
      hasHotel: isHotel,
      cost,
    });

    io.to(roomName).emit("update-rooms", rooms);
  });

  // ================= AUCTION SYSTEM =================
  // Start auction when player declines to buy property
  socket.on("start-auction", ({ roomName, propertyIndex, startingPrice }) => {
    const room = rooms[roomName];
    if (!room) return;

    // Check if auction already active
    if (activeAuctions[roomName]?.active) {
      socket.emit("error", "Auction already in progress");
      return;
    }

    const cell = propertyRentData[propertyIndex];
    const propertyName = cell ? `Property ${propertyIndex}` : `Property ${propertyIndex}`;

    // Initialize auction
    activeAuctions[roomName] = {
      propertyIndex,
      currentBid: startingPrice || 10,
      highestBidder: null,
      bids: [],
      active: true,
      endTime: Date.now() + 30000, // 30 seconds auction
    };

    // Broadcast auction start to all players in room
    io.to(roomName).emit("auction-started", {
      propertyIndex,
      startingPrice: startingPrice || 10,
      propertyName,
      message: `🔨 Auction started for ${propertyName}! Starting bid: $${startingPrice || 10}`,
      endTime: Date.now() + 30000,
    });

    console.log(`🔨 Auction started in ${roomName} for property ${propertyIndex} at $${startingPrice || 10}`);

    // Auto-end auction after 30 seconds
    setTimeout(() => {
      const auction = activeAuctions[roomName];
      if (auction?.active) {
        console.log(`⏰ Auto-ending auction in ${roomName}`);
        endAuctionInternal(roomName, room);
      }
    }, 30000);
  });

  // Place bid in auction
  socket.on("place-bid", ({ roomName, uid, bidAmount }) => {
    const room = rooms[roomName];
    if (!room) return;

    const auction = activeAuctions[roomName];
    if (!auction || !auction.active) {
      socket.emit("error", "No active auction");
      return;
    }

    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    // Validate bid
    if (bidAmount <= auction.currentBid) {
      socket.emit("error", `Bid must be higher than current bid ($${auction.currentBid})`);
      return;
    }

    if (player.money < bidAmount) {
      socket.emit("error", "Not enough money for this bid");
      return;
    }

    // Update auction
    auction.currentBid = bidAmount;
    auction.highestBidder = uid;
    auction.bids.push({ uid, name: player.name, amount: bidAmount });

    console.log(`💰 ${player.name} placed bid of $${bidAmount} in ${roomName}`);

    // Broadcast bid to all players
    io.to(roomName).emit("bid-placed", {
      uid,
      bidAmount,
      propertyIndex: auction.propertyIndex,
      message: `${player.name} bid $${bidAmount}`,
    });
  });

  // Internal function to end auction (used by both timeout and socket event)
  const endAuctionInternal = (roomName: string, room: any) => {
    const auction = activeAuctions[roomName];
    if (!auction || !auction.active) return;

    auction.active = false;

    if (auction.highestBidder) {
      const winner = room.players.find((p: any) => p.uid === auction.highestBidder);
      if (winner) {
        winner.money -= auction.currentBid;
        winner.inventory.properties.push(auction.propertyIndex);

        console.log(`🏆 Auction ended in ${roomName}. ${winner.name} won property ${auction.propertyIndex} for $${auction.currentBid}`);

        io.to(roomName).emit("auction-ended", {
          propertyIndex: auction.propertyIndex,
          winnerUid: winner.uid,
          finalPrice: auction.currentBid,
          message: `🏆 ${winner.name} won the auction for $${auction.currentBid}!`,
        });

        io.to(roomName).emit("property-bought", {
          uid: winner.uid,
          propertyIndex: auction.propertyIndex,
          price: auction.currentBid,
        });
      }
    } else {
      io.to(roomName).emit("auction-ended", {
        propertyIndex: auction.propertyIndex,
        winnerUid: null,
        finalPrice: 0,
        message: "🔨 Auction ended with no bids",
      });
    }

    io.to(roomName).emit("update-rooms", rooms);
  };

  // End auction manually or by timeout
  socket.on("end-auction", ({ roomName }) => {
    const room = rooms[roomName];
    if (!room) return;
    endAuctionInternal(roomName, room);
  });

  // ================= Sell Property to Bank =================
  socket.on("sell-property-to-bank", ({ roomName, uid, propertyIndex }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    // Check if player owns the property
    const propertyIndexInInventory = player.inventory.properties.indexOf(propertyIndex);
    if (propertyIndexInInventory === -1) {
      socket.emit("error", "You don't own this property");
      return;
    }

    // Check if any buildings exist (must sell houses/hotel first)
    if ((propertyBuildings[roomName]?.[propertyIndex] || 0) > 0) {
      socket.emit("error", "Sell all buildings first before selling property");
      return;
    }

    // Calculate sell price using centralized originalPrice from propertyRentData
    const propertyInfo = propertyRentData[propertyIndex];
    const originalPrice = propertyInfo?.originalPrice || 0;
    const sellPrice = Math.floor(originalPrice / 2);

    // Remove property from inventory
    player.inventory.properties.splice(propertyIndexInInventory, 1);

    // Add money to player
    player.money += sellPrice;

    // Remove hotel data if exists
    if (propertyBuildings[roomName]?.[propertyIndex]) {
      delete propertyBuildings[roomName][propertyIndex];
    }

    console.log(`💰 Player ${player.name} sold property ${propertyIndex} (${propertyInfo ? 'priced at $' + originalPrice : 'unknown price'}) to bank for $${sellPrice}`);

    // Broadcast to all players
    io.to(roomName).emit("property-sold-to-bank", {
      uid,
      propertyIndex,
      sellPrice,
      playerName: player.name,
    });

    io.to(roomName).emit("update-rooms", rooms);
  });

  // ================= Handle Jail Card Decision =================
  socket.on("jail-card-decision", ({ roomName, uid, useCard }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    if (!player || !player.pendingJailDecision) return;

    // Clear the pending decision
    player.pendingJailDecision = false;

    const jailPosition = 10;
    const goToJailPosition = 30;

    if (useCard) {
      // Player chose to use the card - remove it from inventory
      const _chanceIndex = player.inventory.chanceCards.indexOf(7);
      if (_chanceIndex > -1) {
        player.inventory.chanceCards.splice(_chanceIndex, 1);
      } else {
        const _communityIndex = player.inventory.communityChestCards.indexOf(5);
        if (_communityIndex > -1) {
          player.inventory.communityChestCards.splice(_communityIndex, 1);
        }
      }

      // Player stays at position 30 (Go To Jail) but doesn't go to jail
      player.position = goToJailPosition;
      console.log(`✅ Player ${player.name} used Get Out of Jail Free card, staying at position ${goToJailPosition}`);
      
      io.to(roomName).emit("jail-card-used", {
        uid,
        message: `${player.name} က 'အချုပ်ခန်းမှ အခမဲ့ထွက်ခွင့်' ကတ်ကို သုံးခဲ့သည်!`
      });
      
      // Emit move result to ensure all clients update the player's position
      io.to(roomName).emit("move-result", {
        uid,
        from: goToJailPosition,
        to: goToJailPosition,
        money: player.money,
        nextPlayerUid: uid,
      });
    } else {
      // Player chose NOT to use the card - send them to jail
      player.position = jailPosition;
      console.log(`🔒 Player ${player.name} declined to use jail card and went to jail`);
      
      io.to(roomName).emit("move-result", {
        uid,
        from: goToJailPosition,
        to: jailPosition,
        money: player.money,
        nextPlayerUid: uid, // Will be updated below
      });
    }

    // Pass turn to next player
    const currentIndex = room.players.findIndex((p) => p.uid === uid);
    
    // Find next non-surrendered/non-bankrupt player
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

    // Emit explicit next-turn event for reliable turn synchronization
    io.to(roomName).emit("next-turn", {
      nextPlayerUid: room.players[nextIndex].uid,
      nextPlayerIndex: nextIndex,
    });

    io.to(roomName).emit("update-rooms", rooms);
  });

// ================= Set Player Color =================
  socket.on("set-player-color", ({ roomName, uid, color }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    // Store color on server
    player.color = color;
    console.log(`🎨 Player ${player.name} color set to ${color}`);

    // Broadcast to ALL players in the room (including sender)
    io.to(roomName).emit("player-color-updated", { uid, color });

    // Also update room state
    io.to(roomName).emit("update-rooms", rooms);
  });

  // ================= Chat Messages =================
  socket.on("send-chat-message", ({ roomName, uid, name, message }) => {
    const room = rooms[roomName];
    if (!room) return;

    // Broadcast message to all players in the room
    const chatMessage = {
      uid,
      name,
      message,
      timestamp: Date.now(),
    };

    console.log(`💬 Chat in ${roomName}: ${name} says "${message}"`);
    
    // Emit to all clients in the room (including sender)
    io.to(roomName).emit("chat-message", chatMessage);
  });

   

  // ================= Trade Between Players =================
  socket.on("send-trade-offer", ({ roomName, fromUid, toUid, offer, request }) => {
    const room = rooms[roomName];
    if (!room) return;

    const fromPlayer = room.players.find((p) => p.uid === fromUid);
    const toPlayer = room.players.find((p) => p.uid === toUid);
    if (!fromPlayer || !toPlayer) return;

    console.log(`🤝 Trade offer from ${fromPlayer.name} to ${toPlayer.name}`);

    // Send trade offer to target player
    io.to(roomName).emit("trade-offer-received", {
      tradeId: Date.now().toString(),
      fromUid,
      fromName: fromPlayer.name,
      toUid,
      toName: toPlayer.name,
      offer,
      request,
    });
  });

  socket.on("accept-trade", ({ roomName, tradeId, fromUid, toUid, offer, request }) => {
    const room = rooms[roomName];
    if (!room) return;

    const fromPlayer = room.players.find((p) => p.uid === fromUid);
    const toPlayer = room.players.find((p) => p.uid === toUid);
    if (!fromPlayer || !toPlayer) return;

    // Validate trade - check ownership and funds
    const fromOwnsProperties = offer.properties.every((prop: number) => 
      fromPlayer.inventory.properties.includes(prop)
    );
    const toOwnsProperties = request.properties.every((prop: number) => 
      toPlayer.inventory.properties.includes(prop)
    );
    const fromHasMoney = fromPlayer.money >= offer.money;
    const toHasMoney = toPlayer.money >= request.money;

    if (!fromOwnsProperties || !toOwnsProperties || !fromHasMoney || !toHasMoney) {
      io.to(roomName).emit("trade-failed", { tradeId, message: "Trade validation failed" });
      return;
    }

    // Execute trade - transfer properties
    // From -> To
    offer.properties.forEach((prop: number) => {
      const idx = fromPlayer.inventory.properties.indexOf(prop);
      if (idx > -1) fromPlayer.inventory.properties.splice(idx, 1);
      toPlayer.inventory.properties.push(prop);
    });

    // To -> From
    request.properties.forEach((prop: number) => {
      const idx = toPlayer.inventory.properties.indexOf(prop);
      if (idx > -1) toPlayer.inventory.properties.splice(idx, 1);
      fromPlayer.inventory.properties.push(prop);
    });

    // Transfer money
    fromPlayer.money -= offer.money;
    fromPlayer.money += request.money;
    toPlayer.money -= request.money;
    toPlayer.money += offer.money;
    console.log(`✅ Trade completed: ${fromPlayer.name} ↔ ${toPlayer.name}`);

    io.to(roomName).emit("trade-completed", {
      tradeId,
      fromUid,
      fromName: fromPlayer.name,
      toUid,
      toName: toPlayer.name,
      offer,
      request,
    });

    io.to(roomName).emit("update-rooms", rooms);
  });

  socket.on("decline-trade", ({ roomName, tradeId }) => {
    io.to(roomName).emit("trade-declined", { tradeId });
  });

  // ================= Update Player Cosmetics =================
  socket.on("update-cosmetics", async ({ roomName, uid }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    if (player) {
      // Assuming fetchPlayerEconomy is an async function available in this scope
      // and returns an object with dice_skin, board_theme, avatar, effect properties.
      // This function would typically interact with a database or external service.
      const economyAndCosmetics = await fetchPlayerEconomy(uid); 
      player.equippedItems = {
        dice_skin: economyAndCosmetics.dice_skin,
        board_theme: economyAndCosmetics.board_theme,
        avatar: economyAndCosmetics.avatar,
      };
      
      io.to(roomName).emit("update-rooms", rooms);
      console.log(`✨ Player ${player.name} updated their cosmetics mid-game!`);
    }
  });

  registerTradeHandlers(socket);

  // ================= VOICE FEATURES =================

// Voice channel join
socket.on("voice-join", ({ roomName, uid, name }: { roomName: string; uid: string; name: string }) => {
  if (!voiceChannels[roomName]) {
    voiceChannels[roomName] = new Set();
  }
  
  // Get existing participants BEFORE adding the new one
  const existingParticipants: Array<{ uid: string; name: string; socketId: string }> = [];
  const room = rooms[roomName];
  if (room) {
    for (const existingUid of voiceChannels[roomName]) {
      if (existingUid !== uid) {
        const player = room.players.find((p) => p.uid === existingUid);
        if (player) {
          existingParticipants.push({ uid: existingUid, name: player.name, socketId: player.socketId });
        }
      }
    }
  }
  
  voiceChannels[roomName].add(uid);
  socket.join(`voice-${roomName}`);
  
  console.log(`🎤 ${name} joined voice channel in ${roomName}`);
  console.log(`🎤 Existing participants:`, existingParticipants.map(p => p.name));
  
  io.to(roomName).emit("voice-channel-update", {
    roomName,
    participants: Array.from(voiceChannels[roomName]),
    joined: { uid, name }
  });
  
  // Notify existing peers about the new peer
  socket.to(`voice-${roomName}`).emit("voice-peer-join", {
    uid,
    name,
    socketId: socket.id
  });
  
  // Notify the new peer about all existing participants
  for (const participant of existingParticipants) {
    socket.emit("voice-peer-join", {
      uid: participant.uid,
      name: participant.name,
      socketId: participant.socketId
    });
  }
});

// WebRTC signaling
socket.on("voice-signal", ({
  roomName,
  targetUid,
  signal
}: {
  roomName: string;
  targetUid: string;
  signal: { type: "offer" | "answer" | "ice-candidate"; data: any; fromUid: string };
}) => {
  const room = rooms[roomName];
  if (!room) return;
  
  const targetPlayer = room.players.find((p) => p.uid === targetUid);
  if (!targetPlayer) return;
  
  io.to(targetPlayer.socketId).emit("voice-signal", {
    fromUid: signal.fromUid,
    type: signal.type,
    data: signal.data
  });
});

// Voice leave
socket.on("voice-leave", ({ roomName, uid, name }: { roomName: string; uid: string; name: string }) => {
  if (voiceChannels[roomName]) {
    voiceChannels[roomName].delete(uid);
    socket.leave(`voice-${roomName}`);
    
    io.to(roomName).emit("voice-channel-update", {
      roomName,
      participants: Array.from(voiceChannels[roomName]),
      left: { uid, name }
    });
    
    socket.to(`voice-${roomName}`).emit("voice-peer-leave", { uid });
    
    if (voiceChannels[roomName].size === 0) {
      delete voiceChannels[roomName];
    }
  }
});

// Mute status
socket.on("voice-mute", ({ roomName, uid, muted }: { roomName: string; uid: string; muted: boolean }) => {
  socket.to(`voice-${roomName}`).emit("voice-mute", { uid, muted });
});

// Voice message handling
socket.on("voice-message-start", ({ roomName, messageId, uid, name, duration }: any) => {
  voiceMessageChunks[messageId] = { chunks: [], timestamp: Date.now() };
  socket.to(roomName).emit("voice-message-recording", { uid, name });
});

socket.on("voice-message-chunk", ({ messageId, chunk, isLast }: any) => {
  if (!voiceMessageChunks[messageId]) return;
  voiceMessageChunks[messageId].chunks.push(Buffer.from(chunk));
  
  if (isLast) {
    const fullBuffer = Buffer.concat(voiceMessageChunks[messageId].chunks);
    delete voiceMessageChunks[messageId];
    
    // Find room
    const roomName = Object.keys(rooms).find((r) =>
      rooms[r].players.some((p) => p.socketId === socket.id)
    );
    
    if (roomName) {
      io.to(roomName).emit("voice-message", {
        messageId,
        senderUid: rooms[roomName].players.find((p) => p.socketId === socket.id)?.uid,
        audioData: fullBuffer.toString("base64"),
        timestamp: Date.now()
      });
    }
  }
});

  // ================= ADMIN GAME MASTER CONSOLE =================
  const ADMIN_KEY = process.env.ADMIN_KEY || "myanmarpoly-admin-2026";

  socket.on("admin-set-money", ({ adminKey, roomName, uid, money }) => {
    if (adminKey !== ADMIN_KEY) { socket.emit("admin-error", "Invalid admin key"); return; }
    const room = rooms[roomName];
    if (!room) { socket.emit("admin-error", `Room "${roomName}" not found`); return; }
    const player = room.players.find(p => p.uid === uid);
    if (!player) { socket.emit("admin-error", `Player "${uid}" not found`); return; }
    const oldMoney = player.money;
    player.money = money;
    console.log(`🔧 [ADMIN] Set ${player.name}'s money: Ks ${oldMoney} → Ks ${money}`);
    io.to(roomName).emit("update-rooms", rooms);
    socket.emit("admin-success", `Set ${player.name}'s money to Ks ${money}`);
  });

  socket.on("admin-set-position", ({ adminKey, roomName, uid, position }) => {
    if (adminKey !== ADMIN_KEY) { socket.emit("admin-error", "Invalid admin key"); return; }
    const room = rooms[roomName];
    if (!room) { socket.emit("admin-error", `Room "${roomName}" not found`); return; }
    const player = room.players.find(p => p.uid === uid);
    if (!player) { socket.emit("admin-error", `Player "${uid}" not found`); return; }
    const oldPos = player.position;
    player.position = position;
    console.log(`🔧 [ADMIN] Moved ${player.name}: position ${oldPos} → ${position}`);
    io.to(roomName).emit("move-result", {
      uid,
      from: oldPos,
      to: position,
      money: player.money,
      nextPlayerUid: uid,
    });
    io.to(roomName).emit("update-rooms", rooms);
    socket.emit("admin-success", `Moved ${player.name} to position ${position}`);
  });

  socket.on("admin-give-properties", ({ adminKey, roomName, uid, properties }) => {
    if (adminKey !== ADMIN_KEY) { socket.emit("admin-error", "Invalid admin key"); return; }
    const room = rooms[roomName];
    if (!room) { socket.emit("admin-error", `Room "${roomName}" not found`); return; }
    const player = room.players.find(p => p.uid === uid);
    if (!player) { socket.emit("admin-error", `Player "${uid}" not found`); return; }
    // Remove properties from other players first
    const newProps: number[] = Array.isArray(properties) ? properties : [];
    room.players.forEach(p => {
      p.inventory.properties = p.inventory.properties.filter(prop => !newProps.includes(prop));
    });
    // Add to target player (avoid duplicates)
    newProps.forEach(prop => {
      if (!player.inventory.properties.includes(prop)) {
        player.inventory.properties.push(prop);
      }
    });
    console.log(`🔧 [ADMIN] Gave ${player.name} properties: [${newProps.join(", ")}]`);
    io.to(roomName).emit("update-rooms", rooms);
    socket.emit("admin-success", `Gave ${player.name} ${newProps.length} properties`);
  });

  socket.on("admin-set-buildings", ({ adminKey, roomName, propertyIndex, level }) => {
    if (adminKey !== ADMIN_KEY) { socket.emit("admin-error", "Invalid admin key"); return; }
    const room = rooms[roomName];
    if (!room) { socket.emit("admin-error", `Room "${roomName}" not found`); return; }
    if (!propertyBuildings[roomName]) propertyBuildings[roomName] = {};
    propertyBuildings[roomName][propertyIndex] = level;
    const levelText = level === 0 ? "none" : level === 5 ? "hotel" : `${level} house(s)`;
    console.log(`🔧 [ADMIN] Set property ${propertyIndex} building level to ${levelText}`);
    // Emit house/hotel built to update client visuals
    if (level === 5) {
      io.to(roomName).emit("hotel-built", { uid: "admin", propertyIndex, cost: 0 });
    } else if (level > 0) {
      io.to(roomName).emit("house-built", { uid: "admin", propertyIndex, houseCount: level, hasHotel: false, cost: 0 });
    }
    io.to(roomName).emit("update-rooms", rooms);
    socket.emit("admin-success", `Set property ${propertyIndex} to ${levelText}`);
  });

  socket.on("admin-get-state", ({ adminKey, roomName }) => {
    if (adminKey !== ADMIN_KEY) { socket.emit("admin-error", "Invalid admin key"); return; }
    const room = rooms[roomName];
    if (!room) { socket.emit("admin-error", `Room "${roomName}" not found`); return; }
    // Deduplicate players by uid
    const seenUids = new Set<string>();
    const uniquePlayers = room.players.filter(p => {
      if (seenUids.has(p.uid)) return false;
      seenUids.add(p.uid);
      return true;
    });
    const state = {
      roomName,
      status: room.status,
      players: uniquePlayers.map(p => ({
        uid: p.uid,
        name: p.name,
        money: p.money,
        position: p.position,
        properties: p.inventory.properties,
        isActive: p.isActive,
        surrendered: p.surrendered,
        bankrupt: p.bankrupt,
        isBot: p.isBot,
      })),
      buildings: propertyBuildings[roomName] || {},
    };
    socket.emit("admin-state", state);
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("❌ Client disconnected", socket.id);

    for (const roomName in rooms) {
      // 1. Find the player who disconnected
      const disconnectedPlayer = rooms[roomName].players.find(
        (p) => p.socketId === socket.id,
      );

      if (disconnectedPlayer) {
        // 2. Mark player as disconnected instead of removing them
        disconnectedPlayer.disconnected = true;
        disconnectedPlayer.socketId = ""; // Clear socketId
        
        // If it was their turn, pass to next player
        if (disconnectedPlayer.isActive && rooms[roomName].status === "in-game") {
          disconnectedPlayer.isActive = false;
          
          // Find next non-surrendered/non-bankrupt/non-disconnected player
          const currentIndex = rooms[roomName].players.findIndex((p) => p.uid === disconnectedPlayer.uid);
          let nextIndex = (currentIndex + 1) % rooms[roomName].players.length;
          let loops = 0;
          while (
            (rooms[roomName].players[nextIndex]?.surrendered || 
             rooms[roomName].players[nextIndex]?.bankrupt ||
             rooms[roomName].players[nextIndex]?.disconnected) && 
            loops < rooms[roomName].players.length
          ) {
            nextIndex = (nextIndex + 1) % rooms[roomName].players.length;
            loops++;
          }
          
          // Set next player as active if found
          const nextPlayer = rooms[roomName].players[nextIndex];
          if (nextPlayer && !nextPlayer.surrendered && !nextPlayer.bankrupt && !nextPlayer.disconnected) {
            nextPlayer.isActive = true;
            io.to(roomName).emit("next-turn", {
              nextPlayerUid: nextPlayer.uid,
              nextPlayerIndex: nextIndex,
            });
          }
        }

        // 3. Emit the specific 'player-disconnected' event with the UID
        io.to(roomName).emit("player-disconnected", { 
          uid: disconnectedPlayer.uid,
          name: disconnectedPlayer.name,
          message: `${disconnectedPlayer.name} has disconnected. They can reconnect to resume.`,
        });
        console.log(`🔌 Player ${disconnectedPlayer.name} (${disconnectedPlayer.uid}) marked as disconnected in ${roomName}`);
        
        // 4. Check if game should end (all remaining active players disconnected or eliminated)
        if (rooms[roomName].status === "in-game") {
          const activePlayers = rooms[roomName].players.filter(
            p => !p.surrendered && !p.bankrupt && !p.disconnected
          );
          if (activePlayers.length === 1 && rooms[roomName].minDurationMet) {
            endGame(roomName, activePlayers[0], "last-standing");
          }
        }
      }
    }

    // Voice cleanup
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

    // Final sync for the room list UI
    emitRooms();
  });
});

// ================= Bot Logic =================
const processingBots = new Set<string>();

const passBotTurn = async (roomName: string, botUid: string) => {
  // Always get fresh room reference
  let room = rooms[roomName];
  if (!room) return;
  
  // Wait for bot's own animation to complete
  const maxWaitTime = 10000; // Max 10 seconds wait
  const startTime = Date.now();
  
  while (animatingPlayers[roomName]?.has(botUid) && (Date.now() - startTime) < maxWaitTime) {
    await new Promise(res => setTimeout(res, 200));
    // Refresh room reference in case it changed
    room = rooms[roomName];
    if (!room) return;
  }
  
  // Clear animating flag (in case timeout reached or client never sent complete)
  animatingPlayers[roomName]?.delete(botUid);
  
  // Give a small buffer after animation completes
  await new Promise(res => setTimeout(res, 500));
  
  // Get fresh room reference again
  room = rooms[roomName];
  if (!room) return;
  
  // Debug: Log bot position before turn change
  const botPlayer = room.players.find(p => p.uid === botUid);
  console.log(`🔄 passBotTurn: Bot ${botPlayer?.name} position before turn change: ${botPlayer?.position}`);
  
  const currentIndex = room.players.findIndex(p => p.uid === botUid);
  if (currentIndex === -1) return;
  
  let nextIndex = (currentIndex + 1) % room.players.length;
  let loops = 0;
  while ((room.players[nextIndex]?.surrendered || room.players[nextIndex]?.bankrupt || room.players[nextIndex]?.disconnected) && loops < room.players.length) {
    nextIndex = (nextIndex + 1) % room.players.length;
    loops++;
  }
  
  // Update isActive for all players using fresh data
  room.players = room.players.map((p, i) => ({
    ...p,
    isActive: i === nextIndex
  }));
  
  // Debug: Log bot position after mapping
  const botPlayerAfter = room.players.find(p => p.uid === botUid);
  console.log(`🔄 passBotTurn: Bot ${botPlayerAfter?.name} position after mapping: ${botPlayerAfter?.position}`);
  
  // Set a cooldown for the next player to prevent immediate re-triggering
  turnCooldowns[roomName] = Date.now() + 3000; // 3 second cooldown
  
  io.to(roomName).emit("next-turn", {
    nextPlayerUid: room.players[nextIndex].uid,
    nextPlayerIndex: nextIndex
  });
  
  io.to(roomName).emit("update-rooms", rooms);
  
  // Debug: Verify rooms data after emit
  const verifyBot = rooms[roomName]?.players.find(p => p.uid === botUid);
  console.log(`🔄 passBotTurn: Bot ${verifyBot?.name} position in rooms after emit: ${verifyBot?.position}`);
};

const playBotTurn = async (roomName: string, botUid: string) => {
  // Check cooldown at the very start
  const cooldownEnd = turnCooldowns[roomName] || 0;
  if (Date.now() < cooldownEnd) {
    console.log(`⏳ playBotTurn: Bot ${botUid} blocked by cooldown, waiting...`);
    return;
  }
  
  let room = rooms[roomName];
  if (!room || room.status !== "in-game") return;
  
  let player = room.players.find(p => p.uid === botUid);
  if (!player || player.surrendered || player.bankrupt || !player.isActive) return;

  // Let bot think
  await new Promise(res => setTimeout(res, 1500));
  
  // Verify room/player states again after awaiting
  if (!rooms[roomName] || rooms[roomName].status !== "in-game") return;
  const recheckedPlayer = rooms[roomName].players.find(p => p.uid === botUid);
  if (!recheckedPlayer || !recheckedPlayer.isActive) return;

  // Let bot think
  await new Promise(res => setTimeout(res, 1500));
  
  if (!rooms[roomName] || rooms[roomName].status !== "in-game") return;
  
  // CRITICAL: Re-fetch player reference to ensure it's not stale
  // (passBotTurn may have recreated player objects via .map())
  const freshPlayer = rooms[roomName].players.find(p => p.uid === botUid);
  if (!freshPlayer) return;
  player = freshPlayer;
  
  // Also refresh room reference to ensure it has latest player data
  room = rooms[roomName];

  const dice = Math.floor(Math.random() * 6) + 1;
  io.to(roomName).emit("dice-rolled", { uid: botUid, dice });

  const oldPos = player.position;
  let newPos = (player.position + dice) % 40;
  
  console.log(`🎲 playBotTurn: ${player.name} rolling ${dice}, moving from ${oldPos} to ${newPos}`);
  
  let sentToJail = false;
  if (newPos === 30) {
    const hasJailCard = player.inventory.chanceCards.includes(7) || player.inventory.communityChestCards.includes(5);
    if (hasJailCard) {
      player.inventory.chanceCards = player.inventory.chanceCards.filter(id => id !== 7);
      player.inventory.communityChestCards = player.inventory.communityChestCards.filter(id => id !== 5);
      io.to(roomName).emit("jail-card-used", {
        uid: player.uid,
        message: `${player.name} used a Get Out of Jail Free card!`
      });
    } else {
      sentToJail = true;
      newPos = 10;
    }
  }
  
  player.position = newPos;
  
  console.log(`📍 playBotTurn: ${player.name} position set to ${player.position}, rooms data: ${rooms[roomName]?.players.find(p => p.uid === botUid)?.position}`);

  if (!sentToJail && newPos < oldPos) {
    io.to(roomName).emit("collect-money", { uid: botUid, reason: "dice" });
    player.money += 200;
  }

  if (player.position === 4) player.money -= 200;
  if (player.position === 38) player.money -= 100;

  let isDrawingCard = false;
  const chancePositions = [7, 22, 36];
  const communityPositions = [2, 17, 33];
  
  if (chancePositions.includes(player.position)) {
    isDrawingCard = true;
    player.inCardDraw = true;
    // Keep bot in processing state during card draw
    const botKey = `${roomName}_${botUid}`;
    processingBots.add(botKey);
    // Set cooldown now to prevent interval from triggering again before turn passes
    turnCooldowns[roomName] = Date.now() + 5000;
    io.to(roomName).emit("before-draw", { type: "chance", uid: botUid });
    setTimeout(() => {
       if (!rooms[roomName]) return;
       const cardId = drawCard(chanceDeck);
       io.to(roomName).emit("draw-card", { type: "chance", uid: botUid, cardId });
       setTimeout(() => {
          if (!rooms[roomName]) return;
          // Notify client that animation is starting BEFORE applying effect
          io.to(roomName).emit("animation-start", { roomName, uid: botUid });
          applyCardEffect(roomName, botUid, "chance", cardId);
          const updatedPlayer = rooms[roomName].players.find(p => p.uid === botUid);
          if (updatedPlayer && !updatedPlayer.inCardDraw) {
            passBotTurn(roomName, botUid);
            // Remove from processingBots after turn is passed
            processingBots.delete(botKey);
          }
       }, 2000);
    }, 1500);
  } else if (communityPositions.includes(player.position)) {
    isDrawingCard = true;
    player.inCardDraw = true;
    // Keep bot in processing state during card draw
    const botKey = `${roomName}_${botUid}`;
    processingBots.add(botKey);
    // Set cooldown now to prevent interval from triggering again before turn passes
    turnCooldowns[roomName] = Date.now() + 6000;
    io.to(roomName).emit("before-draw", { type: "community", uid: botUid });
    setTimeout(() => {
       if (!rooms[roomName]) return;
       const cardId = drawCard(communityDeck);
       io.to(roomName).emit("draw-card", { type: "community", uid: botUid, cardId });
       setTimeout(() => {
          if (!rooms[roomName]) return;
          // Notify client that animation is starting BEFORE applying effect
          io.to(roomName).emit("animation-start", { roomName, uid: botUid });
          applyCardEffect(roomName, botUid, "community", cardId);
          const updatedPlayer = rooms[roomName].players.find(p => p.uid === botUid);
          if (updatedPlayer && !updatedPlayer.inCardDraw) {
            passBotTurn(roomName, botUid);
            // Remove from processingBots after turn is passed
            processingBots.delete(botKey);
          }
       }, 2000);
    }, 1500);
  }

  if (!isDrawingCard) {
    const botBuildingLevel = propertyBuildings[roomName]?.[player.position] || 0;
    const rentResult = calculateRent(room, player.position, roomName, dice, botBuildingLevel);
    if (rentResult.owner && rentResult.owner.uid !== player.uid && rentResult.rentAmount > 0) {
      if (player.money >= rentResult.rentAmount) {
         player.money -= rentResult.rentAmount;
         rentResult.owner.money += rentResult.rentAmount;
         io.to(roomName).emit("rent-paid", {
           fromUid: player.uid,
           toUid: rentResult.owner.uid,
           propertyIndex: player.position,
           amount: rentResult.rentAmount,
           hasHotel: rentResult.hasHotel,
           hasMonopoly: rentResult.hasMonopoly,
           isPartial: false,
           baseRent: rentResult.baseRent,
           buildingLevel: rentResult.buildingLevel,
           houseCount: rentResult.houseCount,
         });
      } else {
         const amountPaid = player.money;
         player.money = 0;
         player.bankrupt = true;
         player.isActive = false;
         rentResult.owner.money += amountPaid;
         returnAssetsToBank(roomName, player);
         io.to(roomName).emit("player-bankrupt", {
             uid: player.uid,
             name: player.name,
             debtAmount: rentResult.rentAmount - amountPaid,
             paidAmount: amountPaid,
             ownerUid: rentResult.owner.uid,
             ownerName: rentResult.owner.name,
         });
         const winCheck = checkWinCondition(roomName);
         if (winCheck.hasWinner && winCheck.winner) {
             endGame(roomName, winCheck.winner, "last-standing");
         }
      }
    } else if (!rentResult.owner && propertyRentData[player.position]) {
       const propertyInfo = propertyRentData[player.position];
       const price = propertyInfo.originalPrice;
       let willBuy = false;
       if (player.money >= price) {
         const diff = player.botDifficulty;
         if (diff === "hard") willBuy = player.money > price + 100;
         else if (diff === "medium") willBuy = player.money > price + 200 && Math.random() > 0.3;
         else willBuy = Math.random() > 0.6;
       }
       if (willBuy) {
         player.money -= price;
         player.inventory.properties.push(player.position);
         io.to(roomName).emit("property-bought", { uid: player.uid, propertyIndex: player.position, price });
       }
    }

    io.to(roomName).emit("move-result", {
      uid: botUid,
      from: oldPos,
      to: player.position,
      money: player.money,
      nextPlayerUid: room.players.find(p => p.isActive)?.uid || botUid,
    });
    
    // Add bot to animating players so passBotTurn waits for animation
    if (!animatingPlayers[roomName]) {
      animatingPlayers[roomName] = new Set();
    }
    animatingPlayers[roomName].add(botUid);
    
    if (!player.bankrupt && (player.botDifficulty === "medium" || player.botDifficulty === "hard")) {
       const monopolies: string[] = [];
       for (const color in colorGroups) {
          if (hasColorMonopoly(room, player.uid, color) && color !== "rail" && color !== "utility") {
             monopolies.push(color);
          }
       }
       if (monopolies.length > 0) {
          const threshold = player.botDifficulty === "hard" ? 200 : 500;
          if (player.money > threshold) {
             for (const color of monopolies) {
                const props = colorGroups[color];
                for (const propIdx of props) {
                   const houseCost = propIdx < 11 ? 50 : (propIdx < 21 ? 100 : (propIdx < 31 ? 150 : 200));
                   if (player.money > threshold + houseCost) {
                      if (!propertyBuildings[roomName]) propertyBuildings[roomName] = {};
                      const currentLevel = propertyBuildings[roomName][propIdx] || 0;
                      if (currentLevel < 4) {
                         propertyBuildings[roomName][propIdx] = currentLevel + 1;
                         player.money -= houseCost;
                         io.to(roomName).emit("house-built", {
                            uid: player.uid, propertyIndex: propIdx, houseCount: currentLevel + 1, hasHotel: false
                         });
                      } else if (currentLevel === 4) {
                         propertyBuildings[roomName][propIdx] = 5;
                         player.money -= houseCost;
                         io.to(roomName).emit("hotel-built", { uid: player.uid, propertyIndex: propIdx, cost: houseCost });
                      }
                   }
                }
             }
          }
       }
    }

    passBotTurn(roomName, botUid);
  }
};

setInterval(() => {
  for (const roomName in rooms) {
    const room = rooms[roomName];
    if (room.status === "in-game") {
      const activePlayer = room.players.find(p => p.isActive);
      if (activePlayer && activePlayer.isBot) {
        const botKey = `${roomName}_${activePlayer.uid}`;
        // Skip if already processing or still animating
        if (!processingBots.has(botKey) && !animatingPlayers[roomName]?.has(activePlayer.uid)) {
          // Check turn cooldown to prevent immediate re-triggering after card draws
          const cooldownEnd = turnCooldowns[roomName] || 0;
          if (Date.now() < cooldownEnd) {
            continue; // Wait for cooldown to expire
          }
          processingBots.add(botKey);
          playBotTurn(roomName, activePlayer.uid).catch(console.error).finally(() => {
            processingBots.delete(botKey);
          });
        }
      }
    }
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`✅ Socket.IO server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🌍 Environment: ${NODE_ENV}`);
  console.log(`🌐 CORS origins: ${JSON.stringify(corsOrigins)}`);
});
