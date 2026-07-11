/**
 * Board view — renders the 15×15 grid and UI chrome.
 */
const BoardView = (() => {
  const STAR_POINTS = [
    [3, 3],
    [3, 11],
    [7, 7],
    [11, 3],
    [11, 11],
  ];

  function colorName(color) {
    if (color === BLACK) return "black";
    if (color === WHITE) return "white";
    return "";
  }

  function create(boardEl) {
    const cells = [];
    boardEl.innerHTML = "";

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cell";
        btn.dataset.r = String(r);
        btn.dataset.c = String(c);
        btn.setAttribute("role", "gridcell");
        btn.setAttribute("aria-label", `Row ${r + 1}, column ${c + 1}`);
        boardEl.appendChild(btn);
        cells.push(btn);
      }
    }

    for (const [sr, sc] of STAR_POINTS) {
      const star = document.createElement("span");
      star.className = "star";
      star.setAttribute("aria-hidden", "true");
      const cell = cells[sr * BOARD_SIZE + sc];
      cell.appendChild(star);
    }

    return { boardEl, cells };
  }

  /**
   * @param {object} view
   * @param {object} game
   * @param {{ interactive?: boolean }} [opts]
   */
  function render(view, game, opts = {}) {
    const interactive = opts.interactive !== false;
    const winSet = new Set(
      (game.winCells || []).map(({ r, c }) => `${r},${c}`)
    );
    const last = game.lastMove;

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = view.cells[r * BOARD_SIZE + c];
        const val = game.board[r][c];
        const existing = cell.querySelector(".stone");
        if (existing) existing.remove();

        if (val !== EMPTY) {
          const stone = document.createElement("span");
          stone.className = `stone ${colorName(val)}`;
          if (last && last.r === r && last.c === c) {
            stone.classList.add("last");
          }
          if (winSet.has(`${r},${c}`)) {
            stone.classList.add("win");
          }
          cell.appendChild(stone);
        }

        cell.disabled = !interactive || game.over || val !== EMPTY;
      }
    }
  }

  function updateStatus(els, game, extras = {}) {
    const { statusText, turnStone, moveCount } = els;

    if (extras.waiting) {
      statusText.textContent = "Waiting for opponent";
      turnStone.dataset.color = colorName(game.turn);
    } else if (game.over) {
      if (game.winner === BLACK) {
        statusText.textContent = "Black wins";
        turnStone.dataset.color = "black";
      } else if (game.winner === WHITE) {
        statusText.textContent = "White wins";
        turnStone.dataset.color = "white";
      } else {
        statusText.textContent = "Draw";
      }
    } else if (extras.yourTurn === true) {
      statusText.textContent = "Your turn";
      turnStone.dataset.color = colorName(game.turn);
    } else if (extras.yourTurn === false) {
      statusText.textContent = "Opponent's turn";
      turnStone.dataset.color = colorName(game.turn);
    } else {
      const name = game.turn === BLACK ? "Black" : "White";
      statusText.textContent = `${name} to move`;
      turnStone.dataset.color = colorName(game.turn);
    }

    moveCount.textContent = `Moves: ${game.moveCount}`;
  }

  function showOverlay(overlay, messageEl, message) {
    messageEl.textContent = message;
    overlay.classList.remove("hidden");
  }

  function hideOverlay(overlay) {
    overlay.classList.add("hidden");
  }

  return {
    create,
    render,
    updateStatus,
    showOverlay,
    hideOverlay,
    colorName,
  };
})();
