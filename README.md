# Monopoly Socket Server

A Socket.IO server for the Monopoly game application.

## Features

- Real-time multiplayer game rooms
- Socket.IO-based communication
- Player management and game state
- Property buying and hotel building
- Chance and Community Chest cards
- Chat messaging
- In-memory game state (rooms, players, properties)

## Prerequisites

- Node.js >= 18.0.0
- pnpm or npm

## Installation

```bash
# Install dependencies
npm install

# Or with pnpm
pnpm install
```

## Development

```bash
# Run in development mode with hot reload
npm run dev
```

## Production Build

```bash
# Build TypeScript to JavaScript
npm run build

# Start the production server
npm start
```

## Deployment to Render.com

### Option 1: Using render.yaml (Recommended)

1. Push your code to GitHub
2. Connect your repository to Render
3. Render will automatically detect and use the `render.yaml` configuration

### Option 2: Manual Configuration

1. **Create a new Web Service** on Render
2. **Build Command**: `npm install`
3. **Start Command**: `npm start`
4. **Health Check Path**: `/health`
5. **Environment Variables**:
   - `NODE_ENV`: `production`
   - `PORT`: `10000` (Render will override this)
   - `CORS_ORIGINS`: Your frontend URL(s), e.g., `https://your-frontend.onrender.com`

### Important Configuration Notes

#### CORS Settings

Update the `CORS_ORIGINS` environment variable in Render with your actual frontend URL(s):

```
CORS_ORIGINS=https://your-frontend.onrender.com,https://your-frontend.vercel.app
```

For development, you can use `*` but this is **not recommended for production**.

#### Health Check

The server includes a health check endpoint at `/health` that Render uses to monitor the service:

```bash
curl https://your-service.onrender.com/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 1234.56,
  "environment": "production"
}
```

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Environment mode | `development` | No |
| `PORT` | Server port | `4000` | No |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) | `*` | No (but recommended for production) |

## API Endpoints

- `GET /` - Server info
- `GET /health` - Health check endpoint

## Socket.IO Events

### Client → Server

- `get-rooms` - Get list of available rooms
- `create-room` - Create a new game room
- `join-room` - Join an existing room
- `leave-room` - Leave a room
- `delete-room` - Delete a room
- `start-game` - Start the game
- `player-move` - Roll dice and move player
- `show-card-effect` - Draw a chance/community card
- `confirm-card-effect` - Apply card effect
- `buy-property` - Purchase a property
- `build-hotel` - Build a hotel on owned property
- `jail-card-decision` - Use or save "Get Out of Jail Free" card
- `set-player-color` - Set player color
- `send-chat-message` - Send chat message

### Server → Client

- `update-rooms` - Room list update
- `room-created` - Room creation confirmation
- `room-joined` - Room join confirmation
- `dice-rolled` - Dice roll result
- `move-result` - Player movement result
- `before-draw` - Prompt to draw card
- `draw-card` - Card drawn
- `collect-money` - Money collected (passing GO)
- `tax-paid` - Tax payment notification
- `rent-paid` - Rent payment notification
- `property-bought` - Property purchase confirmation
- `hotel-built` - Hotel build confirmation
- `jail-card-prompt` - Prompt to use jail card
- `jail-card-used` - Jail card used notification
- `player-color-updated` - Player color update
- `chat-message` - New chat message
- `leave-player` - Player disconnected
- `error` - Error message

## Architecture

The server uses:
- **Socket.IO** for real-time bidirectional communication
- **In-memory storage** for game state (rooms, players, properties)
- **TypeScript** for type safety
- **Node.js HTTP server** as the underlying transport

## License

MIT
