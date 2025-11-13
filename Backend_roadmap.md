# Backend (Node.js + Socket.IO) Roadmap

## Goal
Provide minimal signaling server for WebRTC screen share/view app.

## Steps

1. **Setup**
   - Initialize project: `npm init -y`
   - Install: `npm install express socket.io`
   - Create `server.js`

2. **Core Functionality**
   - Create Express server with HTTPS (self-signed for dev)
   - Integrate Socket.IO
   - Handle events:
     - "start-share" → register host room
     - "join-view" → notify host
     - Relay "offer", "answer", "ice" between peers

3. **Rooms**
   - Store in-memory map: `{ roomId: { host: socket, viewers: [] } }`
   - Auto-cleanup on disconnect

4. **Security (Minimal)**
   - Validate event names (only expected types)
   - Ignore malformed or oversized messages
   - Use CORS whitelist (frontend origin only)

5. **Deployment**
   - Deploy via Render / Vercel / VPS
   - Use HTTPS for production (LetsEncrypt)
   - Ensure persistent connection via WSS

6. **Optional**
   - Add rate-limiting or random token per session
   - Add console logging for monitoring
