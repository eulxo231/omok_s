/**
 * Peer-to-peer online rooms (works on GitHub Pages; no game server required).
 */
const Net = (() => {
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const PEER_PREFIX = "omoks-";

  function makeCode() {
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
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

  function rematchOf(room) {
    return { black: room.rematchBlack, white: room.rematchWhite };
  }

  function snapshot(room, code, ready) {
    return {
      code,
      ready,
      game: serializeGame(room.game),
      rematch: rematchOf(room),
    };
  }

  function connect(handlers = {}) {
    let peer = null;
    let conn = null;
    let role = null;
    let code = null;
    let room = null;
    let self = null;

    function emit(msg) {
      if (handlers.onMessage) handlers.onMessage(msg);
    }

    function fail(message) {
      emit({ type: "error", message });
    }

    function send(data) {
      if (conn && conn.open) conn.send(data);
    }

    function clearRematch() {
      room.rematchBlack = false;
      room.rematchWhite = false;
    }

    function teardown() {
      const oldConn = conn;
      const oldPeer = peer;
      conn = null;
      peer = null;
      role = null;
      code = null;
      room = null;
      try {
        if (oldConn) oldConn.close();
      } catch (_) {
        /* ignore */
      }
      try {
        if (oldPeer) oldPeer.destroy();
      } catch (_) {
        /* ignore */
      }
    }

    function broadcastState(type) {
      const ready = Boolean(conn && conn.open);
      const base = snapshot(room, code, ready);
      send({ type, color: WHITE, ...base });
      emit({ type, color: BLACK, ...base });
    }

    function finishRematchIfReady() {
      if (room.rematchBlack && room.rematchWhite) {
        reset(room.game);
        clearRematch();
        broadcastState("state");
        return;
      }
      const base = snapshot(room, code, true);
      send({ type: "rematch", color: WHITE, ...base });
      emit({ type: "rematch", color: BLACK, ...base });
    }

    function attachHostConn(c) {
      if (conn && conn !== c && conn.open) {
        try {
          c.send({ type: "error", message: "Room is full." });
          c.close();
        } catch (_) {
          /* ignore */
        }
        return;
      }

      conn = c;

      c.on("data", (data) => {
        if (!data || !room) return;

        switch (data.type) {
          case "hello": {
            const readySnap = snapshot(room, code, true);
            send({ type: "welcome", color: WHITE, ...readySnap });
            emit({ type: "opponent_joined", color: BLACK, ...readySnap });
            break;
          }
          case "place": {
            if (room.game.turn !== WHITE) {
              send({ type: "error", message: "Not your turn." });
              return;
            }
            const result = placeStone(room.game, Number(data.r), Number(data.c));
            if (!result.ok) {
              send({ type: "error", message: "Invalid move." });
              return;
            }
            clearRematch();
            broadcastState("state");
            break;
          }
          case "rematch": {
            room.rematchWhite = true;
            finishRematchIfReady();
            break;
          }
          case "leave": {
            try {
              c.close();
            } catch (_) {
              /* ignore */
            }
            break;
          }
          default:
            break;
        }
      });

      c.on("close", () => {
        if (conn !== c) return;
        conn = null;
        if (!room || !code) return;
        reset(room.game);
        clearRematch();
        emit({
          type: "opponent_left",
          color: BLACK,
          ...snapshot(room, code, false),
        });
      });
    }

    function attachGuestConn(c) {
      conn = c;

      c.on("data", (data) => {
        if (!data) return;
        if (data.type === "welcome") {
          emit({ type: "joined", ...data });
          return;
        }
        if (data.type === "state" || data.type === "rematch") {
          emit({ ...data, color: WHITE });
          return;
        }
        if (data.type === "error") emit(data);
      });

      c.on("close", () => {
        if (handlers.onClose) handlers.onClose();
      });

      c.on("open", () => {
        send({ type: "hello" });
      });
    }

    function ensurePeerLib() {
      if (typeof Peer !== "undefined") return true;
      fail("Online library failed to load. Refresh and try again.");
      return false;
    }

    self = {
      create() {
        if (!ensurePeerLib()) return;
        teardown();

        code = makeCode();
        room = {
          game: createGame(),
          rematchBlack: false,
          rematchWhite: false,
        };
        role = "host";

        peer = new Peer(PEER_PREFIX + code);
        peer.on("open", () => {
          emit({
            type: "created",
            color: BLACK,
            ...snapshot(room, code, false),
          });
        });
        peer.on("connection", (c) => {
          if (c.open) attachHostConn(c);
          else c.on("open", () => attachHostConn(c));
        });
        peer.on("error", (err) => {
          if (err && err.type === "unavailable-id") {
            self.create();
            return;
          }
          fail("Could not create room. Try again.");
          if (handlers.onError) handlers.onError(err);
        });
      },

      join(rawCode) {
        if (!ensurePeerLib()) return;

        const normalized = String(rawCode || "")
          .trim()
          .toUpperCase();
        if (!/^[A-Z0-9]{4}$/.test(normalized)) {
          fail("Enter a 4-character room code.");
          return;
        }

        teardown();
        code = normalized;
        role = "guest";

        peer = new Peer();
        peer.on("open", () => {
          const c = peer.connect(PEER_PREFIX + code, { reliable: true });
          attachGuestConn(c);
          if (c.open) send({ type: "hello" });
        });
        peer.on("error", () => {
          fail("Could not join room. Check the code and try again.");
          if (handlers.onError) handlers.onError();
        });
      },

      place(r, c) {
        if (role === "host") {
          if (!room) return;
          if (room.game.turn !== BLACK) return;
          const result = placeStone(room.game, Number(r), Number(c));
          if (!result.ok) return;
          clearRematch();
          broadcastState("state");
          return;
        }
        send({ type: "place", r, c });
      },

      reset() {
        if (role === "host") {
          if (!room || !conn) return;
          room.rematchBlack = true;
          finishRematchIfReady();
          return;
        }
        send({ type: "rematch" });
      },

      leave() {
        send({ type: "leave" });
        emit({ type: "left" });
        teardown();
      },

      close() {
        teardown();
      },
    };

    return self;
  }

  return { connect };
})();
