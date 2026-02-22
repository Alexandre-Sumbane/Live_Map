import express  from 'express';
import http  from 'http';
import { WebSocketServer } from'ws';
import { v4 as uuidv4 } from 'uuid';

import cors  from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const users = new Map();

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

function broadcastUsers() {
  const userList = Array.from(users.values());
  broadcast({ type: 'users', users: userList });
}

wss.on('connection', (ws) => {
  const id = uuidv4();
  
  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      
      if (data.type === 'location') {
        const user = {
          id,
          lat: data.lat,
          lng: data.lng,
          connectedAt: users.get(id)?.connectedAt || Date.now()
        };
        users.set(id, user);
        
        // Send this user their own ID
        if (!users.get(id)?.sentId) {
          ws.send(JSON.stringify({ type: 'your_id', id }));
        }
        
        broadcastUsers();
      }
    } catch (e) {
      console.error('Error parsing message:', e);
    }
  });

  // Send ID immediately
  ws.send(JSON.stringify({ type: 'your_id', id }));

  ws.on('close', () => {
    users.delete(id);
    broadcastUsers();
  });
});

app.get('/health', (req, res) => res.json({ ok: true, users: users.size }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

