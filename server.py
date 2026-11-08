from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
import requests
import random

app = FastAPI(title="OnlinePlat Python API")

@app.get("/api/bgm-tracks")
def get_bgm_tracks():
    """iTunes API経由でドラクエやUndertale風のトラックを最大200曲取得"""
    queries = ["Dragon Quest game soundtrack", "Undertale OST", "RPG game music", "Chiptune game soundtrack"]
    tracks = []
    
    for q in queries:
        try:
            url = f"https://itunes.apple.com/search?term={q}&media=music&limit=50"
            res = requests.get(url, timeout=5)
            if res.status_code == 200:
                data = res.json()
                for item in data.get("results", []):
                    if item.get("previewUrl"):
                        tracks.append({
                            "title": item.get("trackName", "Unknown Track"),
                            "artist": item.get("artistName", "Game Composer"),
                            "previewUrl": item.get("previewUrl"),
                            "artwork": item.get("artworkUrl100", "")
                        })
        except Exception:
            pass

    # 件数が少ない場合のフォールバック処理
    if len(tracks) < 20:
        for i in range(50):
            tracks.append({
                "title": f"Chiptune Theme #{i+1}",
                "artist": "OnlinePlat Chiptune",
                "previewUrl": "https://actions.google.com/sounds/v1/ambiences/rain_heavy.ogg",
                "artwork": ""
            })

    random.shuffle(tracks)
    return {"tracks": tracks[:200]}

app.mount("/", StaticFiles(directory="public", html=True), name="public")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)