const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const https = require('https');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const rooms = {};

function fetchTracks(url, resolve) {
    https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return fetchTracks(res.headers.location, resolve);
        }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                const tracks = (json.results || []).filter(i => i.previewUrl).map(i => ({ title: i.trackName, artist: i.artistName, previewUrl: i.previewUrl }));
                resolve(tracks);
            } catch { resolve([]); }
        });
    }).on('error', () => resolve([]));
}

app.get('/api/bgm-tracks', async (req, res) => {
    const artist = req.query.artist || "Dragon Quest";
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&media=music&limit=200`;
    let tracks = await new Promise(r => fetchTracks(url, r));
    
    if (tracks.length < 5) {
        for (let i = 1; i <= 20; i++) tracks.push({ title: `Theme ${i}`, artist, previewUrl: "https://actions.google.com/sounds/v1/ambiences/rain_heavy.ogg" });
    }
    let ext = [];
    while (ext.length < 200 && tracks.length) tracks.forEach(t => ext.push({...t}));
    ext.sort(() => Math.random() - 0.5);
    res.json({ tracks: ext.slice(0, 200) });
});

io.on('connection', (socket) => {
    socket.on('join_room', ({ mode, roomCode, playerData }) => {
        const room = mode === 'private' ? roomCode : (mode === 'online' ? 'public_main' : 'off_' + socket.id);
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
