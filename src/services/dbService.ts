import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '../monopoloy-project/.env.local' });

const databaseUrl = process.env.DATABASE_URL?.includes('?') 
  ? `${process.env.DATABASE_URL}&sslmode=require` 
  : `${process.env.DATABASE_URL}?sslmode=require`;

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

const CLIENT_API_URL = process.env.CLIENT_API_URL || "http://localhost:3000";

export const updatePlayerStats = async (winner: any, players: any[], gameId?: string) => {
  try {
    const response = await fetch(`${CLIENT_API_URL}/api/player-stats`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-api-key": process.env.SERVER_API_KEY || "myanmarpoly-secret-key-2026"
      },
      body: JSON.stringify({ winner, players, gameId }),
    });
    if (!response.ok) {
      console.error("Failed to update player stats:", await response.text());
    } else {
      const result = await response.json();
      if (result.skipped) {
        console.log(`\u23ed\ufe0f Player stats update skipped: ${result.message}`);
      } else {
        console.log("\u2705 Player stats updated in database");
      }
    }
  } catch (error) {
    console.error("\u274c Error updating player stats:", error);
  }
};

export const fetchPlayerWins = async (uid: string): Promise<number> => {
  try {
    const response = await fetch(`${CLIENT_API_URL}/api/player-stats?uid=${uid}`, {
      headers: {
        "x-api-key": process.env.SERVER_API_KEY || "myanmarpoly-secret-key-2026"
      }
    });
    if (!response.ok) {
      console.error(`Failed to fetch stats for ${uid}:`, await response.text());
      return 0;
    }
    const data = await response.json();
    return data.wins || 0;
  } catch (error) {
    console.error(`\u274c Error fetching wins for ${uid}:`, error);
    return 0;
  }
};

export const getPlayerCoins = async (uid: string): Promise<number> => {
  try {
    const response = await fetch(`${CLIENT_API_URL}/api/player-economy?uid=${uid}`, {
      headers: {
        "x-api-key": process.env.SERVER_API_KEY || "myanmarpoly-secret-key-2026"
      }
    });
    if (!response.ok) return 0;
    const data = await response.json();
    return data.coins || 0;
  } catch (error) {
    console.error(`\u274c Error fetching coins for ${uid}:`, error);
    return 0;
  }
};

export const deductCoins = async (uid: string, amount: number): Promise<boolean> => {
  try {
    const res = await pool.query(`
      UPDATE users 
      SET coins = coins - $1
      WHERE id = $2 AND coins >= $1
      RETURNING coins;
    `, [amount, uid]);
    
    if (res.rowCount && res.rowCount > 0) {
      console.log(`\ud83e\ude99 Deducted ${amount} coins from ${uid}. New balance: ${res.rows[0].coins}`);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`\u274c Failed to deduct coins from ${uid}:`, err);
    return false;
  }
};

export const fetchPlayerEconomy = async (uid: string) => {
  try {
    const response = await fetch(`${CLIENT_API_URL}/api/player-economy?uid=${uid}`, {
      headers: {
        "x-api-key": process.env.SERVER_API_KEY || "myanmarpoly-secret-key-2026"
      }
    });
    if (!response.ok) {
      console.error(`Failed to fetch economy for ${uid}:`, await response.text());
      return { coins: 0, gems: 0, dice_skin: 'default', board_theme: 'default', avatar: 'default' };
    }
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch economy for ${uid}:`, error);
  }
  return { coins: 0, gems: 0, dice_skin: 'default', board_theme: 'default', avatar: 'default' };
};

export const rewardPlayers = async (winnerUid: string, players: any[], coinsCost: number = 50, originalPlayerCount?: number): Promise<{ winnerReward: number; participantReward: number }> => {
  try {
    // Use original player count if provided (for accurate prize pool when players leave)
    const playerCount = originalPlayerCount || players.length;
    const winnerReward = playerCount * coinsCost;

    for (const p of players) {
      if (p.uid === winnerUid) {
        await pool.query(`
          UPDATE users 
          SET coins = coins + $1
          WHERE id = $2
        `, [winnerReward, p.uid]);
        console.log(`💰 Awarded ${winnerReward} coins to winner ${p.name}`);
      }
      // Note: Losers don't get deducted here - coins were already deducted at game start
    }
    return { winnerReward, participantReward: 0 };
  } catch (err) {
    console.error("Failed to reward players:", err);
    return { winnerReward: 0, participantReward: 0 };
  }
};
