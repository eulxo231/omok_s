const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const {
  BLACK,
  WHITE,
  createGame,
  placeStone,
  reset,
} = require("./Model/game");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** @type {Map<string, Room>} */
const rooms = new Map();

/**
 * @typedef {object} Room
 * @property {string} code
 * @property {import("ws").WebSocket | null} black
 * @property {import("ws").WebSocket | null} white
 * @property {ReturnType<typeof createGame>} game
 * @property {boolean} rematchBlack
 * @property {boolean} rematchWhite
 */

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(body);
}

function wsSend(ws, payload) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function serializeGame(game) {
  return {
    board: game.board,
    turn: game.turn,
    winner: game.winner,
    winCells: game.winCells,
    lastMove: game.lastMove,
    moveCount: game.moveCount,
    over: game.over,
  };
}

function makeCode() {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function uniqueCode() {
  let code = makeCode();
  let tries = 0;
  while (rooms.has(code) && tries < 50) {
    code = makeCode();
    tries += 1;
  }
  return code;
}

function roomPlayers(room) {
  return [room.black, room.white].filter(Boolean);
}

function broadcast(room, payload) {
  for (const ws of roomPlayers(room)) {
    wsSend(ws, payload);
  }
}

function roomReady(room) {
  return Boolean(room.black && room.white);
}

function clearRematch(room) {
  room.rematchBlack = false;
  room.rematchWhite = false;
}

function publicRoomState(room) {
  return {
    code: room.code,
    ready: roomReady(room),
    game: serializeGame(room.game),
    rematch: {
      black: room.rematchBlack,
      white: room.rematchWhite,
    },
  };
}

function detachSocket(ws) {
  const { roomCode, color } = ws;
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  if (!room) return;

  if (color === BLACK && room.black === ws) room.black = null;
  if (color === WHITE && room.white === ws) room.white = null;

  ws.roomCode = null;
  ws.color = null;

  if (!room.black && !room.white) {
    rooms.delete(roomCode);
    return;
  }

  reset(room.game);
  clearRematch(room);
  broadcast(room, {
    type: "opponent_left",
    color: room.black ? BLACK : WHITE,
    ...publicRoomState(room),
  });
}

function createRoom(ws) {
  detachSocket(ws);
  const code = uniqueCode();
  const room = {
    code,
    black: ws,
    white: null,
    game: createGame(),
    rematchBlack: false,
    rematchWhite: false,
  };
  rooms.set(code, room);
  ws.roomCode = code;
  ws.color = BLACK;
  wsSend(ws, {
    type: "created",
    color: BLACK,
    ...publicRoomState(room),
  });
}

function joinRoom(ws, rawCode) {
  const code = String(rawCode || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) {
    wsSend(ws, { type: "error", message: "Enter a 4-character room code." });
    return;
  }
  const room = rooms.get(code);
  if (!room) {
    wsSend(ws, { type: "error", message: "Room not found." });
    return;
  }
  if (room.white) {
    wsSend(ws, { type: "error", message: "Room is full." });
    return;
  }
  if (room.black === ws) {
    wsSend(ws, { type: "error", message: "You are already in this room." });
    return;
  }

  detachSocket(ws);
  room.white = ws;
  ws.roomCode = code;
  ws.color = WHITE;

  wsSend(ws, {
    type: "joined",
    color: WHITE,
    ...publicRoomState(room),
  });
  if (room.black) {
    wsSend(room.black, {
      type: "opponent_joined",
      color: BLACK,
      ...publicRoomState(room),
    });
  }
}

function handlePlace(ws, r, c) {
  const room = rooms.get(ws.roomCode);
  if (!room) {
    wsSend(ws, { type: "error", message: "Not in a room." });
    return;
  }
  if (!roomReady(room)) {
    wsSend(ws, { type: "error", message: "Waiting for opponent." });
    return;
  }
  if (ws.color !== room.game.turn) {
    wsSend(ws, { type: "error", message: "Not your turn." });
    return;
  }

  const result = placeStone(room.game, Number(r), Number(c));
  if (!result.ok) {
    wsSend(ws, { type: "error", message: "Invalid move." });
    return;
  }

  clearRematch(room);
  broadcast(room, {
    type: "state",
    ...publicRoomState(room),
  });
}

function handleRematch(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) {
    wsSend(ws, { type: "error", message: "Not in a room." });
    return;
  }
  if (!roomReady(room)) {
    wsSend(ws, { type: "error", message: "Waiting for opponent." });
    return;
  }

  if (ws.color === BLACK) room.rematchBlack = true;
  else if (ws.color === WHITE) room.rematchWhite = true;
  else return;

  if (room.rematchBlack && room.rematchWhite) {
    reset(room.game);
    clearRematch(room);
    broadcast(room, {
      type: "state",
      ...publicRoomState(room),
    });
    return;
  }

  broadcast(room, {
    type: "rematch",
    ...publicRoomState(room),
  });
}

function handleLeave(ws) {
  detachSocket(ws);
  wsSend(ws, { type: "left" });
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  // Match GitHub Pages project paths locally (/omok_s/...)
  if (urlPath === "/omok_s" || urlPath === "/omok_s/") {
    urlPath = "/";
  } else if (urlPath.startsWith("/omok_s/")) {
    urlPath = urlPath.slice("/omok_s".length);
  }

  let filePath = urlPath === "/" ? "/index.html" : urlPath;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const abs = path.join(ROOT, filePath);

  if (!abs.startsWith(ROOT)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(abs, (err, data) => {
    if (err) {
      send(res, 404, "Not found");
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    send(res, 200, data, MIME[ext] || "application/octet-stream");
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.roomCode = null;
  ws.color = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      wsSend(ws, { type: "error", message: "Bad message." });
      return;
    }

    switch (msg.type) {
      case "create":
        createRoom(ws);
        break;
      case "join":
        joinRoom(ws, msg.code);
        break;
      case "place":
        handlePlace(ws, msg.r, msg.c);
        break;
      case "reset":
      case "rematch":
        handleRematch(ws);
        break;
      case "leave":
        handleLeave(ws);
        break;
      default:
        wsSend(ws, { type: "error", message: "Unknown action." });
    }
  });

  ws.on("close", () => detachSocket(ws));
});

server.listen(PORT, () => {
  console.log(`Omok server running at http://localhost:${PORT}`);
});
