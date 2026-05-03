const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const preferredPublicDir = path.join(__dirname, "public");
const PUBLIC_DIR = fs.existsSync(path.join(preferredPublicDir, "index.html"))
  ? preferredPublicDir
  : __dirname;
const rooms = new Map();
const clients = new Map();

function sendJson(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function safeRoomName(name) {
  const trimmed = String(name || "").trim();
  return trimmed.slice(0, 60) || "Family Circle";
}

function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    createdAt: room.createdAt,
    members: [...room.members.values()]
  };
}

function getRoom(id) {
  return rooms.get(id);
}

function createRoom(name) {
  const id = crypto.randomBytes(5).toString("hex");
  const room = {
    id,
    name: safeRoomName(name),
    createdAt: Date.now(),
    members: new Map()
  };
  rooms.set(id, room);
  return room;
}

function broadcast(roomId) {
  const room = getRoom(roomId);
  if (!room) return;
  const payload = `data: ${JSON.stringify({ type: "room", room: publicRoom(room) })}\n\n`;
  const roomClients = clients.get(roomId) || new Set();
  for (const res of roomClients) {
    res.write(payload);
  }
}

function serveStatic(req, res, pathname) {
  const target = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, target));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml"
    };
    res.writeHead(200, {
      "content-type": types[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "POST" && pathname === "/api/rooms") {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 10000) req.destroy();
    });
    req.on("end", () => {
      const data = body ? JSON.parse(body) : {};
      const room = createRoom(data.name);
      sendJson(res, 201, { room: publicRoom(room) });
    });
    return;
  }

  const roomMatch = pathname.match(/^\/api\/rooms\/([a-f0-9]{10})(?:\/(members|events))?$/);
  if (roomMatch) {
    const [, roomId, action] = roomMatch;
    const room = getRoom(roomId);
    if (!room) {
      sendJson(res, 404, { error: "Room not found" });
      return;
    }

    if (req.method === "GET" && !action) {
      sendJson(res, 200, { room: publicRoom(room) });
      return;
    }

    if (req.method === "GET" && action === "events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      res.write(`data: ${JSON.stringify({ type: "room", room: publicRoom(room) })}\n\n`);
      if (!clients.has(roomId)) clients.set(roomId, new Set());
      clients.get(roomId).add(res);
      req.on("close", () => {
        clients.get(roomId)?.delete(res);
      });
      return;
    }

    if (req.method === "POST" && action === "members") {
      let body = "";
      req.on("data", chunk => {
        body += chunk;
        if (body.length > 20000) req.destroy();
      });
      req.on("end", () => {
        const data = body ? JSON.parse(body) : {};
        const id = String(data.id || crypto.randomUUID());
        const now = Date.now();
        const member = {
          id,
          name: String(data.name || "Loved one").trim().slice(0, 40) || "Loved one",
          color: String(data.color || "#2563eb").slice(0, 20),
          status: ["safe", "moving", "help"].includes(data.status) ? data.status : "safe",
          message: String(data.message || "").trim().slice(0, 120),
          battery: Number.isFinite(data.battery) ? Math.max(0, Math.min(100, data.battery)) : null,
          consent: data.consent === true,
          lastSeen: now,
          location: data.location && data.consent === true ? {
            lat: Number(data.location.lat),
            lng: Number(data.location.lng),
            accuracy: Number(data.location.accuracy || 0),
            speed: Number(data.location.speed || 0),
            updatedAt: now
          } : null
        };

        if (!member.consent || !Number.isFinite(member.location?.lat) || !Number.isFinite(member.location?.lng)) {
          member.location = null;
        }

        room.members.set(id, member);
        broadcast(roomId);
        sendJson(res, 200, { member, room: publicRoom(room) });
      });
      return;
    }
  }

  serveStatic(req, res, pathname);
});

setInterval(() => {
  const cutoff = Date.now() - 1000 * 60 * 60 * 12;
  for (const [roomId, room] of rooms.entries()) {
    for (const [memberId, member] of room.members.entries()) {
      if (member.lastSeen < cutoff) room.members.delete(memberId);
    }
    if (room.createdAt < cutoff && room.members.size === 0) rooms.delete(roomId);
  }
}, 1000 * 60 * 15);

server.listen(PORT, () => {
  console.log(`CircleWatch running at http://localhost:${PORT}`);
});
