const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ポート設定（GlitchやRender環境に対応）
const PORT = process.env.PORT || 3000;

// データ保存用ディレクトリ（なければ作成）
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 画像保存用ディレクトリ（なければ作成）
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');

// 初期ファイル作成
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');
if (!fs.existsSync(CHATS_FILE)) fs.writeFileSync(CHATS_FILE, '{}');

// ミドルウェア設定
app.use(express.json());

// 【重要】publicフォルダがない現在のGitHub構成に合わせて、ルートにあるファイルを配信
app.use(express.static(__dirname)); 
// アップロードされた画像も配信
app.use('/uploads', express.static(UPLOAD_DIR));

// 画像アップロード設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// JSON読み書きヘルパー
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8') || '{}');
const writeJSON = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2));

// --- API Endpoints ---
app.post('/api/register', (req, res) => {
  const { userId, password, displayName } = req.body;
  const users = readJSON(USERS_FILE);
  if (users[userId]) return res.status(400).json({ error: 'User already exists' });
  users[userId] = { userId, password, displayName: displayName || userId, friends: {} };
  writeJSON(USERS_FILE, users);
  res.json({ success: true, user: { userId, displayName: users[userId].displayName } });
});

app.post('/api/login', (req, res) => {
  const { userId, password } = req.body;
  const users = readJSON(USERS_FILE);
  if (users[userId] && users[userId].password === password) {
    res.json({ success: true, user: { userId, displayName: users[userId].displayName } });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image' });
  res.json({ success: true, imageUrl: `/uploads/${req.file.filename}` });
});

app.get('/api/search', (req, res) => {
  const { q, currentUserId } = req.query;
  const users = readJSON(USERS_FILE);
  const results = Object.keys(users)
    .filter(id => id.includes(q) && id !== currentUserId)
    .map(id => ({ userId: id, displayName: users[id].displayName }));
  res.json(results);
});

app.post('/api/friends', (req, res) => {
  const { currentUserId, friendId } = req.body;
  const users = readJSON(USERS_FILE);
  if (!users[currentUserId] || !users[friendId]) return res.status(404).json({ error: 'User not found' });
  users[currentUserId].friends[friendId] = true;
  users[friendId].friends[currentUserId] = true;
  writeJSON(USERS_FILE, users);
  res.json({ success: true });
});

app.get('/api/friends/:userId', (req, res) => {
  const users = readJSON(USERS_FILE);
  const u = users[req.params.userId];
  if (!u) return res.json([]);
  const list = Object.keys(u.friends || {}).map(id => ({ userId: id, displayName: users[id]?.displayName || id }));
  res.json(list);
});

// --- Socket.io ---
io.on('connection', (socket) => {
  socket.on('join_room', (roomId) => {
    socket.join(roomId);
    const chats = readJSON(CHATS_FILE);
    if (chats[roomId]?.messages) socket.emit('chat_history', Object.values(chats[roomId].messages));
  });

  socket.on('chat_message', (data) => {
    const chats = readJSON(CHATS_FILE);
    if (!chats[data.roomId]) chats[data.roomId] = { messages: {} };
    const msgId = Date.now() + Math.random().toString(36).substr(2, 5);
    const msg = { id: msgId, sender: data.sender, text: data.text, imageUrl: data.imageUrl, timestamp: Date.now() };
    chats[data.roomId].messages[msgId] = msg;
    writeJSON(CHATS_FILE, chats);
    io.to(data.roomId).emit('chat_message', msg);
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
