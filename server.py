#!/usr/bin/env python3
"""Hardened Local Full-Stack Dev Server for 《鹈鹕测试大乱斗》 (mirrors Cloudflare Worker + D1 security shield)."""
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Windows Registry often maps .js to text/plain, breaking strict ES6 <script type="module"> MIME checks!
mimetypes.init()
mimetypes.add_type("application/javascript; charset=utf-8", ".js")
mimetypes.add_type("application/javascript; charset=utf-8", ".mjs")
mimetypes.add_type("text/css; charset=utf-8", ".css")
mimetypes.add_type("audio/mp4", ".m4a")
mimetypes.add_type("audio/ogg", ".ogg")
mimetypes.add_type("audio/mpeg", ".mp3")
mimetypes.add_type("image/png", ".png")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("image/jpeg", ".jpg")

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT_DIR, "pelican_local.db")
DB_LOCK = threading.Lock()
PEPPER = "pelican_brawl_edge_shield_v2_9f8a7c6e"
VALID_HEROES = {"nailong", "ikun", "pelican", "naiwa", "hakimi"}

DEFAULT_SAVE = {
    "beans": 150,
    "dashEnergy": 0,
    "bestDist": 0,
    "bestSingleRun": 0,
    "maxCheckpoint": 0,
    "selectedCheckpoint": 0,
    "selectedHero": "nailong",
    "unlocked": ["ikun", "pelican", "naiwa", "nailong", "hakimi"],
    "mods": {"claw": 0, "nitro": 0, "sawBumper": 0, "mortarCat": 0},
    "heroLv": {"nailong": 1, "ikun": 1, "pelican": 1, "naiwa": 1, "hakimi": 1},
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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ip_limits (
              ip_hash TEXT PRIMARY KEY,
              reg_day INTEGER NOT NULL,
              reg_day_count INTEGER NOT NULL,
              reg_total_count INTEGER NOT NULL,
              last_reg_ms INTEGER NOT NULL,
              fail_window_ms INTEGER NOT NULL,
              fail_count INTEGER NOT NULL,
              save_min_bucket INTEGER NOT NULL,
              save_min_count INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS leaderboard (
              player_key TEXT PRIMARY KEY,
              nickname TEXT NOT NULL,
              hero TEXT NOT NULL,
              best_single INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_lb_score ON leaderboard(best_single DESC)")
        conn.commit()


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def hash_password_pbkdf2(password: str, salt_hex: str) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_hex.encode("utf-8"), 100_000, dklen=32)
    return f"pbkdf2$100000${dk.hex()}"


def verify_password(password: str, salt_hex: str, stored_hash: str) -> bool:
    if stored_hash.startswith("pbkdf2$100000$"):
        return hmac.compare_digest(hash_password_pbkdf2(password, salt_hex), stored_hash)
    return hmac.compare_digest(sha256_hex(f"{salt_hex}:{password}"), stored_hash)


def make_ticket(ip_hash: str, now_ms: int) -> str:
    sig = sha256_hex(f"{PEPPER}:ticket:{ip_hash}:{now_ms}")[:32]
    return f"{now_ms}.{sig}"


def verify_ticket(ticket: str, ip_hash: str, now_ms: int) -> bool:
    if not isinstance(ticket, str) or "." not in ticket:
        return False
    ts_str, sig = ticket.split(".", 1)
    try:
        ts = int(ts_str)
    except ValueError:
        return False
    age = now_ms - ts
    if age < 800 or age > 900_000:
        return False
    expected = sha256_hex(f"{PEPPER}:ticket:{ip_hash}:{ts}")[:32]
    return hmac.compare_digest(sig, expected)


def sanitize_save(raw, prev=None):
    s = raw if isinstance(raw, dict) else {}
    p = prev if isinstance(prev, dict) else {}
    best_dist = min(999_999, max(0, int(s.get("bestDist") or 0), int(p.get("bestDist") or 0)))
    best_single = min(999_999, max(0, int(s.get("bestSingleRun") or 0), int(p.get("bestSingleRun") or 0)))
    max_cp = min(
        999_500,
        max(
            0,
            int(s.get("maxCheckpoint") or 0),
            int(p.get("maxCheckpoint") or 0),
            (best_dist // 500) * 500,
        ),
    )
    if "beans" in s and s["beans"] is not None:
        beans_val = min(999_999_999, max(0, int(s.get("beans") or 0)))
    else:
        beans_val = min(999_999_999, max(260, int(p.get("beans") or 260)))

    unlocked = list(DEFAULT_SAVE["unlocked"])
    for arr in (p.get("unlocked"), s.get("unlocked")):
        if isinstance(arr, list):
            for x in arr:
                if isinstance(x, str) and x in VALID_HEROES and x not in unlocked:
                    unlocked.append(x)

    sm = s.get("mods") if isinstance(s.get("mods"), dict) else {}
    pm = p.get("mods") if isinstance(p.get("mods"), dict) else {}
    mods = {}
    for k in ("claw", "nitro", "sawBumper", "mortarCat"):
        mods[k] = min(3, max(0, int(sm.get(k) or 0), int(pm.get(k) or 0)))

    shl = s.get("heroLv") if isinstance(s.get("heroLv"), dict) else {}
    phl = p.get("heroLv") if isinstance(p.get("heroLv"), dict) else {}
    hero_lv = {}
    for h in ("nailong", "ikun", "pelican", "naiwa", "hakimi"):
        hero_lv[h] = min(6, max(1, int(shl.get(h) or 1), int(phl.get(h) or 1)))

    sel_cp_raw = s.get("selectedCheckpoint", p.get("selectedCheckpoint", 0))
    sel_cp = min(max_cp, max(0, int(sel_cp_raw or 0)))
    cand_hero = s.get("selectedHero") if isinstance(s.get("selectedHero"), str) else p.get("selectedHero")
    hero = cand_hero if cand_hero in VALID_HEROES else "nailong"
    if "dashEnergy" in s and s["dashEnergy"] is not None:
        dash_energy = min(30.0, max(0.0, round(float(s.get("dashEnergy") or 0.0), 1)))
    else:
        dash_energy = min(30.0, max(0.0, round(float(p.get("dashEnergy") or 0.0), 1)))

    return {
        "beans": beans_val,
        "dashEnergy": dash_energy,
        "bestDist": best_dist,
        "bestSingleRun": best_single,
        "maxCheckpoint": max_cp,
        "selectedCheckpoint": sel_cp,
        "selectedHero": hero,
        "unlocked": unlocked,
        "mods": mods,
        "heroLv": hero_lv,
    }


class GameHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def end_headers(self):
        if not getattr(self, "path", "").startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def guess_type(self, path):
        clean = str(path).split("?", 1)[0].lower()
        if clean.endswith(".js") or clean.endswith(".mjs"):
            return "application/javascript; charset=utf-8"
        if clean.endswith(".css"):
            return "text/css; charset=utf-8"
        if clean.endswith(".html"):
            return "text/html; charset=utf-8"
        if clean.endswith(".m4a"):
            return "audio/mp4"
        if clean.endswith(".ogg"):
            return "audio/ogg"
        if clean.endswith(".mp3"):
            return "audio/mpeg"
        if clean.endswith(".png"):
            return "image/png"
        if clean.endswith(".svg"):
            return "image/svg+xml"
        if clean.endswith(".jpg") or clean.endswith(".jpeg"):
            return "image/jpeg"
        return super().guess_type(path)

    def client_ip_hash(self) -> str:
        ip = self.client_address[0] if self.client_address else "127.0.0.1"
        return sha256_hex(f"{PEPPER}:ip:{ip}")

    def get_ip_guard(self, conn, ip_hash: str, now_ms: int) -> dict:
        day = now_ms // 86_400_000
        min_bucket = now_ms // 60_000
        row = conn.execute("SELECT * FROM ip_limits WHERE ip_hash = ?", (ip_hash,)).fetchone()
        if not row:
            conn.execute(
                "INSERT INTO ip_limits VALUES (?, ?, 0, 0, 0, ?, 0, ?, 0)",
                (ip_hash, day, now_ms, min_bucket),
            )
            return {
                "reg_day": day, "reg_day_count": 0, "reg_total_count": 0, "last_reg_ms": 0,
                "fail_window_ms": now_ms, "fail_count": 0, "save_min_bucket": min_bucket, "save_min_count": 0,
            }
        g = dict(row)
        if g["reg_day"] != day:
            g["reg_day"] = day
            g["reg_day_count"] = 0
        if now_ms - g["fail_window_ms"] > 600_000:
            g["fail_window_ms"] = now_ms
            g["fail_count"] = 0
        if g["save_min_bucket"] != min_bucket:
            g["save_min_bucket"] = min_bucket
            g["save_min_count"] = 0
        return g

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self, max_bytes=4096):
        length = int(self.headers.get("Content-Length") or 0)
        if length > max_bytes:
            raise OverflowError("Payload too large")
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
            return self.send_json({"ok": True, "game": "鹈鹕测试大乱斗", "localSqlite": True, "shield": True})
        if path == "/api/auth/ticket":
            ip_hash = self.client_ip_hash()
            return self.send_json({"ok": True, "ticket": make_ticket(ip_hash, int(time.time() * 1000))})
        if path == "/api/leaderboard":
            from urllib.parse import parse_qs, urlparse
            qs = parse_qs(urlparse(self.path).query)
            my_key = (qs.get("key") or [""])[0].strip()[:64]
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                # Sync registered players into leaderboard automatically
                p_rows = conn.execute("SELECT username, display_name, save_json, updated_at FROM players").fetchall()
                for pr in p_rows:
                    try:
                        sv = json.loads(pr["save_json"])
                        bs = min(30000, max(0, int(sv.get("bestSingleRun") or 0)))
                        hero = sv.get("selectedHero") if sv.get("selectedHero") in VALID_HEROES else "nailong"
                        if bs > 0:
                            conn.execute(
                                """
                                INSERT INTO leaderboard (player_key, nickname, hero, best_single, updated_at)
                                VALUES (?, ?, ?, ?, ?)
                                ON CONFLICT(player_key) DO UPDATE SET
                                  nickname = excluded.nickname,
                                  hero = excluded.hero,
                                  best_single = MAX(leaderboard.best_single, excluded.best_single),
                                  updated_at = CASE WHEN excluded.best_single > leaderboard.best_single THEN excluded.updated_at ELSE leaderboard.updated_at END
                                """,
                                (f"u:{pr['username']}", pr["display_name"], hero, bs, pr["updated_at"]),
                            )
                    except Exception:
                        pass
                conn.commit()
                top_rows = conn.execute(
                    "SELECT player_key, nickname, hero, best_single, updated_at FROM leaderboard WHERE best_single > 0 ORDER BY best_single DESC, updated_at ASC LIMIT 30"
                ).fetchall()
                total_cnt = conn.execute("SELECT COUNT(*) FROM leaderboard WHERE best_single > 0").fetchone()[0]
                my_rank = None
                if my_key:
                    me = conn.execute("SELECT best_single FROM leaderboard WHERE player_key = ?", (my_key,)).fetchone()
                    if me and me["best_single"] > 0:
                        higher = conn.execute("SELECT COUNT(*) FROM leaderboard WHERE best_single > ?", (me["best_single"],)).fetchone()[0]
                        my_rank = higher + 1
            top_list = [
                {
                    "rank": idx + 1,
                    "isMe": bool(my_key and r["player_key"] == my_key),
                    "nickname": r["nickname"],
                    "hero": r["hero"],
                    "bestSingle": r["best_single"],
                    "updatedAt": r["updated_at"],
                }
                for idx, r in enumerate(top_rows)
            ]
            return self.send_json({"ok": True, "top": top_list, "myRank": my_rank, "total": total_cnt})
        if path == "/api/auth/me":
            token = self.extract_token()
            if not token:
                return self.send_json({"ok": False, "error": "未登录"}, 401)
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT display_name, save_json, updated_at FROM players WHERE token = ?",
                    (token,),
                ).fetchone()
            if not row:
                return self.send_json({"ok": False, "error": "登录已失效"}, 401)
            cloud_save = sanitize_save(json.loads(row["save_json"]))
            return self.send_json({
                "ok": True,
                "username": row["display_name"],
                "save": cloud_save,
                "updatedAt": row["updated_at"],
            })
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        try:
            body = self.read_json_body(4096)
        except OverflowError:
            return self.send_json({"ok": False, "error": "请求数据过大"}, 413)
        except Exception:
            return self.send_json({"ok": False, "error": "请求格式错误"}, 400)

        now = int(time.time() * 1000)
        ip_hash = self.client_ip_hash()

        if path == "/api/auth/register":
            if body.get("hp_trap"):
                return self.send_json({"ok": False, "error": "请求被拒绝"}, 403)
            if not verify_ticket(body.get("ticket"), ip_hash, now):
                return self.send_json({"ok": False, "error": "安全校验超时或过快，请重新打开存档窗口再试"}, 403)

            raw_name = str(body.get("username") or "").strip()
            pwd = str(body.get("password") or "")
            if len(raw_name) < 2 or len(raw_name) > 20 or re.search(r"[\s<>'\"\\/;]", raw_name):
                return self.send_json({"ok": False, "error": "账号需为2~20位常规字符（不含空格或特殊符号）"}, 400)
            if len(pwd) < 4 or len(pwd) > 64:
                return self.send_json({"ok": False, "error": "密码长度需为4~64位"}, 400)

            norm_user = raw_name.lower()
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                guard = self.get_ip_guard(conn, ip_hash, now)
                if now - guard["last_reg_ms"] < 45_000:
                    return self.send_json({"ok": False, "error": "注册操作过于频繁，请45秒后再试"}, 429)
                if guard["reg_day_count"] >= 3:
                    return self.send_json({"ok": False, "error": "当前网络今日注册已达上限(3个)，请直接登录已有账号"}, 429)
                if guard["reg_total_count"] >= 5:
                    return self.send_json({"ok": False, "error": "当前网络注册账号数已达上限，请直接登录已有账号"}, 429)

                exists = conn.execute("SELECT 1 FROM players WHERE username = ?", (norm_user,)).fetchone()
                if exists:
                    return self.send_json({"ok": False, "error": "该账号已被注册，请换个账号或直接登录！"}, 409)

                salt = secrets.token_hex(16)
                pass_hash = hash_password_pbkdf2(pwd, salt)
                token = secrets.token_hex(24)
                clean_save = sanitize_save(body.get("save"))
                conn.execute(
                    "INSERT INTO players VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)",
                    (norm_user, raw_name, salt, pass_hash, token, json.dumps(clean_save, ensure_ascii=False), now, now),
                )
                conn.execute(
                    "UPDATE ip_limits SET reg_day = ?, reg_day_count = ?, reg_total_count = ?, last_reg_ms = ? WHERE ip_hash = ?",
                    (guard["reg_day"], guard["reg_day_count"] + 1, guard["reg_total_count"] + 1, now, ip_hash),
                )
                conn.commit()
            return self.send_json({"ok": True, "username": raw_name, "token": token, "save": clean_save, "updatedAt": now})

        if path == "/api/auth/login":
            raw_name = str(body.get("username") or "").strip()
            pwd = str(body.get("password") or "")
            if not raw_name or not pwd:
                return self.send_json({"ok": False, "error": "请输入账号和密码"}, 400)
            norm_user = raw_name.lower()
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                guard = self.get_ip_guard(conn, ip_hash, now)
                if guard["fail_count"] >= 6:
                    return self.send_json({"ok": False, "error": "密码尝试次数过多，请10分钟后再试"}, 429)

                row = conn.execute("SELECT * FROM players WHERE username = ?", (norm_user,)).fetchone()
                valid = verify_password(pwd, row["salt"], row["pass_hash"]) if row else False
                if not row or not valid:
                    conn.execute(
                        "UPDATE ip_limits SET fail_window_ms = ?, fail_count = ? WHERE ip_hash = ?",
                        (guard["fail_window_ms"], guard["fail_count"] + 1, ip_hash),
                    )
                    conn.commit()
                    return self.send_json(
                        {"ok": False, "error": "账号不存在，请核对账号或点击注册" if not row else "密码错误，请重试"},
                        404 if not row else 401,
                    )

                if not row["pass_hash"].startswith("pbkdf2$"):
                    conn.execute(
                        "UPDATE players SET pass_hash = ? WHERE username = ?",
                        (hash_password_pbkdf2(pwd, row["salt"]), norm_user),
                    )
                if guard["fail_count"] > 0:
                    conn.execute("UPDATE ip_limits SET fail_count = 0 WHERE ip_hash = ?", (ip_hash,))

                cloud_save = sanitize_save(json.loads(row["save_json"]))
                conn.commit()
                return self.send_json({"ok": True, "username": row["display_name"], "token": row["token"], "save": cloud_save, "updatedAt": row["updated_at"]})

        if path == "/api/save":
            token = self.extract_token(body)
            if not token:
                return self.send_json({"ok": False, "error": "未登录"}, 401)
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                guard = self.get_ip_guard(conn, ip_hash, now)
                if guard["save_min_count"] >= 120:
                    return self.send_json({"ok": False, "error": "同步过于频繁"}, 429)
                conn.execute(
                    "UPDATE ip_limits SET save_min_bucket = ?, save_min_count = ? WHERE ip_hash = ?",
                    (guard["save_min_bucket"], guard["save_min_count"] + 1, ip_hash),
                )

                row = conn.execute("SELECT username, display_name, save_json FROM players WHERE token = ?", (token,)).fetchone()
                if not row:
                    return self.send_json({"ok": False, "error": "登录已失效"}, 401)
                prev_save = json.loads(row["save_json"])
                merged_save = sanitize_save(body.get("save"), prev_save)
                if row["username"] == "ikun" and prev_save.get("beans", 0) >= 90_000_000 and merged_save["beans"] < 50_000_000:
                    merged_save["beans"] = prev_save["beans"]
                conn.execute(
                    "UPDATE players SET save_json = ?, live_run_json = NULL, updated_at = ? WHERE username = ?",
                    (json.dumps(merged_save, ensure_ascii=False), now, row["username"]),
                )
                conn.commit()
                return self.send_json({"ok": True, "username": row["display_name"], "save": merged_save, "updatedAt": now})

        if path == "/api/leaderboard":
            token = self.extract_token(body)
            score = min(25000, max(0, int(body.get("bestSingle") or 0)))
            hero = body.get("hero") if body.get("hero") in VALID_HEROES else "nailong"
            raw_nick = re.sub(r"[\s<>'\"\\/;]", "", str(body.get("nickname") or "").strip())[:16]
            guest_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(body.get("guestId") or ""))[:36]
            if score < 5:
                return self.send_json({"ok": False, "error": "先跑出至少 5m 单命成绩再上榜吧！"}, 400)
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                pkey = ""
                nick = raw_nick or "神秘骑手"
                if token:
                    prow = conn.execute("SELECT username, display_name FROM players WHERE token = ?", (token,)).fetchone()
                    if prow:
                        pkey = f"u:{prow['username']}"
                        nick = prow["display_name"]
                if not pkey:
                    if len(guest_id) < 6:
                        return self.send_json({"ok": False, "error": "缺少榜单标识"}, 400)
                    if len(nick) < 2:
                        return self.send_json({"ok": False, "error": "昵称需至少2个字符"}, 400)
                    pkey = f"g:{guest_id}"
                conn.execute(
                    """
                    INSERT INTO leaderboard (player_key, nickname, hero, best_single, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(player_key) DO UPDATE SET
                      nickname = excluded.nickname,
                      hero = excluded.hero,
                      best_single = MAX(leaderboard.best_single, excluded.best_single),
                      updated_at = CASE WHEN excluded.best_single >= leaderboard.best_single THEN excluded.updated_at ELSE leaderboard.updated_at END
                    """,
                    (pkey, nick, hero, score, now),
                )
                conn.commit()
                me = conn.execute("SELECT best_single FROM leaderboard WHERE player_key = ?", (pkey,)).fetchone()
                best_now = me["best_single"] if me else score
                higher = conn.execute("SELECT COUNT(*) FROM leaderboard WHERE best_single > ?", (best_now,)).fetchone()[0]
            return self.send_json({"ok": True, "playerKey": pkey, "nickname": nick, "bestSingle": best_now, "myRank": higher + 1})

        return self.send_json({"ok": False, "error": "Not found"}, 404)


class NoReuseThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = False


if __name__ == "__main__":
    init_db()
    server = NoReuseThreadingHTTPServer(("0.0.0.0", 8765), GameHandler)
    print("Pelican Test Brawl Hardened Full-Stack Server v3.2 listening on http://0.0.0.0:8765", flush=True)
    server.serve_forever()
