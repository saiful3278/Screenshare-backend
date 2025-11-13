const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
  } else {
    next();
  }
});


let server;
if (process.env.USE_HTTPS === 'true' && process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
  try {
    const key = fs.readFileSync(process.env.SSL_KEY_PATH);
    const cert = fs.readFileSync(process.env.SSL_CERT_PATH);
    server = https.createServer({ key, cert }, app);
  } catch (e) {
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'],
  path: '/socket.io'
});

// In-memory room storage
const rooms = {};

// Allowed event names for validation
const allowedEvents = ['start-share', 'join-view', 'offer', 'answer', 'ice', 'ice-candidate', 'stop-share', 'get-available'];

// Essential logging function
function logEvent(event, data) {
  console.log(`[${new Date().toISOString()}] ${event}:`, JSON.stringify(data));
}

// Event validation middleware
function validateEvent(event, data) {
  if (!allowedEvents.includes(event)) {
    return { valid: false, error: 'Invalid event type' };
  }
  let messageSize = 0;
  try {
    if (data == null) {
      messageSize = 0;
    } else {
      const s = JSON.stringify(data);
      messageSize = typeof s === 'string' ? s.length : 0;
    }
  } catch (_) {
    return { valid: false, error: 'Malformed payload' };
  }
  if (messageSize > 65536) {
    return { valid: false, error: 'Message too large' };
  }
  return { valid: true };
}

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Handle start-share event - register host room
  socket.on('start-share', (data) => {
    const validation = validateEvent('start-share', data);
    if (!validation.valid) {
      socket.emit('error', validation.error);
      return;
    }
    const { roomId: providedRoomId } = data || {};
    const roomId = providedRoomId || socket.id;
    
    // Create new room with host
    rooms[roomId] = {
      host: socket,
      viewers: []
    };
    
    socket.join(roomId);
    socket.roomId = roomId;
    socket.isHost = true;
    
    logEvent('start-share', { roomId, socketId: socket.id });
    io.to(roomId).emit('room-created', { roomId });
  });
  socket.on('stop-share', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId] && socket.isHost) {
      io.to(roomId).emit('host-stopped');
      rooms[roomId].viewers.forEach(viewer => {
        try { viewer.leave(roomId); } catch (_) {}
      });
      delete rooms[roomId];
      logEvent('stop-share', { roomId });
    }
  });

  socket.on('get-available', () => {
    const count = Object.keys(rooms).length;
    socket.emit('available-count', { count });
  });
  socket.on('ice-candidate', (data) => {
    const validation = validateEvent('ice-candidate', data);
    if (!validation.valid) {
      socket.emit('error', validation.error);
      return;
    }
    const { targetId, candidate } = data || {};
    if (!targetId || !candidate) {
      const roomId = socket.roomId;
      if (roomId && candidate) {
        socket.to(roomId).emit('ice', { candidate, fromId: socket.id });
        logEvent('ice', { fromId: socket.id, roomId });
      } else {
        socket.emit('error', 'Invalid ICE payload');
      }
      return;
    }
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket && targetSocket.roomId === socket.roomId) {
      targetSocket.emit('ice', { candidate, fromId: socket.id });
      logEvent('ice', { fromId: socket.id, targetId });
    }
  });
  
  // Handle join-view event - notify host
  socket.on('join-view', (data) => {
    const validation = validateEvent('join-view', data);
    if (!validation.valid) {
      socket.emit('error', validation.error);
      return;
    }
    const { roomId } = data || {};
    if (!roomId) {
      socket.emit('error', 'Missing roomId');
      return;
    }
    const room = rooms[roomId];
    
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    
    // Add viewer to room
    room.viewers.push(socket);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.isHost = false;
    
    io.to(roomId).emit('viewer-joined', { viewerId: socket.id });
    logEvent('join-view', { roomId, viewerId: socket.id });
    socket.emit('view-joined', { roomId });
  });
  
  // Handle WebRTC signaling - relay offer from host to viewer
  socket.on('offer', (data) => {
    const validation = validateEvent('offer', data);
    if (!validation.valid) {
      socket.emit('error', validation.error);
      return;
    }
    const { targetId, offer } = data || {};
    if (!targetId || !offer) {
      const roomId = socket.roomId;
      if (roomId && offer) {
        socket.to(roomId).emit('offer', { offer, fromId: socket.id });
        logEvent('offer', { fromId: socket.id, roomId });
      } else {
        socket.emit('error', 'Invalid offer payload');
      }
      return;
    }
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket && targetSocket.roomId === socket.roomId) {
      targetSocket.emit('offer', { offer, fromId: socket.id });
      logEvent('offer', { fromId: socket.id, targetId });
    }
  });
  
  // Handle WebRTC signaling - relay answer from viewer to host
  socket.on('answer', (data) => {
    const validation = validateEvent('answer', data);
    if (!validation.valid) {
      socket.emit('error', validation.error);
      return;
    }
    const { targetId, answer } = data || {};
    if (!targetId || !answer) {
      const roomId = socket.roomId;
      if (roomId && answer) {
        socket.to(roomId).emit('answer', { answer, fromId: socket.id });
        logEvent('answer', { fromId: socket.id, roomId });
      } else {
        socket.emit('error', 'Invalid answer payload');
      }
      return;
    }
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket && targetSocket.roomId === socket.roomId) {
      targetSocket.emit('answer', { answer, fromId: socket.id });
      logEvent('answer', { fromId: socket.id, targetId });
    }
  });
  
  // Handle WebRTC signaling - relay ICE candidates
  socket.on('ice', (data) => {
    const validation = validateEvent('ice', data);
    if (!validation.valid) {
      socket.emit('error', validation.error);
      return;
    }
    const { targetId, candidate } = data || {};
    if (!targetId || !candidate) {
      const roomId = socket.roomId;
      if (roomId && candidate) {
        socket.to(roomId).emit('ice', { candidate, fromId: socket.id });
        logEvent('ice', { fromId: socket.id, roomId });
      } else {
        socket.emit('error', 'Invalid ICE payload');
      }
      return;
    }
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket && targetSocket.roomId === socket.roomId) {
      targetSocket.emit('ice', { candidate, fromId: socket.id });
      logEvent('ice', { fromId: socket.id, targetId });
    }
  });
  
  // Handle disconnect - auto-cleanup
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    if (socket.roomId && rooms[socket.roomId]) {
      const room = rooms[socket.roomId];
      
      if (socket.isHost) {
        // Host disconnected - delete room and notify all viewers
        logEvent('host-disconnected', { roomId: socket.roomId });
        
        // Notify all viewers
        room.viewers.forEach(viewer => {
          viewer.emit('host-disconnected');
          viewer.disconnect();
        });
        
        // Delete room
        delete rooms[socket.roomId];
      } else {
        // Viewer disconnected - remove from room
        const viewerIndex = room.viewers.indexOf(socket);
        if (viewerIndex > -1) {
          room.viewers.splice(viewerIndex, 1);
          logEvent('viewer-disconnected', { roomId: socket.roomId, viewerId: socket.id });
          
          // Notify host
          if (room.host) {
            room.host.emit('viewer-left', { viewerId: socket.id });
          }
        }
      }
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: Object.keys(rooms).length });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5001;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log('CORS any origin enabled');
});
