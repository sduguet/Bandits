'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createGame, applyAction, publicGameFor } = require('./game-server');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ['websocket', 'polling'] });
const rooms = new Map();
const PORT = process.env.PORT || 3000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const AVATARS = new Set(Array.from({ length: 18 }, (_, index) => `avatar-${index + 1}`));

app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get(['/online.html', '/play-online.html'], (_req, res) => res.redirect(301, '/'));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], index: 'index.html', dotfiles: 'ignore' }));

function roomCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(value) {
  return String(value || '').trim().replace(/[<>]/g, '').slice(0, 18);
}

function cleanCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

function cleanAvatar(value) {
  const avatar = String(value || '');
  return AVATARS.has(avatar) ? avatar : 'avatar-1';
}

function roomForSocket(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}

function currentPlayer(room, socket) {
  return room.players.find(p => p.token === socket.data.playerToken);
}

function roomPayload(room, viewer) {
  return {
    code: room.code,
    hostId: room.hostId,
    you: viewer.id,
    started: Boolean(room.game),
    players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, connected: p.connected })),
    game: room.game ? publicGameFor(room.game, viewer.id) : null
  };
}

function broadcast(room) {
  for (const p of room.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('room:update', roomPayload(room, p));
  }
}

function joinSocket(socket, room, p) {
  if (p.socketId && p.socketId !== socket.id) io.to(p.socketId).emit('session:replaced');
  p.socketId = socket.id;
  p.connected = true;
  socket.data.roomCode = room.code;
  socket.data.playerToken = p.token;
  socket.join(room.code);
}

io.on('connection', socket => {
  socket.on('room:create', (data = {}, ack = () => {}) => {
    try {
      const name = cleanName(data.name);
      if (!name) throw new Error('Indiquez votre prénom.');
      const code = roomCode();
      const p = { id: crypto.randomUUID(), token: crypto.randomUUID(), name, avatar: cleanAvatar(data.avatar), connected: true, socketId: socket.id };
      const room = { code, hostId: p.id, players: [p], game: null, createdAt: Date.now() };
      rooms.set(code, room);
      joinSocket(socket, room, p);
      ack({ ok: true, code, token: p.token, playerId: p.id });
      broadcast(room);
    } catch (err) { ack({ ok: false, error: err.message }); }
  });

  socket.on('room:join', (data = {}, ack = () => {}) => {
    try {
      const code = cleanCode(data.code);
      const room = rooms.get(code);
      if (!room) throw new Error('Ce salon est introuvable.');
      let p = data.token ? room.players.find(item => item.token === data.token) : null;
      if (!p) {
        if (room.game) throw new Error('La partie a déjà commencé.');
        if (room.players.length >= 3) throw new Error('Ce salon est complet.');
        const name = cleanName(data.name);
        if (!name) throw new Error('Indiquez votre prénom.');
        p = { id: crypto.randomUUID(), token: crypto.randomUUID(), name, avatar: cleanAvatar(data.avatar), connected: true, socketId: socket.id };
        room.players.push(p);
      }
      joinSocket(socket, room, p);
      ack({ ok: true, code, token: p.token, playerId: p.id });
      broadcast(room);
    } catch (err) { ack({ ok: false, error: err.message }); }
  });

  socket.on('room:start', (_data, ack = () => {}) => {
    try {
      const room = roomForSocket(socket);
      const p = room && currentPlayer(room, socket);
      if (!room || !p) throw new Error('Salon introuvable.');
      if (room.hostId !== p.id) throw new Error('Seul l’hôte peut lancer la partie.');
      if (room.players.length !== 3 || room.players.some(item => !item.connected)) throw new Error('Les trois joueurs doivent être présents.');
      if (room.game) throw new Error('La partie a déjà commencé.');
      room.game = createGame(room.players);
      ack({ ok: true });
      broadcast(room);
    } catch (err) { ack({ ok: false, error: err.message }); }
  });

  socket.on('game:action', (action = {}, ack = () => {}) => {
    try {
      const room = roomForSocket(socket);
      const p = room && currentPlayer(room, socket);
      if (!room?.game || !p) throw new Error('Partie introuvable.');
      applyAction(room.game, p.id, action);
      ack({ ok: true });
      broadcast(room);
    } catch (err) { ack({ ok: false, error: err.expose ? err.message : 'Action impossible.' }); }
  });

  socket.on('disconnect', () => {
    const room = roomForSocket(socket);
    const p = room && currentPlayer(room, socket);
    if (!room || !p || p.socketId !== socket.id) return;
    p.connected = false;
    p.socketId = null;
    if (!room.game) {
      room.players = room.players.filter(item => item.id !== p.id);
      if (room.hostId === p.id) room.hostId = room.players[0]?.id || null;
    }
    if (!room.players.length) rooms.delete(room.code);
    else broadcast(room);
  });
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.createdAt < cutoff && room.players.every(p => !p.connected)) rooms.delete(code);
  }
}, 30 * 60 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => console.log(`Brigands écoute sur le port ${PORT}`));

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
