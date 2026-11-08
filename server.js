const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const https = require('https');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingTimeout: 5000,
    pingInterval: 10000
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const rooms = {};

// リダイレクトを確実に追従してiTunes APIからJSONを取得するヘルパー
function fetchJSONWithRedirects(url) {
    return new Promise((resolve) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchJSONWithRedirects(res.headers.location).then(resolve);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => {
            resolve(null);
        });
    });
}

app.get('/api/bgm-tracks', async (req, res) => {
    const artist = req.query.artist || "Dragon Quest";
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&media=music&limit=200`;
    
    const json = await fetchJSONWithRedirects(url);
    const tracks = [];
    
    if (json && json.results) {
        json.results.forEach(item => {
            if (item.previewUrl) {
                tracks.push({
                    title: item.trackName || "Track",
                    artist: item.artistName || artist,
                    previewUrl: item.previewUrl
                });
            }
        });
    }
    
    if (tracks.length < 5) {
        for (let i = 1; i <= 20; i++) {
            tracks.push({
                title: `${artist} Theme ${i}`,
                artist: artist,
                previewUrl: "https://actions.google.com/sounds/v1/ambiences/rain_heavy.ogg"
            });
        }
    }
    
    let extendedTracks = [];
    while (extendedTracks.length < 200 && tracks.length > 0) {
        tracks.forEach(t => extendedTracks.push({...t}));
    }
    extendedTracks.sort(() => Math.random() - 0.5);
    
    res.json({ tracks: extendedTracks.slice(0, 200) });
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_room', ({ mode, roomCode, playerData }) => {
        let targetRoom = mode === 'private' ? roomCode : (mode === 'online' ? 'public_main' : 'offline_' + socket.id);
        socket.join(targetRoom);
        socket.room = targetRoom;
        socket.playerData = playerData || { name: 'Player', x: 100, y: 1500, color: '#38bdf8', emote: '' };

        if (!rooms[targetRoom]) rooms[targetRoom] = {};
        rooms[targetRoom][socket.id] = socket.playerData;

        io.to(targetRoom).emit('update_players', rooms[targetRoom]);
    });

    socket.on('player_move', (data) => {
        if (socket.room && rooms[socket.room] && rooms[socket.room][socket.id]) {
            rooms[socket.room][socket.id] = { ...rooms[socket.room][socket.id], ...data };
            socket.to(socket.room).emit('player_moved', { id: socket.id, data: rooms[socket.room][socket.id] });
        }
    });

    socket.on('player_emote', (emoteText) => {
        if (socket.room && rooms[socket.room] && rooms[socket.room][socket.id]) {
            rooms[socket.room][socket.id].emote = emoteText;
            io.to(socket.room).emit('update_players', rooms[socket.room]);
        }
    });

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
