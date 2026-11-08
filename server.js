const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingTimeout: 5000,
    pingInterval: 10000
});

const rooms = {};

// サーバーサイドでiTunes Search APIを叩いてCORSを完全回避 (200曲取得)
function fetchITunesTracks(artistName) {
    return new Promise((resolve) => {
        const query = encodeURIComponent(artistName || "Dragon Quest");
        const url = `https://itunes.apple.com/search?term=${query}&media=music&limit=200`;
        
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const tracks = [];
                    if (json && json.results) {
                        json.results.forEach(item => {
                            if (item.previewUrl) {
                                tracks.push({
                                    title: item.trackName || "Track",
                                    artist: item.artistName || artistName,
                                    previewUrl: item.previewUrl
                                });
                            }
                        });
                    }
                    resolve(tracks);
                } catch (e) {
                    resolve([]);
                }
            });
        }).on('error', () => {
            resolve([]);
        });
    });
}

app.get('/api/bgm-tracks', async (req, res) => {
    const artist = req.query.artist || "Dragon Quest";
    let tracks = await fetchITunesTracks(artist);
    
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

// WebSocket & リアルタイム同期
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_room', ({ mode, roomCode, playerData }) => {
        let targetRoom = mode === 'private' ? roomCode : (mode === 'online' ? 'public_main' : 'offline_' + socket.id);
        socket.join(targetRoom);
        socket.room = targetRoom;
        socket.playerData = playerData || { name: 'Player', x: 100, y: 400, color: '#38bdf8', emote: '' };

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

    // エモート同期
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

// フロントエンドHTML全コード統合
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>OnlinePlat</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-tap-highlight-color: transparent; }
        body { background: #0f172a; color: #f8fafc; font-family: sans-serif; overflow: hidden; width: 100vw; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        
        .screen { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #0f172a; z-index: 100; padding: 20px; text-align: center; }
        .screen.hidden { display: none !important; }
        
        h1 { font-size: 2.2rem; margin-bottom: 10px; color: #38bdf8; }
        .instructions { font-size: 0.9rem; color: #94a3b8; margin-bottom: 15px; line-height: 1.4; background: #1e293b; padding: 10px; border-radius: 8px; border: 1px solid #475569; max-width: 320px; text-align: left; }
        .btn { background: #2563eb; color: white; border: none; padding: 14px 24px; font-size: 1.1rem; border-radius: 8px; cursor: pointer; margin: 8px; font-weight: bold; width: 260px; z-index: 110; touch-action: manipulation; }
        .btn:active { background: #1d4ed8; transform: scale(0.98); }
        .btn-secondary { background: #475569; }
        
        input { padding: 14px; font-size: 1rem; border-radius: 8px; border: 1px solid #475569; background: #1e293b; color: white; margin: 8px; width: 260px; text-align: center; z-index: 110; }
        
        #game-ui { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: none; flex-direction: column; z-index: 1; }
        header { display: flex; justify-content: space-between; align-items: center; padding: 10px 20px; background: rgba(15, 23, 42, 0.9); border-bottom: 1px solid #334155; z-index: 5; }
        .header-controls { display: flex; align-items: center; gap: 10px; position: relative; }
        
        .mic-switch { background: #ef4444; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.9rem; }
        .mic-switch.active { background: #22c55e; }
        
        .icon-btn { background: #334155; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 1rem; }
        
        #target-voice-container { position: absolute; top: 50px; right: 0; background: #1e293b; border: 1px solid #475569; border-radius: 8px; padding: 10px; width: 220px; max-height: 150px; overflow-y: auto; z-index: 200; display: none; }
        #target-voice-container h4 { font-size: 0.85rem; margin-bottom: 6px; color: #94a3b8; border-bottom: 1px solid #334155; padding-bottom: 4px; }
        .target-item { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; margin: 4px 0; }

        canvas { flex-grow: 1; display: block; background: #1e293b; }

        /* 左下のエモートリストパネル */
        #emote-panel { position: absolute; bottom: 110px; left: 20px; background: rgba(30, 41, 59, 0.9); border: 1px solid #475569; border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 6px; z-index: 20; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
        #emote-panel h4 { font-size: 0.8rem; color: #94a3b8; text-align: center; margin-bottom: 2px; }
        .emote-btn { background: #334155; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: bold; transition: 0.2s; text-align: left; }
        .emote-btn:hover { background: #2563eb; }

        /* モバイル＆PC用タッチコントローラー */
        #mobile-controls { position: absolute; bottom: 20px; width: 100%; display: flex; justify-content: space-between; padding: 0 30px; z-index: 10; pointer-events: none; }
        .touch-group { display: flex; gap: 15px; pointer-events: auto; }
        .touch-btn { width: 70px; height: 70px; background: rgba(51, 65, 85, 0.85); border: 2px solid rgba(255,255,255,0.3); border-radius: 50%; color: white; font-size: 1.5rem; display: flex; align-items: center; justify-content: center; cursor: pointer; user-select: none; touch-action: manipulation; }
        .touch-btn:active { background: rgba(37, 99, 235, 0.9); }

        #settings-modal { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: none; align-items: center; justify-content: center; z-index: 300; }
        .modal-content { background: #1e293b; padding: 30px; border-radius: 12px; width: 380px; border: 1px solid #475569; display: flex; flex-direction: column; gap: 15px; max-height: 90vh; overflow-y: auto; }
        .setting-row { display: flex; flex-direction: column; gap: 5px; font-size: 0.9rem; text-align: left; }
    </style>
</head>
<body>

    <div id="mode-screen" class="screen">
        <h1>OnlinePlat</h1>
        <div class="instructions">
            <b>【操作方法 (szxc)】</b><br>
            ・<b>Z</b>: 左移動 / <b>X</b>: 右移動<br>
            ・<b>C</b>: ジャンプ / <b>S</b>: しゃがみ・下<br>
            ※画面下ボタンや左下の「エモートリスト」も使えます！
        </div>
        <input type="text" id="player-name" placeholder="プレイヤー名" value="Player">
        <button class="btn" onclick="startOfflineMode()">オフライン</button>
        <button class="btn" onclick="startOnlineMode()">オンライン</button>
        <button class="btn btn-secondary" onclick="showPrivateMenu()">プライベート</button>
    </div>

    <div id="private-screen" class="screen hidden">
        <h1>プライベート部屋</h1>
        <input type="text" id="room-code-input" placeholder="部屋番号 (例: 1234)">
        <button class="btn" onclick="startPrivateMode()">ホスト / 入出</button>
        <button class="btn btn-secondary" onclick="backToMain()">戻る</button>
    </div>

    <div id="game-ui">
        <header>
            <div id="room-info" style="font-weight: bold; color: #38bdf8;">OnlinePlat</div>
            <div class="header-controls">
                <button id="mic-toggle-btn" class="mic-switch" onclick="toggleMic()">マイク OFF</button>
                <button class="icon-btn" onclick="toggleTargetList()">👥 送信先</button>
                <button class="icon-btn" onclick="openSettings()">⚙️ 設定</button>

                <div id="target-voice-container">
                    <h4>ボイス送信先選択</h4>
                    <div class="target-item">
                        <input type="checkbox" id="select-all-target" checked onchange="toggleAllTargets(this)">
                        <label for="select-all-target">全員に送信</label>
                    </div>
                    <div id="target-checkboxes"></div>
                </div>
            </div>
        </header>

        <!-- 左下のエモートリスト -->
        <div id="emote-panel">
            <h4>💬 エモート</h4>
            <button class="emote-btn" onclick="sendEmote('👍 ナイス！')">👍 ナイス！</button>
            <button class="emote-btn" onclick="sendEmote('😂 草w')">😂 草w</button>
            <button class="emote-btn" onclick="sendEmote('🔥 やる気！')">🔥 やる気！</button>
            <button class="emote-btn" onclick="sendEmote('💖 ありがと')">💖 ありがと</button>
            <button class="emote-btn" onclick="sendEmote('👋 お疲れ！')">👋 お疲れ！</button>
        </div>

        <canvas id="gameCanvas"></canvas>

        <div id="mobile-controls">
            <div class="touch-group">
                <div class="touch-btn" id="btn-left">Z</div>
                <div class="touch-btn" id="btn-right">X</div>
            </div>
            <div class="touch-group">
                <div class="touch-btn" id="btn-jump">C</div>
            </div>
        </div>
    </div>

    <div id="settings-modal">
        <div class="modal-content">
            <h3 style="color: #38bdf8;">設定</h3>
            <div class="setting-row">
                <label>BGM アーティスト名 (200曲検索):</label>
                <input type="text" id="artist-input" value="Dragon Quest" style="width: 100%;">
                <button class="btn" style="width: 100%; padding: 10px; margin-top: 5px;" onclick="changeArtist()">アーティスト変更して更新</button>
            </div>
            <div class="setting-row">
                <label>BGM 音量: <span id="bgm-val">50</span>%</label>
                <input type="range" min="0" max="100" value="50" oninput="updateBgmVolume(this.value)">
            </div>
            <div class="setting-row">
                <label>効果音音量: <span id="sfx-val">70</span>%</label>
                <input type="range" min="0" max="100" value="70" oninput="updateSfxVolume(this.value)">
            </div>
            <div class="setting-row">
                <label>マイク検知量: <span id="mic-sens-val">30</span></label>
                <input type="range" min="0" max="100" value="30" oninput="updateMicSensitivity(this.value)">
            </div>
            <div class="setting-row">
                <label>相手の声の音量: <span id="voice-vol-val">80</span>%</label>
                <input type="range" min="0" max="100" value="80" oninput="updateVoiceVolume(this.value)">
            </div>
            <button class="btn btn-secondary" style="width: 100%;" onclick="closeSettings()">閉じる</button>
            <button class="btn" style="background: #ef4444; width: 100%;" onclick="location.reload()">ゲームを退出</button>
        </div>
    </div>

    <audio id="bgm-player" autoplay></audio>

    <script>
        const keys = {};

        // szxc キー操作対応
        window.addEventListener('keydown', e => { 
            keys[e.code] = true; 
            keys[e.key.toLowerCase()] = true; 
        });
        window.addEventListener('keyup', e => { 
            keys[e.code] = false; 
            keys[e.key.toLowerCase()] = false; 
        });

        function setupTouchButton(id, keyName1, keyName2) {
            const el = document.getElementById(id);
            if (!el) return;
            const start = (e) => { e.preventDefault(); keys[keyName1] = true; keys[keyName2] = true; };
            const end = (e) => { e.preventDefault(); keys[keyName1] = false; keys[keyName2] = false; };
            el.addEventListener('mousedown', start);
            el.addEventListener('mouseup', end);
            el.addEventListener('mouseleave', end);
            el.addEventListener('touchstart', start, {passive: false});
            el.addEventListener('touchend', end, {passive: false});
        }

        setupTouchButton('btn-left', 'KeyZ', 'ArrowLeft');
        setupTouchButton('btn-right', 'KeyX', 'ArrowRight');
        setupTouchButton('btn-jump', 'KeyC', 'Space');

        let socket = null;
        let gameMode = 'offline';
        let roomCode = '';
        let playerName = 'Player';
        let players = {};
        let myId = null;

        let bgmTracks = [];
        let currentTrackIndex = 0;
        let bgmVolume = 0.5;
        let voiceVolume = 0.8;
        let micActive = false;
        let localStream = null;
        let peerConnections = {};
        let selectedVoiceTargets = 'all';
        let currentArtist = 'Dragon Quest';
        let myEmote = '';
        let emoteTimer = null;

        window.addEventListener('DOMContentLoaded', () => {
            initBGM(currentArtist);
            const startAudio = () => {
                const player = document.getElementById('bgm-player');
                if (player.paused && bgmTracks.length > 0) {
                    player.play().catch(e => {});
                }
                window.removeEventListener('click', startAudio);
                window.removeEventListener('touchstart', startAudio);
            };
            window.addEventListener('click', startAudio);
            window.addEventListener('touchstart', startAudio);
        });

        async function initBGM(artist) {
            try {
                const res = await fetch(\`/api/bgm-tracks?artist=\${encodeURIComponent(artist)}\`);
                const data = await res.json();
                bgmTracks = data.tracks || [];
                currentTrackIndex = 0;
                if (bgmTracks.length > 0) playNextBgm();
            } catch (e) {}
        }

        const bgmPlayer = document.getElementById('bgm-player');
        bgmPlayer.addEventListener('ended', () => {
            currentTrackIndex = (currentTrackIndex + 1) % bgmTracks.length;
            playNextBgm();
        });

        function playNextBgm() {
            if (bgmTracks.length === 0) return;
            bgmPlayer.src = bgmTracks[currentTrackIndex].previewUrl;
            bgmPlayer.volume = bgmVolume;
            bgmPlayer.play().catch(e => {});
        }

        function changeArtist() {
            const inputVal = document.getElementById('artist-input').value.trim();
            if (inputVal) {
                currentArtist = inputVal;
                initBGM(currentArtist);
                alert(\`アーティスト「\${currentArtist}」の曲を200曲検索してループ再生します！\`);
            }
        }

        function sendEmote(text) {
            myEmote = text;
            if (socket && socket.connected) {
                socket.emit('player_emote', myEmote);
            }
            if (emoteTimer) clearTimeout(emoteTimer);
            emoteTimer = setTimeout(() => {
                myEmote = '';
                if (socket && socket.connected) {
                    socket.emit('player_emote', '');
                }
            }, 3500);
        }

        function updateBgmVolume(val) { bgmVolume = val / 100; bgmPlayer.volume = bgmVolume; document.getElementById('bgm-val').innerText = val; }
        function updateSfxVolume(val) { document.getElementById('sfx-val').innerText = val; }
        function updateMicSensitivity(val) { document.getElementById('mic-sens-val').innerText = val; }
        function updateVoiceVolume(val) { 
            voiceVolume = val / 100; 
            document.getElementById('voice-vol-val').innerText = val;
            document.querySelectorAll('audio.peer-audio').forEach(el => el.volume = voiceVolume);
        }

        function showPrivateMenu() {
            document.getElementById('mode-screen').classList.add('hidden');
            document.getElementById('private-screen').classList.remove('hidden');
        }

        function backToMain() {
            document.getElementById('private-screen').classList.add('hidden');
            document.getElementById('mode-screen').classList.remove('hidden');
        }

        function startOfflineMode() { gameMode = 'offline'; startGame(); }
        function startOnlineMode() { gameMode = 'online'; startGame(); }
        function startPrivateMode() {
            const code = document.getElementById('room-code-input').value.trim();
            if (!code) { alert('部屋番号を入力してください'); return; }
            roomCode = code;
            gameMode = 'private';
            startGame();
        }

        function startGame() {
            const nameInput = document.getElementById('player-name').value.trim();
            if (nameInput) playerName = nameInput;

            document.getElementById('mode-screen').classList.add('hidden');
            document.getElementById('private-screen').classList.add('hidden');
            document.getElementById('game-ui').style.display = 'flex';
            document.getElementById('room-info').innerText = \`OnlinePlat - \${gameMode.toUpperCase()} \${roomCode ? '('+roomCode+')':''}\`;

            initSocket();
            initCanvas();
            initMic();
        }

        function initSocket() {
            socket = io();
            socket.on('connect', () => {
                myId = socket.id;
                socket.emit('join_room', { mode: gameMode, roomCode: r
