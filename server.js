const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_room', ({ mode, roomCode, playerData }) => {
        let targetRoom = mode === 'private' ? roomCode : (mode === 'online' ? 'public_main' : 'offline_' + socket.id);
        socket.join(targetRoom);
        socket.room = targetRoom;
        socket.playerData = playerData || { name: 'Player', x: 100, y: 100, color: '#3b82f6' };

        if (!rooms[targetRoom]) {
            rooms[targetRoom] = {};
        }
        rooms[targetRoom][socket.id] = socket.playerData;

        // 部屋に参加している全員にプレイヤー一覧を共有
        io.to(targetRoom).emit('update_players', rooms[targetRoom]);
    });

    socket.on('player_move', (data) => {
        if (socket.room && rooms[socket.room] && rooms[socket.room][socket.id]) {
            rooms[socket.room][socket.id] = { ...rooms[socket.room][socket.id], ...data };
            socket.to(socket.room).emit('player_moved', { id: socket.id, data: rooms[socket.room][socket.id] });
        }
    });

    // WebRTC シグナリング (個別の相手指定対応)
    socket.on('voice_signal', ({ to, signal, from, targetOnly }) => {
        io.to(to).emit('voice_signal', { signal, from, targetOnly });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (socket.room && rooms[socket.room]) {
            delete rooms[socket.room][socket.id];
            if (Object.keys(rooms[socket.room]).length === 0) {
                delete rooms[socket.room];
            } else {
                io.to(socket.room).emit('update_players', rooms[socket.room]);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`OnlinePlat server running on port ${PORT}`);
});