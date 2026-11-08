const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

app.get('/api/bgm-tracks', (req, res) => {
    const artist = req.query.artist || "Dragon Quest";
    https.get(`https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&media=music&limit=50`, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => {
            try {
                const json = JSON.parse(data);
                const tracks = (json.results || []).filter(i => i.previewUrl).map(i => ({ title: i.trackName, previewUrl: i.previewUrl }));
                res.json({ tracks: tracks.length ? tracks : [{ previewUrl: "https://actions.google.com/sounds/v1/ambiences/rain_heavy.ogg" }] });
            } catch { res.json({ tracks: [] }); }
        });
    });
});

const rooms = {};
io.on('connection', (socket) => {
    socket.on('join_room', ({ mode, roomCode, playerData }) => {
        const room = mode === 'private' ? roomCode : (mode === 'online' ? 'public' : 'off_' + socket.id);
        socket.room = room;
        socket.join(room);
        rooms[room] = rooms[room] || {};
        rooms[room][socket.id] = playerData;
        io.to(room).emit('update_players', rooms[room]);
    });
    socket.on('player_move', (data) => {
        if (socket.room && rooms[socket.room]?.[socket.id]) {
            Object.assign(rooms[socket.room][socket.id], data);
            socket.to(socket.room).emit('player_moved', { id: socket.id, data });
        }
    });
    socket.on('player_emote', (emote) => {
        if (socket.room && rooms[socket.room]?.[socket.id]) {
            rooms[socket.room][socket.id].emote = emote;
            io.to(socket.room).emit('update_players', rooms[socket.room]);
        }
    });
    socket.on('voice_signal', (d) => io.to(d.to).emit('voice_signal', d));
    socket.on('disconnect', () => {
        if (socket.room && rooms[socket.room]) {
            delete rooms[socket.room][socket.id];
            if (!Object.keys(rooms[socket.room]).length) delete rooms[socket.room];
            else io.to(socket.room).emit('update_players', rooms[socket.room]);
        }
    });
});

server.listen(process.env.PORT || 3000);
