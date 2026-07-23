const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {
  // 部屋への参加
  socket.on('joinRoom', ({ roomId, playerName }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        players: [],
        started: false,
        currentTurn: 0,
        timer: null
      };
    }

    const room = rooms[roomId];

    if (room.players.length < 4 && !room.started) {
      const seat = room.players.length;
      const player = {
        id: socket.id,
        name: playerName || `プレイヤー${seat + 1}`,
        seat: seat,
        isCpu: false
      };
      room.players.push(player);

      socket.emit('assignedSeat', { seat: seat, roomId: roomId });

      io.to(roomId).emit('roomUpdate', {
        playerCount: room.players.length,
        players: room.players
      });

      if (room.players.length === 4) {
        startMatch(roomId);
      }
    } else {
      socket.emit('roomFull');
    }
  });

  // 不足メンバーをCPUで埋めて開始
  socket.on('startWithCpu', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.started) return;

    const currentCount = room.players.length;
    for (let i = currentCount; i < 4; i++) {
      room.players.push({
        id: `CPU_${i}`,
        name: `CPU ${i}`,
        seat: i,
        isCpu: true
      });
    }

    startMatch(roomId);
  });

  // 打牌・アクション同期
  socket.on('playerAction', ({ roomId, actionData }) => {
    const room = rooms[roomId];
    if (!room) return;

    io.to(roomId).emit('gameAction', actionData);
    
    if (actionData.type === 'discard' || actionData.type === 'nextTurn') {
      resetTurnTimer(roomId, actionData.nextTurn);
    }
  });

  socket.on('disconnect', () => {
    for (const rId in rooms) {
      const room = rooms[rId];
      const pIndex = room.players.findIndex(p => p.id === socket.id);
      if (pIndex !== -1) {
        if (!room.started) {
          room.players.splice(pIndex, 1);
          room.players.forEach((p, idx) => p.seat = idx);
          io.to(rId).emit('roomUpdate', {
            playerCount: room.players.length,
            players: room.players
          });
        } else {
          room.players[pIndex].isCpu = true;
          room.players[pIndex].name += '(切断)';
          io.to(rId).emit('playerDisconnected', { seat: pIndex });
        }
      }
      if (room.players.filter(p => !p.isCpu).length === 0) {
        if (room.timer) clearInterval(room.timer);
        delete rooms[rId];
      }
    }
  });
});

function startMatch(roomId) {
  const room = rooms[roomId];
  room.started = true;
  io.to(roomId).emit('gameStart', { players: room.players });
  resetTurnTimer(roomId, 0);
}

function resetTurnTimer(roomId, currentTurn) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.timer) clearInterval(room.timer);
  room.currentTurn = currentTurn;

  let timeLeft = 60; // 1手1分
  io.to(roomId).emit('timerUpdate', { timeLeft, turn: currentTurn });

  room.timer = setInterval(() => {
    timeLeft--;
    io.to(roomId).emit('timerUpdate', { timeLeft, turn: currentTurn });

    if (timeLeft <= 0) {
      clearInterval(room.timer);
      io.to(roomId).emit('timeOut', { turn: currentTurn });
    }
  }, 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`麻雀サーバー起動: Port ${PORT}`));
