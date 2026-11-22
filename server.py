#!/usr/bin/env python3
"""Hardened Local Full-Stack Dev Server for 《鹈鹕测试大乱斗》 (mirrors Cloudflare Worker + D1 security & sync shield)."""
import hashlib
import hmac
import json
import math
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
VALID_HEROES = ("nailong", "ikun", "pelican", "naiwa", "hakimi")
VALID_MODS = ("claw", "nitro", "sawBumper", "mortarCat")
VALID_TALENTS = {"superCharge": 5, "maxHpPct": 5, "autoRegen": 5}

HERO_CUM_COSTS = {1: 0, 2: 1000, 3: 2800, 4: 5600, 5: 9800, 6: 15800}
HERO_STEP_COSTS = {1: 1000, 2: 1800, 3: 2800, 4: 4200, 5: 6000}
MOD_CUM_COSTS = {0: 0, 1: 500, 2: 1600, 3: 3600}
MOD_STEP_COSTS = {0: 500, 1: 1100, 2: 2000}
TALENT_STEP_COSTS = {"superCharge": 1000, "maxHpPct": 10000, "autoRegen": 20000}

DEFAULT_SAVE = {
    "beans": 2000,
    "dashEnergy": 0.0,
    "bestDist": 0,
    "bestSingleRun": 0,
    "maxCheckpoint": 0,
    "selectedCheckpoint": 0,
    "selectedHero": "nailong",
    "unlocked": list(VALID_HEROES),
    "mods": {"claw": 0, "nitro": 0, "sawBumper": 0, "mortarCat": 0},
    "heroLv": {"nailong": 1, "ikun": 1, "pelican": 1, "naiwa": 1, "hakimi": 1},
    "talents": {"superCharge": 0, "maxHpPct": 0, "autoRegen": 0},
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


def extract_save_rev(raw_parsed) -> int:
    if isinstance(raw_parsed, dict):
        try:
            return max(1, int(raw_parsed.get("_rev") or 1))
        except Exception:
            return 1
    return 1


def serialize_save_with_rev(clean_save: dict, rev: int) -> str:
    payload = dict(clean_save)
    payload["_rev"] = max(1, int(rev))
    return json.dumps(payload, ensure_ascii=False)


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
        beans_val = min(999_999_999, max(2000, int(p.get("beans") or 2000)))

    unlocked = list(DEFAULT_SAVE["unlocked"])
    for arr in (p.get("unlocked"), s.get("unlocked")):
        if isinstance(arr, list):
            for x in arr:
                if isinstance(x, str) and x in VALID_HEROES and x not in unlocked:
                    unlocked.append(x)

    sm = s.get("mods") if isinstance(s.get("mods"), dict) else {}
    pm = p.get("mods") if isinstance(p.get("mods"), dict) else {}
    mods = {}
    for k in VALID_MODS:
        mods[k] = min(3, max(0, int(sm.get(k) or 0), int(pm.get(k) or 0)))

    shl = s.get("heroLv") if isinstance(s.get("heroLv"), dict) else {}
    phl = p.get("heroLv") if isinstance(p.get("heroLv"), dict) else {}
    hero_lv = {}
    for h in VALID_HEROES:
        hero_lv[h] = min(6, max(1, int(shl.get(h) or 1), int(phl.get(h) or 1)))

    stl = s.get("talents") if isinstance(s.get("talents"), dict) else {}
    ptl = p.get("talents") if isinstance(p.get("talents"), dict) else {}
    talents = {}
    for tk, tmax in VALID_TALENTS.items():
        talents[tk] = min(tmax, max(0, int(stl.get(tk) or 0), int(ptl.get(tk) or 0)))

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
        "talents": talents,
    }


def canonical_save_str(sv: dict) -> str:
    s = sanitize_save(sv, None)
    hl = s["heroLv"]
    md = s["mods"]
    tl = s["talents"]
    return (
        f"beans={s['beans']}|dash={s['dashEnergy']:.1f}|bd={s['bestDist']}|bs={s['bestSingleRun']}"
        f"|mcp={s['maxCheckpoint']}|scp={s['selectedCheckpoint']}|hero={s['selectedHero']}"
        f"|hl={hl['nailong']},{hl['ikun']},{hl['pelican']},{hl['naiwa']},{hl['hakimi']}"
        f"|md={md['claw']},{md['nitro']},{md['sawBumper']},{md['mortarCat']}"
        f"|tl={tl['superCharge']},{tl['maxHpPct']},{tl['autoRegen']}"
    )


def make_sync_sig(username: str, rev: int, issued_ms: int, sv: dict) -> str:
    norm_u = str(username or "").strip().lower()
    msg = f"{PEPPER}:sync:{norm_u}:{int(rev)}:{int(issued_ms)}:{canonical_save_str(sv)}"
    return hmac.new(PEPPER.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()


def calc_perm_cost(sv: dict) -> int:
    total = 0
    hl = sv.get("heroLv") or {}
    for h in VALID_HEROES:
        lv = min(6, max(1, int(hl.get(h) or 1)))
        total += HERO_CUM_COSTS[lv]
    md = sv.get("mods") or {}
    for k in VALID_MODS:
        lv = min(3, max(0, int(md.get(k) or 0)))
        total += MOD_CUM_COSTS[lv]
    tl = sv.get("talents") or {}
    for tk, tmax in VALID_TALENTS.items():
        lv = min(tmax, max(0, int(tl.get(tk) or 0)))
        total += lv * TALENT_STEP_COSTS[tk]
    return total


def reconcile_save_submission(server_save: dict, server_rev: int, body: dict, username: str, now_ms: int):
    """
    Cryptographically verified 3-Way Conservation-of-Value Merge:
      - Blocks unsigned/tampered baseSave overwrites (returns needsRebase=True, 0 server mutation).
      - Prevents offline double-spend across devices (upgrades & Hyper Dash capped by availableBeans).
      - Prevents double-charging when two tabs buy the same upgrade.
      - Preserves concurrent gameplay earnings across devices while capping max earn rate against DevTools tampering.
    """
    srv = sanitize_save(server_save, None)
    client_raw = sanitize_save(body.get("save"), None)

    base_rev = body.get("baseRev")
    base_ms = body.get("baseIssuedAt")
    base_sig = body.get("baseSig")
    raw_base = body.get("baseSave")

    sig_valid = False
    base_save = None
    if (
        isinstance(base_rev, int) and not isinstance(base_rev, bool)
        and isinstance(base_ms, int) and not isinstance(base_ms, bool)
        and isinstance(base_sig, str)
        and isinstance(raw_base, dict)
        and 1 <= base_rev <= server_rev
        and 1 <= base_ms <= now_ms + 60_000
    ):
        base_save = sanitize_save(raw_base, None)
        expected_sig = make_sync_sig(username, base_rev, base_ms, base_save)
        sig_valid = hmac.compare_digest(base_sig, expected_sig)

    if not sig_valid:
        return srv, server_rev, True, True

    is_conflict = base_rev < server_rev or canonical_save_str(base_save) != canonical_save_str(srv)

    # Ensure client permanent levels are at least base_save before computing paid permanent delta
    client_eff = sanitize_save(client_raw, base_save)

    d_dash = round(client_raw["dashEnergy"] - base_save["dashEnergy"], 1)
    paid_dash = round(max(0.0, d_dash) * 1000)
    paid_perm = max(0, calc_perm_cost(client_eff) - calc_perm_cost(base_save))
    pure_bean_delta = (client_raw["beans"] - base_save["beans"]) + paid_perm + paid_dash

    elapsed_sec = max(1.0, (now_ms - base_ms) / 1000.0)
    max_earn = min(60_000, int(1500 + elapsed_sec * 180))
    if pure_bean_delta > max_earn:
        pure_bean_delta = max_earn
        is_conflict = True

    avail = srv["beans"] + pure_bean_delta
    double_spent_consumable = False

    if d_dash > 0:
        room_sec = round(max(0.0, 30.0 - srv["dashEnergy"]), 1)
        want_sec = min(d_dash, room_sec)
        cost_want = round(want_sec * 1000)
        if avail >= cost_want:
            merged_dash = round(srv["dashEnergy"] + want_sec, 1)
            avail -= cost_want
            if want_sec < d_dash:
                is_conflict = True
        else:
            affordable_packs = max(0, int(avail) // 10_000)
            grant_sec = min(room_sec, affordable_packs * 10.0)
            merged_dash = round(srv["dashEnergy"] + grant_sec, 1)
            avail -= round(grant_sec * 1000)
            is_conflict = True
    else:
        raw_dash = round(srv["dashEnergy"] + d_dash, 1)
        if raw_dash >= 0.0:
            merged_dash = raw_dash
        else:
            merged_dash = 0.0
            deficit_cost = round((-raw_dash) * 1000)
            is_conflict = True
            if avail >= deficit_cost:
                avail -= deficit_cost
            else:
                double_spent_consumable = True
                avail = max(0, srv["beans"] + min(0, pure_bean_delta) - deficit_cost)

    if avail < 0:
        double_spent_consumable = True
        avail = 0
        is_conflict = True

    merged_hl = dict(srv["heroLv"])
    for h in VALID_HEROES:
        while merged_hl[h] < client_eff["heroLv"][h]:
            step_cost = HERO_STEP_COSTS[merged_hl[h]]
            if avail >= step_cost:
                avail -= step_cost
                merged_hl[h] += 1
            else:
                is_conflict = True
                break

    merged_mods = dict(srv["mods"])
    for k in VALID_MODS:
        while merged_mods[k] < client_eff["mods"][k]:
            step_cost = MOD_STEP_COSTS[merged_mods[k]]
            if avail >= step_cost:
                avail -= step_cost
                merged_mods[k] += 1
            else:
                is_conflict = True
                break

    merged_talents = dict(srv["talents"])
    for tk, tmax in VALID_TALENTS.items():
        while merged_talents[tk] < min(tmax, client_eff["talents"][tk]):
            step_cost = TALENT_STEP_COSTS[tk]
            if avail >= step_cost:
                avail -= step_cost
                merged_talents[tk] += 1
            else:
                is_conflict = True
                break

    if double_spent_consumable:
        best_dist = srv["bestDist"]
        best_single = srv["bestSingleRun"]
        max_cp = srv["maxCheckpoint"]
    else:
        best_dist = min(999_999, max(srv["bestDist"], client_raw["bestDist"]))
        best_single = min(999_999, max(srv["bestSingleRun"], client_raw["bestSingleRun"]))
        max_cp = min(999_500, max(srv["maxCheckpoint"], client_raw["maxCheckpoint"], (best_dist // 500) * 500))

    merged_save = {
        "beans": min(999_999_999, max(0, int(avail))),
        "dashEnergy": min(30.0, max(0.0, round(merged_dash, 1))),
        "bestDist": best_dist,
        "bestSingleRun": best_single,
        "maxCheckpoint": max_cp,
        "selectedCheckpoint": min(max_cp, max(0, int(client_raw["selectedCheckpoint"]))),
        "selectedHero": client_raw["selectedHero"] if client_raw["selectedHero"] in VALID_HEROES else srv["selectedHero"],
        "unlocked": list(DEFAULT_SAVE["unlocked"]),
        "mods": merged_mods,
        "heroLv": merged_hl,
        "talents": merged_talents,
    }
    return merged_save, server_rev + 1, is_conflict, False


def build_signed_auth_payload(username_display: str, clean_save: dict, rev: int, now_ms: int, token: str = "", conflict_resolved: bool = False, needs_rebase: bool = False):
    payload = {
        "ok": True,
        "username": username_display,
        "save": clean_save,
        "rev": int(rev),
        "issuedAtMs": int(now_ms),
        "syncSig": make_sync_sig(username_display, rev, now_ms, clean_save),
        "updatedAt": int(now_ms),
        "conflictResolved": bool(conflict_resolved),
        "needsRebase": bool(needs_rebase),
    }
    if token:
        payload["token"] = token
    return payload


CLOUD_API_ORIGIN = "https://nailong.openwaifu-agent.uk"


def proxy_cloud_api(method: str, path_and_query: str, body_dict=None, auth_hdr: str = ""):
    """Forwards account/leaderboard API calls to Cloud D1 so ALL accounts work across all devices!"""
    import urllib.error
    import urllib.request

    url = CLOUD_API_ORIGIN + path_and_query
    headers = {
        "User-Agent": "PelicanLocalDevBridge/6.2",
        "Accept": "application/json",
    }
    if auth_hdr:
        headers["Authorization"] = auth_hdr
    data_bytes = None
    if body_dict is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
        data_bytes = json.dumps(body_dict, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=4.5) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as he:
        try:
            raw = he.read().decode("utf-8")
            return he.code, json.loads(raw)
        except Exception:
            return he.code, None
    except Exception:
        return None, None


def sync_cloud_row_into_local(username_display: str, token: str, cloud_save_obj: dict, cloud_rev: int, updated_at: int):
    """Mirrors Cloud D1 account locally while monotonically preserving any newer test-server fields (e.g. talents) before prod deploy."""
    norm_u = str(username_display or "").strip().lower()
    now = int(updated_at or int(time.time() * 1000))
    with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        prev_row = conn.execute("SELECT save_json FROM players WHERE username = ?", (norm_u,)).fetchone()
        prev_parsed = json.loads(prev_row["save_json"]) if prev_row else None
        prev_rev = extract_save_rev(prev_parsed)
        merged_save = sanitize_save(cloud_save_obj, prev_parsed)
        eff_rev = max(int(cloud_rev or 1), prev_rev)
        conn.execute(
            """
            INSERT INTO players (username, display_name, salt, pass_hash, token, save_json, live_run_json, created_at, updated_at)
            VALUES (?, ?, 'cloud_synced', 'cloud_synced', ?, ?, NULL, ?, ?)
            ON CONFLICT(username) DO UPDATE SET
              display_name = excluded.display_name,
              token = excluded.token,
              save_json = excluded.save_json,
              updated_at = MAX(players.updated_at, excluded.updated_at)
            """,
            (norm_u, username_display, token, serialize_save_with_rev(merged_save, eff_rev), now, now),
        )
        conn.commit()
    return merged_save, eff_rev


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

    def get_ip_guard(self, conn: sqlite3.Connection, ip_hash: str, now_ms: int) -> dict:
        day = now_ms // 86_400_000
        min_bucket = now_ms // 60_000
        row = conn.execute("SELECT * FROM ip_limits WHERE ip_hash = ?", (ip_hash,)).fetchone()
        if not row:
            conn.execute(
                "INSERT INTO ip_limits VALUES (?, ?, 0, 0, 0, ?, 0, ?, 0)",
                (ip_hash, day, now_ms, min_bucket),
            )
            return {
                "ip_hash": ip_hash,
                "reg_day": day,
                "reg_day_count": 0,
                "reg_total_count": 0,
                "last_reg_ms": 0,
                "fail_window_ms": now_ms,
                "fail_count": 0,
                "save_min_bucket": min_bucket,
                "save_min_count": 0,
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
        now = int(time.time() * 1000)
        if path == "/api/health":
            return self.send_json({"ok": True, "game": "鹈鹕测试大乱斗", "localSqlite": True, "shield": True, "conflictEngine": "v6.2"})
        if path == "/api/auth/ticket":
            c_status, c_data = proxy_cloud_api("GET", "/api/auth/ticket")
            if c_status == 200 and isinstance(c_data, dict) and c_data.get("ticket"):
                return self.send_json(c_data, 200)
            ip_hash = self.client_ip_hash()
            return self.send_json({"ok": True, "ticket": make_ticket(ip_hash, now)})
        if path == "/api/leaderboard":
            c_status, c_data = proxy_cloud_api("GET", self.path)
            if c_status == 200 and isinstance(c_data, dict) and c_data.get("ok"):
                return self.send_json(c_data, 200)
            from urllib.parse import parse_qs, urlparse
            qs = parse_qs(urlparse(self.path).query)
            my_key = (qs.get("key") or [""])[0].strip()[:64]
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
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
            c_status, c_data = proxy_cloud_api("GET", "/api/auth/me", None, f"Bearer {token}")
            if c_status == 200 and isinstance(c_data, dict) and c_data.get("ok"):
                merged_save, eff_rev = sync_cloud_row_into_local(
                    c_data.get("username"), token, c_data.get("save"), c_data.get("rev") or 1, c_data.get("updatedAt") or now
                )
                return self.send_json(build_signed_auth_payload(c_data.get("username"), merged_save, eff_rev, now), 200)
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute("SELECT display_name, save_json FROM players WHERE token = ?", (token,)).fetchone()
            if not row:
                return self.send_json({"ok": False, "error": "登录已失效"}, 401)
            parsed_raw = json.loads(row["save_json"])
            rev = extract_save_rev(parsed_raw)
            clean_save = sanitize_save(parsed_raw, None)
            return self.send_json(build_signed_auth_payload(row["display_name"], clean_save, rev, now), 200)

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
            # Bound initial guest beans on fresh account registration to block forged initial wallets
            if isinstance(body.get("save"), dict):
                body["save"]["beans"] = min(30_000, max(0, int(body["save"].get("beans") or 150)))
            c_status, c_data = proxy_cloud_api("POST", "/api/auth/register", body)
            if c_status is not None and isinstance(c_data, dict):
                if c_data.get("ok"):
                    merged_save, eff_rev = sync_cloud_row_into_local(
                        c_data.get("username"), c_data.get("token"), c_data.get("save"), c_data.get("rev") or 1, c_data.get("updatedAt") or now
                    )
                    return self.send_json(build_signed_auth_payload(c_data.get("username"), merged_save, eff_rev, now, token=c_data.get("token")), 200)
                return self.send_json(c_data, c_status)

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
                clean_save = sanitize_save(body.get("save"), None)
                clean_save["beans"] = min(30_000, clean_save["beans"])
                conn.execute(
                    "INSERT INTO players VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)",
                    (norm_user, raw_name, salt, pass_hash, token, serialize_save_with_rev(clean_save, 1), now, now),
                )
                conn.execute(
                    "UPDATE ip_limits SET reg_day = ?, reg_day_count = ?, reg_total_count = ?, last_reg_ms = ? WHERE ip_hash = ?",
                    (guard["reg_day"], guard["reg_day_count"] + 1, guard["reg_total_count"] + 1, now, ip_hash),
                )
                conn.commit()
            return self.send_json(build_signed_auth_payload(raw_name, clean_save, 1, now, token=token), 200)

        if path == "/api/auth/login":
            c_status, c_data = proxy_cloud_api("POST", "/api/auth/login", body)
            if c_status == 200 and isinstance(c_data, dict) and c_data.get("ok"):
                merged_save, eff_rev = sync_cloud_row_into_local(
                    c_data.get("username"), c_data.get("token"), c_data.get("save"), c_data.get("rev") or 1, c_data.get("updatedAt") or now
                )
                return self.send_json(build_signed_auth_payload(c_data.get("username"), merged_save, eff_rev, now, token=c_data.get("token")), 200)
            if c_status in (401, 429) and isinstance(c_data, dict):
                return self.send_json(c_data, c_status)

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

                parsed_raw = json.loads(row["save_json"])
                rev = extract_save_rev(parsed_raw)
                clean_save = sanitize_save(parsed_raw, None)
                conn.commit()
                return self.send_json(build_signed_auth_payload(row["display_name"], clean_save, rev, now, token=row["token"]), 200)

        if path == "/api/save":
            token = self.extract_token(body)
            if not token:
                return self.send_json({"ok": False, "error": "未登录"}, 401)

            # Pull authoritative Cloud D1 state if online so cross-device edits on ANY device reconcile cleanly!
            c_me_status, c_me = proxy_cloud_api("GET", "/api/auth/me", None, f"Bearer {token}")
            if c_me_status == 401:
                return self.send_json({"ok": False, "error": "登录已失效"}, 401)

            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                guard = self.get_ip_guard(conn, ip_hash, now)
                if guard["save_min_count"] >= 120:
                    return self.send_json({"ok": False, "error": "同步过于频繁"}, 429)
                conn.execute(
                    "UPDATE ip_limits SET save_min_bucket = ?, save_min_count = ? WHERE ip_hash = ?",
                    (guard["save_min_bucket"], guard["save_min_count"] + 1, ip_hash),
                )

                local_row = conn.execute(
                    "SELECT username, display_name, save_json, updated_at FROM players WHERE token = ?", (token,)
                ).fetchone()

                if c_me_status == 200 and isinstance(c_me, dict) and c_me.get("ok"):
                    disp_name = c_me.get("username")
                    norm_u = str(disp_name).strip().lower()
                    cloud_sv = c_me.get("save") or {}
                    cloud_rev = int(c_me.get("rev") or 1)
                    cloud_upd = int(c_me.get("updatedAt") or 0)
                    if local_row:
                        local_parsed = json.loads(local_row["save_json"])
                        local_rev = extract_save_rev(local_parsed)
                        # If Cloud D1 was modified more recently by another device, adopt Cloud's wallet while keeping monotonic talents
                        if cloud_upd > int(local_row["updated_at"] or 0) + 500 or cloud_rev > local_rev:
                            srv_save = sanitize_save(cloud_sv, local_parsed)
                            srv_rev = max(cloud_rev, local_rev + (1 if canonical_save_str(srv_save) != canonical_save_str(local_parsed) else 0))
                        else:
                            srv_save = sanitize_save(local_parsed, cloud_sv)
                            srv_rev = max(local_rev, cloud_rev)
                    else:
                        srv_save = sanitize_save(cloud_sv, None)
                        srv_rev = max(1, cloud_rev)
                else:
                    if not local_row:
                        return self.send_json({"ok": False, "error": "登录已失效"}, 401)
                    disp_name = local_row["display_name"]
                    norm_u = local_row["username"]
                    local_parsed = json.loads(local_row["save_json"])
                    srv_rev = extract_save_rev(local_parsed)
                    srv_save = sanitize_save(local_parsed, None)

                merged_save, next_rev, conflict_resolved, needs_rebase = reconcile_save_submission(
                    srv_save, srv_rev, body, disp_name, now
                )

                if not needs_rebase:
                    conn.execute(
                        """
                        INSERT INTO players (username, display_name, salt, pass_hash, token, save_json, live_run_json, created_at, updated_at)
                        VALUES (?, ?, 'cloud_synced', 'cloud_synced', ?, ?, NULL, ?, ?)
                        ON CONFLICT(username) DO UPDATE SET
                          display_name = excluded.display_name,
                          token = excluded.token,
                          save_json = excluded.save_json,
                          live_run_json = NULL,
                          updated_at = excluded.updated_at
                        """,
                        (norm_u, disp_name, token, serialize_save_with_rev(merged_save, next_rev), now, now),
                    )
                conn.commit()

            # Push authoritative reconciled state up to Cloud D1 (only when a valid signed mutation occurred)
            if not needs_rebase:
                cloud_push_body = dict(body)
                cloud_push_body["save"] = merged_save
                proxy_cloud_api("POST", "/api/save", cloud_push_body, f"Bearer {token}")

            return self.send_json(
                build_signed_auth_payload(
                    disp_name, merged_save, next_rev, now, conflict_resolved=conflict_resolved, needs_rebase=needs_rebase
                ),
                200,
            )

        if path == "/api/leaderboard":
            tok_hdr = self.extract_token(body)
            c_status, c_data = proxy_cloud_api("POST", "/api/leaderboard", body, f"Bearer {tok_hdr}" if tok_hdr else "")
            if c_status is not None and isinstance(c_data, dict):
                return self.send_json(c_data, c_status)
            token = tok_hdr
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
    print("Pelican Test Brawl Hardened Full-Stack Server v6.2 listening on http://0.0.0.0:8765", flush=True)
    server.serve_forever()
