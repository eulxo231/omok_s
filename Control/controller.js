/**
 * Controller — local play + online rooms.
 */
(function init() {
  const boardEl = document.getElementById("board");
  const statusText = document.getElementById("status-text");
  const turnStone = document.getElementById("turn-stone");
  const moveCount = document.getElementById("move-count");
  const btnUndo = document.getElementById("btn-undo");
  const btnReset = document.getElementById("btn-reset");
  const overlay = document.getElementById("overlay");
  const overlayMessage = document.getElementById("overlay-message");
  const overlayHint = document.getElementById("overlay-hint");
  const btnOverlayReset = document.getElementById("btn-overlay-reset");

  const modeLocal = document.getElementById("mode-local");
  const modeOnline = document.getElementById("mode-online");
  const onlinePanel = document.getElementById("online-panel");
  const lobby = document.getElementById("lobby");
  const lobbyError = document.getElementById("lobby-error");
  const roomInfo = document.getElementById("room-info");
  const roomCodeEl = document.getElementById("room-code");
  const roomRole = document.getElementById("room-role");
  const roomWait = document.getElementById("room-wait");
  const btnCreate = document.getElementById("btn-create");
  const btnJoin = document.getElementById("btn-join");
  const btnLeave = document.getElementById("btn-leave");
  const roomInput = document.getElementById("room-input");

  let mode = "local";
  let game = createGame();
  let myColor = null;
  let roomReady = false;
  let roomCode = null;
  let net = null;
  let lastOver = false;
  let rematch = { black: false, white: false };

  const view = BoardView.create(boardEl);
  const statusEls = { statusText, turnStone, moveCount };

  function applyRemoteGame(remote) {
    game.board = remote.board;
    game.turn = remote.turn;
    game.winner = remote.winner;
    game.winCells = remote.winCells;
    game.lastMove = remote.lastMove;
    game.moveCount = remote.moveCount;
    game.over = remote.over;
    game.history = [];
  }

  function applyRematch(next) {
    rematch = {
      black: Boolean(next && next.black),
      white: Boolean(next && next.white),
    };
  }

  function iWantRematch() {
    return myColor === BLACK ? rematch.black : rematch.white;
  }

  function opponentWantsRematch() {
    return myColor === BLACK ? rematch.white : rematch.black;
  }

  function canInteract() {
    if (mode === "local") return true;
    return roomReady && !game.over && myColor === game.turn;
  }

  function updateRematchUi() {
    if (mode !== "online") {
      overlayHint.textContent = "";
      btnOverlayReset.disabled = false;
      btnOverlayReset.textContent = "Play again";
      btnReset.textContent = "New game";
      btnReset.disabled = false;
      return;
    }

    const mine = iWantRematch();
    const theirs = opponentWantsRematch();

    if (game.over) {
      if (mine && !theirs) {
        overlayHint.textContent = "Waiting for opponent to agree…";
        btnOverlayReset.disabled = true;
        btnOverlayReset.textContent = "Waiting…";
      } else if (!mine && theirs) {
        overlayHint.textContent = "Opponent wants to play again";
        btnOverlayReset.disabled = false;
        btnOverlayReset.textContent = "Play again";
      } else {
        overlayHint.textContent = "Both players must agree";
        btnOverlayReset.disabled = false;
        btnOverlayReset.textContent = "Play again";
      }
    } else {
      overlayHint.textContent = "";
      btnOverlayReset.disabled = false;
      btnOverlayReset.textContent = "Play again";
    }

    if (!roomReady) {
      btnReset.disabled = true;
      btnReset.textContent = "New game";
      return;
    }

    if (mine && !theirs) {
      btnReset.disabled = true;
      btnReset.textContent = "Waiting…";
    } else if (!mine && theirs) {
      btnReset.disabled = false;
      btnReset.textContent = "Agree to restart";
    } else {
      btnReset.disabled = false;
      btnReset.textContent = "New game";
    }
  }

  function refresh() {
    BoardView.render(view, game, { interactive: canInteract() });

    if (mode === "online") {
      BoardView.updateStatus(statusEls, game, {
        waiting: Boolean(roomCode) && !roomReady,
        yourTurn: roomReady ? myColor === game.turn : undefined,
      });
      btnUndo.disabled = true;
    } else {
      BoardView.updateStatus(statusEls, game);
      btnUndo.disabled = game.history.length === 0;
    }

    if (game.over && !lastOver) {
      if (game.winner === BLACK) {
        BoardView.showOverlay(overlay, overlayMessage, "Black wins!");
      } else if (game.winner === WHITE) {
        BoardView.showOverlay(overlay, overlayMessage, "White wins!");
      } else {
        BoardView.showOverlay(overlay, overlayMessage, "Draw");
      }
    }
    if (!game.over) {
      BoardView.hideOverlay(overlay);
    }
    lastOver = game.over;
    updateRematchUi();
  }

  function setLobbyError(msg) {
    lobbyError.textContent = msg || "";
  }

  function showLobby() {
    lobby.classList.remove("hidden");
    roomInfo.classList.add("hidden");
    roomCode = null;
    myColor = null;
    roomReady = false;
    applyRematch(null);
    setLobbyError("");
  }

  function showRoom(code, color, ready) {
    lobby.classList.add("hidden");
    roomInfo.classList.remove("hidden");
    roomCode = code;
    myColor = color;
    roomReady = ready;
    roomCodeEl.textContent = code;
    roomRole.textContent = color === BLACK ? "You are Black" : "You are White";
    roomWait.classList.toggle("hidden", ready);
    roomWait.textContent = ready ? "" : "Waiting for opponent…";
  }

  function ensureNet() {
    if (net) return net;
    net = Net.connect({
      onMessage(msg) {
        handleNetMessage(msg);
      },
      onClose() {
        if (mode === "online" && roomCode) {
          setLobbyError("Opponent disconnected.");
          showLobby();
          game = createGame();
          lastOver = false;
          refresh();
        }
        if (net) {
          net.close();
          net = null;
        }
      },
      onError() {
        // Specific errors are sent as { type: "error", message }
      },
    });
    return net;
  }

  function handleNetMessage(msg) {
    switch (msg.type) {
      case "created":
      case "joined":
      case "opponent_joined":
      case "state":
      case "rematch":
      case "opponent_left": {
        if (msg.color != null) myColor = msg.color;
        applyRemoteGame(msg.game);
        applyRematch(msg.rematch);
        showRoom(msg.code, myColor, msg.ready);
        if (msg.type === "opponent_left") {
          roomWait.classList.remove("hidden");
          roomWait.textContent = "Opponent left — waiting for a new player…";
          lastOver = false;
        }
        if (msg.type === "created" || msg.type === "joined") {
          setLobbyError("");
          lastOver = false;
        }
        refresh();
        break;
      }
      case "left":
        showLobby();
        game = createGame();
        lastOver = false;
        refresh();
        break;
      case "error":
        setLobbyError(msg.message || "Something went wrong.");
        break;
      default:
        break;
    }
  }

  function leaveOnline() {
    if (net) net.leave();
    showLobby();
    game = createGame();
    lastOver = false;
    refresh();
  }

  function setMode(next) {
    if (next === mode) return;
    if (mode === "online") {
      if (net && roomCode) net.leave();
      showLobby();
    }

    mode = next;
    modeLocal.classList.toggle("active", mode === "local");
    modeOnline.classList.toggle("active", mode === "online");
    modeLocal.setAttribute("aria-selected", mode === "local" ? "true" : "false");
    modeOnline.setAttribute("aria-selected", mode === "online" ? "true" : "false");
    onlinePanel.classList.toggle("hidden", mode !== "online");

    game = createGame();
    applyRematch(null);
    lastOver = false;
    BoardView.hideOverlay(overlay);

    if (mode === "online") {
      showLobby();
    }

    refresh();
  }

  function onPlace(r, c) {
    if (!canInteract()) return;

    if (mode === "online") {
      ensureNet().place(r, c);
      return;
    }

    const result = placeStone(game, r, c);
    if (!result.ok) return;
    refresh();
  }

  function onReset() {
    if (mode === "online") {
      if (!roomReady || iWantRematch()) return;
      ensureNet().reset();
      return;
    }
    reset(game);
    lastOver = false;
    BoardView.hideOverlay(overlay);
    refresh();
  }

  function onUndo() {
    if (mode !== "local") return;
    if (!undo(game)) return;
    lastOver = false;
    BoardView.hideOverlay(overlay);
    refresh();
  }

  boardEl.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell || !boardEl.contains(cell)) return;
    onPlace(Number(cell.dataset.r), Number(cell.dataset.c));
  });

  btnUndo.addEventListener("click", onUndo);
  btnReset.addEventListener("click", onReset);
  btnOverlayReset.addEventListener("click", onReset);

  modeLocal.addEventListener("click", () => setMode("local"));
  modeOnline.addEventListener("click", () => setMode("online"));

  btnCreate.addEventListener("click", () => {
    setLobbyError("");
    ensureNet().create();
  });

  btnJoin.addEventListener("click", () => {
    setLobbyError("");
    const code = roomInput.value.trim();
    if (!code) {
      setLobbyError("Enter a 4-character room code.");
      return;
    }
    btnJoin.disabled = true;
    ensureNet().join(code);
    setTimeout(() => {
      btnJoin.disabled = false;
    }, 1500);
  });

  roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      btnJoin.click();
    }
  });

  roomInput.addEventListener("input", () => {
    roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  btnLeave.addEventListener("click", leaveOnline);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) BoardView.hideOverlay(overlay);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") BoardView.hideOverlay(overlay);
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      onUndo();
    }
  });

  refresh();
})();
