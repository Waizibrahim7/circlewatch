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
const MEMBER_TTL_MS = 1000 * 60 * 60 * 24;
const EMPTY_ROOM_TTL_MS = 1000 * 60 * 60 * 24 * 7;

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

function roomKeyFrom(url, req) {
  return url.searchParams.get("key") || req.headers["x-room-key"] || "";
}

function authorized(room, url, req) {
  const stored = Buffer.from(String(room.key || ""));
  const provided = Buffer.from(String(roomKeyFrom(url, req)));
  return stored.length === provided.length && crypto.timingSafeEqual(stored, provided);
}

function createRoom(name) {
  const id = crypto.randomBytes(5).toString("hex");
  const key = crypto.randomBytes(18).toString("base64url");
  const room = {
    id,
    key,
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
      sendJson(res, 201, { room: publicRoom(room), key: room.key });
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
    if (!authorized(room, url, req)) {
      sendJson(res, 403, { error: "Private invite key required" });
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
        const existing = room.members.get(id);
        const incomingLocation = data.location ? {
          lat: Number(data.location.lat),
          lng: Number(data.location.lng),
          accuracy: Number(data.location.accuracy || 0),
          speed: Number(data.location.speed || 0),
          updatedAt: now,
          live: data.liveSharing === true
        } : null;
        const hasValidLocation = Number.isFinite(incomingLocation?.lat) && Number.isFinite(incomingLocation?.lng);
        const location = data.hideLocation === true
          ? null
          : hasValidLocation && data.consent === true
            ? incomingLocation
            : data.keepLastLocation === true && existing?.location
              ? { ...existing.location, live: false }
              : null;
        const member = {
          id,
          name: String(data.name || "Loved one").trim().slice(0, 40) || "Loved one",
          color: String(data.color || "#2563eb").slice(0, 20),
          status: ["safe", "moving", "help"].includes(data.status) ? data.status : "safe",
          message: String(data.message || "").trim().slice(0, 120),
          battery: Number.isFinite(data.battery) ? Math.max(0, Math.min(100, data.battery)) : null,
          consent: data.consent === true,
          liveSharing: data.liveSharing === true,
          lastSeen: now,
          location
        };

        if (member.location && (!Number.isFinite(member.location.lat) || !Number.isFinite(member.location.lng))) {
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
  const memberCutoff = Date.now() - MEMBER_TTL_MS;
  const roomCutoff = Date.now() - EMPTY_ROOM_TTL_MS;
  for (const [roomId, room] of rooms.entries()) {
    for (const [memberId, member] of room.members.entries()) {
      if (member.lastSeen < memberCutoff) room.members.delete(memberId);
    }
    if (room.createdAt < roomCutoff && room.members.size === 0) rooms.delete(roomId);
  }
}, 1000 * 60 * 15);

server.listen(PORT, () => {
  console.log(`CircleWatch running at http://localhost:${PORT}`);
});
