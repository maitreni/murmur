/**
 * MURMUR — Backend Node.js
 * Stack : Express + Socket.io + SQLite (better-sqlite3) + JWT + bcryptjs
 */

require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const Database   = require('better-sqlite3');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const path       = require('path');

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT       || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'murmur_secret_change_me_in_production';
const DB_FILE    = process.env.DB_FILE    || './murmur.db';

// ─── APP & SERVER ────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── DATABASE ────────────────────────────────────────────────────────────────
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT UNIQUE NOT NULL,
    pin_hash   TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS boards (
    id         TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    name       TEXT NOT NULL,
    share_mode TEXT NOT NULL DEFAULT 'none',
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(owner) REFERENCES users(username)
  );

  CREATE TABLE IF NOT EXISTS cards (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id   TEXT NOT NULL,
    text       TEXT    DEFAULT '',
    image      TEXT    DEFAULT '',
    color      TEXT    DEFAULT '#fffdf7',
    stripe     TEXT    DEFAULT '#c8553d',
    x          REAL    DEFAULT 0,
    y          REAL    DEFAULT 0,
    w          REAL    DEFAULT 220,
    z          INTEGER DEFAULT 10,
    date_label TEXT    DEFAULT '',
    FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
  );
`);

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const genId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

const signToken = (username) => jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });

const verifyToken = (token) => {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
};

const fmtCard = (r) => ({
  id: r.id, boardId: r.board_id,
  text: r.text, image: r.image,
  color: r.color, stripe: r.stripe,
  x: r.x, y: r.y, w: r.w, z: r.z,
  date: r.date_label,
});

/** Middleware JWT */
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const payload = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : null);
  if (!payload) return res.status(401).json({ error: 'Non authentifié' });
  req.user = payload.username;
  next();
}

/** Vérifie les droits d'écriture (propriétaire ou mode 'edit') */
function canWrite(boardId, username) {
  const b = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId);
  if (!b) return null;
  if (b.owner === username || b.share_mode === 'edit') return b;
  return null;
}

const touchBoard = (id) =>
  db.prepare(`UPDATE boards SET updated_at = datetime('now') WHERE id = ?`).run(id);

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { username = '', pin = '' } = req.body;
  if (!/^[a-z0-9_-]{2,30}$/.test(username))
    return res.status(400).json({ error: 'Nom invalide (2-30 chars, minuscules/chiffres/_/-)' });
  if (!/^\d{4}$/.test(pin))
    return res.status(400).json({ error: 'PIN invalide (4 chiffres)' });
  try {
    const hash = await bcrypt.hash(pin, 10);
    db.prepare('INSERT INTO users (username, pin_hash) VALUES (?, ?)').run(username, hash);
    res.json({ token: signToken(username), username });
  } catch (e) {
    res.status(e.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 500)
       .json({ error: e.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'Nom déjà pris' : 'Erreur serveur' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username = '', pin = '' } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Utilisateur inconnu' });
  const ok = await bcrypt.compare(pin, user.pin_hash);
  if (!ok) return res.status(401).json({ error: 'PIN incorrect' });
  res.json({ token: signToken(username), username });
});

// ─── BOARDS ───────────────────────────────────────────────────────────────────
app.get('/api/boards', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, COUNT(c.id) AS card_count
    FROM boards b LEFT JOIN cards c ON c.board_id = b.id
    WHERE b.owner = ?
    GROUP BY b.id
    ORDER BY b.updated_at DESC
  `).all(req.user);
  res.json(rows);
});

app.post('/api/boards', auth, (req, res) => {
  const name = (req.body.name || 'Nouveau tableau').trim().slice(0, 80);
  const id = genId();
  db.prepare('INSERT INTO boards (id, owner, name) VALUES (?, ?, ?)').run(id, req.user, name);
  res.status(201).json({ id, name, owner: req.user, share_mode: 'none', card_count: 0, updated_at: new Date().toISOString() });
});

app.get('/api/boards/:id', (req, res) => {
  const b = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Tableau introuvable' });

  const h = req.headers.authorization || '';
  const payload = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : null);
  const isOwner = payload?.username === b.owner;

  if (!isOwner && b.share_mode === 'none')
    return res.status(403).json({ error: 'Ce tableau n\'est pas partagé' });

  const cards = db.prepare('SELECT * FROM cards WHERE board_id = ? ORDER BY z ASC').all(b.id);
  res.json({ ...b, cards: cards.map(fmtCard) });
});

app.patch('/api/boards/:id', auth, (req, res) => {
  const b = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Introuvable' });
  if (b.owner !== req.user) return res.status(403).json({ error: 'Accès refusé' });

  const name       = (req.body.name       ?? b.name).slice(0, 80);
  const share_mode = req.body.share_mode  ?? b.share_mode;
  db.prepare(`UPDATE boards SET name=?, share_mode=?, updated_at=datetime('now') WHERE id=?`)
    .run(name, share_mode, b.id);

  // Notifier les clients connectés
  io.to(`board:${b.id}`).emit('board:updated', { name, share_mode });
  res.json({ ...b, name, share_mode });
});

app.delete('/api/boards/:id', auth, (req, res) => {
  const b = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Introuvable' });
  if (b.owner !== req.user) return res.status(403).json({ error: 'Accès refusé' });
  db.prepare('DELETE FROM boards WHERE id = ?').run(b.id);
  io.to(`board:${b.id}`).emit('board:deleted');
  res.json({ ok: true });
});

// ─── CARDS ────────────────────────────────────────────────────────────────────
app.post('/api/boards/:boardId/cards', auth, (req, res) => {
  const board = canWrite(req.params.boardId, req.user);
  if (!board) return res.status(403).json({ error: 'Accès refusé' });

  const { text='', image='', color='#fffdf7', stripe='#c8553d',
          x=40, y=40, w=220, z=10, date='' } = req.body;

  const info = db.prepare(`
    INSERT INTO cards (board_id,text,image,color,stripe,x,y,w,z,date_label)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(board.id, text, image, color, stripe, x, y, w, z, date);

  const card = fmtCard(db.prepare('SELECT * FROM cards WHERE id=?').get(info.lastInsertRowid));
  touchBoard(board.id);

  io.to(`board:${board.id}`).emit('card:added', card);
  res.status(201).json(card);
});

app.patch('/api/cards/:id', auth, (req, res) => {
  const c = db.prepare('SELECT * FROM cards WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Introuvable' });

  const board = canWrite(c.board_id, req.user);
  if (!board) return res.status(403).json({ error: 'Accès refusé' });

  const allowed = ['text','image','color','stripe','x','y','w','z'];
  const sets = [], vals = [];
  allowed.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]); } });
  if (!sets.length) return res.json(fmtCard(c));

  vals.push(c.id);
  db.prepare(`UPDATE cards SET ${sets.join(',')} WHERE id=?`).run(...vals);
  const updated = fmtCard(db.prepare('SELECT * FROM cards WHERE id=?').get(c.id));

  io.to(`board:${board.id}`).emit('card:updated', updated);
  res.json(updated);
});

app.delete('/api/cards/:id', auth, (req, res) => {
  const c = db.prepare('SELECT * FROM cards WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Introuvable' });

  const board = canWrite(c.board_id, req.user);
  if (!board) return res.status(403).json({ error: 'Accès refusé' });

  db.prepare('DELETE FROM cards WHERE id=?').run(c.id);
  io.to(`board:${board.id}`).emit('card:deleted', { id: c.id });
  res.json({ ok: true });
});

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WS] +${socket.id}`);

  socket.on('board:join', ({ boardId, token }) => {
    const b = db.prepare('SELECT * FROM boards WHERE id=?').get(boardId);
    if (!b) return socket.emit('error', 'Tableau introuvable');

    const payload = verifyToken(token);
    const isOwner = payload?.username === b.owner;
    if (!isOwner && b.share_mode === 'none') return socket.emit('error', 'Accès refusé');

    socket.join(`board:${boardId}`);

    const cards = db.prepare('SELECT * FROM cards WHERE board_id=? ORDER BY z ASC').all(boardId);
    socket.emit('board:state', { board: b, cards: cards.map(fmtCard) });

    // Nombre de connectés sur ce tableau
    const room = io.sockets.adapter.rooms.get(`board:${boardId}`);
    io.to(`board:${boardId}`).emit('board:presence', {
      count: room ? room.size : 1,
      username: payload?.username || 'Visiteur',
      event: 'join',
    });
  });

  /** Déplacement live (sans écriture DB — persisté via REST à mouseup) */
  socket.on('card:move_live', ({ boardId, cardId, x, y }) => {
    socket.to(`board:${boardId}`).emit('card:move_live', { cardId, x, y });
  });

  /** Frappe live */
  socket.on('card:typing_live', ({ boardId, cardId, text }) => {
    socket.to(`board:${boardId}`).emit('card:typing_live', { cardId, text });
  });

  socket.on('board:leave', ({ boardId }) => {
    socket.leave(`board:${boardId}`);
    const room = io.sockets.adapter.rooms.get(`board:${boardId}`);
    io.to(`board:${boardId}`).emit('board:presence', { count: room ? room.size : 0, event: 'leave' });
  });

  socket.on('disconnect', () => console.log(`[WS] -${socket.id}`));
});

// ─── FALLBACK SPA ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── START ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🎉  Murmur  →  http://localhost:${PORT}`);
  console.log(`   DB      : ${DB_FILE}`);
  if (JWT_SECRET === 'murmur_secret_change_me_in_production')
    console.log(`   ⚠️  Définissez JWT_SECRET=... dans .env pour la production\n`);
});
