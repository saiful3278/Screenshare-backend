# BACKEND.PROJECT.RULES

- Framework: Node.js with Express + Socket.IO.
- Purpose: signaling server only.
- No database, no file storage.
- Store active rooms in a JS object.
- Events allowed: start-share, join-view, offer, answer, ice.
- Validate event names to block unknown data.
- Use CORS whitelist to accept frontend origin only.
- Serve over HTTPS/WSS (localhost can use HTTP for dev).
- Auto-delete room when host disconnects.
- Log only essential events (join, leave, offer, answer).
