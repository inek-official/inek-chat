const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// RenderのDisk対応: 環境変数があればそれを使用し、なければローカルのパスを使う
const DATA_DIR = process.env.STORAGE_PATH ? process.env.STORAGE_PATH : path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_PATH ? process.env.UPLOAD_PATH : path.join(__dirname, 'public', 'uploads');

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + path.extname(file.originalname))
  }
});
const upload = multer({ storage: storage });

// Helper functions for reading/writing JSON files
function readJSON(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return {};
  }
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
  }
}

// Ensure data files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) writeJSON(USERS_FILE, {});
if (!fs.existsSync(CHATS_FILE)) writeJSON(CHATS_FILE, {});

// --- API Endpoints ---

// Register User
app.post('/api/register', (req, res) => {
  const { userId, password, displayName } = req.body;
  if (!userId || !password) return res.status(400).json({ error: 'Missing userId or password' });

  const users = readJSON(USERS_FILE);
  if (users[userId]) return res.status(400).json({ error: 'User ID already exists' });

  users[userId] = {
    userId,
    password, // In a real app, hash this!
    displayName: displayName || userId,
    friends: {}
  };
  writeJSON(USERS_FILE, users);
  res.json({ success: true, user: { userId, displayName: users[userId].displayName } });
});

// Login User
app.post('/api/login', (req, res) => {
  const { userId, password } = req.body;
  const users = readJSON(USERS_FILE);

  if (users[userId] && users[userId].password === password) {
    res.json({ success: true, user: { userId, displayName: users[userId].displayName } });
  } else {
    res.status(401).json({ error: 'Invalid user ID or password' });
  }
});

// Upload Image
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, imageUrl });
});

// Search Users
app.get('/api/search', (req, res) => {
  const { q, currentUserId } = req.query;
  if (!q) return res.json([]);

  const users = readJSON(USERS_FILE);
  const results = Object.keys(users)
    .filter(uid => uid.includes(q) && uid !== currentUserId)
    .map(uid => ({ userId: uid, displayName: users[uid].displayName }));

  res.json(results);
});

// Add Friend
app.post('/api/friends', (req, res) => {
  const { currentUserId, friendId } = req.body;
  const users = readJSON(USERS_FILE);

  if (!users[currentUserId] || !users[friendId]) {
    return res.status(400).json({ error: 'User not found' });
  }

  users[currentUserId].friends[friendId] = true;
  users[friendId].friends[currentUserId] = true;
  writeJSON(USERS_FILE, users);

  res.json({ success: true });
});

// Get Friends
app.get('/api/friends/:userId', (req, res) => {
  const { userId } = req.params;
  const users = readJSON(USERS_FILE);

  if (!users[userId]) return res.json([]);

  const friendsList = Object.keys(users[userId].friends || {}).map(fId => {
    return { userId: fId, displayName: users[fId] ? users[fId].displayName : fId };
  });
  res.json(friendsList);
});


// --- WebSocket / Socket.io ---
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Join a room when starting a chat
  socket.on('join_room', (roomId) => {
    socket.join(roomId);
    console.log(`User joined room: ${roomId}`);

    // Send chat history to the user
    const chats = readJSON(CHATS_FILE);
    if (chats[roomId] && chats[roomId].messages) {
      socket.emit('chat_history', Object.values(chats[roomId].messages));
    }
  });

  // Handle incoming messages
  socket.on('chat_message', (msgData) => {
    /* msgData expects: { roomId, sender, text, imageUrl } */
    const chats = readJSON(CHATS_FILE);
    const roomId = msgData.roomId;

    if (!chats[roomId]) {
      chats[roomId] = { messages: {} };
    }

    const messageId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    const message = {
      id: messageId,
      sender: msgData.sender,
      text: msgData.text,
      imageUrl: msgData.imageUrl || null,
      timestamp: Date.now()
    };

    chats[roomId].messages[messageId] = message;
    writeJSON(CHATS_FILE, chats);

    // Broadcast message to everyone in the room
    io.to(roomId).emit('chat_message', message);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
