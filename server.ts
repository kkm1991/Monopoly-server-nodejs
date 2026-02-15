import { createServer } from "http";

import { Server } from "socket.io";

const PORT = process.env.PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || "development";

// Configure CORS based on environment
const corsOrigins = NODE_ENV === "production" 
  ? (process.env.CORS_ORIGINS?.split(",") || ["https://monopoly-project-phi.vercel.app"])
  : "*";

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
});

const io = new Server(server, {
  cors: { 
    origin: corsOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket", "polling"], // Support both for compatibility
  pingTimeout: 60000,
  pingInterval: 25000
});

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
type Player = {
  uid: string;
  name: string;
  identifier: string;
  socketId: string;
  money: number;
  position: number;
  inCardDraw: boolean;
  isActive: boolean;
  color?: string;
  pendingJailDecision?: boolean;
  inventory: {
    chanceCards: number[];
    communityChestCards: number[];
    properties: number[];
  };
};

type Room = {
  name: string;
  players: Player[];
  maxPlayers: number;
  status: "waiting" | "in-game";
};

// In-memory rooms
const rooms: Record<
  string,
  {
    name: string;
    players: Array<{
      uid: string;
      name: string;
      identifier: string;
      socketId: string;
      money: number;
      position: number;
      isActive: boolean;
      // add this to track cards like "Get Out of Jail Free" (only stored ids)
      inCardDraw: boolean;
      color?: string;
      pendingJailDecision?: boolean;
      inventory: {
        chanceCards: number[];
        communityChestCards: number[];
        properties: number[];
      };
    }>;
    maxPlayers: number;
    status: "waiting" | "in-game";
  }
> = {};

// Property Hotels tracking (separate from rooms to persist)
const propertyHotels: Record<string, Record<number, boolean>> = {};

// Property rent data
const propertyRentData: Record<number, { rent: number; hotelRent: number; color: string }> = {
  // Brown properties
  1: { rent: 4, hotelRent: 20, color: "#955436" },
  3: { rent: 6, hotelRent: 30, color: "#955436" },
  // Light Blue properties
  6: { rent: 8, hotelRent: 40, color: "#AAE0FA" },
  8: { rent: 8, hotelRent: 40, color: "#AAE0FA" },
  9: { rent: 10, hotelRent: 50, color: "#AAE0FA" },
  // Pink properties
  11: { rent: 12, hotelRent: 60, color: "#D93A96" },
  13: { rent: 12, hotelRent: 60, color: "#D93A96" },
  14: { rent: 14, hotelRent: 70, color: "#D93A96" },
  // Orange properties
  16: { rent: 14, hotelRent: 70, color: "#F7941D" },
  18: { rent: 14, hotelRent: 70, color: "#F7941D" },
  19: { rent: 16, hotelRent: 80, color: "#F7941D" },
  // Red properties
  21: { rent: 18, hotelRent: 90, color: "#ED1B24" },
  23: { rent: 18, hotelRent: 90, color: "#ED1B24" },
  24: { rent: 20, hotelRent: 100, color: "#ED1B24" },
  // Yellow properties
  26: { rent: 22, hotelRent: 110, color: "#FEF200" },
  27: { rent: 22, hotelRent: 110, color: "#FEF200" },
  29: { rent: 24, hotelRent: 120, color: "#FEF200" },
  // Green properties
  31: { rent: 26, hotelRent: 130, color: "#1FB25A" },
  32: { rent: 26, hotelRent: 130, color: "#1FB25A" },
  34: { rent: 28, hotelRent: 140, color: "#1FB25A" },
  // Dark Blue properties
  37: { rent: 35, hotelRent: 175, color: "#0072BB" },
  39: { rent: 50, hotelRent: 200, color: "#0072BB" },
  // Railroads
  5: { rent: 25, hotelRent: 25, color: "rail" },
  15: { rent: 25, hotelRent: 25, color: "rail" },
  25: { rent: 25, hotelRent: 25, color: "rail" },
  35: { rent: 25, hotelRent: 25, color: "rail" },
  // Utilities
  12: { rent: 0, hotelRent: 0, color: "utility" }, // Electric
  28: { rent: 0, hotelRent: 0, color: "utility" }, // Water
};

// Color groups for monopoly check
const colorGroups: Record<string, number[]> = {
  "#955436": [1, 3], // Brown
  "#AAE0FA": [6, 8, 9], // Light Blue
  "#D93A96": [11, 13, 14], // Pink
  "#F7941D": [16, 18, 19], // Orange
  "#ED1B24": [21, 23, 24], // Red
  "#FEF200": [26, 27, 29], // Yellow
  "#1FB25A": [31, 32, 34], // Green
  "#0072BB": [37, 39], // Dark Blue
  "rail": [5, 15, 25, 35], // Railroads
  "utility": [12, 28], // Utilities
};

// Helper function to find property owner
const findPropertyOwner = (room: Room, propertyIndex: number): Player | null => {
  return room.players.find(p => p.inventory.properties.includes(propertyIndex)) || null;
};

// Helper function to check if player has monopoly (all properties of same color)
const hasColorMonopoly = (room: Room, playerUid: string, color: string): boolean => {
  const propertiesInColor = colorGroups[color];
  if (!propertiesInColor) return false;
  
  const player = room.players.find(p => p.uid === playerUid);
  if (!player) return false;
  
  return propertiesInColor.every(idx => player.inventory.properties.includes(idx));
};

// Helper function to calculate rent
const calculateRent = (
  room: Room, 
  propertyIndex: number, 
  roomName: string,
  diceRoll: number = 0
): { rentAmount: number; owner: Player | null; hasMonopoly: boolean; hasHotel: boolean } => {
  const rentInfo = propertyRentData[propertyIndex];
  if (!rentInfo) {
    return { rentAmount: 0, owner: null, hasMonopoly: false, hasHotel: false };
  }
  
  const owner = findPropertyOwner(room, propertyIndex);
  if (!owner) {
    return { rentAmount: 0, owner: null, hasMonopoly: false, hasHotel: false };
  }
  
  const hasMonopoly = hasColorMonopoly(room, owner.uid, rentInfo.color);
  const hasHotel = propertyHotels[roomName]?.[propertyIndex] || false;
  
  // Calculate base rent
  let baseRent = hasHotel ? rentInfo.hotelRent : rentInfo.rent;
  
  // Railroad rent calculation (increases with more railroads owned)
  if (rentInfo.color === "rail") {
    const railroadsOwned = owner.inventory.properties.filter(p => 
      [5, 15, 25, 35].includes(p)
    ).length;
    // Rent doubles for each additional railroad: 25, 50, 100, 200
    baseRent = 25 * Math.pow(2, railroadsOwned - 1);
  }
  
  // Utility rent calculation (4x dice roll for 1, 10x for both)
  if (rentInfo.color === "utility") {
    const utilitiesOwned = owner.inventory.properties.filter(p => 
      [12, 28].includes(p)
    ).length;
    // If has monopoly (both utilities), rent is 10x dice, otherwise 4x dice
    const multiplier = hasMonopoly ? 10 : 4;
    baseRent = multiplier * diceRoll;
  }
  
  // Apply monopoly multiplier for regular properties (2x)
  const rentAmount = (hasMonopoly && rentInfo.color !== "utility") ? baseRent * 2 : baseRent;
  
  return { rentAmount, owner, hasMonopoly, hasHotel };
};

const chanceEffects: Record<number, (player: Player, room: Room) => void> = {
  1: (p) => {
    // စတင် (GO) သို့ တိုက်ရိုက်သွားပါ
    p.position = 0;
    p.money += 200; 
  },
  2: (p) => {
    // ပုဂံ သို့ သွားပါ
    p.position = 34;
  },
  3: (p) => {
    // မေမြို့ သို့ သွားပါ
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
      io.to(room.name).emit("collect-money", { uid: p.uid });
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
  1: (p) => {
    // စတင် (GO) သို့ တိုက်ရိုက်သွားပါ
    p.position = 0;
    p.money += 200;
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

//  text: "အနီးဆုံး ဘူတာ/ဆိပ်ကမ်း သို့ သွားပါ။",
const railroads = [5, 15, 25, 35];
const nearestCell = (current: number) => {
  for (const r of railroads) {
    if (r > current) {
      return r;
    }
  }
  return railroads[0]; // wrap around
};

//  text: "အနီးဆုံး လျှပ်စစ်ဌာန သို့မဟုတ် ရေပေးဝေရေးဌာနသို့ သွားပါ။",
const utilities = [12, 28];
const nearestUtility = (current: number) => {
  for (const u of utilities) {
    if (u > current) {
      return u;
    }
  }
  return utilities[0]; // wrap around
};

io.on("connection", (socket) => {
  // Send all rooms on new connection
  socket.emit("update-rooms", rooms);

  // Lobby requests current rooms
  socket.on("get-rooms", () => {
    socket.emit("update-rooms", rooms);
  });

  // Create a new room
  socket.on("create-room", ({ roomName, maxPlayers, user }) => {
    if (!roomName || rooms[roomName]) {
      socket.emit("error", "Room invalid or already exists");
      return;
    }

    rooms[roomName] = {
      name: roomName,
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
    io.emit("update-rooms", rooms);
    socket.emit("room-created", roomName);
  });

  // Join existing room
  socket.on("join-room", ({ roomName, user }) => {
    const room = rooms[roomName];
    if (!room) {
      socket.emit("error", "Room does not exist");
      return;
    }
    if (room.players.length >= room.maxPlayers) {
      socket.emit("error", "Room full");
      return;
    }

    const exists = room.players.some((p) => p.uid === user.uid);
    if (!exists) {
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
        inventory: {
          chanceCards: [],
          communityChestCards: [],
          properties: [],
        },
      });
    }

    socket.join(roomName);
    io.emit("update-rooms", rooms);
    socket.emit("room-joined", roomName);
  });

  // Leave room
  socket.on("leave-room", ({ roomName, uid }) => {
    const room = rooms[roomName];
    if (!room) return;

    room.players = room.players.filter((p) => p.uid !== uid);
    socket.leave(roomName);

    if (room.players.length === 0) delete rooms[roomName];

    io.emit("update-rooms", rooms);
  });

  // Delete room
  socket.on("delete-room", ({ roomName }) => {
    delete rooms[roomName];
    io.emit("update-rooms", rooms);
  });

  // ================= Start Game =================
  socket.on("start-game", ({ roomName }) => {
    const room = rooms[roomName];
    if (!room || room.players.length < 2) {
      socket.emit("error", "Need at least 2 players to start the game");
      return;
    }

    room.status = "in-game";
    room.players = room.players.map((p, i) => ({
      ...p,
      isActive: i === 0, // first player starts
      money: 1500,
      position: 0,
      inCardDraw: false,
      inventory: {
        chanceCards: [],
        communityChestCards: [],
        properties: [],
      },
    }));

    io.to(roomName).emit("update-rooms", rooms);
  });

  // ================= Player Move (Dice Roll) =================
  socket.on("player-move", ({ roomName, uid }) => {
    const room = rooms[roomName];
    if (!room) return;

    const dice = Math.floor(Math.random() * 6) + 1;
    // const dice = 36;
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
          message: "အချုပ်ခန်းသို့သွားရန် ကျက်သရေပေါက်သည်။ 'အချုပ်ခန်းမှ အခမဲ့ထွက်ခွင့်' ကတ်ကို သုံးလိုပါသလား?"
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
    const rentResult = calculateRent(room, player.position, roomName, dice);
    
    if (rentResult.owner && rentResult.owner.uid !== player.uid && rentResult.rentAmount > 0) {
      // Check if player has enough money
      if (player.money < rentResult.rentAmount) {
        // Player is bankrupt or cannot pay full rent
        // For now, take all their money
        const amountPaid = player.money;
        player.money = 0;
        rentResult.owner.money += amountPaid;
        
        console.log(`⚠️ ${player.name} couldn't pay full rent Ks ${rentResult.rentAmount}, paid Ks ${amountPaid} instead`);
        
        io.to(roomName).emit("rent-paid", {
          fromUid: player.uid,
          toUid: rentResult.owner.uid,
          propertyIndex: player.position,
          amount: amountPaid,
          hasHotel: rentResult.hasHotel,
          hasMonopoly: rentResult.hasMonopoly,
          isPartial: true,
        });
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
        });
      }
    }

    // Pass turn to next player (ONLY if not drawing a card)
    const nextIndex = (currentIndex + 1) % room.players.length;
    room.players = room.players.map((p, i) => ({
      ...p,
      isActive: i === nextIndex,
    }));

    // last move Result
    io.to(roomName).emit("move-result", {
      uid,
      from: oldPos,
      to: player.position,
      money: player.money,
      nextPlayerUid: room.players[nextIndex].uid,
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
      // cardId = 8;
      type = "chance";

      console.log(player);
    } else if (communityPositions.includes(player.position)) {
      cardId = drawCard(communityDeck);
      type = "community";

      console.log(player);
    }

    if (cardId !== undefined) {
      io.to(roomName).emit("draw-card", { type, uid, cardId });
    }
  });

  // client ဘက်က chance နဲ့ community card ကိုရရှိကြောင်း စောင့်ကြည့်ပြီးမှ applyCardEffect ကိုလုပ်မယ်
  socket.on("confirm-card-effect", ({ roomName, uid, deckType, cardId }) => {
    applyCardEffect(roomName, uid, deckType, cardId);

    const room = rooms[roomName];
    const player = room.players.find((p) => p.uid === uid);

    // If the effect triggered another draw (e.g. Chance 8 -> Community Chest),
    // do NOT pass the turn yet.
    if (player && player.inCardDraw) {
      return;
    }

    //Now that the effect (like moving to yangon) is applied,
    //we can broadcast the new postion and pass the turn to the next player
    const currentIndex = room.players.findIndex((p) => p.uid === uid);
    const nextIndex = (currentIndex + 1) % room.players.length;
    room.players = room.players.map((p, i) => ({
      ...p,
      isActive: i === nextIndex,
    }));
    io.to(roomName).emit("update-rooms", rooms);
  });

  // ================= Buy Property =================
  socket.on("buy-property", ({ roomName, uid, propertyIndex, price }) => {
    const room = rooms[roomName];
    if (!room) return;

    const player = room.players.find((p) => p.uid === uid);
    if (!player) return;

    // Check if property is already owned (double-check on server)
    const isAlreadyOwned = room.players.some((p) =>
      p.inventory.properties.includes(propertyIndex)
    );
    if (isAlreadyOwned) {
      socket.emit("error", "Property already owned");
      return;
    }

    // Check if player has enough money
    if (player.money < price) {
      socket.emit("error", "Not enough money");
      return;
    }

    // Deduct money and add property to inventory
    player.money -= price;
    player.inventory.properties.push(propertyIndex);

    console.log(`✅ Player ${player.name} bought property ${propertyIndex} for $${price}`);
    console.log(`📦 Player inventory now:`, player.inventory);

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
    if (!propertyHotels[roomName]) {
      propertyHotels[roomName] = {};
    }

    // Check if hotel already exists
    if (propertyHotels[roomName][propertyIndex]) {
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

    // Build hotel
    player.money -= cost;
    propertyHotels[roomName][propertyIndex] = true;

    console.log(`🏨 Player ${player.name} built hotel on property ${propertyIndex} for Ks ${cost}`);

    // Broadcast to all players
    io.to(roomName).emit("hotel-built", {
      uid,
      propertyIndex,
      cost,
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
      const chanceIndex = player.inventory.chanceCards.indexOf(7);
      const communityIndex = player.inventory.communityChestCards.indexOf(5);
      
      if (chanceIndex > -1) {
        player.inventory.chanceCards.splice(chanceIndex, 1);
      } else if (communityIndex > -1) {
        player.inventory.communityChestCards.splice(communityIndex, 1);
      }

      // Player stays at position 30 (Go To Jail) but doesn't go to jail
      // Position stays at 30, turn passes to next player
      console.log(`✅ Player ${player.name} used Get Out of Jail Free card`);
      
      io.to(roomName).emit("jail-card-used", {
        uid,
        message: `${player.name} က 'အချုပ်ခန်းမှ အခမဲ့ထွက်ခွင့်' ကတ်ကို သုံးခဲ့သည်!`
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
    const nextIndex = (currentIndex + 1) % room.players.length;
    room.players = room.players.map((p, i) => ({
      ...p,
      isActive: i === nextIndex,
    }));

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

  // Handle disconnect
  // socket.on("disconnect", () => {
  //   console.log("❌ Client disconnected", socket.id);
  //   for (const roomName in rooms) {
  //     rooms[roomName].players = rooms[roomName].players.filter(
  //       (p) => p.socketId !== socket.id,
  //     );
  //     if (rooms[roomName].players.length === 0) {
  //       delete rooms[roomName];
  //     }
  //   }
  //   io.emit("update-rooms", rooms);
  // });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("❌ Client disconnected", socket.id);

    for (const roomName in rooms) {
      // 1. Find the player before removing them
      const leavingPlayer = rooms[roomName].players.find(
        (p) => p.socketId === socket.id,
      );

      if (leavingPlayer) {
        // 2. Remove the player from the array
        rooms[roomName].players = rooms[roomName].players.filter(
          (p) => p.socketId !== socket.id,
        );

        // 3. Emit the specific 'leave-player' event with the UID
        // We send it to everyone in that specific room
        io.to(roomName).emit("leave-player", { uid: leavingPlayer.uid });
        console.log("leavingPlayer", leavingPlayer.uid);
        // 4. Clean up the room if it's empty
        if (rooms[roomName].players.length === 0) {
          delete rooms[roomName];
        }
      }
    }

    // Final sync for the room list UI
    io.emit("update-rooms", rooms);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Socket.IO server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🌍 Environment: ${NODE_ENV}`);
  console.log(`🌐 CORS origins: ${JSON.stringify(corsOrigins)}`);
});
