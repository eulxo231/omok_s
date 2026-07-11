/**
 * Omok game model — 15×15 board, free-style five-in-a-row.
 */
const BOARD_SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

function createBoard() {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(EMPTY)
  );
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function inBounds(r, c) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

function countLine(board, r, c, dr, dc, color) {
  let n = 0;
  let rr = r + dr;
  let cc = c + dc;
  while (inBounds(rr, cc) && board[rr][cc] === color) {
    n += 1;
    rr += dr;
    cc += dc;
  }
  return n;
}

function winningLine(board, r, c, color) {
  for (const [dr, dc] of DIRS) {
    const forward = countLine(board, r, c, dr, dc, color);
    const backward = countLine(board, r, c, -dr, -dc, color);
    if (forward + backward + 1 >= 5) {
      const cells = [{ r, c }];
      let rr = r + dr;
      let cc = c + dc;
      for (let i = 0; i < forward; i++) {
        cells.push({ r: rr, c: cc });
        rr += dr;
        cc += dc;
      }
      rr = r - dr;
      cc = c - dc;
      for (let i = 0; i < backward; i++) {
        cells.push({ r: rr, c: cc });
        rr -= dr;
        cc -= dc;
      }
      return cells;
    }
  }
  return null;
}

function isBoardFull(board) {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === EMPTY) return false;
    }
  }
  return true;
}

function createGame() {
  return {
    board: createBoard(),
    turn: BLACK,
    winner: null,
    winCells: null,
    lastMove: null,
    moveCount: 0,
    history: [],
    over: false,
  };
}

function placeStone(game, r, c) {
  if (game.over) return { ok: false, reason: "game-over" };
  if (!inBounds(r, c)) return { ok: false, reason: "oob" };
  if (game.board[r][c] !== EMPTY) return { ok: false, reason: "occupied" };

  const color = game.turn;
  game.board[r][c] = color;
  game.lastMove = { r, c, color };
  game.moveCount += 1;
  game.history.push({ r, c, color });

  const line = winningLine(game.board, r, c, color);
  if (line) {
    game.winner = color;
    game.winCells = line;
    game.over = true;
    return { ok: true, win: true, color, line };
  }

  if (isBoardFull(game.board)) {
    game.over = true;
    game.winner = null;
    return { ok: true, draw: true };
  }

  game.turn = color === BLACK ? WHITE : BLACK;
  return { ok: true, win: false };
}

function undo(game) {
  if (game.history.length === 0) return false;
  const last = game.history.pop();
  game.board[last.r][last.c] = EMPTY;
  game.moveCount -= 1;
  game.winner = null;
  game.winCells = null;
  game.over = false;
  game.turn = last.color;
  game.lastMove =
    game.history.length > 0
      ? { ...game.history[game.history.length - 1] }
      : null;
  return true;
}

function reset(game) {
  Object.assign(game, createGame());
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BOARD_SIZE,
    EMPTY,
    BLACK,
    WHITE,
    createGame,
    placeStone,
    undo,
    reset,
    cloneBoard,
  };
}
