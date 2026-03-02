export type Player = {
  uid: string;
  name: string;
  identifier: string;
  socketId: string;
  money: number;
  position: number;
  inCardDraw: boolean;
  isActive: boolean;
  color?: string;
  isBot?: boolean;
  botDifficulty?: "easy" | "medium" | "hard";
  pendingJailDecision?: boolean;
  surrendered?: boolean; // Player surrendered but watching
  bankrupt?: boolean; // Player is bankrupt (lost game but watching)
  disconnected?: boolean; // Player temporarily disconnected (can reconnect)
  wins?: number; // Total wins for this player
  equippedItems?: {
    dice_skin: string;
    board_theme: string;
    avatar: string;
    effect?: string;
  };
  inventory: {
    chanceCards: number[];
    communityChestCards: number[];
    properties: number[];
  };
};

export type CardOffer = {
  offerId: string;
  fromUid: string;
  toUid: string;
  cardType: 'chance' | 'community';
  price: number;
};

export type Room = {
  name: string;
  players: Player[];
  maxPlayers: number;
  status: "waiting" | "in-game" | "finished";
  gameStartTime?: number; // Track when game started for 20min win condition
  winner?: string; // UID of winner
  pendingCardOffers?: Record<string, CardOffer>;
  statsUpdated?: boolean; // Prevent duplicate stats updates
  minDurationMet?: boolean; // Has game met minimum 1-minute duration for rankings
};
