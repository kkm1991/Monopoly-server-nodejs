import { Socket } from "socket.io";
import { rooms } from "../../services/gameState.js";
import { getIO } from "../../services/socketService.js";

export const registerTradeHandlers = (socket: Socket) => {
  const io = getIO();

  // Send card sale offer to target player
  socket.on("sell-jail-card", ({ roomName, fromUid, toUid, cardType, price }) => {
    const room = rooms[roomName];
    if (!room) {
      console.log(`❌ sell-jail-card: Room ${roomName} not found`);
      return;
    }

    const fromPlayer = room.players.find((p) => p.uid === fromUid);
    const toPlayer = room.players.find((p) => p.uid === toUid);

    if (!fromPlayer || !toPlayer) {
      socket.emit("error", "Player not found");
      return;
    }

    const offerId = `offer_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    if (!room.pendingCardOffers) {
      room.pendingCardOffers = {};
    }
    room.pendingCardOffers[offerId] = {
      offerId,
      fromUid,
      toUid,
      cardType,
      price,
    };

    console.log(`🎴 ${fromPlayer.name} offered ${cardType} jail card to ${toPlayer.name} for $${price}`);
    console.log(`📋 Current offers in room:`, Object.keys(room.pendingCardOffers));

    // Send offer to target player
    io.to(roomName).emit("jail-card-offer", {
      offerId,
      fromUid,
      fromName: fromPlayer.name,
      toUid,
      cardType,
      price,
    });

    // Notify seller
    socket.emit("jail-card-offer-sent", {
      offerId,
      toName: toPlayer.name,
      cardType,
      price,
    });
  });

  // Accept jail card offer
  socket.on("accept-jail-card-offer", ({ roomName, offerId }) => {
    console.log(`🎴 accept-jail-card-offer received: roomName=${roomName}, offerId=${offerId}`);
    
    const room = rooms[roomName];
    if (!room) return;
    
    const roomOffers = room.pendingCardOffers || {};
    const offer = roomOffers[offerId];

    if (!offer) {
      socket.emit("error", "Offer not found or expired");
      return;
    }

    const fromPlayer = room.players.find((p) => p.uid === offer.fromUid);
    const toPlayer = room.players.find((p) => p.uid === offer.toUid);

    if (!fromPlayer || !toPlayer) {
      socket.emit("error", "Player not found");
      return;
    }

    // Check money
    if (toPlayer.money < offer.price) {
      socket.emit("error", "Not enough money to accept offer");
      delete room.pendingCardOffers![offerId];
      io.to(roomName).emit("jail-card-offer-declined", { offerId, reason: "Not enough money" });
      return;
    }

    // Process transaction
    let cardId: number | null = null;
    if (offer.cardType === "chance") {
      const idx = fromPlayer.inventory.chanceCards.indexOf(7);
      if (idx > -1) {
        cardId = fromPlayer.inventory.chanceCards.splice(idx, 1)[0];
        toPlayer.inventory.chanceCards.push(cardId);
      }
    } else {
      const idx = fromPlayer.inventory.communityChestCards.indexOf(5);
      if (idx > -1) {
        cardId = fromPlayer.inventory.communityChestCards.splice(idx, 1)[0];
        toPlayer.inventory.communityChestCards.push(cardId);
      }
    }

    if (cardId === null || cardId === undefined) {
      socket.emit("error", "Seller no longer has the card");
      delete room.pendingCardOffers![offerId];
      io.to(roomName).emit("jail-card-offer-declined", { offerId, reason: "Card no longer available" });
      return;
    }

    // Transfer money
    fromPlayer.money += offer.price;
    toPlayer.money -= offer.price;

    console.log(`✅ ${toPlayer.name} accepted ${offer.cardType} jail card from ${fromPlayer.name} for $${offer.price}`);

    // Notify all players
    io.to(roomName).emit("jail-card-sold", {
      offerId,
      fromUid: offer.fromUid,
      toUid: offer.toUid,
      cardType: offer.cardType,
      cardId, 
      price: offer.price,
      fromName: fromPlayer.name,
      toName: toPlayer.name,
    });

    delete room.pendingCardOffers![offerId];
    io.to(roomName).emit("update-rooms", rooms);
  });

  // Decline jail card offer
  socket.on("decline-jail-card-offer", ({ roomName, offerId }) => {
    const room = rooms[roomName];
    if (!room) return;
    
    const roomOffers = room.pendingCardOffers || {};
    const offer = roomOffers[offerId];

    if (!offer) return;

    const fromPlayer = room.players.find(p => p.uid === offer.fromUid);

    io.to(roomName).emit("jail-card-offer-declined", {
      offerId,
      reason: "Declined by player",
      fromUid: offer.fromUid,
      fromName: fromPlayer?.name,
      cardType: offer.cardType,
      price: offer.price,
    });

    delete room.pendingCardOffers![offerId];
  });
};
