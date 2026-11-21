#!/usr/bin/env python3
"""Local Full-Stack Dev Server for 《鹈鹕测试大乱斗》 (mirrors Cloudflare Worker + D1 API on port 8765)."""
import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT_DIR, "pelican_local.db")
DB_LOCK = threading.Lock()

DEFAULT_SAVE = {
    "beans": 260,
    "bestDist": 0,
    "maxCheckpoint": 0,
    "selectedCheckpoint": 0,
    "selectedHero": "nailong",
    "unlocked": ["ikun", "pelican", "naiwa", "nailong"],
    "mods": {"claw": 0, "nitro": 0, "sawBumper": 0, "mortarCat": 0},
}


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS players (
              username TEXT PRIMARY KEY,
              display_name TEXT NOT NULL,
              salt TEXT NOT NULL,
              pass_hash TEXT NOT NULL,
              token TEXT NOT NULL,
              save_json TEXT NOT NULL,
              live_run_json TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_players_token ON players(token)")
        conn.commit()


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sanitize_save(raw, prev=None):
    s = raw if isinstance(raw, dict) else {}
    p = prev if isinstance(prev, dict) else {}
    best_dist = max(0, int(s.get("bestDist") or 0), int(p.get("bestDist") or 0))
    max_cp = max(
        0,
        int(s.get("maxCheckpoint") or 0),
        int(p.get("maxCheckpoint") or 0),
        (best_dist // 500) * 500,
    )
    if "beans" in s and s["beans"] is not None:
        beans_val = max(0, int(s.get("beans") or 0))
    else:
        beans_val = max(260, int(p.get("beans") or 260))

    unlocked = list(dict.fromkeys(
        DEFAULT_SAVE["unlocked"]
        + [x for x in (p.get("unlocked") or []) if isinstance(x, str)]
        + [x for x in (s.get("unlocked") or []) if isinstance(x, str)]
    ))
    sm = s.get("mods") if isinstance(s.get("mods"), dict) else {}
    pm = p.get("mods") if isinstance(p.get("mods"), dict) else {}
    mods = {}
    for k in ("claw", "nitro", "sawBumper", "mortarCat"):
        mods[k] = min(3, max(0, int(sm.get(k) or 0), int(pm.get(k) or 0)))

    sel_cp_raw = s.get("selectedCheckpoint", p.get("selectedCheckpoint", 0))
    sel_cp = min(max_cp, max(0, int(sel_cp_raw or 0)))
    hero = s.get("selectedHero") if isinstance(s.get("selectedHero"), str) else (
        p.get("selectedHero") if isinstance(p.get("selectedHero"), str) else "nailong"
    )
    return {
        "beans": beans_val,
        "bestDist": best_dist,
        "maxCheckpoint": max_cp,
        "selectedCheckpoint": sel_cp,
        "selectedHero": hero,
        "unlocked": unlocked,
        "mods": mods,
    }


def sanitize_live_run(raw):
    if not isinstance(raw, dict):
        return None
    dist = int(raw.get("dist") or 0)
    hp = int(raw.get("hp") or 0)
    if dist < 20 or hp <= 0:
        return None
    return {
        "dist": dist,
        "beans": max(0, int(raw.get("beans") or 0)),
        "hp": min(5, hp),
        "heroId": raw.get("heroId") if isinstance(raw.get("heroId"), str) else "nailong",
        "superCharge": min(100, max(0, int(raw.get("superCharge") or 0))),
    }


class GameHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def extract_token(self, body=None):
        auth = self.headers.get("Authorization") or ""
        if auth.startswith("Bearer "):
            return auth[7:].strip()
        if isinstance(body, dict) and isinstance(body.get("token"), str):
            return body["token"].strip()
        return ""

    def do_OPTIONS(self):
        self.send_json({"ok": True})

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            return self.send_json({"ok": True, "game": "鹈鹕测试大乱斗", "localSqlite": True})
        if path == "/api/auth/me":
            token = self.extract_token()
            if not token:
                return self.send_json({"ok": False, "error": "未登录"}, 401)
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT display_name, save_json, live_run_json, updated_at FROM players WHERE token = ?",
                    (token,),
                ).fetchone()
            if not row:
                return self.send_json({"ok": False, "error": "登录已失效"}, 401)
            cloud_save = sanitize_save(json.loads(row["save_json"]))
            cloud_live = sanitize_live_run(json.loads(row["live_run_json"])) if row["live_run_json"] else None
            return self.send_json({
                "ok": True,
                "username": row["display_name"],
                "save": cloud_save,
                "liveRun": cloud_live,
                "updatedAt": row["updated_at"],
            })
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        try:
            body = self.read_json_body()
        except Exception:
            return self.send_json({"ok": False, "error": "请求格式错误"}, 400)

        if path == "/api/auth/register":
            raw_name = str(body.get("username") or "").strip()
            pwd = str(body.get("password") or "")
            if len(raw_name) < 2 or len(raw_name) > 24 or re.search(r"\s", raw_name):
                return self.send_json({"ok": False, "error": "账号需为2~24位字符（不含空格）"}, 400)
            if len(pwd) < 4 or len(pwd) > 64:
                return self.send_json({"ok": False, "error": "密码长度需为4~64位"}, 400)
            norm_user = raw_name.lower()
            salt = secrets.token_hex(16)
            pass_hash = sha256_hex(f"{salt}:{pwd}")
            token = secrets.token_hex(24)
            clean_save = sanitize_save(body.get("save"))
            clean_live = sanitize_live_run(body.get("liveRun"))
            now = int(time.time() * 1000)
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                exists = conn.execute("SELECT 1 FROM players WHERE username = ?", (norm_user,)).fetchone()
                if exists:
                    return self.send_json({"ok": False, "error": "该账号已被注册，请换个账号或直接登录！"}, 409)
                conn.execute(
                    "INSERT INTO players (username, display_name, salt, pass_hash, token, save_json, live_run_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        norm_user,
                        raw_name,
                        salt,
                        pass_hash,
                        token,
                        json.dumps(clean_save, ensure_ascii=False),
                        json.dumps(clean_live, ensure_ascii=False) if clean_live else None,
                        now,
                        now,
                    ),
                )
                conn.commit()
            return self.send_json({
                "ok": True,
                "username": raw_name,
                "token": token,
                "save": clean_save,
                "liveRun": clean_live,
                "updatedAt": now,
            })

        if path == "/api/auth/login":
            raw_name = str(body.get("username") or "").strip()
            pwd = str(body.get("password") or "")
            if not raw_name or not pwd:
                return self.send_json({"ok": False, "error": "请输入账号和密码"}, 400)
            norm_user = raw_name.lower()
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute("SELECT * FROM players WHERE username = ?", (norm_user,)).fetchone()
                if not row:
                    return self.send_json({"ok": False, "error": "账号不存在，请核对账号或点击注册"}, 404)
                if sha256_hex(f"{row['salt']}:{pwd}") != row["pass_hash"]:
                    return self.send_json({"ok": False, "error": "密码错误，请重试"}, 401)
                cloud_save = sanitize_save(json.loads(row["save_json"]))
                cloud_live = sanitize_live_run(json.loads(row["live_run_json"])) if row["live_run_json"] else None
                guest_save = body.get("guestSave")
                if isinstance(guest_save, dict):
                    merged = sanitize_save(cloud_save, guest_save)
                    g_beans = int(guest_save.get("beans") or 0)
                    merged["beans"] = max(cloud_save["beans"], g_beans if g_beans > 260 else cloud_save["beans"])
                    if merged != cloud_save:
                        cloud_save = merged
                        conn.execute(
                            "UPDATE players SET save_json = ?, updated_at = ? WHERE username = ?",
                            (json.dumps(cloud_save, ensure_ascii=False), int(time.time() * 1000), norm_user),
                        )
                        conn.commit()
                return self.send_json({
                    "ok": True,
                    "username": row["display_name"],
                    "token": row["token"],
                    "save": cloud_save,
                    "liveRun": cloud_live,
                    "updatedAt": row["updated_at"],
                })

        if path == "/api/save":
            token = self.extract_token(body)
            if not token:
                return self.send_json({"ok": False, "error": "未登录"}, 401)
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT username, display_name, save_json FROM players WHERE token = ?",
                    (token,),
                ).fetchone()
                if not row:
                    return self.send_json({"ok": False, "error": "登录已失效"}, 401)
                prev_save = json.loads(row["save_json"])
                merged_save = sanitize_save(body.get("save"), prev_save)
                clean_live = sanitize_live_run(body.get("liveRun"))
                now = int(time.time() * 1000)
                conn.execute(
                    "UPDATE players SET save_json = ?, live_run_json = ?, updated_at = ? WHERE username = ?",
                    (
                        json.dumps(merged_save, ensure_ascii=False),
                        json.dumps(clean_live, ensure_ascii=False) if clean_live else None,
                        now,
                        row["username"],
                    ),
                )
                conn.commit()
                return self.send_json({
                    "ok": True,
                    "username": row["display_name"],
                    "save": merged_save,
                    "liveRun": clean_live,
                    "updatedAt": now,
                })

        return self.send_json({"ok": False, "error": "Not found"}, 404)


if __name__ == "__main__":
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", 8765), GameHandler)
    print("Pelican Test Brawl Full-Stack Dev Server listening on http://0.0.0.0:8765", flush=True)
    server.serve_forever()
