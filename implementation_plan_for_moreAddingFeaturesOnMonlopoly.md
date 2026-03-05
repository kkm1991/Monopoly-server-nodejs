# Feature Implementation Plan — Monopoly Game Enhancements

8 features from `ထပ်ပြီး လုပ်ဆောင်ချင်တဲ့ အချက်များ.txt`. Organized by priority/dependency.

## User Review Required

> [!IMPORTANT]
> These features are **large in scope** — together they involve new DB tables, new API routes, new pages, server & client changes. I recommend implementing them in **phases** to keep things testable. Please confirm the phase order, or if you want to tackle specific features first.

> [!WARNING]
> **Feature ၁ & ၂ (Coin entry + win prize)** will fundamentally change the game economy. Currently [rewardPlayers()](file:///d:/New%20Monopoly%20Project/monopoly-server/src/services/dbService.ts#79-97) in [dbService.ts](file:///d:/New%20Monopoly%20Project/monopoly-server/src/services/dbService.ts) already gives the winner **100 coins** and participants **20 coins** — this would need to be replaced by the new prize system.

> [!CAUTION]
> **Feature ၃-၄ (Friend system)** requires new DB tables and a whole new page. This is the most complex feature set.

---

## Phase 1: Game Room Economy (Features ၁, ၂, ၅, ၆)
*These are tightly coupled — coin entry fee, win prize, custom rooms, and game rules.*

### ၁. Coin Entry Fee (50 coins per game)
### ၂. Win Prize (players × coin cost)

#### [MODIFY] [dbService.ts](file:///d:/New%20Monopoly%20Project/monopoly-server/src/services/dbService.ts)
- Add `deductCoins(uid, amount)` — deduct coins from a player
- Add `getPlayerCoins(uid)` — check player's coin balance
- Modify [rewardPlayers()](file:///d:/New%20Monopoly%20Project/monopoly-server/src/services/dbService.ts#79-97) to accept dynamic `coinsCost` and `playerCount` instead of hardcoded 100/20

#### [MODIFY] [server.ts](file:///d:/New%20Monopoly%20Project/monopoly-server/server.ts)
- In `start-game` handler: deduct `coinsCost` (default 50) from all players, emit `coins-deducted` event
- In [endGame()](file:///d:/New%20Monopoly%20Project/monopoly-server/src/services/gameLogic.ts#100-170) flow: award winner `playerCount × coinsCost`, emit `coins-awarded` event
- Add coin balance validation before game start (reject players without enough coins)

#### [MODIFY] [gameboard.tsx](file:///d:/New%20Monopoly%20Project/monopoloy-project/components/gameboard.tsx)
- Listen to `coins-deducted` event → show dialog "ပွဲဝင်ကြေး Ks 50 နူတ်ယူပါပြီ"
- Listen to `coins-awarded` event → show dialog on game-end screen "နိုင်ပွဲဆု Ks {amount} ရရှိပါပြီ"

---

### ၅. Custom Room Creation (coins cost, room creator kick)
### ၆. Game Rules Dialog (timer, starting money, coins cost, win prize)

#### [MODIFY] [server.ts](file:///d:/New%20Monopoly%20Project/monopoly-server/server.ts)
- Extend room type with `creatorUid`, `gameRules: { timer, startingMoney, coinsCost, winPrizeMultiplier }`
- Modify `create-room` handler: remove `paid_player` restriction, deduct `coinsCost` for custom rooms, store `creatorUid`
- Add `kick-player` socket event: only room creator can kick, before game starts
- Modify `start-game` handler: accept `gameRules` from client (only from room creator), validate rules, apply to game
- Use `gameRules.startingMoney` instead of hardcoded `1500`
- Use `gameRules.timer` to set game duration

#### [MODIFY] [lobby.tsx](file:///d:/New%20Monopoly%20Project/monopoloy-project/components/lobby.tsx)
- Remove `paid_player` restriction for room creation
- Allow all users to create rooms (costs coins)

#### [NEW] [GameRulesDialog.tsx](file:///d:/New%20Monopoly%20Project/monopoloy-project/components/GameRulesDialog.tsx)
- Modal shown when room creator clicks "Start Game"
- Options:
  - **Timer**: Unlimited / 15 / 20 / 40 / 60 minutes (radio/select)
  - **Starting Money**: default 1500 (number input)
  - **Coins Cost**: default 50 (number input)
  - **Win Prize**: auto-calculated as `playerCount × coinsCost`
- "Start" button emits `start-game` with `gameRules`

#### [MODIFY] [gameboard.tsx](file:///d:/New%20Monopoly%20Project/monopoloy-project/components/gameboard.tsx)
- Show game rules dialog to room creator when "Start Game" clicked
- Add kick button next to players in lobby (only visible to room creator)
- Listen to `kicked-from-room` event → redirect to lobby with toast

---

## Phase 2: Friend System (Features ၃, ၃-duplicate, ၄)

### ၃. Friend Page, Invite & Accept

#### [NEW] [004_friends.sql](file:///d:/New%20Monopoly%20Project/monopoloy-project/lib/db/migrations/004_friends.sql)
```sql
CREATE TABLE IF NOT EXISTS friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, blocked
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, friend_id)
);
```

#### [NEW] API routes
- `app/api/friends/route.ts` — GET friend list, POST send invite
- `app/api/friends/[id]/route.ts` — PATCH accept/reject, DELETE unfriend
- `app/api/friends/search/route.ts` — search users by username

#### [NEW] [friends/page.tsx](file:///d:/New%20Monopoly%20Project/monopoloy-project/app/friends/page.tsx)
- Friend list, pending invites, search users, send invite

### ၃ (duplicate). Share Coins with Friends

#### [NEW] `app/api/friends/share-coins/route.ts`
- POST: transfer coins from user to friend (validate balance, friendship)

### ၄. Share Cosmetics with Friends

#### [NEW] `app/api/friends/share-cosmetic/route.ts`
- POST: gift a cosmetic item (remove from sender, add to receiver)

---

## Phase 3: Admin & Notifications (Features ၇, ၈)

### ၇. User Management (Admin CRUD)

#### [NEW] `app/api/admin/users/route.ts`
- GET: list users with pagination, search
- PATCH: update user coins, gems, role
- DELETE: ban/delete user

#### [NEW] [admin/page.tsx](file:///d:/New%20Monopoly%20Project/monopoloy-project/app/admin/page.tsx)
- Admin dashboard with user table, coin/gem management, role management
- Protected: only `role === "admin"` can access

### ၈. Notification System

#### [NEW] [005_notifications.sql](file:///d:/New%20Monopoly%20Project/monopoloy-project/lib/db/migrations/005_notifications.sql)
```sql
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- 'coins_received', 'friend_invite', 'announcement', etc.
    title VARCHAR(255) NOT NULL,
    message TEXT,
    read BOOLEAN DEFAULT FALSE,
    data JSONB, -- extra metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### [NEW] API routes
- `app/api/notifications/route.ts` — GET notifications, POST mark as read
- Server emits `new-notification` via Socket.IO for real-time delivery

#### [NEW] [NotificationBell.tsx](file:///d:/New%20Monopoly%20Project/monopoloy-project/components/NotificationBell.tsx)
- Bell icon in navbar with unread count badge
- Dropdown showing recent notifications

---

## Verification Plan

### Automated Tests
- `npx tsc --noEmit` in `monopoly-server/` — verify server compiles after each phase
- Client: `pnpm dev` in `monopoloy-project/` — verify no build errors

### Manual Verification (User)
**Phase 1:**
1. Create a room → verify coins deducted, rules dialog appears
2. Start game → verify all players' coins deducted, dialog shows deduction
3. Win game → verify winner receives `playerCount × coinsCost` coins
4. Test kick feature: room creator kicks a player, verify kicked player returns to lobby
5. Test custom rules: set different timer/starting money, verify game uses those values

**Phase 2:**
1. Search and send friend invite → verify receiver sees pending invite
2. Accept invite → both users see each other in friend list
3. Share coins → verify balance changes for both users
4. Share cosmetic → verify item moves from sender to receiver

**Phase 3:**
1. Admin page: add/modify coins and gems for a user → verify changes persist
2. Notification: trigger coin addition → verify notification appears in bell
