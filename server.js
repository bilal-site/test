import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer } from "ws";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database("bilalnet.db");

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "375b7ae5184a90e9eaccffea3240bf4fed7831e5a3248c5edacd8dd7fc99a8a5"; // Should be 32 bytes
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_KEY.padEnd(32, ' ').slice(0, 32)), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted + ":" + cipher.getAuthTag().toString("hex");
}

function decrypt(text) {
  const [ivHex, encrypted, authTagHex] = text.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_KEY.padEnd(32, ' ').slice(0, 32)), iv);
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS user_tags (
    username TEXT PRIMARY KEY,
    color TEXT
  );
  CREATE TABLE IF NOT EXISTS bans (
    username TEXT PRIMARY KEY,
    expiresAt INTEGER,
    reason TEXT
  );
`);

// Create owner account
try {
  db.prepare("INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)").run("BILALHAMAMA68", "20161221");
} catch (e) {
  console.error("Error creating owner account", e);
}

const activeUsers = new Map(); // username -> ws

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes
  app.post("/api/signup", (req, res) => {
    const { username, password } = req.body;
    try {
      const stmt = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)");
      stmt.run(username, password);
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ success: false, error: "Username taken" });
    }
  });

  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ? AND password = ?").get(username, password);
    if (user) {
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, error: "Invalid credentials" });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // WebSocket
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    let currentUser = null;

    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "join") {
        const banned = db.prepare("SELECT * FROM bans WHERE username = ?").get(message.username);
        if (banned) {
          if (banned.expiresAt === 0 || Date.now() < banned.expiresAt) {
            ws.send(JSON.stringify({ type: "banned", reason: banned.reason, expiresAt: banned.expiresAt }));
            ws.close();
            return;
          } else {
            db.prepare("DELETE FROM bans WHERE username = ?").run(message.username);
          }
        }
        currentUser = message.username;
        activeUsers.set(currentUser, ws);
        broadcastUserList();
      } else if (message.type === "chat") {
        if (!currentUser) return; // Security: ignore if not joined
        if (currentUser === "BILALHAMAMA68" && message.content.startsWith("/")) {
          handleAdminCommand(message.content);
        } else {
          const encryptedContent = encrypt(message.content);
          db.prepare("INSERT INTO messages (username, content) VALUES (?, ?)").run(currentUser, encryptedContent);
          
          const broadcastMessage = { type: 'chat', username: currentUser, content: message.content };
          wss.clients.forEach((client) => {
            if (client.readyState === 1) {
              client.send(JSON.stringify(broadcastMessage));
            }
          });
        }
      }
    });

    ws.on("close", () => {
      if (currentUser) {
        activeUsers.delete(currentUser);
        broadcastUserList();
      }
    });
  });

  function handleAdminCommand(command) {
    const parts = command.split(" ");
    const cmd = parts[0];
    
    if (cmd === "/ban") {
      // /ban [duration] [reason] [user]
      const duration = parts[1];
      const userToBan = parts[parts.length - 1];
      const reason = parts.slice(2, parts.length - 1).join(" ");
      
      const expiresAt = duration === "0" || duration === "now" ? 0 : Date.now() + parseInt(duration) * 60 * 1000;
      
      // Logic to ban user (disconnect and prevent from joining)
      db.prepare("INSERT OR REPLACE INTO bans (username, expiresAt, reason) VALUES (?, ?, ?)").run(userToBan, expiresAt, reason);
      
      if (activeUsers.has(userToBan)) {
        activeUsers.get(userToBan).close();
        activeUsers.delete(userToBan);
        broadcastUserList();
      }
    } else if (cmd === "/chattag") {
      // /chattag [user] [color]
      const userToTag = parts[1];
      const color = parts[2];
      db.prepare("INSERT OR REPLACE INTO user_tags (username, color) VALUES (?, ?)").run(userToTag, color);
      broadcastUserList();
    } else if (cmd === "/serverannouncement") {
      // /serverannouncement [text]
      const text = parts.slice(1).join(" ");
      const announcement = { type: "announcement", content: text };
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(JSON.stringify(announcement));
        }
      });
    }
  }

  function broadcastUserList() {
    const users = Array.from(activeUsers.keys());
    const tags = db.prepare("SELECT * FROM user_tags").all();
    const tagMap = {};
    tags.forEach(t => tagMap[t.username] = t.color);
    const message = JSON.stringify({ type: "userList", users, tagMap });
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(message);
      }
    });
  }
}

startServer();
