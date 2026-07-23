const BOARD_SIZE = 8;
const EMPTY = 0, BLACK = 1, WHITE = -1;
let board = [];
let currentPlayer = BLACK;
let gameMode = 'pvp';
let aiLevel = 1;
let isProcessing = false;

// オンライン通信用変数
let peer = null;
let conn = null;
let myRole = BLACK;
let isAwaitingAck = false;

const ROOM_PREFIX = "othello-app-room-";

// リアルタイムアナライザー用変数
let analysisTimer = null;
let currentSearchDepth = 1;
let currentBestPV = []; // Principal Variation（読み筋）
let predictedFinalScore = { black: 32, white: 32 };

const COORD_NAMES = [
  ['A1','B1','C1','D1','E1','F1','G1','H1'],
  ['A2','B2','C2','D2','E2','F2','G2','H2'],
  ['A3','B3','C3','D3','E3','F3','G3','H3'],
  ['A4','B4','C4','D4','E4','F4','G4','H4'],
  ['A5','B5','C5','D5','E5','F5','G5','H5'],
  ['A6','B6','C6','D6','E6','F6','G6','H6'],
  ['A7','B7','C7','D7','E7','F7','G7','H7'],
  ['A8','B8','C8','D8','E8','F8','G8','H8']
];

const WEIGHTS = [
  [ 120, -30,  20,   5,   5,  20, -30, 120],
  [-30,  -50,  -5,  -5,  -5,  -5, -50, -30],
  [  20,  -5,  15,   3,   3,  15,  -5,  20],
  [   5,  -5,   3,   3,   3,   3,  -5,   5],
  [   5,  -5,   3,   3,   3,   3,  -5,   5],
  [  20,  -5,  15,   3,   3,  15,  -5,  20],
  [-30,  -50,  -5,  -5,  -5,  -5, -50, -30],
  [ 120, -30,  20,   5,   5,  20, -30, 120]
];

const directions = [
  [-1,-1], [-1,0], [-1,1],
  [ 0,-1],         [ 0,1],
  [ 1,-1], [ 1,0], [ 1,1]
];

const N = {
  E4: 329.63, Fs4: 369.99, Gs4: 415.30, A4: 440.00, B4: 493.88,
  Cs5: 554.37, Ds5: 622.25, E5: 659.25, Fs5: 739.99, Gs5: 830.61,
  _ : 0
};

let audioCtx = null;
let bgmGainNode = null;
let seGainNode = null;
let bgmTimer = null;
let currentBgmType = 'pop';
let bgmStep = 0;

const BGM_DATA = {
  'pop': {
    type: 'sine', tempo: 250,
    notes: [261.63, 329.63, 392.00, 523.25, 392.00, 329.63, 293.66, 349.23, 392.00, 587.33, 392.00, 349.23]
  },
  'ambient': {
    type: 'triangle', tempo: 400,
    notes: [220.00, 261.63, 329.63, 440.00, 329.63, 261.63, 196.00, 246.94, 293.66, 392.00, 293.66, 246.94]
  },
  '8bit': {
    type: 'square', tempo: 150,
    notes: [N.E5, N._, N.E5, N.Fs5, N.Gs5, N.Fs5, N.E5, N.Ds5, N.Cs5, N._, N.B4]
  }
};

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    bgmGainNode = audioCtx.createGain();
    seGainNode = audioCtx.createGain();
    bgmGainNode.connect(audioCtx.destination);
    seGainNode.connect(audioCtx.destination);
    updateVolume();
    startBGM();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function updateVolume() {
  const bgmVol = document.getElementById('bgm-volume').value;
  const seVol = document.getElementById('se-volume').value;
  document.getElementById('bgm-val').innerText = bgmVol;
  document.getElementById('se-val').innerText = seVol;

  if (bgmGainNode) bgmGainNode.gain.value = (bgmVol / 100) * 0.15;
  if (seGainNode) seGainNode.gain.value = (seVol / 100) * 0.3;
}

function changeBGMType(type) {
  currentBgmType = type;
  bgmStep = 0;
  startBGM();
}

function playSE(type) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(seGainNode);
  const now = audioCtx.currentTime;

  if (type === 'place') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);
    gain.gain.setValueAtTime(1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    osc.start(now); osc.stop(now + 0.08);
  } else if (type === 'pass') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(330, now + 0.1);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.25);
    osc.start(now); osc.stop(now + 0.25);
  } else if (type === 'win') {
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g); o.connect(seGainNode);
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.3, now + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3);
      o.start(now + i * 0.12); o.stop(now + i * 0.12 + 0.3);
    });
  }
}

function startBGM() {
  if (bgmTimer) clearInterval(bgmTimer);
  const bgm = BGM_DATA[currentBgmType];

  bgmTimer = setInterval(() => {
    if (!audioCtx || bgmGainNode.gain.value === 0) return;
    const freq = bgm.notes[bgmStep % bgm.notes.length];
    if (freq > 0) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = bgm.type;
      osc.frequency.value = freq;
      const now = audioCtx.currentTime;
      const noteLen = (bgm.tempo / 1000) * 0.85;
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + noteLen);
      osc.connect(gain); gain.connect(bgmGainNode);
      osc.start(now); osc.stop(now + noteLen);
    }
    bgmStep++;
  }, bgm.tempo);
}

function showBanner(text, duration = 1500) {
  const banner = document.getElementById('message-banner');
  banner.innerText = text;
  banner.classList.add('show');
  setTimeout(() => banner.classList.remove('show'), duration);
}

function showScreen(screenId) {
  initAudio();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

function showDifficultySelect() { showScreen('difficulty-screen'); }
function changeBgColor(color) { document.documentElement.style.setProperty('--bg-color', color); }

function startGame(mode, level = 1) {
  gameMode = mode;
  aiLevel = level;

  document.getElementById('reset-btn').style.display = (mode === 'online') ? 'none' : 'inline-block';
  document.getElementById('leave-online-btn').style.display = (mode === 'online') ? 'inline-block' : 'none';
  document.getElementById('menu-btn').style.display = (mode === 'online') ? 'none' : 'inline-block';

  showScreen('game-screen');
  initGame();
}

function initGame() {
  board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(EMPTY));
  board[3][3] = WHITE; board[3][4] = BLACK;
  board[4][3] = BLACK; board[4][4] = WHITE;
  
  currentPlayer = BLACK;
  isProcessing = false;
  isAwaitingAck = false;
  currentSearchDepth = 1;
  currentBestPV = [];

  setSyncOverlay(false);
  document.getElementById('thinking-badge').style.display = 'none';
  renderBoard();
  updateStatus();

  // 毎秒アナライザーをリアルタイム更新するループを開始
  startRealtimeAnalyzer();
}

// --- オンライン通信処理（PeerJS） ---

function getRoomNumber() {
  const num = document.getElementById('room-number').value;
  if (!num || num.length !== 4 || isNaN(num)) {
    alert("4桁の数字を入力してください（例: 1234）");
    return null;
  }
  return num;
}

function setOnlineStatus(msg) {
  document.getElementById('online-status').innerText = msg;
}

function createRoom() {
  const num = getRoomNumber();
  if (!num) return;
  setOnlineStatus("部屋を作成中...");
  document.getElementById('cancel-online-btn').style.display = 'inline-block';

  if (peer) peer.destroy();
  peer = new Peer(ROOM_PREFIX + num);

  peer.on('open', () => {
    myRole = BLACK;
    setOnlineStatus(`部屋 ${num} を作成しました。対戦相手を待っています...`);
  });

  peer.on('connection', (c) => {
    conn = c;
    setupConnection();
    document.getElementById('cancel-online-btn').style.display = 'none';
    startGame('online');
    showBanner("対戦相手が接続しました！");
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      alert("そのルームナンバーは既に使用されています。別の番号をお試しください。");
    } else {
      alert("エラーが発生しました: " + err.type);
    }
    cancelOnlineWaiting();
  });
}

function joinRoom() {
  const num = getRoomNumber();
  if (!num) return;
  setOnlineStatus("部屋に接続中...");
  document.getElementById('cancel-online-btn').style.display = 'inline-block';

  if (peer) peer.destroy();
  peer = new Peer();

  peer.on('open', () => {
    myRole = WHITE;
    conn = peer.connect(ROOM_PREFIX + num);
    setupConnection();
  });

  peer.on('error', (err) => {
    alert("接続エラーが発生しました。部屋が存在するか確認してください。");
    cancelOnlineWaiting();
  });
}

function setupConnection() {
  conn.on('open', () => {
    if (myRole === WHITE) {
      document.getElementById('cancel-online-btn').style.display = 'none';
      startGame('online');
      showBanner("部屋に参加しました！");
    }
  });

  conn.on('data', (data) => {
    handleNetworkMessage(data);
  });

  conn.on('close', () => {
    alert("対戦相手の通信が切断されました。");
    leaveOnlineAndReturnMenu();
  });
}

function cancelOnlineWaiting() {
  if (conn) { conn.close(); conn = null; }
  if (peer) { peer.destroy(); peer = null; }
  setOnlineStatus("");
  document.getElementById('cancel-online-btn').style.display = 'none';
}

function leaveOnlineAndReturnMenu() {
  if (confirm("オンライン対戦を解除してメニューに戻りますか？")) {
    if (analysisTimer) clearInterval(analysisTimer);
    cancelOnlineWaiting();
    showScreen('online-screen');
  }
}

function handleNetworkMessage(data) {
  if (data.type === 'MOVE') {
    executeMove(data.r, data.c, false);
    conn.send({ type: 'ACK', board: board });
  } else if (data.type === 'ACK') {
    isAwaitingAck = false;
    setSyncOverlay(false);
    checkNextTurn();
  }
}

function setSyncOverlay(show) {
  const overlay = document.getElementById('sync-overlay');
  if (show) overlay.classList.add('active');
  else overlay.classList.remove('active');
}

// --- 毎秒実行のリアルタイム高度形勢アナライザー ---

function startRealtimeAnalyzer() {
  if (analysisTimer) clearInterval(analysisTimer);

  // 1秒(1000ms)毎に深層探索をステップ実行し、解析精度と手読みを深める
  analysisTimer = setInterval(() => {
    const emptyCount = countEmptyCells(board);
    
    // バックグラウンドで段階的に探索深さを増やす
    if (emptyCount <= 14) {
      // 終盤：全探索で正確な最終枚数を計算
      const result = solveEndgamePV(board, currentPlayer);
      predictedFinalScore = calculateFinalDiscs(board, result.score, currentPlayer);
      currentBestPV = result.pv;
    } else {
      // 中盤：タイマーごとに1段階ずつ深く先読み（最大8手先まで）
      currentSearchDepth = (currentSearchDepth % 6) + 3;
      const result = analyzeDeepMinimax(board, currentSearchDepth, currentPlayer);
      predictedFinalScore = estimateFinalDiscs(board, result.score);
      currentBestPV = result.pv;
    }

    updateStatusUIOnly();
  }, 1000);
}

// 評価結果に基づいた最終予測枚数の算出
function estimateFinalDiscs(currentBoard, evalScore) {
  let blackCount = 0, whiteCount = 0, emptyCount = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (currentBoard[r][c] === BLACK) blackCount++;
      else if (currentBoard[r][c] === WHITE) whiteCount++;
      else emptyCount++;
    }
  }

  // 評価値から終盤の勝敗マージンを推測
  const margin = Math.round(Math.max(-emptyCount, Math.min(emptyCount, evalScore / 25)));
  const currentDiff = blackCount - whiteCount;
  const finalDiff = currentDiff + margin;

  let predictedBlack = Math.round(32 + finalDiff / 2);
  predictedBlack = Math.max(0, Math.min(64, predictedBlack));
  let predictedWhite = 64 - predictedBlack;

  return { black: predictedBlack, white: predictedWhite };
}

function calculateFinalDiscs(currentBoard, exactDiff, player) {
  let blackCount = 0, whiteCount = 0, emptyCount = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (currentBoard[r][c] === BLACK) blackCount++;
      else if (currentBoard[r][c] === WHITE) whiteCount++;
      else emptyCount++;
    }
  }

  // 完全読みによる精密差分
  const diff = player === BLACK ? exactDiff : -exactDiff;
  const finalBlack = Math.max(0, Math.min(64, Math.round((blackCount + whiteCount + emptyCount + diff) / 2)));
  return { black: finalBlack, white: 64 - finalBlack };
}

// 先読みライン（PV: Principal Variation）付きMinimax探索
function analyzeDeepMinimax(b, depth, player) {
  const moves = getValidMoves(b, player);
  if (moves.length === 0 || depth === 0) {
    return { score: evaluateStaticBoard(b), pv: [] };
  }

  moves.sort((a, b) => WEIGHTS[b.r][b.c] - WEIGHTS[a.r][a.c]);

  let bestScore = player === BLACK ? -Infinity : Infinity;
  let bestMove = moves[0];
  let bestPV = [];

  for (const m of moves) {
    const nextBoard = simulateMove(b, m.r, m.c, player);
    const res = analyzeDeepMinimax(nextBoard, depth - 1, -player);
    
    if (player === BLACK) {
      if (res.score > bestScore) {
        bestScore = res.score;
        bestMove = m;
        bestPV = [COORD_NAMES[m.r][m.c], ...res.pv];
      }
    } else {
      if (res.score < bestScore) {
        bestScore = res.score;
        bestMove = m;
        bestPV = [COORD_NAMES[m.r][m.c], ...res.pv];
      }
    }
  }

  return { score: bestScore, pv: bestPV.slice(0, 4) }; // 最大4手先まで記録
}

// 終盤全探索 (PV付き)
function solveEndgamePV(b, player, alpha = -Infinity, beta = Infinity) {
  const moves = getValidMoves(b, player);
  if (moves.length === 0) {
    const oppMoves = getValidMoves(b, -player);
    if (oppMoves.length === 0) {
      let bCount = 0, wCount = 0;
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (b[r][c] === BLACK) bCount++;
          else if (b[r][c] === WHITE) wCount++;
        }
      }
      return { score: bCount - wCount, pv: [] };
    }
    const res = solveEndgamePV(b, -player, alpha, beta);
    return { score: res.score, pv: ["パス", ...res.pv] };
  }

  let bestScore = player === BLACK ? -Infinity : Infinity;
  let bestPV = [];

  for (const m of moves) {
    const nextBoard = simulateMove(b, m.r, m.c, player);
    const res = solveEndgamePV(nextBoard, -player, alpha, beta);

    if (player === BLACK) {
      if (res.score > bestScore) {
        bestScore = res.score;
        bestPV = [COORD_NAMES[m.r][m.c], ...res.pv];
      }
      alpha = Math.max(alpha, bestScore);
    } else {
      if (res.score < bestScore) {
        bestScore = res.score;
        bestPV = [COORD_NAMES[m.r][m.c], ...res.pv];
      }
      beta = Math.min(beta, bestScore);
    }
    if (beta <= alpha) break;
  }

  return { score: bestScore, pv: bestPV.slice(0, 5) };
}

// --- 盤面描画＆動作処理 ---

function renderBoard() {
  const boardElement = document.getElementById('board');
  boardElement.innerHTML = '';

  const validMoves = getValidMoves(board, currentPlayer);

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');

      if (board[r][c] !== EMPTY) {
        const disc = document.createElement('div');
        disc.classList.add('disc', board[r][c] === BLACK ? 'black' : 'white');
        cell.appendChild(disc);
      } else if (!isProcessing && !isAwaitingAck && validMoves.some(m => m.r === r && m.c === c)) {
        if (gameMode === 'pvp' || 
           (gameMode === 'ai' && currentPlayer === BLACK) ||
           (gameMode === 'online' && currentPlayer === myRole)) {
          cell.classList.add('placeable');
          cell.addEventListener('click', () => handlePlayerMove(r, c));
        }
      }

      boardElement.appendChild(cell);
    }
  }
}

function handlePlayerMove(r, c) {
  if (isProcessing || isAwaitingAck) return;

  if (gameMode === 'online') {
    executeMove(r, c, true);
  } else {
    executeMove(r, c, false);
  }
}

function executeMove(r, c, isMyOnlineMove = false) {
  const flipped = getFlippedDiscs(board, r, c, currentPlayer);
  if (flipped.length === 0) return;

  playSE('place');
  board[r][c] = currentPlayer;
  flipped.forEach(p => board[p.r][p.c] = currentPlayer);

  currentPlayer = -currentPlayer;
  
  // 手を打ったら直ちに探索を初期化して速報更新
  currentSearchDepth = 1;
  updateStatus();

  if (isMyOnlineMove) {
    isAwaitingAck = true;
    setSyncOverlay(true);
    renderBoard();
    conn.send({ type: 'MOVE', r: r, c: c });
  } else {
    checkNextTurn();
  }
}

function checkNextTurn() {
  const validMoves = getValidMoves(board, currentPlayer);

  if (validMoves.length === 0) {
    const nextPlayerMoves = getValidMoves(board, -currentPlayer);
    if (nextPlayerMoves.length === 0) {
      isProcessing = false;
      if (analysisTimer) clearInterval(analysisTimer);
      document.getElementById('thinking-badge').style.display = 'none';
      renderBoard();
      updateStatus(true);
      playSE('win');
      return;
    }

    playSE('pass');
    showBanner((currentPlayer === BLACK ? '黒' : '白') + ' パス');
    
    isProcessing = true;
    currentPlayer = -currentPlayer;
    updateStatus();
    
    setTimeout(() => {
      checkNextTurn();
    }, 1200);
    return;
  }

  if (gameMode === 'ai' && currentPlayer === WHITE) {
    isProcessing = true;
    renderBoard();
    
    const badge = document.getElementById('thinking-badge');
    if (aiLevel >= 3) {
      badge.innerText = aiLevel === 5 ? '⚡ 超最強解析中...' : '🤔 AI思考中...';
      badge.style.display = 'block';
    }
    
    setTimeout(() => {
      makeAIMove();
    }, 30);
  } else {
    isProcessing = false;
    document.getElementById('thinking-badge').style.display = 'none';
    renderBoard();
  }
}

// --- AI対戦思考エンジン ---

function makeAIMove() {
  const validMoves = getValidMoves(board, WHITE);
  if (validMoves.length === 0) {
    isProcessing = false;
    checkNextTurn();
    return;
  }

  if (validMoves.length === 1) {
    document.getElementById('thinking-badge').style.display = 'none';
    executeMove(validMoves[0].r, validMoves[0].c);
    return;
  }

  let chosenMove = null;

  if (aiLevel === 1) {
    chosenMove = validMoves[Math.floor(Math.random() * validMoves.length)];
    executeMove(chosenMove.r, chosenMove.c);
  } else if (aiLevel === 2) {
    let bestScore = -Infinity;
    validMoves.forEach(m => {
      const score = WEIGHTS[m.r][m.c];
      if (score > bestScore) {
        bestScore = score;
        chosenMove = m;
      }
    });
    executeMove(chosenMove.r, chosenMove.c);
  } else if (aiLevel === 3) {
    let bestScore = -Infinity, alpha = -Infinity, beta = Infinity;
    validMoves.forEach(m => {
      const tempBoard = simulateMove(board, m.r, m.c, WHITE);
      const score = minimax(tempBoard, 3, alpha, beta, false);
      if (score > bestScore) {
        bestScore = score;
        chosenMove = m;
      }
      alpha = Math.max(alpha, bestScore);
    });
    executeMove(chosenMove.r, chosenMove.c);
  } else if (aiLevel === 4) {
    let emptyCount = countEmptyCells(board);
    if (emptyCount <= 14) {
      chosenMove = getBestEndgameMove(validMoves);
    } else {
      chosenMove = getBestMinimaxMove(validMoves, 5);
    }
    executeMove(chosenMove.r, chosenMove.c);
  } else if (aiLevel === 5) {
    makeUltraFastEngineMove(validMoves);
  }
}

function makeUltraFastEngineMove(validMoves) {
  const emptyCount = countEmptyCells(board);
  const startTime = Date.now();
  const MAX_TIME = emptyCount > 20 ? 15000 : 30000;

  validMoves.sort((a, b) => WEIGHTS[b.r][b.c] - WEIGHTS[a.r][a.c]);

  let bestMove = validMoves[0];
  let bestScore = -Infinity, alpha = -Infinity, beta = Infinity;
  const depth = emptyCount <= 16 ? 99 : (emptyCount <= 28 ? 9 : 7);

  for (let i = 0; i < validMoves.length; i++) {
    if (Date.now() - startTime >= MAX_TIME) break;
    const m = validMoves[i];
    const tempBoard = simulateMove(board, m.r, m.c, WHITE);
    let score = 0;

    if (depth === 99) {
      score = -solveEndgameWithTimeLimit(tempBoard, BLACK, -beta, -alpha, startTime, MAX_TIME);
    } else {
      score = minimaxWithTimeLimit(tempBoard, depth - 1, alpha, beta, false, startTime, MAX_TIME);
    }

    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
    }
    alpha = Math.max(alpha, bestScore);
  }

  document.getElementById('thinking-badge').style.display = 'none';
  executeMove(bestMove.r, bestMove.c);
}

function countEmptyCells(b) {
  let count = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (b[r][c] === EMPTY) count++;
    }
  }
  return count;
}

function getBestMinimaxMove(moves, depth) {
  let bestMove = moves[0], bestScore = -Infinity, alpha = -Infinity, beta = Infinity;
  for (const m of moves) {
    const tempBoard = simulateMove(board, m.r, m.c, WHITE);
    const score = minimax(tempBoard, depth, alpha, beta, false);
    if (score > bestScore) { bestScore = score; bestMove = m; }
    alpha = Math.max(alpha, bestScore);
  }
  return bestMove;
}

function getBestEndgameMove(moves) {
  let bestMove = moves[0], bestScore = -Infinity, alpha = -Infinity, beta = Infinity;
  for (const m of moves) {
    const tempBoard = simulateMove(board, m.r, m.c, WHITE);
    const outcome = -solveEndgame(tempBoard, BLACK, alpha, beta);
    if (outcome > bestScore) { bestScore = outcome; bestMove = m; }
    alpha = Math.max(alpha, bestScore);
  }
  return bestMove;
}

function minimaxWithTimeLimit(currentBoard, depth, alpha, beta, isMaximizing, startTime, maxTime) {
  if (Date.now() - startTime >= maxTime || depth === 0) {
    return evaluateStaticBoard(currentBoard);
  }

  const player = isMaximizing ? WHITE : BLACK;
  const validMoves = getValidMoves(currentBoard, player);

  if (validMoves.length === 0) {
    const opponentMoves = getValidMoves(currentBoard, -player);
    if (opponentMoves.length === 0) return evaluateStaticBoard(currentBoard) * 10;
    return minimaxWithTimeLimit(currentBoard, depth - 1, alpha, beta, !isMaximizing, startTime, maxTime);
  }

  validMoves.sort((a, b) => WEIGHTS[b.r][b.c] - WEIGHTS[a.r][a.c]);

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const m of validMoves) {
      if (Date.now() - startTime >= maxTime) break;
      const nextBoard = simulateMove(currentBoard, m.r, m.c, WHITE);
      const evalVal = minimaxWithTimeLimit(nextBoard, depth - 1, alpha, beta, false, startTime, maxTime);
      maxEval = Math.max(maxEval, evalVal);
      alpha = Math.max(alpha, maxEval);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const m of validMoves) {
      if (Date.now() - startTime >= maxTime) break;
      const nextBoard = simulateMove(currentBoard, m.r, m.c, BLACK);
      const evalVal = minimaxWithTimeLimit(nextBoard, depth - 1, alpha, beta, true, startTime, maxTime);
      minEval = Math.min(minEval, evalVal);
      beta = Math.min(beta, minEval);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function solveEndgameWithTimeLimit(currentBoard, player, alpha = -Infinity, beta = Infinity, startTime, maxTime) {
  if (Date.now() - startTime >= maxTime) return evaluateStaticBoard(currentBoard);

  const validMoves = getValidMoves(currentBoard, player);

  if (validMoves.length === 0) {
    const opponentMoves = getValidMoves(currentBoard, -player);
    if (opponentMoves.length === 0) {
      let blackCount = 0, whiteCount = 0;
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (currentBoard[r][c] === BLACK) blackCount++;
          else if (currentBoard[r][c] === WHITE) whiteCount++;
        }
      }
      return blackCount - whiteCount;
    }
    return solveEndgameWithTimeLimit(currentBoard, -player, alpha, beta, startTime, maxTime);
  }

  if (player === BLACK) {
    let maxEval = -Infinity;
    for (const m of validMoves) {
      if (Date.now() - startTime >= maxTime) break;
      const nextBoard = simulateMove(currentBoard, m.r, m.c, BLACK);
      const evalVal = solveEndgameWithTimeLimit(nextBoard, WHITE, alpha, beta, startTime, maxTime);
      maxEval = Math.max(maxEval, evalVal);
      alpha = Math.max(alpha, maxEval);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const m of validMoves) {
      if (Date.now() - startTime >= maxTime) break;
      const nextBoard = simulateMove(currentBoard, m.r, m.c, WHITE);
      const evalVal = solveEndgameWithTimeLimit(nextBoard, BLACK, alpha, beta, startTime, maxTime);
      minEval = Math.min(minEval, evalVal);
      beta = Math.min(beta, minEval);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function simulateMove(currentBoard, r, c, player) {
  const newBoard = currentBoard.map(row => [...row]);
  const flipped = getFlippedDiscs(newBoard, r, c, player);
  newBoard[r][c] = player;
  flipped.forEach(p => newBoard[p.r][p.c] = player);
  return newBoard;
}

function minimax(currentBoard, depth, alpha, beta, isMaximizing) {
  if (depth === 0) return evaluateStaticBoard(currentBoard);

  const player = isMaximizing ? WHITE : BLACK;
  const validMoves = getValidMoves(currentBoard, player);

  if (validMoves.length === 0) {
    const opponentMoves = getValidMoves(currentBoard, -player);
    if (opponentMoves.length === 0) return evaluateStaticBoard(currentBoard) * 10;
    return minimax(currentBoard, depth - 1, alpha, beta, !isMaximizing);
  }

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const m of validMoves) {
      const nextBoard = simulateMove(currentBoard, m.r, m.c, WHITE);
      const evalVal = minimax(nextBoard, depth - 1, alpha, beta, false);
      maxEval = Math.max(maxEval, evalVal);
      alpha = Math.max(alpha, maxEval);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const m of validMoves) {
      const nextBoard = simulateMove(currentBoard, m.r, m.c, BLACK);
      const evalVal = minimax(nextBoard, depth - 1, alpha, beta, true);
      minEval = Math.min(minEval, evalVal);
      beta = Math.min(beta, minEval);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function evaluateStaticBoard(b) {
  let score = 0, totalDiscs = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (b[r][c] !== EMPTY) {
        totalDiscs++;
        const val = WEIGHTS[r][c];
        score += (b[r][c] === WHITE ? val : -val);
      }
    }
  }

  const whiteMoves = getValidMoves(b, WHITE).length;
  const blackMoves = getValidMoves(b, BLACK).length;
  score += (whiteMoves - blackMoves) * 15;

  if (totalDiscs > 52) {
    let whiteCount = 0, blackCount = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (b[r][c] === WHITE) whiteCount++;
        if (b[r][c] === BLACK) blackCount++;
      }
    }
    score += (whiteCount - blackCount) * 25;
  }

  return score;
}

function solveEndgame(currentBoard, player, alpha = -Infinity, beta = Infinity) {
  const validMoves = getValidMoves(currentBoard, player);

  if (validMoves.length === 0) {
    const opponentMoves = getValidMoves(currentBoard, -player);
    if (opponentMoves.length === 0) {
      let blackCount = 0, whiteCount = 0;
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (currentBoard[r][c] === BLACK) blackCount++;
          else if (currentBoard[r][c] === WHITE) whiteCount++;
        }
      }
      return blackCount - whiteCount;
    }
    return solveEndgame(currentBoard, -player, alpha, beta);
  }

  if (player === BLACK) {
    let maxEval = -Infinity;
    for (const m of validMoves) {
      const nextBoard = simulateMove(currentBoard, m.r, m.c, BLACK);
      const evalVal = solveEndgame(nextBoard, WHITE, alpha, beta);
      maxEval = Math.max(maxEval, evalVal);
      alpha = Math.max(alpha, maxEval);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const m of validMoves) {
      const nextBoard = simulateMove(currentBoard, m.r, m.c, WHITE);
      const evalVal = solveEndgame(nextBoard, BLACK, alpha, beta);
      minEval = Math.min(minEval, evalVal);
      beta = Math.min(beta, minEval);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function getValidMoves(currentBoard, player) {
  const moves = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (currentBoard[r][c] === EMPTY && getFlippedDiscs(currentBoard, r, c, player).length > 0) {
        moves.push({ r, c });
      }
    }
  }
  return moves;
}

function getFlippedDiscs(currentBoard, r, c, player) {
  const flipped = [];
  directions.forEach(([dr, dc]) => {
    let nr = r + dr, nc = c + dc;
    const temp = [];
    while (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && currentBoard[nr][nc] === -player) {
      temp.push({ r: nr, c: nc });
      nr += dr; nc += dc;
    }
    if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && currentBoard[nr][nc] === player) {
      flipped.push(...temp);
    }
  });
  return flipped;
}

function evaluateBoard() {
  let blackScore = 0, whiteScore = 0, totalDiscs = 0;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === BLACK) { blackScore += WEIGHTS[r][c]; totalDiscs++; }
      else if (board[r][c] === WHITE) { whiteScore += WEIGHTS[r][c]; totalDiscs++; }
    }
  }

  const mobilityWeight = (64 - totalDiscs) > 20 ? 12 : 4;
  blackScore += getValidMoves(board, BLACK).length * mobilityWeight;
  whiteScore += getValidMoves(board, WHITE).length * mobilityWeight;

  return blackScore - whiteScore;
}

function updateStatus(isGameOver = false) {
  updateStatusUIOnly(isGameOver);
}

// 画面UIのテキスト・バーの更新処理
function updateStatusUIOnly(isGameOver = false) {
  let blackCount = 0, whiteCount = 0, emptyCount = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === BLACK) blackCount++;
      else if (board[r][c] === WHITE) whiteCount++;
      else emptyCount++;
    }
  }

  document.getElementById('black-score').innerText = `黒: ${blackCount}`;
  document.getElementById('white-score').innerText = `白: ${whiteCount}`;

  const turnDisplay = document.getElementById('turn-display');
  if (isGameOver) {
    if (blackCount > whiteCount) turnDisplay.innerText = '黒の勝ち！';
    else if (whiteCount > blackCount) turnDisplay.innerText = '白の勝ち！';
    else turnDisplay.innerText = '引き分け！';
  } else {
    turnDisplay.innerText = currentPlayer === BLACK ? '黒の番' : '白の番';
  }

  const evalText = document.getElementById('eval-text');
  const evalBar = document.getElementById('eval-bar');
  const pvText = document.getElementById('pv-text');
  const predictedScoreText = document.getElementById('predicted-score-text');

  if (isGameOver) {
    if (blackCount === whiteCount) {
      evalBar.style.width = '50%';
      evalText.innerText = 'ゲーム終了 (引き分け)';
    } else if (blackCount > whiteCount) {
      evalBar.style.width = '100%';
      evalText.innerText = `黒 勝利 (+${blackCount - whiteCount})`;
    } else {
      evalBar.style.width = '0%';
      evalText.innerText = `白 勝利 (-${whiteCount - blackCount})`;
    }
    predictedScoreText.innerText = `最終結果: 黒 ${blackCount}枚 - 白 ${whiteCount}枚`;
    pvText.innerText = 'AI読み筋: -';
    return;
  }

  // バー割合と評価テキスト
  const evalValue = evaluateBoard();
  const percentage = Math.round((1 / (1 + Math.exp(-evalValue / 100))) * 100);
  evalBar.style.width = `${percentage}%`;

  if (Math.abs(evalValue) < 20) evalText.innerText = `互角 (${evalValue > 0 ? '+' : ''}${evalValue})`;
  else if (evalValue > 0) evalText.innerText = `黒 優勢 (+${evalValue})`;
  else evalText.innerText = `白 優勢 (${evalValue})`;

  // 予測最終枚数表示
  predictedScoreText.innerText = `最終予想: 黒 ${predictedFinalScore.black}枚 - 白 ${predictedFinalScore.white}枚`;

  // 読み筋（最善手の列挙）表示
  if (currentBestPV && currentBestPV.length > 0) {
    pvText.innerText = `AI読み筋: ${currentBestPV.join(' → ')}`;
  } else {
    pvText.innerText = `AI読み筋: 解析中...`;
  }
}

function resetGame() {
  if (analysisTimer) clearInterval(analysisTimer);
  initGame();
}
