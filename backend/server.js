const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const path = require('node:path');
dotenv.config({ path: path.join(__dirname, '.env') });
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const { connectDB } = require('./config/db');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('./utils/security');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const authRoutes = require('./routes/authRoutes');
const conversationRoutes = require('./routes/conversationRoutes');
const groupRoutes = require('./routes/groupRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const Conversation = require('./models/Conversation');

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT || 5002);
app.disable('x-powered-by');

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Cannot start ChatSphere: port ${port} is already in use. Stop the existing backend or configure a different PORT.`);
  } else {
    console.error('ChatSphere backend failed to listen:', {
      errorCode: error.code || 'unknown',
      errorName: error.name || 'Error',
    });
  }
  process.exit(1);
});

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  },
});
global.__io = io;

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  next();
});

app.get('/api/health', (req, res) => {
  const databaseState = mongoose.connection.readyState;
  res.status(200).json({
    status: databaseState === 1 ? 'ok' : 'degraded',
    message: 'ChatSphere backend is running.',
    database: databaseState === 1 ? 'connected' : 'unavailable',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health/database', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  return res.status(connected ? 200 : 503).json({
    status: connected ? 'connected' : 'unavailable',
  });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/health/')) return next();
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Database is unavailable. Please try again later.' });
  }
  return next();
});

app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/uploads', uploadRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

io.use((socket, next) => {
  const authHeader = socket.handshake.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : socket.handshake.auth?.token || null;

  if (!token) {
    return next(new Error('Authentication required for Socket.IO connections.'));
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    socket.userId = decoded.userId;
    next();
  } catch (error) {
    next(new Error(error.statusCode === 503 ? error.message : 'Invalid or expired socket token.'));
  }
});

io.on('connection', (socket) => {
  socket.data.conversationRooms = new Set();
  socket.join(`user:${socket.userId}`);

  socket.on('join-room', async (roomId, acknowledge) => {
    const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
    try {
      if (typeof roomId !== 'string' || !/^[a-f\d]{24}$/i.test(roomId)) {
        return reply({ ok: false, message: 'Invalid conversation identifier.' });
      }
      const isMember = await Conversation.exists({ _id: roomId, members: socket.userId });
      if (!isMember) return reply({ ok: false, message: 'You are not a member of this conversation.' });

      socket.join(roomId);
      socket.data.conversationRooms.add(roomId);
      return reply({ ok: true, roomId });
    } catch (error) {
      const safeMessage = String(error.message || 'Unknown database error.')
        .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[MongoDB connection string redacted]');
      console.error('Socket conversation authorization failed:', safeMessage);
      return reply({ ok: false, message: 'Unable to join this conversation.' });
    }
  });

  socket.on('leave-room', (roomId) => {
    if (typeof roomId !== 'string' || !socket.data.conversationRooms.has(roomId)) return;
    socket.leave(roomId);
    socket.data.conversationRooms.delete(roomId);
  });

  socket.on('typing', (payload) => {
    const { roomId, isTyping } = payload && typeof payload === 'object' ? payload : {};
    if (typeof roomId !== 'string' || !socket.data.conversationRooms.has(roomId)) return;
    socket.to(roomId).emit('typing', {
      conversationId: roomId,
      isTyping: Boolean(isTyping),
      userId: socket.userId,
    });
  });
});

function startServer() {
  const jwtSecretConfigured = typeof process.env.JWT_SECRET === 'string' && process.env.JWT_SECRET.trim().length >= 32;
  server.listen(port, () => {
    console.log(`ChatSphere backend running on http://localhost:${port}`);
    if (!jwtSecretConfigured) {
      console.error('JWT_SECRET is missing or shorter than 32 characters. Registration and login will not issue tokens until it is configured in backend/.env.');
    }

    connectDB().then((dbReady) => {
      if (!dbReady) {
        console.log('MongoDB is not connected. Database-dependent requests will return HTTP 503 until the connection succeeds.');
      }
    }).catch((error) => {
      console.error('Unexpected MongoDB startup error:', {
        errorCode: error.code || 'unknown',
        errorName: error.name || 'Error',
      });
    });
  });
}

process.on('SIGINT', () => {
  console.log('Shutting down backend gracefully.');
  server.close(() => process.exit(0));
});

startServer();

module.exports = { app, server, io };
