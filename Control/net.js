/**
 * Online rooms over a public MQTT broker (works on GitHub Pages).
 */
const Net = (() => {
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const BROKER = "wss://broker.emqx.io:8084/mqtt";
  const TOPIC_PREFIX = "omok_s/v1/";

  function makeCode() {
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
  }

  function makeId() {
    return "omok-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
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
    let client = null;
    let clientId = null;
    let role = null;
    let code = null;
    let topic = null;
    let room = null;
    let ready = false;
    let busy = false;
    let greeted = false;
    let joinTimer = null;

    function emit(msg) {
      if (handlers.onMessage) handlers.onMessage(msg);
    }

    function fail(message) {
      busy = false;
      emit({ type: "error", message });
    }

    function clearJoinTimer() {
      if (joinTimer) {
        clearTimeout(joinTimer);
        joinTimer = null;
      }
    }

    function publish(payload, opts) {
      if (!client || !topic || !client.connected) return;
      client.publish(topic, JSON.stringify(payload), opts || { qos: 0 });
    }

    function clearRetain() {
      if (!client || !topic) return;
      try {
        client.publish(topic, "", { retain: true, qos: 0 });
      } catch (_) {
        /* ignore */
      }
    }

    function clearRematch() {
      room.rematchBlack = false;
      room.rematchWhite = false;
    }

    function teardown() {
      clearJoinTimer();
      busy = false;
      greeted = false;
      const old = client;
      client = null;
      clientId = null;
      role = null;
      code = null;
      topic = null;
      room = null;
      ready = false;
      if (old) {
        try {
          old.end(true);
        } catch (_) {
          /* ignore */
        }
      }
    }

    function broadcastState(type) {
      const base = snapshot(room, code, ready);
      publish({ type, from: clientId, ...base });
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
      publish({ type: "rematch", from: clientId, ...base });
      emit({ type: "rematch", color: BLACK, ...base });
    }

    function onHostMessage(msg) {
      if (!msg || msg.from === clientId) return;

      switch (msg.type) {
        case "hello": {
          if (ready) {
            publish({
              type: "error",
              from: clientId,
              to: msg.from,
              message: "Room is full.",
            });
            return;
          }
          ready = true;
          const base = snapshot(room, code, true);
          publish({
            type: "welcome",
            from: clientId,
            to: msg.from,
            color: WHITE,
            ...base,
          });
          emit({ type: "opponent_joined", color: BLACK, ...base });
          break;
        }
        case "place": {
          if (!ready) return;
          if (room.game.turn !== WHITE) {
            publish({
              type: "error",
              from: clientId,
              to: msg.from,
              message: "Not your turn.",
            });
            return;
          }
          const result = placeStone(room.game, Number(msg.r), Number(msg.c));
          if (!result.ok) {
            publish({
              type: "error",
              from: clientId,
              to: msg.from,
              message: "Invalid move.",
            });
            return;
          }
          clearRematch();
          broadcastState("state");
          break;
        }
        case "rematch": {
          if (!ready) return;
          room.rematchWhite = true;
          finishRematchIfReady();
          break;
        }
        case "leave":
        case "peer_gone": {
          if (!ready) return;
          ready = false;
          reset(room.game);
          clearRematch();
          emit({
            type: "opponent_left",
            color: BLACK,
            ...snapshot(room, code, false),
          });
          break;
        }
        default:
          break;
      }
    }

    function onGuestMessage(msg) {
      if (!msg || msg.from === clientId) return;
      if (msg.to && msg.to !== clientId) return;

      switch (msg.type) {
        case "host_ready": {
          if (!greeted && !ready) {
            greeted = true;
            publish({ type: "hello", from: clientId });
          }
          break;
        }
        case "welcome": {
          clearJoinTimer();
          busy = false;
          ready = true;
          emit({ type: "joined", color: WHITE, ...msg });
          break;
        }
        case "state":
        case "rematch": {
          emit({ ...msg, color: WHITE });
          break;
        }
        case "leave":
        case "peer_gone": {
          if (handlers.onClose) handlers.onClose();
          break;
        }
        case "error": {
          busy = false;
          clearJoinTimer();
          emit({ type: "error", message: msg.message || "Something went wrong." });
          break;
        }
        default:
          break;
      }
    }

    function handleMessage(raw) {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (role === "host") onHostMessage(msg);
      else if (role === "guest") onGuestMessage(msg);
    }

    function ensureMqtt() {
      if (typeof mqtt !== "undefined") return true;
      fail("Online library failed to load. Refresh and try again.");
      return false;
    }

    function startClient(willRole) {
      clientId = makeId();
      client = mqtt.connect(BROKER, {
        clientId,
        clean: true,
        reconnectPeriod: 0,
        connectTimeout: 12000,
        will: {
          topic,
          payload: JSON.stringify({
            type: "peer_gone",
            from: clientId,
            role: willRole,
          }),
          qos: 0,
          retain: false,
        },
      });

      client.on("message", (_t, payload) => handleMessage(payload));
      client.on("error", () => {
        /* connect handler / timeout covers user-facing errors */
      });
    }

    return {
      create() {
        if (!ensureMqtt()) return;
        if (busy) return;
        teardown();
        busy = true;

        code = makeCode();
        topic = TOPIC_PREFIX + code;
        room = {
          game: createGame(),
          rematchBlack: false,
          rematchWhite: false,
        };
        role = "host";
        ready = false;

        startClient("host");

        const createTimer = setTimeout(() => {
          if (busy && role === "host") {
            fail("Could not create room. Try again.");
            teardown();
          }
        }, 12000);

        client.on("connect", () => {
          clearTimeout(createTimer);
          client.subscribe(topic, { qos: 0 }, (err) => {
            if (err) {
              fail("Could not create room. Try again.");
              teardown();
              return;
            }
            publish(
              { type: "host_ready", from: clientId },
              { retain: true, qos: 0 }
            );
            busy = false;
            emit({
              type: "created",
              color: BLACK,
              ...snapshot(room, code, false),
            });
          });
        });
      },

      join(rawCode) {
        if (!ensureMqtt()) return;
        if (busy) return;

        const normalized = String(rawCode || "")
          .trim()
          .toUpperCase();
        if (!/^[A-Z0-9]{4}$/.test(normalized)) {
          fail("Enter a 4-character room code.");
          return;
        }

        teardown();
        busy = true;
        greeted = false;
        code = normalized;
        topic = TOPIC_PREFIX + code;
        role = "guest";
        ready = false;
        room = null;

        startClient("guest");

        const joinConnectTimer = setTimeout(() => {
          if (busy && !ready && role === "guest") {
            fail("Could not join room. Try again.");
            teardown();
          }
        }, 12000);

        client.on("connect", () => {
          clearTimeout(joinConnectTimer);
          client.subscribe(topic, { qos: 0 }, (err) => {
            if (err) {
              fail("Could not join room. Try again.");
              teardown();
              return;
            }
            joinTimer = setTimeout(() => {
              if (!ready) {
                fail("Room not found. Check the code and try again.");
                teardown();
              }
            }, 6000);
          });
        });
      },

      place(r, c) {
        if (role === "host") {
          if (!room || !ready) return;
          if (room.game.turn !== BLACK) return;
          const result = placeStone(room.game, Number(r), Number(c));
          if (!result.ok) return;
          clearRematch();
          broadcastState("state");
          return;
        }
        publish({ type: "place", from: clientId, r, c });
      },

      reset() {
        if (role === "host") {
          if (!room || !ready) return;
          room.rematchBlack = true;
          finishRematchIfReady();
          return;
        }
        publish({ type: "rematch", from: clientId });
      },

      leave() {
        if (client && topic && client.connected) {
          publish({ type: "leave", from: clientId, role });
          if (role === "host") clearRetain();
        }
        emit({ type: "left" });
        teardown();
      },

      close() {
        teardown();
      },
    };
  }

  return { connect };
})();
