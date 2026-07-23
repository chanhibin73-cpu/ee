const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public')); // publicフォルダ内の静的ファイルを配信

const rooms = {};

// 牌山生成・シャッフル
function createDeck() {
  const ALL_TILES_LIST = [
    { type: 'man', label: '1萬', val: 1 }, { type: 'man', label: '2萬', val: 2 }, { type: 'man', label: '3萬', val: 3 },
    { type: 'man', label: '4萬', val: 4 }, { type: 'man', label: '5萬', val: 5 }, { type: 'man', label: '6萬', val: 6 },
    { type: 'man', label: '7萬', val: 7 }, { type: 'man', label: '8萬', val: 8 }, { type: 'man', label: '9萬', val: 9 },
    { type: 'pin', label: '1筒', val: 11 }, { type: 'pin', label: '2筒', val: 12 }, { type: 'pin', label: '3筒', val: 13 },
    { type: 'pin', label: '4筒', val: 14 }, { type: 'pin', label: '5筒', val: 15 }, { type: 'pin', label: '6筒', val: 16 },
    { type: 'pin', label: '7筒', val: 17 }, { type: 'pin', label: '8筒', val: 18 }, { type: 'pin', label: '9筒', val: 19 },
    { type: 'sou', label: '1索', val: 21 }, { type: 'sou', label: '2索', val: 22 }, { type: 'sou', label: '3索', val: 23 },
    { type: 'sou', label: '4索', val: 24 }, { type: 'sou', label: '5索', val: 25 }, { type: 'sou', label: '6索', val: 26 },
    { type: 'sou', label: '7索', val: 27 }, { type: 'sou', label: '8索', val: 28 }, { type: 'sou', label: '9索', val: 29 },
    { type: 'ji', label: '東', val: 31 }, { type: 'ji', label: '南', val: 32 }, { type: 'ji', label: '西', val: 33 }, { type: 'ji', label: '北', val: 34 },
    { type: 'ji', label: '白', val: 35 }, { type: 'ji', label: '發', val: 36 }, { type: 'ji', label: '中', val: 37 }
  ];
  let deck = []; let id = 0;
  ALL_TILES_LIST.forEach(t => {
    for (let i = 0; i < 4; i++) deck.push({ ...t, id: id++, isAka: ((t.val === 5 || t.val === 15 || t.val === 25) && i === 0) });
  });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, playerName }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        players: [],
        started: false,
        deck: [],
        currentTurn: 0,
        scores: [25000, 25000, 25000, 25000],
        currentKyoku: 1,
        oya: 0,
        hands: [[], [], [], []],
        timer: null
      };
    }

    const room = rooms[roomId];

    if (room.players.length < 4 && !room.started) {
      const pIndex = room.players.length;
      room.players.push({ id: socket.id, name: playerName || `プレイヤー${pIndex + 1}`, seat: pIndex });
      socket.emit('assignedSeat', { seat: pIndex, roomId });

      io.to(roomId).emit('roomUpdate', {
        playerCount: room.players.length,
        players: room.players.map(p => p.name)
      });

      // 4人揃ったら対局開始（東風戦）
      if (room.players.length === 4) {
        room.started = true;
        startOnlineGame(roomId);
      }
    } else {
      socket.emit('roomFull');
    }
  });

  socket.on('discard', ({ roomId, seat, tileIndex }) => {
    const room = rooms[roomId];
    if (!room || room.currentTurn !== seat) return;

    clearInterval(room.timer);
    const tile = room.hands[seat].splice(tileIndex, 1)[0];
    
    // 次のプレイヤーのターンへ
    room.currentTurn = (room.currentTurn + 1) % 4;
    
    // 配牌の補充
    if (room.deck.length > 0) {
      const drawnTile = room.deck.pop();
      room.hands[room.currentTurn].push(drawnTile);
    }

    io.to(roomId).emit('gameStateUpdate', {
      currentTurn: room.currentTurn,
      lastDiscard: tile,
      handsCount: room.hands.map(h => h.length),
      deckCount: room.deck.length
    });

    startTurnTimer(roomId);
  });

  socket.on('disconnect', () => {
    // 切断処理（簡易）
    for (const rId in rooms) {
      rooms[rId].players = rooms[rId].players.filter(p => p.id !== socket.id);
      if (rooms[rId].players.length === 0) delete rooms[rId];
    }
  });
});

function startOnlineGame(roomId) {
  const room = rooms[roomId];
  room.deck = createDeck();
  room.hands = [[], [], [], []];

  // 13枚ずつ配牌
  for (let i = 0; i < 13; i++) {
    for (let p = 0; p < 4; p++) {
      room.hands[p].push(room.deck.pop());
    }
  }
  // 親（0）に1枚多く配牌
  room.hands[0].push(room.deck.pop());

  io.to(roomId).emit('gameStart', {
    bakaze: '東',
    kyoku: room.currentKyoku,
    scores: room.scores,
    players: room.players,
    hands: room.hands // 各自の手牌を個別に送る拡張が可能
  });

  startTurnTimer(roomId);
}

function startTurnTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  let timeLeft = 60; // 1手1分
  io.to(roomId).emit('timerUpdate', { timeLeft, turn: room.currentTurn });

  if (room.timer) clearInterval(room.timer);

  room.timer = setInterval(() => {
    timeLeft--;
    io.to(roomId).emit('timerUpdate', { timeLeft, turn: room.currentTurn });

    if (timeLeft <= 0) {
      clearInterval(room.timer);
      // 時間切れ時の自動ツモ切り処理
      const activeSeat = room.currentTurn;
      const hand = room.hands[activeSeat];
      if (hand.length > 0) {
        const autoTileIndex = hand.length - 1; // 最後に引いた牌を切る
        room.hands[activeSeat].splice(autoTileIndex, 1);
        room.currentTurn = (room.currentTurn + 1) % 4;

        if (room.deck.length > 0) {
          room.hands[room.currentTurn].push(room.deck.pop());
        }

        io.to(roomId).emit('gameStateUpdate', {
          currentTurn: room.currentTurn,
          handsCount: room.hands.map(h => h.length),
          deckCount: room.deck.length,
          timeOutDiscard: true
        });

        startTurnTimer(roomId);
      }
    }
  }, 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`麻雀オンラインサーバー起動中: port ${PORT}`));
