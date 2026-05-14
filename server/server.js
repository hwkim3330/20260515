'use strict';
const express = require('express');
const cors    = require('cors');
const http    = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs   = require('fs');

const app  = express();
const PORT = 3100;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Ensure log directories exist
const logsDir   = path.join(__dirname, 'logs');
const testsDir  = path.join(logsDir, 'tests');
const macrosDir = path.join(logsDir, 'macros');
[logsDir, testsDir, macrosDir].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// Make dirs available to route modules via app.locals
app.locals.testsDir  = testsDir;
app.locals.macrosDir = macrosDir;

// Routes
app.use('/api', require('./routes/health'));
app.use('/api', require('./routes/packetFlow'));
app.use('/api', require('./routes/macro'));
app.use('/api', require('./routes/logs'));

// 404
app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

// Broadcast helper available to routes
app.locals.broadcast = (msg) => {
  const raw = JSON.stringify(msg);
  wss.clients.forEach(ws => { try { ws.send(raw); } catch {} });
};

wss.on('connection', (ws) => {
  ws.on('error', () => {});
  ws.send(JSON.stringify({ type: 'connected', time: new Date().toISOString() }));
});

server.listen(PORT, () => {
  console.log(`[PacketLabManager] Server running on http://localhost:${PORT}`);
  console.log(`[PacketLabManager] Logs: ${logsDir}`);
});
