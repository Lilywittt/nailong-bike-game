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

# Load local .env.local secrets safely (gitignored; never committed to public repo)
def _load_local_dotenv():
    env_file = os.path.join(ROOT_DIR, ".env.local")
    if not os.path.isfile(env_file):
        return
    try:
        with open(env_file, "r", encoding="utf-8") as fh:
            for line in fh:
                s = line.strip()
                if not s or s.startswith("#") or "=" not in s:
                    continue
                k, v = s.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception:
        pass


_load_local_dotenv()


_ALIPAY_KEY_MTIME = -1.0


def _load_alipay_keys():
    kp = os.path.join(ROOT_DIR, ".env.alipay_keys.json")
    if os.path.isfile(kp):
        try:
            with open(kp, "r", encoding="utf-8") as fh:
                d = json.load(fh)
                return (
                    str(d.get("alipay_app_id") or "").strip(),
                    re.sub(r"\s+", "", str(d.get("app_private_key") or "")),
                    re.sub(r"\s+", "", str(d.get("alipay_public_key") or "")),
                )
        except Exception:
            pass
    return (
        os.environ.get("ALIPAY_APP_ID", "").strip(),
        re.sub(r"\s+", "", os.environ.get("ALIPAY_PRIVATE_KEY", "")),
        re.sub(r"\s+", "", os.environ.get("ALIPAY_PUBLIC_KEY", "")),
    )


ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY_B64, ALIPAY_PUBLIC_KEY_B64 = _load_alipay_keys()
ALIPAY_DIRECT_CONFIGURED = bool(ALIPAY_APP_ID and ALIPAY_PRIVATE_KEY_B64 and ALIPAY_PUBLIC_KEY_B64)

# Server-Authoritative Recharge / Top-Up Security Config (1 RMB = 1,000 Green Beans baseline)
PAY_WEBHOOK_SECRET = os.environ.get("PELICAN_PAY_WEBHOOK_SECRET", "pelican_pay_wh_sec_v63_7d9e2b4a1f8c3056")
AFDIAN_USER_ID = os.environ.get("AFDIAN_USER_ID", "").strip()
AFDIAN_TOKEN = os.environ.get("AFDIAN_TOKEN", "").strip()
ALLOW_AFDIAN_FALLBACK = os.environ.get("ALLOW_AFDIAN_FALLBACK", "0") == "1"
REAL_PAY_ENABLED = bool(ALIPAY_DIRECT_CONFIGURED or (ALLOW_AFDIAN_FALLBACK and AFDIAN_USER_ID and AFDIAN_TOKEN))
# Sandbox fake pay is strictly OFF whenever real payment is configured!
SANDBOX_PAY_ENABLED = (os.environ.get("PELICAN_PAY_ENV", "") == "local_sandbox") and not REAL_PAY_ENABLED


def _refresh_alipay_keys_if_needed():
    global _ALIPAY_KEY_MTIME, ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY_B64, ALIPAY_PUBLIC_KEY_B64
    global ALIPAY_DIRECT_CONFIGURED, REAL_PAY_ENABLED, SANDBOX_PAY_ENABLED
    kp = os.path.join(ROOT_DIR, ".env.alipay_keys.json")
    mtime = os.path.getmtime(kp) if os.path.isfile(kp) else 0.0
    if mtime == _ALIPAY_KEY_MTIME:
        return
    _ALIPAY_KEY_MTIME = mtime
    ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY_B64, ALIPAY_PUBLIC_KEY_B64 = _load_alipay_keys()
    ALIPAY_DIRECT_CONFIGURED = bool(ALIPAY_APP_ID and ALIPAY_PRIVATE_KEY_B64 and ALIPAY_PUBLIC_KEY_B64)
    REAL_PAY_ENABLED = bool(ALIPAY_DIRECT_CONFIGURED or (ALLOW_AFDIAN_FALLBACK and AFDIAN_USER_ID and AFDIAN_TOKEN))
    SANDBOX_PAY_ENABLED = (os.environ.get("PELICAN_PAY_ENV", "") == "local_sandbox") and not REAL_PAY_ENABLED
FIRST_RECHARGE_BONUS_BEANS = 2000
ORDER_TTL_MS = 20 * 60 * 1000  # 20 minutes
VALID_PAY_CHANNELS = ("wechat", "alipay")
AFDIAN_POLL_LOCK = threading.Lock()
LAST_AFDIAN_POLL_MS = 0

RECHARGE_PACKS = {
    "pack_1": {
        "id": "pack_1",
        "name": "🌱 1元尝鲜包",
        "price_yuan": 1,
        "amount_fen": 100,
        "base_beans": 1000,
        "bonus_beans": 0,
        "total_beans": 1000,
        "bonus_pct_lbl": "基准 1元=1000豆",
        "badge": "零门槛体验",
    },
    "pack_6": {
        "id": "pack_6",
        "name": "🔥 新手破冰包",
        "price_yuan": 6,
        "amount_fen": 600,
        "base_beans": 6000,
        "bonus_beans": 800,
        "total_beans": 6800,
        "bonus_pct_lbl": "多送 +13%",
        "badge": "🔥 人气首推",
    },
    "pack_18": {
        "id": "pack_18",
        "name": "⚡ 极速冲刺包",
        "price_yuan": 18,
        "amount_fen": 1800,
        "base_beans": 18000,
        "bonus_beans": 4000,
        "total_beans": 22000,
        "bonus_pct_lbl": "多送 +22%",
        "badge": "⚡ 畅玩爆款",
    },
    "pack_30": {
        "id": "pack_30",
        "name": "💎 天赋进阶包",
        "price_yuan": 30,
        "amount_fen": 3000,
        "base_beans": 30000,
        "bonus_beans": 9000,
        "total_beans": 39000,
        "bonus_pct_lbl": "多送 +30%",
        "badge": "💎 冲榜热销",
    },
    "pack_68": {
        "id": "pack_68",
        "name": "👑 霸主豪华箱",
        "price_yuan": 68,
        "amount_fen": 6800,
        "base_beans": 68000,
        "bonus_beans": 27000,
        "total_beans": 95000,
        "bonus_pct_lbl": "多送 +40%",
        "badge": "👑 超值特惠",
    },
    "pack_128": {
        "id": "pack_128",
        "name": "🏆 至尊满配金库",
        "price_yuan": 128,
        "amount_fen": 12800,
        "base_beans": 128000,
        "bonus_beans": 60000,
        "total_beans": 188000,
        "bonus_pct_lbl": "多送 +47%",
        "badge": "🏆 毕业神档",
    },
}

DEFAULT_SAVE = {
    "beans": 2000,
    "dashEnergy": 10.0,
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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS recharge_orders (
              order_id TEXT PRIMARY KEY,
              username TEXT NOT NULL,
              display_name TEXT NOT NULL,
              pack_id TEXT NOT NULL,
              pack_name TEXT NOT NULL,
              pay_channel TEXT NOT NULL,
              amount_fen INTEGER NOT NULL,
              base_beans INTEGER NOT NULL,
              bonus_tier_beans INTEGER NOT NULL,
              bonus_first_beans INTEGER NOT NULL DEFAULT 0,
              credited_beans INTEGER NOT NULL DEFAULT 0,
              status TEXT NOT NULL,
              trade_no TEXT,
              is_sandbox INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              expires_at INTEGER NOT NULL,
              paid_at INTEGER
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_user_created ON recharge_orders(username, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_user_status ON recharge_orders(username, status)")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_trade_no ON recharge_orders(trade_no) WHERE trade_no IS NOT NULL"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pay_webhook_nonces (
              nonce TEXT PRIMARY KEY,
              created_at INTEGER NOT NULL
            )
            """
        )
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
        fallback_dash = p.get("dashEnergy") if ("dashEnergy" in p and p["dashEnergy"] is not None) else DEFAULT_SAVE["dashEnergy"]
        dash_energy = min(30.0, max(0.0, round(float(fallback_dash or 0.0), 1)))

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
    max_earn = min(2_000_000, int(8000 + elapsed_sec * 520))
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
    if os.environ.get("PELICAN_OFFLINE_TEST") == "1":
        return None, None
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


def has_local_paid_orders(conn: sqlite3.Connection, norm_u: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM recharge_orders WHERE username = ? AND status = 'PAID' LIMIT 1",
        (norm_u,),
    ).fetchone()
    return row is not None


def sync_cloud_row_into_local(username_display: str, token: str, cloud_save_obj: dict, cloud_rev: int, updated_at: int):
    """Mirrors Cloud D1 account locally while keeping test-server recharged wallets strictly isolated from stale Cloud overwrites."""
    norm_u = str(username_display or "").strip().lower()
    now = int(updated_at or int(time.time() * 1000))
    with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        prev_row = conn.execute("SELECT save_json, updated_at FROM players WHERE username = ?", (norm_u,)).fetchone()
        prev_parsed = json.loads(prev_row["save_json"]) if prev_row else None
        prev_rev = extract_save_rev(prev_parsed)
        local_paid = has_local_paid_orders(conn, norm_u)

        if prev_parsed and (local_paid or prev_rev > int(cloud_rev or 1)):
            # Local test server has newer state or paid test-server recharge orders -> preserve local wallet!
            merged_save = sanitize_save(prev_parsed, cloud_save_obj)
            eff_rev = max(prev_rev, int(cloud_rev or 1))
        else:
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


def make_pay_webhook_sig(ts_ms: int, nonce: str, order_id: str, amount_fen: int, trade_no: str, pay_status: str) -> str:
    msg = f"pelican_pay_v1:{int(ts_ms)}:{nonce}:{order_id}:{int(amount_fen)}:{trade_no}:{pay_status}"
    return hmac.new(PAY_WEBHOOK_SECRET.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_pay_webhook_sig(
    ts_ms: int, nonce: str, order_id: str, amount_fen: int, trade_no: str, pay_status: str, sig: str, now_ms: int
) -> tuple[bool, str]:
    if not isinstance(sig, str) or len(sig) != 64:
        return False, "无效的支付回调签名格式"
    if not isinstance(nonce, str) or not (8 <= len(nonce) <= 64) or not re.fullmatch(r"[A-Za-z0-9_-]+", nonce):
        return False, "无效的回调随机串(Nonce)"
    if abs(int(now_ms) - int(ts_ms)) > 300_000:
        return False, "支付回调时间戳已过期或偏差过大"
    expected = make_pay_webhook_sig(ts_ms, nonce, order_id, amount_fen, trade_no, pay_status)
    if not hmac.compare_digest(sig.lower(), expected.lower()):
        return False, "支付回调 HMAC-SHA256 验签失败"
    return True, ""


def format_order_dict(row) -> dict:
    return {
        "orderId": row["order_id"],
        "username": row["display_name"],
        "packId": row["pack_id"],
        "packName": row["pack_name"],
        "payChannel": row["pay_channel"],
        "amountFen": int(row["amount_fen"]),
        "priceYuan": round(int(row["amount_fen"]) / 100.0, 2),
        "baseBeans": int(row["base_beans"]),
        "bonusTierBeans": int(row["bonus_tier_beans"]),
        "bonusFirstBeans": int(row["bonus_first_beans"]),
        "creditedBeans": int(row["credited_beans"]),
        "status": row["status"],
        "tradeNo": row["trade_no"] or "",
        "isSandbox": bool(row["is_sandbox"]),
        "createdAt": int(row["created_at"]),
        "expiresAt": int(row["expires_at"]),
        "paidAt": int(row["paid_at"]) if row["paid_at"] else None,
    }


def resolve_authenticated_player(token: str, now_ms: int):
    """Authenticates Bearer token against local SQLite (and syncs from Cloud D1 on first local hit)."""
    if not token:
        return None
    with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT username, display_name, save_json, updated_at FROM players WHERE token = ?", (token,)
        ).fetchone()
    if row:
        return dict(row)

    c_status, c_data = proxy_cloud_api("GET", "/api/auth/me", None, f"Bearer {token}")
    if c_status == 200 and isinstance(c_data, dict) and c_data.get("ok"):
        sync_cloud_row_into_local(
            c_data.get("username"), token, c_data.get("save"), c_data.get("rev") or 1, c_data.get("updatedAt") or now_ms
        )
        with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            row2 = conn.execute(
                "SELECT username, display_name, save_json, updated_at FROM players WHERE token = ?", (token,)
            ).fetchone()
        if row2:
            return dict(row2)
    return None


def make_qr_data_url(url_text: str) -> str:
    """Generates a 100% real ISO-18004 scannable PNG QR code data URI for WeChat / Alipay scan-to-pay."""
    import base64
    import io
    import qrcode

    is_long = len(url_text or "") > 140
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_L if is_long else qrcode.constants.ERROR_CORRECT_M,
        box_size=4 if is_long else 7,
        border=2,
    )
    qr.add_data(url_text)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0f172a", back_color="#ffffff")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def calc_entitled_beans_for_fen(paid_fen: int) -> tuple[int, int]:
    """
    Computes (base_beans, bonus_tier_beans) strictly from actual verified paid_fen (1 RMB = 100 fen = 1,000 beans).
    Prevents URL custom_price downward-tampering exploits (e.g. creating a ¥128 order and paying ¥1 only grants 1,000 beans!).
    """
    fen = max(0, int(paid_fen))
    base_beans = fen * 10  # Exact 1 RMB (100 fen) = 1,000 green beans
    # Find highest bonus tier whose price <= actual paid_fen
    best_bonus = 0
    best_tier_fen = 0
    for p in RECHARGE_PACKS.values():
        tf = int(p["amount_fen"])
        if fen >= tf and tf >= best_tier_fen:
            best_tier_fen = tf
            # Scale bonus if multiple packs worth, or grant exact tier bonus
            best_bonus = int(p["bonus_beans"])
    return base_beans, best_bonus


def settle_verified_order(
    order_id: str,
    amount_fen: int,
    trade_no: str,
    nonce: str,
    is_sandbox: bool,
    now_ms: int,
    allow_amount_recalc: bool = False,
):
    """
    Atomically settles a verified payment inside DB_LOCK + SQLite BEGIN IMMEDIATE:
      1. Enforces exact amount_fen match (or recalculates strictly from actual paid_fen when allow_amount_recalc=True for real gateway queries).
      2. Enforces single-credit idempotency (`WHERE order_id = ? AND status = 'PENDING'`, rowcount == 1 + UNIQUE trade_no).
      3. Evaluates `first_bonus` ONLY at atomic settlement time (`COUNT(PAID) == 0`), blocking multi-pending-order first-charge exploits.
      4. Credits `players.save_json` and bumps `_rev` in the exact same SQLite commit!
    """
    if not order_id or not trade_no or len(trade_no) > 80:
        return 400, {"ok": False, "error": "缺少有效订单号或支付流水号"}
    if int(amount_fen) < 100:
        return 400, {"ok": False, "error": "实付金额低于最低充值门槛(¥1.00)，不予入账"}

    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("BEGIN IMMEDIATE")
            order_row = conn.execute("SELECT * FROM recharge_orders WHERE order_id = ?", (order_id,)).fetchone()
            if not order_row:
                conn.execute("ROLLBACK")
                return 404, {"ok": False, "error": "充值订单不存在"}

            orig_fen = int(order_row["amount_fen"])
            paid_fen = int(amount_fen)
            if paid_fen != orig_fen and not allow_amount_recalc:
                conn.execute("ROLLBACK")
                return 400, {"ok": False, "error": "回调实付金额与订单金额不一致，拒绝入账"}

            if order_row["status"] == "PAID":
                conn.execute("ROLLBACK")
                if order_row["trade_no"] == trade_no:
                    p_row = conn.execute(
                        "SELECT display_name, save_json FROM players WHERE username = ?", (order_row["username"],)
                    ).fetchone()
                    auth_sync = None
                    if p_row:
                        parsed_raw = json.loads(p_row["save_json"])
                        auth_sync = build_signed_auth_payload(
                            p_row["display_name"], sanitize_save(parsed_raw, None), extract_save_rev(parsed_raw), now_ms
                        )
                    return 200, {
                        "ok": True,
                        "idempotentReplay": True,
                        "credited": False,
                        "order": format_order_dict(order_row),
                        "authSync": auth_sync,
                    }
                return 409, {"ok": False, "error": "该订单已由其他流水号完成支付"}

            # Allow late real-gateway settlement even if order just crossed local UI expiry, unless explicitly CANCELLED and unpaid
            if order_row["status"] not in ("PENDING", "EXPIRED", "CANCELLED"):
                conn.execute("ROLLBACK")
                return 409, {"ok": False, "error": f"订单状态为 {order_row['status']}，不可入账"}
            if not allow_amount_recalc and order_row["status"] != "PENDING":
                conn.execute("ROLLBACK")
                return 409, {"ok": False, "error": f"订单状态为 {order_row['status']}，不可入账"}
            if not allow_amount_recalc and now_ms > int(order_row["expires_at"]) + 60_000:
                conn.execute("UPDATE recharge_orders SET status = 'EXPIRED' WHERE order_id = ? AND status = 'PENDING'", (order_id,))
                conn.execute("COMMIT")
                return 409, {"ok": False, "error": "该订单已超时失效，请重新发起充值"}

            # Anti-replay nonce check (unique primary key)
            try:
                conn.execute("INSERT INTO pay_webhook_nonces (nonce, created_at) VALUES (?, ?)", (nonce, now_ms))
            except sqlite3.IntegrityError:
                conn.execute("ROLLBACK")
                return 409, {"ok": False, "error": "检测到重复的回调随机串(Nonce Replay)，已拦截"}

            norm_u = order_row["username"]
            player_row = conn.execute(
                "SELECT username, display_name, save_json FROM players WHERE username = ?", (norm_u,)
            ).fetchone()
            if not player_row:
                conn.execute("ROLLBACK")
                return 404, {"ok": False, "error": "订单所属玩家账号不存在"}

            if paid_fen == orig_fen:
                eff_base = int(order_row["base_beans"])
                eff_tier_bonus = int(order_row["bonus_tier_beans"])
            else:
                eff_base, eff_tier_bonus = calc_entitled_beans_for_fen(paid_fen)

            # Evaluate First-Top-Up Bonus strictly inside BEGIN IMMEDIATE before flipping status -> PAID!
            paid_before = conn.execute(
                "SELECT COUNT(*) FROM recharge_orders WHERE username = ? AND status = 'PAID'", (norm_u,)
            ).fetchone()[0]
            first_bonus = FIRST_RECHARGE_BONUS_BEANS if int(paid_before) == 0 else 0
            total_grant = eff_base + eff_tier_bonus + first_bonus

            allowed_prev_states = ("PENDING", "EXPIRED", "CANCELLED") if allow_amount_recalc else ("PENDING",)
            placeholders = ",".join("?" for _ in allowed_prev_states)
            try:
                cur = conn.execute(
                    f"""
                    UPDATE recharge_orders
                    SET status = 'PAID',
                        amount_fen = ?,
                        base_beans = ?,
                        bonus_tier_beans = ?,
                        trade_no = ?,
                        bonus_first_beans = ?,
                        credited_beans = ?,
                        is_sandbox = ?,
                        paid_at = ?
                    WHERE order_id = ? AND status IN ({placeholders})
                    """,
                    (
                        paid_fen,
                        eff_base,
                        eff_tier_bonus,
                        trade_no,
                        first_bonus,
                        total_grant,
                        1 if is_sandbox else 0,
                        now_ms,
                        order_id,
                        *allowed_prev_states,
                    ),
                )
            except sqlite3.IntegrityError:
                conn.execute("ROLLBACK")
                return 409, {"ok": False, "error": "支付流水号重复(TradeNo Conflict)，已拦截"}

            if cur.rowcount != 1:
                conn.execute("ROLLBACK")
                return 409, {"ok": False, "error": "并发状态冲突，订单未重复入账"}

            parsed_save = json.loads(player_row["save_json"])
            cur_rev = extract_save_rev(parsed_save)
            clean_save = sanitize_save(parsed_save, None)
            clean_save["beans"] = min(999_999_999, clean_save["beans"] + total_grant)
            next_rev = cur_rev + 1

            conn.execute(
                "UPDATE players SET save_json = ?, updated_at = ? WHERE username = ?",
                (serialize_save_with_rev(clean_save, next_rev), now_ms, norm_u),
            )
            updated_order = conn.execute("SELECT * FROM recharge_orders WHERE order_id = ?", (order_id,)).fetchone()
            conn.execute("COMMIT")

            auth_sync = build_signed_auth_payload(player_row["display_name"], clean_save, next_rev, now_ms)
            return 200, {
                "ok": True,
                "idempotentReplay": False,
                "credited": True,
                "creditedBeans": total_grant,
                "bonusFirstBeans": first_bonus,
                "newBeansBalance": clean_save["beans"],
                "order": format_order_dict(updated_order),
                "authSync": auth_sync,
            }
        except Exception as exc:
            try:
                conn.execute("ROLLBACK")
            except Exception:
                pass
            return 500, {"ok": False, "error": f"订单结算异常: {exc}"}
        finally:
            conn.close()


def _alipay_rsa2_sign(unsigned_str: str) -> str:
    import base64
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    priv = serialization.load_der_private_key(base64.b64decode(ALIPAY_PRIVATE_KEY_B64), password=None)
    sig_bytes = priv.sign(unsigned_str.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(sig_bytes).decode("ascii")


def _alipay_rsa2_verify(unsigned_str: str, sign_b64: str) -> bool:
    import base64
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    if not ALIPAY_PUBLIC_KEY_B64 or not sign_b64:
        return False
    try:
        pub = serialization.load_der_public_key(base64.b64decode(ALIPAY_PUBLIC_KEY_B64))
        pub.verify(base64.b64decode(sign_b64), unsigned_str.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
        return True
    except Exception:
        return False


def _alipay_gateway_call(method_name: str, biz_dict: dict, notify_url: str = "") -> dict:
    """Calls Official Alipay Gateway (`https://openapi.alipay.com/gateway.do`) with RSA2-SHA256 signing & verification."""
    import urllib.parse
    import urllib.request

    params = {
        "app_id": ALIPAY_APP_ID,
        "method": method_name,
        "format": "JSON",
        "charset": "utf-8",
        "sign_type": "RSA2",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "version": "1.0",
        "biz_content": json.dumps(biz_dict, ensure_ascii=False, separators=(",", ":")),
    }
    if notify_url:
        params["notify_url"] = notify_url
    unsigned = "&".join(f"{k}={params[k]}" for k in sorted(params) if params[k] != "" and params[k] is not None)
    params["sign"] = _alipay_rsa2_sign(unsigned)

    body_bytes = urllib.parse.urlencode(params).encode("utf-8")
    req = urllib.request.Request(
        "https://openapi.alipay.com/gateway.do?charset=utf-8",
        data=body_bytes,
        headers={"Content-Type": "application/x-www-form-urlencoded;charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=7.0) as resp:
        raw_txt = resp.read().decode("utf-8")

    parsed = json.loads(raw_txt)
    resp_key = method_name.replace(".", "_") + "_response"
    sign_b64 = parsed.get("sign") or ""
    # Extract exact JSON substring of `<method>_response` to verify Alipay's RSA2 signature
    key_token = f'"{resp_key}":'
    idx = raw_txt.find(key_token)
    if idx != -1 and sign_b64:
        sub_start = raw_txt.find("{", idx + len(key_token))
        depth = 0
        in_str = False
        esc = False
        sub_end = -1
        for pos in range(sub_start, len(raw_txt)):
            ch = raw_txt[pos]
            if esc:
                esc = False
                continue
            if ch == "\\":
                esc = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if not in_str:
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        sub_end = pos + 1
                        break
        if sub_start != -1 and sub_end != -1:
            resp_json_slice = raw_txt[sub_start:sub_end]
            if not _alipay_rsa2_verify(resp_json_slice, sign_b64):
                return {"code": "SIGN_ERR", "sub_msg": "支付宝网关响应 RSA2 验签未通过"}
    return parsed.get(resp_key) or {}


def _build_alipay_redirect_url(method_name: str, biz_dict: dict, notify_url: str = "", return_url: str = "") -> str:
    import urllib.parse

    _refresh_alipay_keys_if_needed()
    params = {
        "app_id": ALIPAY_APP_ID,
        "method": method_name,
        "format": "JSON",
        "charset": "utf-8",
        "sign_type": "RSA2",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "version": "1.0",
        "biz_content": json.dumps(biz_dict, ensure_ascii=False, separators=(",", ":")),
    }
    if notify_url:
        params["notify_url"] = notify_url
    if return_url:
        params["return_url"] = return_url
    unsigned = "&".join(f"{k}={params[k]}" for k in sorted(params) if params[k] != "" and params[k] is not None)
    params["sign"] = _alipay_rsa2_sign(unsigned)
    return "https://openapi.alipay.com/gateway.do?" + urllib.parse.urlencode(params)


def _probe_alipay_web_url_live(target_url: str) -> bool:
    import urllib.request

    try:
        req = urllib.request.Request(
            target_url,
            headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile"},
        )
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            txt = resp.read().decode("gbk", errors="ignore")
            if (
                "insufficient-isv-permissions" in txt
                or "ISV权限不足" in txt
                or "invalid-signature" in txt
                or "调试错误" in txt
            ):
                return False
            return True
    except Exception:
        return False


def alipay_create_smart_checkout(
    order_id: str, amount_fen: int, subject: str, notify_url: str = "", return_url: str = ""
) -> tuple[bool, str, str, str]:
    """
    Tries official Alipay Face-to-Face (`alipay.trade.precreate`) first; if not bound (`40006`),
    automatically falls back to `alipay.trade.wap.pay` / `alipay.trade.page.pay`!
    Returns `(ok, qr_target_url, web_checkout_url, err_msg)`.
    """
    _refresh_alipay_keys_if_needed()
    if not ALIPAY_DIRECT_CONFIGURED:
        return False, "", "", "尚未配置支付宝开放平台密钥"

    ali_ok, ali_qr, ali_err = alipay_precreate_qr(
        order_id=order_id, amount_fen=amount_fen, subject=subject, notify_url=notify_url
    )
    if ali_ok and ali_qr:
        return True, ali_qr, ali_qr, ""

    yuan_str = f"{int(amount_fen) / 100.0:.2f}"
    wap_url = _build_alipay_redirect_url(
        "alipay.trade.wap.pay",
        {
            "out_trade_no": order_id,
            "total_amount": yuan_str,
            "subject": subject[:64],
            "product_code": "QUICK_WAP_WAY",
            "timeout_express": "20m",
        },
        notify_url=notify_url,
        return_url=return_url,
    )
    page_url = _build_alipay_redirect_url(
        "alipay.trade.page.pay",
        {
            "out_trade_no": order_id,
            "total_amount": yuan_str,
            "subject": subject[:64],
            "product_code": "FAST_INSTANT_TRADE_PAY",
            "timeout_express": "20m",
        },
        notify_url=notify_url,
        return_url=return_url,
    )
    wap_live = _probe_alipay_web_url_live(wap_url)
    page_live = _probe_alipay_web_url_live(page_url)
    if wap_live or page_live:
        qr_target = wap_url if wap_live else page_url
        web_target = page_url if page_live else wap_url
        return True, qr_target, web_target, ""

    return (
        False,
        "",
        "",
        f"支付宝网关验签通过(AppID: {ALIPAY_APP_ID})，但收款接口待激活 [{ali_err}] —— 请在支付宝开放平台进入该应用确认已绑定【当面付/手机网站/电脑网站支付】并点击右上角【提交上线】，上线后无需重启即可秒出收款码！",
    )


def alipay_precreate_qr(order_id: str, amount_fen: int, subject: str, notify_url: str = "") -> tuple[bool, str, str]:
    """Creates an official Alipay Face-to-Face scan-to-pay QR (`alipay.trade.precreate`). Zero 3rd-party commission!"""
    _refresh_alipay_keys_if_needed()
    if not ALIPAY_DIRECT_CONFIGURED:
        return False, "", "尚未配置支付宝开放平台密钥"
    try:
        res = _alipay_gateway_call(
            "alipay.trade.precreate",
            {
                "out_trade_no": order_id,
                "total_amount": f"{int(amount_fen) / 100.0:.2f}",
                "subject": subject[:64],
                "timeout_express": "20m",
            },
            notify_url=notify_url,
        )
        if str(res.get("code")) == "10000" and res.get("qr_code"):
            return True, str(res["qr_code"]), ""
        sub_msg = res.get("sub_msg") or res.get("msg") or "暂未开通"
        sub_code = res.get("sub_code") or ""
        return False, "", f"支付宝官方网关提示：{sub_msg} ({sub_code})"
    except Exception as exc:
        return False, "", f"连接支付宝官方网关异常：{exc}"


def alipay_query_and_settle_order(order_id: str, now_ms: int) -> bool:
    """Queries official `alipay.trade.query` with RSA2 verification and settles atomically if PAID."""
    _refresh_alipay_keys_if_needed()
    if not ALIPAY_DIRECT_CONFIGURED or not order_id:
        return False
    try:
        res = _alipay_gateway_call("alipay.trade.query", {"out_trade_no": order_id})
        if str(res.get("code")) != "10000":
            return False
        t_status = str(res.get("trade_status") or "").upper()
        if t_status not in ("TRADE_SUCCESS", "TRADE_FINISHED"):
            return False
        ali_trade_no = re.sub(r"[^A-Za-z0-9_-]", "", str(res.get("trade_no") or "").strip())[:64]
        paid_fen = int(round(float(res.get("total_amount") or 0.0) * 100))
        if not ali_trade_no or paid_fen < 100:
            return False
        code, payload = settle_verified_order(
            order_id=order_id,
            amount_fen=paid_fen,
            trade_no=f"ALI_{ali_trade_no}",
            nonce=f"ali_{ali_trade_no}"[:64],
            is_sandbox=False,
            now_ms=now_ms,
            allow_amount_recalc=False,
        )
        return bool(code == 200 and payload.get("credited"))
    except Exception:
        return False


def query_afdian_orders_api(out_trade_no: str = "") -> list[dict]:
    """Queries Afdian Official OpenAPI `/api/open/query-order` with MD5 server-secret signature."""
    if not REAL_PAY_ENABLED:
        return []
    import urllib.request

    ts = int(time.time())
    p_obj = {"page": 1}
    if out_trade_no:
        p_obj["out_trade_no"] = str(out_trade_no).strip()
    params_str = json.dumps(p_obj, separators=(",", ":"))
    sign_raw = f"{AFDIAN_TOKEN}params{params_str}ts{ts}user_id{AFDIAN_USER_ID}"
    sign_hex = hashlib.md5(sign_raw.encode("utf-8")).hexdigest()
    req_body = json.dumps(
        {
            "user_id": AFDIAN_USER_ID,
            "params": params_str,
            "ts": ts,
            "sign": sign_hex,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        "https://ifdian.net/api/open/query-order",
        data=req_body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "PelicanPayVerifier/6.4",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=6.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, dict) and data.get("ec") == 200:
                lst = (data.get("data") or {}).get("list")
                return lst if isinstance(lst, list) else []
    except Exception:
        pass
    return []


def extract_order_id_from_afdian_item(item: dict) -> str:
    """Extracts our PL... order_id from `custom_order_id` or `remark`."""
    c_oid = str(item.get("custom_order_id") or "").strip()
    if re.fullmatch(r"PL\d{14}[0-9A-F]{10}", c_oid):
        return c_oid
    rem = str(item.get("remark") or "").strip()
    m = re.search(r"(PL\d{14}[0-9A-F]{10})", rem)
    return m.group(1) if m else ""


def sync_real_afdian_payments(now_ms: int, force: bool = False, specific_trade_no: str = "") -> int:
    """Polls authoritative Afdian OpenAPI and atomically settles any newly paid real orders."""
    global LAST_AFDIAN_POLL_MS
    if not REAL_PAY_ENABLED:
        return 0

    min_gap = 900 if force else 2300
    with AFDIAN_POLL_LOCK:
        if not specific_trade_no and (now_ms - LAST_AFDIAN_POLL_MS) < min_gap:
            return 0
        LAST_AFDIAN_POLL_MS = now_ms

    items = query_afdian_orders_api(out_trade_no=specific_trade_no)
    settled_cnt = 0
    for item in items:
        if not isinstance(item, dict) or int(item.get("status") or 0) != 2:
            continue
        out_tx = re.sub(r"[^A-Za-z0-9_-]", "", str(item.get("out_trade_no") or "").strip())[:64]
        if not out_tx or out_tx == "202106232138371083454010626":
            continue
        oid = extract_order_id_from_afdian_item(item)
        if not oid:
            continue
        try:
            tot_amt = float(item.get("total_amount") or 0.0)
            show_amt = float(item.get("show_amount") or 0.0)
            paid_fen = int(round(max(tot_amt, show_amt) * 100))
        except (TypeError, ValueError):
            continue
        if paid_fen < 100:
            continue

        trade_no = f"AFD_{out_tx}"
        nonce = f"afd_{out_tx}"[:64]
        code, res = settle_verified_order(
            order_id=oid,
            amount_fen=paid_fen,
            trade_no=trade_no,
            nonce=nonce,
            is_sandbox=False,
            now_ms=now_ms,
            allow_amount_recalc=True,
        )
        if code == 200 and res.get("credited"):
            settled_cnt += 1
    return settled_cnt


# ============================================================================
# ONLINE MULTIPLAYER PARTY RACE ENGINE (/api/party/* — Thread-Safe In-Memory)
# ============================================================================
PARTY_LOCK = threading.Lock()
PARTY_ROOMS: dict[str, dict] = {}
PARTY_MATCH_QUEUE: list[str] = []
PARTY_ROOM_IDLE_TTL_MS = 15 * 60 * 1000  # Auto-prune rooms idle > 15 min
PARTY_COUNTDOWN_MS = 3200
PARTY_CORE_MODULES = (
    "ikun_trampoline",
    "canyon_skyrail",
    "truck_gauntlet",
    "wave_coaster",
    "split_decker",
    "maodie_ambush",
    "mega_vault",
    "narrow_brawl",
    "turbo_chicane",
)
PARTY_VALID_ITEMS = (
    "hero_skill_hit",
    "timed_shield",
    "ddj_rush",
    "bean_nitro",
    "melee_bump",
    "naiwa_swarm",
    "truck_isekai",
    "dagou_bite",
    "bball_rain",
    "lawyer_seal",
    "maodie_trap",
    "pelican_carry",
    "manbo_steal",
    "lightning_whip",
    "kun_rocket",
    "pan_shield",
)
PARTY_OFFENSIVE_ITEMS = (
    "melee_bump",
    "naiwa_swarm",
    "truck_isekai",
    "dagou_bite",
    "bball_rain",
    "lawyer_seal",
    "maodie_trap",
    "pelican_carry",
    "manbo_steal",
    "lightning_whip",
)
PARTY_ITEM_DAMAGE = {
    "truck_isekai": 50,
    "lightning_whip": 45,
    "naiwa_swarm": 42,
    "dagou_bite": 38,
    "bball_rain": 36,
    "maodie_trap": 34,
    "pelican_carry": 32,
    "manbo_steal": 30,
    "lawyer_seal": 30,
    "melee_bump": 28,
}
PARTY_ITEM_BANNERS = {
    "naiwa_swarm": "🐸 对手狂撒一整群冒牌奶蛙砸脸！",
    "truck_isekai": "🚛 大运泥头车全速创过来了！",
    "dagou_bite": "🐕 恶犬大狗嚼扑上来咬你车轮！",
    "bball_rain": "🏀 漫天燃烧篮球陨石雨来袭！",
    "lawyer_seal": "📜 律师函警告 · 你干嘛嗨嗨哟！",
    "maodie_trap": "😾 五只圆头耄耋炸毛飞扑！",
    "pelican_carry": "🦢 鹈鹕顺丰强制凌空叼走！",
    "manbo_steal": "🐴 曼波魔音偷走了你的车速！",
    "lightning_whip": "🔔 雷霆少林巨钟当头镇压！",
}
PARTY_ITEM_SPEECH = {
    "timed_shield": "🛡️ 背带金钟罩，黑子别沾边！",
    "ddj_rush": "🐔 叮咚鸡血飙车啦！",
    "bean_nitro": "🧋 哈基米南北绿豆氮气！",
    "naiwa_swarm": "🐸 吃我一车狂笑奶蛙群！",
    "truck_isekai": "🚛 大运泥头车送你出道！",
    "dagou_bite": "🐕 关门！放大狗嚼咬他！",
    "bball_rain": "🏀 燃烧篮球陨石雨！",
    "lawyer_seal": "📜 律师函糊脸警告！",
    "maodie_trap": "😾 圆头耄耋大军扑脸！",
    "pelican_carry": "🦢 鹈鹕顺丰强制揽收！",
    "manbo_steal": "🐴 曼波~偷走你的车速！",
    "lightning_whip": "🔔 吃我雷霆巨钟镇压！",
    "kun_rocket": "🚀 背带窜天猴升空！",
    "pan_shield": "🥘 纯路人铁锅护体！",
}
PARTY_BOT_PERSONAS = (
    ("🤖 抽象大帝", "ikun"),
    ("🤖 圆头耄耋王", "hakimi"),
    ("🤖 背带顺丰王", "pelican"),
    ("🤖 狂笑冒牌龙", "naiwa"),
    ("🤖 喷火大头王", "nailong"),
)


def _party_clean_id(raw_id) -> str:
    s = re.sub(r"[^A-Za-z0-9_:-]", "", str(raw_id or "").strip())[:48]
    return s if len(s) >= 3 else f"p_{secrets.token_hex(5)}"


def _party_clean_nick(raw_nick, fallback="派对骑手") -> str:
    s = re.sub(r"[\r\n\t<>'\"\\/;]", "", str(raw_nick or "").strip())[:16]
    return s if len(s) >= 1 else fallback


def _party_clean_hero(raw_hero) -> str:
    h = str(raw_hero or "").strip()
    return h if h in VALID_HEROES else "nailong"


def _resolve_party_account_key(token: str, fallback_user: str, now_ms: int) -> tuple[str, str]:
    """Resolves authenticated account identity so the same account can NEVER match against itself."""
    if token:
        prow = resolve_authenticated_player(token, now_ms)
        if prow and prow.get("username"):
            norm_u = str(prow["username"]).strip().lower()
            disp_u = str(prow.get("display_name") or prow["username"]).strip()
            return f"user:{norm_u}", disp_u
    clean_fb = re.sub(r"[\s<>'\"\\/;]", "", str(fallback_user or "").strip())[:20]
    if len(clean_fb) >= 2:
        return f"user:{clean_fb.lower()}", clean_fb
    return "", ""


def _generate_party_module_plan(track_seed: int, race_dist: int) -> list[str]:
    """Deterministically generates ~12 spliced modular stage segment IDs from trackSeed."""
    state = (int(track_seed) ^ 0x9E3779B9) & 0xFFFFFFFF
    if state == 0:
        state = 0x6D2B79F5

    def next_rand() -> int:
        nonlocal state
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        return state

    mid_count = max(3, int(round(max(510, int(race_dist) - 300) / 170.0)))
    pool = list(PARTY_CORE_MODULES)
    for i in range(len(pool) - 1, 0, -1):
        j = next_rand() % (i + 1)
        pool[i], pool[j] = pool[j], pool[i]

    middle: list[str] = []
    while len(middle) < mid_count:
        for mod_id in pool:
            if len(middle) >= mid_count:
                break
            if middle and middle[-1] == mod_id:
                alt = pool[(pool.index(mod_id) + 1) % len(pool)]
                middle.append(alt)
            else:
                middle.append(mod_id)
        # Reshuffle for any extra segments beyond 9
        for i in range(len(pool) - 1, 0, -1):
            j = next_rand() % (i + 1)
            pool[i], pool[j] = pool[j], pool[i]

    return ["start_launchpad", *middle, "final_sprint"]


def _prune_party_rooms_locked(now_ms: int):
    stale_codes = []
    for code, rm in PARTY_ROOMS.items():
        idle_ms = now_ms - int(rm.get("updatedAtMs") or 0)
        if idle_ms > PARTY_ROOM_IDLE_TTL_MS:
            stale_codes.append(code)
            continue
        if rm.get("status") == "waiting":
            wait_ttl = 120_000 if rm.get("isQuickmatch") else 300_000
            humans = [p for p in rm.get("players", {}).values() if not p.get("isBot")]
            if not humans or all((now_ms - int(p.get("lastSyncMs") or rm.get("updatedAtMs") or 0)) > wait_ttl for p in humans):
                stale_codes.append(code)
    for code in stale_codes:
        PARTY_ROOMS.pop(code, None)
    if PARTY_MATCH_QUEUE:
        PARTY_MATCH_QUEUE[:] = [
            c
            for c in PARTY_MATCH_QUEUE
            if c in PARTY_ROOMS and PARTY_ROOMS[c].get("status") == "waiting" and len(PARTY_ROOMS[c].get("players", {})) < 2
        ]


def _forfeit_party_player_locked(room: dict, quitter_id: str, reason: str, now_ms: int):
    """Cleanly handles mid-race quit, tab close/refresh beacon, or heartbeat timeout."""
    rcode = room.get("roomCode") or ""
    if rcode in PARTY_MATCH_QUEUE:
        PARTY_MATCH_QUEUE.remove(rcode)
    quitter = room["players"].get(quitter_id)
    other_humans = [p for k, p in room["players"].items() if k != quitter_id and not p.get("isBot")]

    if room.get("status") in ("countdown", "racing") and other_humans and quitter:
        survivor = other_humans[0]
        old_nick = quitter.get("nickname") or "对手"
        start_ref = int(room.get("startAtMs") or room.get("createdAtMs") or now_ms)
        elapsed = max(1000, now_ms - start_ref)
        survivor["finishedServerMs"] = now_ms
        survivor["finishedClientMs"] = now_ms
        survivor["elapsedMs"] = elapsed
        room["status"] = "finished"
        room["results"] = [
            {
                "place": 1,
                "title": "🥇 对手退赛判胜",
                "rewardBeans": 500,
                "playerId": survivor["playerId"],
                "nickname": survivor["nickname"],
                "heroId": survivor["heroId"],
                "isBot": False,
                "dist": round(float(survivor.get("dist") or 0.0), 1),
                "elapsedMs": elapsed,
                "finishedServerMs": now_ms,
                "itemsLanded": int(survivor.get("itemsLanded") or 0),
                "itemsUsed": int(survivor.get("itemsUsed") or 0),
                "forfeited": False,
            },
            {
                "place": 2,
                "title": "📡 掉线判负" if reason == "disconnect" else "🏳️ 中途退赛",
                "rewardBeans": 0,
                "playerId": quitter["playerId"],
                "nickname": old_nick,
                "heroId": quitter["heroId"],
                "isBot": bool(quitter.get("isBot")),
                "dist": round(float(quitter.get("dist") or 0.0), 1),
                "elapsedMs": None,
                "finishedServerMs": now_ms,
                "itemsLanded": int(quitter.get("itemsLanded") or 0),
                "itemsUsed": int(quitter.get("itemsUsed") or 0),
                "forfeited": True,
                "forfeitReason": reason,
            },
        ]
        room["players"].pop(quitter_id, None)
        if isinstance(room.get("rematchVotes"), set):
            room["rematchVotes"].discard(quitter_id)
        survivor["inbox"].append(
            {
                "eventId": f"forfeit_{quitter_id}_{now_ms}",
                "type": "rival_forfeit_win",
                "fromNick": old_nick,
                "reason": reason,
            }
        )
        room["updatedAtMs"] = now_ms
    else:
        room["players"].pop(quitter_id, None)
        if isinstance(room.get("rematchVotes"), set):
            room["rematchVotes"].discard(quitter_id)
        humans_left = [p for p in room["players"].values() if not p.get("isBot")]
        if not humans_left:
            if rcode in PARTY_MATCH_QUEUE:
                PARTY_MATCH_QUEUE.remove(rcode)
            PARTY_ROOMS.pop(rcode, None)
        elif room.get("status") == "waiting" and len(humans_left) == 1:
            survivor = humans_left[0]
            room["hostId"] = survivor["playerId"]
            survivor["slot"] = 1
            survivor["ready"] = False
            survivor["lastSyncMs"] = now_ms
            if room.get("wasQuickmatch"):
                room["isQuickmatch"] = True
                if rcode not in PARTY_MATCH_QUEUE:
                    PARTY_MATCH_QUEUE.append(rcode)
            room["updatedAtMs"] = now_ms
        else:
            room["isQuickmatch"] = False


def _make_party_player_state(
    player_id: str, slot: int, nickname: str, hero_id: str, now_ms: int, is_bot: bool = False, account_key: str = "", account_name: str = ""
) -> dict:
    p = {
        "playerId": player_id,
        "slot": slot,
        "nickname": nickname,
        "heroId": hero_id,
        "accountKey": account_key,
        "accountName": account_name,
        "isBot": bool(is_bot),
        "ready": bool(is_bot),
        "x": 120.0,
        "y": 0.0,
        "vx": 0.0,
        "vy": 0.0,
        "dist": 0.0,
        "hp": 100,
        "maxHp": 100,
        "animState": {"onGround": True, "striking": False, "shieldActive": False, "rocketActive": False, "dizzy": False, "clamped": False},
        "shieldUntilMs": 0,
        "shieldConsumedAtMs": 0,
        "oneHitShieldUntilMs": 0,
        "oneHitConsumedAtMs": 0,
        "rocketUntilMs": 0,
        "speech": "",
        "speechUntilMs": 0,
        "itemsUsed": 0,
        "itemsLanded": 0,
        "finishedServerMs": None,
        "finishedClientMs": None,
        "elapsedMs": None,
        "inbox": [],
        "lastSyncMs": now_ms,
    }
    if is_bot:
        p["_bot"] = {
            "lastTickMs": now_ms,
            "nextCrateDist": 70.0,
            "heldItem": "",
            "useItemAtMs": 0,
            "aliveSec": 0.0,
            "koUntilMs": 0,
            "nextHazardCheckM": 95.0,
            "slowUntilMs": 0,
            "slowMult": 1.0,
            "stunUntilMs": 0,
            "clampedUntilMs": 0,
            "boostUntilMs": 0,
            "boostMult": 1.0,
            "hopPhase": 0.0,
        }
    return p


def _public_party_player_view(p: dict | None, now_ms: int) -> dict | None:
    if not p:
        return None
    anim = p.get("animState") if isinstance(p.get("animState"), dict) else {}
    shield_on = (int(p.get("shieldUntilMs") or 0) > now_ms) or (
        bool(anim.get("shieldActive")) and (now_ms - int(p.get("shieldConsumedAtMs") or 0) > 1500)
    )
    one_hit_on = (int(p.get("oneHitShieldUntilMs") or 0) > now_ms) or (
        bool(anim.get("oneHitShield")) and (now_ms - int(p.get("oneHitConsumedAtMs") or 0) > 1500)
    )
    rocket_on = (int(p.get("rocketUntilMs") or 0) > now_ms) or bool(anim.get("rocketActive"))
    speech = p.get("speech") if int(p.get("speechUntilMs") or 0) > now_ms else ""
    return {
        "playerId": p["playerId"],
        "slot": p["slot"],
        "nickname": p["nickname"],
        "heroId": p["heroId"],
        "isBot": bool(p.get("isBot")),
        "ready": bool(p.get("ready") or p.get("isBot")),
        "x": round(float(p.get("x") or 120.0), 1),
        "y": round(float(p.get("y") or 0.0), 1),
        "vx": round(float(p.get("vx") or 0.0), 1),
        "vy": round(float(p.get("vy") or 0.0), 1),
        "dist": round(float(p.get("dist") or 0.0), 1),
        "hp": int(p.get("hp") or 100),
        "animState": anim,
        "shieldActive": shield_on,
        "oneHitShield": one_hit_on,
        "rocketActive": rocket_on,
        "speech": speech or str(anim.get("speech") or "")[:32],
        "itemsUsed": int(p.get("itemsUsed") or 0),
        "itemsLanded": int(p.get("itemsLanded") or 0),
        "finished": p.get("finishedServerMs") is not None,
        "elapsedMs": p.get("elapsedMs"),
        "staleMs": 0 if p.get("isBot") else max(0, now_ms - int(p.get("lastSyncMs") or now_ms)),
    }


def _recompute_party_results_locked(room: dict, now_ms: int):
    finished_players = [
        p for p in room["players"].values() if p.get("finishedServerMs") is not None
    ]
    finished_players.sort(
        key=lambda x: (int(x["finishedServerMs"]), int(x.get("finishedClientMs") or x["finishedServerMs"]))
    )
    results = []
    for idx, fp in enumerate(finished_players):
        place = idx + 1
        results.append(
            {
                "place": place,
                "title": "🥇 冠军梗王" if place == 1 else "🥈 惜败乐子人",
                "rewardBeans": 500 if place == 1 else 200,
                "playerId": fp["playerId"],
                "nickname": fp["nickname"],
                "heroId": fp["heroId"],
                "isBot": bool(fp.get("isBot")),
                "dist": round(float(fp.get("dist") or room["raceDist"]), 1),
                "elapsedMs": int(fp.get("elapsedMs") or max(1000, int(fp["finishedServerMs"]) - int(room.get("startAtMs") or room["createdAtMs"]))),
                "finishedServerMs": int(fp["finishedServerMs"]),
                "itemsLanded": int(fp.get("itemsLanded") or 0),
                "itemsUsed": int(fp.get("itemsUsed") or 0),
            }
        )
    room["results"] = results
    total_players = len(room["players"])
    if total_players >= 2 and len(finished_players) >= total_players:
        room["status"] = "finished"
    elif len(finished_players) >= 1:
        first_ms = int(finished_players[0]["finishedServerMs"])
        # Auto-conclude race if trailing player hasn't crossed 16s after champion finishes
        if now_ms - first_ms >= 16_000:
            for up in room["players"].values():
                if up.get("finishedServerMs") is None:
                    up["finishedServerMs"] = now_ms
                    up["elapsedMs"] = max(1000, now_ms - int(room.get("startAtMs") or room["createdAtMs"]))
            _recompute_party_results_locked(room, now_ms)


def _apply_offensive_hit_to_bot_locked(bot_p: dict, item_id: str, now_ms: int, reflected: bool = False):
    bs = bot_p.get("_bot")
    if not bs:
        return
    if item_id == "bball_rain":
        bs["slowUntilMs"] = max(bs["slowUntilMs"], now_ms + 2600)
        bs["slowMult"] = 0.62
        bot_p["speech"] = "🏀 哎哟我的中分头！" if not reflected else "🥘 被自己篮球砸中了！"
    elif item_id == "lawyer_seal":
        bs["slowUntilMs"] = max(bs["slowUntilMs"], now_ms + 3000)
        bs["slowMult"] = min(bs["slowMult"] if bs["slowUntilMs"] > now_ms else 1.0, 0.80)
        bot_p["speech"] = "📜 律师函糊脸看不见路！"
    elif item_id == "pelican_carry":
        bs["clampedUntilMs"] = max(bs["clampedUntilMs"], now_ms + 1300)
        bot_p["speech"] = "🦢 救命！被鹈鹕叼走了！"
    elif item_id == "manbo_steal":
        bs["slowUntilMs"] = max(bs["slowUntilMs"], now_ms + 3200)
        bs["slowMult"] = 0.72
        bot_p["speech"] = "🐴 曼波把我的车速偷了！"
    elif item_id == "maodie_trap":
        bs["slowUntilMs"] = max(bs["slowUntilMs"], now_ms + 2400)
        bs["slowMult"] = 0.55
        bot_p["speech"] = "😾 哎哟被耄耋扑脸！"
    elif item_id == "naiwa_swarm":
        bs["slowUntilMs"] = max(bs["slowUntilMs"], now_ms + 2600)
        bs["slowMult"] = 0.44
        bot_p["speech"] = "🐸 救命满脸都是冒牌奶蛙！"
    elif item_id == "truck_isekai":
        bs["stunUntilMs"] = max(bs["stunUntilMs"], now_ms + 1250)
        bot_p["speech"] = "🚛 哇啊被泥头车创飞了！"
    elif item_id == "dagou_bite":
        bs["slowUntilMs"] = max(bs["slowUntilMs"], now_ms + 2300)
        bs["slowMult"] = 0.40
        bot_p["speech"] = "🐕 别咬我车屁股啊大狗嚼！"
    elif item_id == "melee_bump":
        bs["slowUntilMs"] = max(bs["slowUntilMs"], now_ms + 1200)
        bs["slowMult"] = 0.52
        bot_p["speech"] = "🐔 哎哟贴脸铁山靠！"
    elif item_id == "lightning_whip":
        bs["stunUntilMs"] = max(bs["stunUntilMs"], now_ms + 1150)
        bot_p["speech"] = "🔔 哎哟大铜钟扣头上了！"
    bot_p["speechUntilMs"] = now_ms + 1800


def _process_party_item_event_locked(room: dict, caller: dict, rival: dict | None, evt: dict, now_ms: int):
    if not isinstance(evt, dict):
        return
    raw_eid = str(evt.get("eventId") or "").strip()[:80]
    event_id = re.sub(r"[^A-Za-z0-9_:-]", "", raw_eid) or f"evt_{caller['playerId']}_{now_ms}_{len(room['processedEventIds'])}"
    if event_id in room["processedEventIds"]:
        return
    room["processedEventIds"].add(event_id)
    if len(room["processedEventIds"]) > 600:
        room["processedEventIds"] = set(list(room["processedEventIds"])[-350:])

    item_id = str(evt.get("itemId") or "").strip()
    if item_id not in PARTY_VALID_ITEMS:
        return

    caller["itemsUsed"] = int(caller.get("itemsUsed") or 0) + 1
    caller["speech"] = ""
    caller["speechUntilMs"] = 0

    if item_id == "timed_shield":
        caller["oneHitShieldUntilMs"] = now_ms + 7000
        caller["oneHitConsumedAtMs"] = 0
        return

    if item_id == "pan_shield":
        caller["shieldUntilMs"] = now_ms + 4500
        caller["shieldConsumedAtMs"] = 0
        return

    if item_id == "kun_rocket":
        caller["rocketUntilMs"] = now_ms + 3000
        if caller.get("isBot") and caller.get("_bot"):
            caller["_bot"]["boostUntilMs"] = now_ms + 3000
            caller["_bot"]["boostMult"] = 2.05
        if rival and not rival.get("isBot"):
            rival["inbox"].append(
                {
                    "eventId": f"{event_id}_cast_notice",
                    "type": "rival_boost_notice",
                    "itemId": item_id,
                    "fromNick": caller["nickname"],
                }
            )
        return

    if item_id == "ddj_rush":
        caller["rocketUntilMs"] = max(int(caller.get("rocketUntilMs") or 0), now_ms + 1450)
        if caller.get("isBot") and caller.get("_bot"):
            caller["_bot"]["boostUntilMs"] = max(caller["_bot"]["boostUntilMs"], now_ms + 1450)
            caller["_bot"]["boostMult"] = 1.82
        return

    if item_id == "bean_nitro":
        caller["rocketUntilMs"] = max(int(caller.get("rocketUntilMs") or 0), now_ms + 2650)
        if caller.get("isBot") and caller.get("_bot"):
            caller["_bot"]["boostUntilMs"] = max(caller["_bot"]["boostUntilMs"], now_ms + 2650)
            caller["_bot"]["boostMult"] = 1.54
        return

    if item_id == "hero_skill_hit":
        if not rival:
            return
        rival_anim_sk = rival.get("animState") if isinstance(rival.get("animState"), dict) else {}
        rival_one_hit_sk = (int(rival.get("oneHitShieldUntilMs") or 0) > now_ms) or (
            bool(rival_anim_sk.get("oneHitShield")) and (now_ms - int(rival.get("oneHitConsumedAtMs") or 0) > 1500)
        )
        if rival_one_hit_sk:
            rival["oneHitShieldUntilMs"] = 0
            rival["oneHitConsumedAtMs"] = now_ms
            if isinstance(rival.get("animState"), dict):
                rival["animState"]["oneHitShield"] = False
            if not rival.get("isBot"):
                rival["inbox"].append({"eventId": f"{event_id}_skblk", "type": "one_hit_shield_block", "itemId": "melee_bump"})
            if not caller.get("isBot"):
                caller["inbox"].append({"eventId": f"{event_id}_skblk_ack", "type": "attack_blocked_ack", "itemId": "melee_bump"})
            return

        dmg = min(45, max(16, int(evt.get("dmg") or 30)))
        cur_hp = int(rival.get("hp") or 100) - dmg
        if cur_hp <= 0:
            rival["hp"] = 100
            caller["itemsLanded"] = int(caller.get("itemsLanded") or 0) + 1
            if rival.get("isBot") and rival.get("_bot"):
                rival["_bot"]["koUntilMs"] = now_ms + 2400
                rival["_bot"]["aliveSec"] = 0.0
                rival["speech"] = "💀 被技能击毙！速度归零重跑！"
                rival["speechUntilMs"] = now_ms + 2200
            elif not rival.get("isBot"):
                rival["inbox"].append(
                    {
                        "eventId": f"{event_id}_ko_v",
                        "type": "hero_ko_victim",
                        "fromNick": caller["nickname"],
                    }
                )
            if not caller.get("isBot"):
                caller["inbox"].append(
                    {
                        "eventId": f"{event_id}_ko_k",
                        "type": "hero_ko_killer",
                        "targetNick": rival["nickname"],
                    }
                )
        else:
            rival["hp"] = cur_hp
            if not rival.get("isBot"):
                rival["inbox"].append(
                    {
                        "eventId": f"{event_id}_skhurt",
                        "type": "hero_skill_hurt",
                        "dmg": dmg,
                        "fromNick": caller["nickname"],
                    }
                )
            if not caller.get("isBot"):
                caller["inbox"].append(
                    {
                        "eventId": f"{event_id}_skack",
                        "type": "hero_skill_ack",
                        "dmg": dmg,
                        "rivalHp": cur_hp,
                    }
                )
        return

    # Only use ground-mine mode if explicitly requested via legacyTrap=True;
    # otherwise ALL offensive items (including 😾 maodie_trap!) lock-on & home onto rival 100%!
    if item_id == "maodie_trap" and evt.get("legacyTrap") is True:
        max_world_x = 120.0 + float(room["raceDist"]) * 18.0 - 60.0
        tx = max(160.0, min(max_world_x, float(evt.get("trapX") or caller.get("x") or 200.0)))
        ty = float(evt.get("trapY") or 0.0)
        trap_id = f"trap_{event_id}"[:64]
        if not any(t["trapId"] == trap_id for t in room["trackTraps"]):
            room["trackTraps"].append(
                {
                    "trapId": trap_id,
                    "kind": "maodie_trap",
                    "ownerId": caller["playerId"],
                    "ownerNick": caller["nickname"],
                    "x": round(tx, 1),
                    "y": round(ty, 1),
                    "createdAtMs": now_ms,
                    "active": True,
                }
            )
        return

    # Self-boost side of hybrid offensive items when bot uses them
    if caller.get("isBot") and caller.get("_bot"):
        bs = caller["_bot"]
        if item_id == "pelican_carry":
            bs["boostUntilMs"] = max(bs["boostUntilMs"], now_ms + 2500)
            bs["boostMult"] = 1.45
        elif item_id == "manbo_steal":
            bs["boostUntilMs"] = max(bs["boostUntilMs"], now_ms + 3200)
            bs["boostMult"] = 1.34
        elif item_id == "lightning_whip":
            bs["boostUntilMs"] = max(bs["boostUntilMs"], now_ms + 1450)
            bs["boostMult"] = 1.68

    if not rival:
        return

    rival_anim = rival.get("animState") if isinstance(rival.get("animState"), dict) else {}
    rival_shielded = (int(rival.get("shieldUntilMs") or 0) > now_ms) or (
        bool(rival_anim.get("shieldActive")) and (now_ms - int(rival.get("shieldConsumedAtMs") or 0) > 1500)
    )

    if rival_shielded:
        rival["shieldUntilMs"] = 0
        rival["shieldConsumedAtMs"] = now_ms
        if isinstance(rival.get("animState"), dict):
            rival["animState"]["shieldActive"] = False
        rival["itemsLanded"] = int(rival.get("itemsLanded") or 0) + 1
        rival["speech"] = "🥘 铁锅反弹！露出鸡脚了吧！"
        rival["speechUntilMs"] = now_ms + 2600

        if not rival.get("isBot"):
            rival["inbox"].append(
                {
                    "eventId": f"{event_id}_shield_win",
                    "type": "shield_reflect_win",
                    "itemId": item_id,
                    "fromId": caller["playerId"],
                    "fromNick": caller["nickname"],
                    "reflected": True,
                    "banner": "🥘 铁锅反弹！小黑子露出鸡脚了吧！",
                }
            )

        if caller.get("isBot"):
            _apply_offensive_hit_to_bot_locked(caller, item_id, now_ms, reflected=True)
        else:
            caller["inbox"].append(
                {
                    "eventId": f"{event_id}_reflected",
                    "type": "attack",
                    "itemId": item_id,
                    "fromId": rival["playerId"],
                    "fromNick": rival["nickname"],
                    "targetId": caller["playerId"],
                    "reflected": True,
                    "banner": "🥘 铁锅反弹！小黑子露出鸡脚了吧！",
                }
            )
        return

    rival_one_hit = (int(rival.get("oneHitShieldUntilMs") or 0) > now_ms) or (
        bool(rival_anim.get("oneHitShield")) and (now_ms - int(rival.get("oneHitConsumedAtMs") or 0) > 1500)
    )
    if rival_one_hit:
        rival["oneHitShieldUntilMs"] = 0
        rival["oneHitConsumedAtMs"] = now_ms
        if isinstance(rival.get("animState"), dict):
            rival["animState"]["oneHitShield"] = False
        if not rival.get("isBot"):
            rival["inbox"].append(
                {
                    "eventId": f"{event_id}_onehit_block",
                    "type": "one_hit_shield_block",
                    "itemId": item_id,
                    "fromId": caller["playerId"],
                    "fromNick": caller["nickname"],
                }
            )
        if not caller.get("isBot"):
            caller["inbox"].append(
                {
                    "eventId": f"{event_id}_blk_ack",
                    "type": "attack_blocked_ack",
                    "itemId": item_id,
                    "targetNick": rival["nickname"],
                }
            )
        return

    # Direct hit on rival (deals 30~50 differentiated HP damage; lethal KO resets rival speed to minimum!)
    caller["itemsLanded"] = int(caller.get("itemsLanded") or 0) + 1
    item_dmg = int(PARTY_ITEM_DAMAGE.get(item_id, 35))
    next_rival_hp = int(rival.get("hp") or 100) - item_dmg
    lethal_ko = next_rival_hp <= 0
    if lethal_ko:
        rival["hp"] = 100
    else:
        rival["hp"] = next_rival_hp

    banner_txt = PARTY_ITEM_BANNERS.get(item_id, "💥 遭到对手梗道具袭击！")
    if not caller.get("isBot"):
        caller["inbox"].append(
            {
                "eventId": f"{event_id}_hit_ack",
                "type": "attack_hit_confirm",
                "itemId": item_id,
                "dmg": item_dmg,
                "lethalKo": lethal_ko,
                "targetNick": rival["nickname"],
                "comboHits": caller["itemsLanded"],
            }
        )
    if rival.get("isBot"):
        _apply_offensive_hit_to_bot_locked(rival, item_id, now_ms, reflected=False)
        if lethal_ko and rival.get("_bot"):
            rival["_bot"]["koUntilMs"] = now_ms + 2400
            rival["_bot"]["aliveSec"] = 0.0
            rival["speech"] = "💀 血条被打空！速度归零！"
            rival["speechUntilMs"] = now_ms + 2200
    else:
        rival["inbox"].append(
            {
                "eventId": event_id,
                "type": "attack",
                "itemId": item_id,
                "dmg": item_dmg,
                "lethalKo": lethal_ko,
                "fromId": caller["playerId"],
                "fromNick": caller["nickname"],
                "targetId": rival["playerId"],
                "reflected": False,
                "banner": banner_txt,
            }
        )


def _tick_party_bot_locked(room: dict, bot_p: dict, human_p: dict | None, now_ms: int):
    bs = bot_p.get("_bot")
    if not bs:
        return
    prev_ms = int(bs.get("lastTickMs") or now_ms)
    bs["lastTickMs"] = now_ms
    if room.get("status") not in ("countdown", "racing"):
        return
    start_at = int(room.get("startAtMs") or now_ms)
    if now_ms < start_at:
        bot_p["x"] = 120.0
        bot_p["dist"] = 0.0
        bot_p["vx"] = 0.0
        return
    if room["status"] == "countdown":
        room["status"] = "racing"
    if bot_p.get("finishedServerMs") is not None:
        bot_p["vx"] = 0.0
        return

    dt = min(0.25, max(0.0, (now_ms - prev_ms) / 1000.0))
    if dt <= 0.0001:
        return

    human_dist = float(human_p.get("dist") or 0.0) if human_p else 0.0
    bot_dist = float(bot_p.get("dist") or 0.0)
    gap_m = human_dist - bot_dist  # >0 means bot is trailing behind human

    # Bot also obeys exact 40s linear 1.0x -> 2.0x alive speed ramp (resets to 1.0x on KO!)
    ko_crawling = now_ms < int(bs.get("koUntilMs") or 0)
    if ko_crawling:
        bs["aliveSec"] = 0.0
    else:
        bs["aliveSec"] = min(40.0, float(bs.get("aliveSec") or 0.0) + dt)
    bot_alive_mult = 1.0 + min(1.0, float(bs["aliveSec"]) / 40.0)

    clamped = now_ms < int(bs.get("clampedUntilMs") or 0)
    stunned = now_ms < int(bs.get("stunUntilMs") or 0)
    rocket_on = now_ms < int(bot_p.get("rocketUntilMs") or 0)
    shield_on = now_ms < int(bot_p.get("shieldUntilMs") or 0)

    # Occasional simulated hazard mistake if bot is far ahead so bot also experiences survival pressure
    if bot_p["dist"] >= float(bs.get("nextHazardCheckM") or 95.0):
        bs["nextHazardCheckM"] = bot_p["dist"] + 115.0
        if gap_m < -24.0 and (now_ms % 5 == 0) and not rocket_on:
            bot_p["hp"] = max(0, int(bot_p.get("hp") or 100) - 38)
            if bot_p["hp"] <= 0:
                bot_p["hp"] = 100
                bs["koUntilMs"] = now_ms + 2200
                bs["aliveSec"] = 0.0
                ko_crawling = True
                bot_p["speech"] = "💥 撞障翻车！加速归零！"
                bot_p["speechUntilMs"] = now_ms + 1800

    base_spd = 365.0 * bot_alive_mult
    if gap_m > 16.0:
        base_spd *= min(1.36, 1.0 + (gap_m - 16.0) * 0.011)
    elif gap_m < -20.0:
        base_spd *= max(0.76, 1.0 + (gap_m + 20.0) * 0.009)

    if ko_crawling:
        spd = 58.0
    elif stunned:
        spd = 65.0
    elif clamped:
        spd = 95.0
    else:
        spd = base_spd
        if now_ms < int(bs.get("boostUntilMs") or 0):
            spd *= float(bs.get("boostMult") or 1.35)
        if not rocket_on and now_ms < int(bs.get("slowUntilMs") or 0):
            spd *= float(bs.get("slowMult") or 0.65)

    # Gentle Distance-Proportional Elastic Rope Pull (`L0 = 150px`, softened influence coefficient!)
    if human_p:
        hx = float(human_p.get("x") or 120.0)
        dx_px = hx - float(bot_p["x"])  # >0 means human is ahead of bot
        abs_dx = abs(dx_px)
        rope_rest = 150.0
        if abs_dx > rope_rest:
            stretch = abs_dx - rope_rest
            pull_v = min(72.0, stretch * 0.065)
            if dx_px > 0:
                spd += pull_v
            else:
                drag_scale = 0.16 if rocket_on else 0.48
                spd = max(145.0, spd - pull_v * drag_scale)

    bot_p["vx"] = spd
    bot_p["x"] += spd * dt
    bot_p["dist"] = max(0.0, (bot_p["x"] - 120.0) / 18.0)

    # Simulated rhythmic jump hops so bot visibly leaps over obstacles & rails
    bs["hopPhase"] = (float(bs.get("hopPhase") or 0.0) + dt * 1.9) % (math.pi * 2.0)
    hop_sin = math.sin(bs["hopPhase"])
    in_air = hop_sin > 0.58 or clamped
    hop_lift = -95.0 if clamped else (-max(0.0, (hop_sin - 0.58) / 0.42) * 86.0 if in_air else 0.0)
    t_wave = max(0.0, bot_p["x"] - 380.0) * 0.0016
    road_y = math.sin(t_wave) * 20.0 + math.sin(t_wave * 2.1 + 1.1) * 9.0
    bot_p["y"] = road_y + hop_lift
    bot_p["vy"] = -220.0 if in_air else 0.0

    bot_p["animState"] = {
        "onGround": not in_air,
        "striking": (int(now_ms // 220) % 13 == 0) and not stunned,
        "shieldActive": shield_on,
        "rocketActive": rocket_on,
        "dizzy": stunned or (now_ms < int(bs.get("slowUntilMs") or 0) and float(bs.get("slowMult") or 1.0) <= 0.58),
        "clamped": clamped,
    }

    # Check shared trackTraps placed by human
    for trap in room["trackTraps"]:
        if not trap.get("active") or trap.get("ownerId") == bot_p["playerId"]:
            continue
        if abs(bot_p["x"] - float(trap["x"])) < 46.0 and not in_air:
            trap["active"] = False
            if shield_on:
                bot_p["shieldUntilMs"] = 0
                bot_p["shieldConsumedAtMs"] = now_ms
                bot_p["speech"] = "🥘 铁锅挡下耄耋陷阱！"
                bot_p["speechUntilMs"] = now_ms + 2200
            else:
                bs["slowUntilMs"] = max(bs["slowUntilMs"], now_ms + 2200)
                bs["slowMult"] = 0.55
                bot_p["speech"] = "😾 哎哟踩到圆头耄耋了！"
                bot_p["speechUntilMs"] = now_ms + 2200
                if human_p:
                    human_p["itemsLanded"] = int(human_p.get("itemsLanded") or 0) + 1
                    human_p["inbox"].append(
                        {
                            "eventId": f"traphit_{trap['trapId']}",
                            "type": "trap_landed_ack",
                            "itemId": "maodie_trap",
                            "fromId": bot_p["playerId"],
                            "fromNick": bot_p["nickname"],
                            "banner": f"😾 {bot_p['nickname']} 一脚踩中了你的圆头耄耋路障！",
                        }
                    )

    # Bot crate pickup & rubber-banded meme item usage!
    if bot_p["dist"] >= float(bs.get("nextCrateDist") or 75.0) and bot_p["dist"] < float(room["raceDist"]) - 45.0:
        bs["nextCrateDist"] = bot_p["dist"] + 155.0 + ((now_ms % 5) * 14.0)
        if not bs.get("heldItem"):
            if gap_m > 18.0:
                choices = ("truck_isekai", "naiwa_swarm", "dagou_bite", "pelican_carry", "kun_rocket", "ddj_rush", "lightning_whip")
            else:
                choices = ("naiwa_swarm", "truck_isekai", "dagou_bite", "bball_rain", "maodie_trap", "timed_shield", "ddj_rush", "bean_nitro", "pan_shield", "manbo_steal")
            bs["heldItem"] = choices[(now_ms // 97) % len(choices)]
            bs["useItemAtMs"] = now_ms + 1500 + (now_ms % 1300)

    if bs.get("heldItem") and now_ms >= int(bs.get("useItemAtMs") or 0) and not stunned and not clamped:
        chosen_item = bs["heldItem"]
        bs["heldItem"] = ""
        _process_party_item_event_locked(
            room,
            bot_p,
            human_p,
            {"eventId": f"bot_evt_{room['roomCode']}_{now_ms}", "itemId": chosen_item},
            now_ms,
        )

    if bot_p["dist"] >= float(room["raceDist"]) and bot_p.get("finishedServerMs") is None:
        bot_p["dist"] = float(room["raceDist"])
        bot_p["x"] = 120.0 + float(room["raceDist"]) * 18.0
        bot_p["finishedServerMs"] = now_ms
        bot_p["finishedClientMs"] = now_ms
        bot_p["elapsedMs"] = max(1000, now_ms - start_at)
        _recompute_party_results_locked(room, now_ms)


def _party_clean_room_code(raw: object) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(raw or "").strip().upper())[:8]


def _create_party_room_locked(
    player_id: str,
    nickname: str,
    hero_id: str,
    race_dist: int,
    now_ms: int,
    is_quickmatch: bool = False,
    account_key: str = "",
    account_name: str = "",
    custom_code: str = "",
) -> dict:
    _prune_party_rooms_locked(now_ms)
    room_code = ""
    if custom_code:
        existing = PARTY_ROOMS.get(custom_code)
        if existing:
            if existing.get("status") == "finished" and (now_ms - int(existing.get("updatedAtMs") or 0)) > 15_000:
                PARTY_ROOMS.pop(custom_code, None)
            else:
                return {"_error": f"房号【{custom_code}】已被使用，请换一个房号或直接点击“加入”进房！"}
        room_code = custom_code
    else:
        for _ in range(120):
            cand = f"{secrets.randbelow(9000) + 1000}"
            if cand not in PARTY_ROOMS:
                room_code = cand
                break
        if not room_code:
            room_code = f"{(now_ms % 9000) + 1000}"

    track_seed = secrets.randbelow(1_900_000_000) + 100_000
    module_plan = _generate_party_module_plan(track_seed, race_dist)
    p1 = _make_party_player_state(
        player_id, 1, nickname, hero_id, now_ms, is_bot=False, account_key=account_key, account_name=account_name
    )

    room = {
        "roomCode": room_code,
        "roundId": 1,
        "hostId": player_id,
        "status": "waiting",
        "isQuickmatch": bool(is_quickmatch),
        "wasQuickmatch": bool(is_quickmatch),
        "raceDist": race_dist,
        "trackSeed": track_seed,
        "modulePlan": module_plan,
        "createdAtMs": now_ms,
        "updatedAtMs": now_ms,
        "startAtMs": None,
        "players": {player_id: p1},
        "processedEventIds": set(),
        "trackTraps": [],
        "results": [],
        "rematchVotes": set(),
    }
    PARTY_ROOMS[room_code] = room
    if is_quickmatch and room_code not in PARTY_MATCH_QUEUE:
        PARTY_MATCH_QUEUE.append(room_code)
    return room


def _build_party_room_response_locked(room: dict, caller_id: str, now_ms: int, drain_inbox: bool = False) -> dict:
    caller = room["players"].get(caller_id)
    rival = None
    for pid, pobj in room["players"].items():
        if pid != caller_id:
            rival = pobj
            break

    incoming = []
    if caller and drain_inbox and caller["inbox"]:
        incoming = list(caller["inbox"])
        caller["inbox"].clear()

    active_traps = [t for t in room["trackTraps"] if t.get("active")]
    return {
        "ok": True,
        "roomCode": room["roomCode"],
        "roundId": int(room.get("roundId") or 1),
        "status": room["status"],
        "isQuickmatch": bool(room.get("isQuickmatch")),
        "raceDist": room["raceDist"],
        "trackSeed": room["trackSeed"],
        "modulePlan": room["modulePlan"],
        "startAtMs": room["startAtMs"],
        "serverNowMs": now_ms,
        "you": _public_party_player_view(caller, now_ms),
        "rival": _public_party_player_view(rival, now_ms),
        "incomingEvents": incoming,
        "trackTraps": active_traps,
        "results": room["results"],
        "rematchVotes": sorted(list(room.get("rematchVotes", set()))),
        "playerCount": len(room["players"]),
    }


class GameHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def end_headers(self):
        req_p = getattr(self, "path", "").split("?", 1)[0].lower()
        if not req_p.startswith("/api/"):
            if req_p in ("/", "/index.html") or req_p.endswith((".html", ".js", ".mjs", ".css")):
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            else:
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
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Pay-Timestamp, X-Pay-Nonce, X-Pay-Signature")
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
            return self.send_json(
                {
                    "ok": True,
                    "game": "鹈鹕测试大乱斗",
                    "localSqlite": True,
                    "shield": True,
                    "conflictEngine": "v6.2",
                    "rechargeChannel": "v6.4-real-pay",
                    "partyRace": True,
                    "realPay": REAL_PAY_ENABLED,
                    "sandboxPay": SANDBOX_PAY_ENABLED,
                }
            )
        if path == "/api/party/room":
            from urllib.parse import parse_qs, urlparse

            qs = parse_qs(urlparse(self.path).query)
            rcode = _party_clean_room_code((qs.get("roomCode") or [""])[0])
            pid = _party_clean_id((qs.get("playerId") or [""])[0])
            qs_hero = (qs.get("heroId") or [""])[0].strip()
            with PARTY_LOCK:
                _prune_party_rooms_locked(now)
                rm = PARTY_ROOMS.get(rcode)
                if not rm:
                    return self.send_json({"ok": False, "error": "房间不存在或已过期"}, 404)
                if pid in rm["players"]:
                    me_p = rm["players"][pid]
                    me_p["lastSyncMs"] = now
                    rm["updatedAtMs"] = now
                    if qs_hero in VALID_HEROES and (rm.get("status") in ("waiting", "finished") or me_p.get("finishedServerMs") is not None):
                        me_p["heroId"] = qs_hero
                if rm.get("status") == "finished":
                    for op_id, op_obj in list(rm["players"].items()):
                        if op_id != pid and not op_obj.get("isBot") and (now - int(op_obj.get("lastSyncMs") or now)) > 120000:
                            _forfeit_party_player_locked(rm, op_id, "disconnect", now)
                return self.send_json(_build_party_room_response_locked(rm, pid, now, drain_inbox=False))
        if path == "/api/pay/alipay_return":
            from urllib.parse import parse_qs, urlparse

            _refresh_alipay_keys_if_needed()
            qs = parse_qs(urlparse(self.path).query)
            oid = (qs.get("out_trade_no") or [""])[0].strip()[:48]
            if oid and ALIPAY_DIRECT_CONFIGURED:
                alipay_query_and_settle_order(oid, now)
            html_bytes = (
                "<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'/>"
                "<meta name='viewport' content='width=device-width,initial-scale=1'/>"
                "<title>支付完成 · 鹈鹕测试大乱斗</title></head>"
                "<body style='background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;"
                "justify-content:center;height:100vh;margin:0;text-align:center;'>"
                "<div><h2 style='color:#4ade80;'>✅ 支付宝付款已完成</h2>"
                "<p>绿豆正在同步入账，正在自动返回车库...</p>"
                "<a href='/' style='display:inline-block;margin-top:12px;padding:10px 22px;background:#38bdf8;color:#0f172a;"
                "border-radius:999px;font-weight:900;text-decoration:none;'>立即返回游戏</a></div>"
                "<script>setTimeout(()=>location.replace('/'),1200);</script></body></html>"
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html_bytes)))
            self.end_headers()
            self.wfile.write(html_bytes)
            return

        if path == "/api/pay/go":
            from urllib.parse import parse_qs, urlparse

            _refresh_alipay_keys_if_needed()
            qs = parse_qs(urlparse(self.path).query)
            oid = (qs.get("oid") or [""])[0].strip()[:48]
            if not oid or not ALIPAY_DIRECT_CONFIGURED:
                return self.send_plain_text("Invalid order", 400)
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                orow = conn.execute("SELECT * FROM recharge_orders WHERE order_id = ?", (oid,)).fetchone()
            if not orow or orow["status"] != "PENDING":
                self.send_response(302)
                self.send_header("Location", "/")
                self.end_headers()
                return
            ua = str(self.headers.get("User-Agent") or "")
            is_mobile = bool(re.search(r"Mobile|Android|iPhone|iPad|AlipayClient", ua, re.I))
            host_hdr = self.headers.get("Host") or "127.0.0.1:8788"
            target = _build_alipay_redirect_url(
                "alipay.trade.wap.pay" if is_mobile else "alipay.trade.page.pay",
                {
                    "out_trade_no": oid,
                    "total_amount": f"{int(orow['amount_fen']) / 100.0:.2f}",
                    "subject": f"鹈鹕测试大乱斗-{orow['pack_name']}"[:64],
                    "product_code": "QUICK_WAP_WAY" if is_mobile else "FAST_INSTANT_TRADE_PAY",
                    "timeout_express": "20m",
                },
                notify_url="https://nailong.openwaifu-agent.uk/api/pay/alipay_notify",
                return_url=f"http://{host_hdr}/api/pay/alipay_return",
            )
            self.send_response(302)
            self.send_header("Location", target)
            self.end_headers()
            return

        if path == "/api/pay/catalog":
            _refresh_alipay_keys_if_needed()
            token = self.extract_token()
            first_eligible = True
            logged_in = False
            username_disp = ""
            if token:
                prow = resolve_authenticated_player(token, now)
                if prow:
                    logged_in = True
                    username_disp = prow["display_name"]
                    with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                        paid_cnt = conn.execute(
                            "SELECT COUNT(*) FROM recharge_orders WHERE username = ? AND status = 'PAID'",
                            (prow["username"],),
                        ).fetchone()[0]
                        first_eligible = int(paid_cnt) == 0
            packs_out = [
                {
                    "id": p["id"],
                    "name": p["name"],
                    "priceYuan": p["price_yuan"],
                    "amountFen": p["amount_fen"],
                    "baseBeans": p["base_beans"],
                    "bonusBeans": p["bonus_beans"],
                    "totalBeans": p["total_beans"],
                    "bonusPctLbl": p["bonus_pct_lbl"],
                    "badge": p["badge"],
                }
                for p in RECHARGE_PACKS.values()
            ]
            return self.send_json(
                {
                    "ok": True,
                    "loggedIn": logged_in,
                    "username": username_disp,
                    "firstBonusBeans": FIRST_RECHARGE_BONUS_BEANS,
                    "firstBonusEligible": first_eligible,
                    "realPayEnabled": REAL_PAY_ENABLED,
                    "sandboxEnabled": SANDBOX_PAY_ENABLED,
                    "packs": packs_out,
                }
            )

        if path == "/api/pay/status":
            token = self.extract_token()
            prow = resolve_authenticated_player(token, now)
            if not prow:
                return self.send_json({"ok": False, "error": "请先登录账号"}, 401)
            from urllib.parse import parse_qs, urlparse

            qs = parse_qs(urlparse(self.path).query)
            order_id = (qs.get("orderId") or [""])[0].strip()[:48]
            force_sync = (qs.get("force") or [""])[0] == "1"
            if not order_id:
                return self.send_json({"ok": False, "error": "缺少订单号"}, 400)

            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                orow = conn.execute("SELECT * FROM recharge_orders WHERE order_id = ?", (order_id,)).fetchone()
            if not orow:
                return self.send_json({"ok": False, "error": "订单不存在"}, 404)
            if orow["username"] != prow["username"]:
                return self.send_json({"ok": False, "error": "无权查询他人订单"}, 403)

            # Query authoritative real payment gateway if order is not yet PAID!
            if orow["status"] == "PENDING" and REAL_PAY_ENABLED:
                if ALIPAY_DIRECT_CONFIGURED:
                    alipay_query_and_settle_order(order_id, now)
                if ALLOW_AFDIAN_FALLBACK and AFDIAN_USER_ID and AFDIAN_TOKEN:
                    sync_real_afdian_payments(now_ms=now, force=force_sync)

            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                orow = conn.execute("SELECT * FROM recharge_orders WHERE order_id = ?", (order_id,)).fetchone()
                if orow["status"] == "PENDING" and now > int(orow["expires_at"]):
                    conn.execute(
                        "UPDATE recharge_orders SET status = 'EXPIRED' WHERE order_id = ? AND status = 'PENDING'",
                        (order_id,),
                    )
                    conn.commit()
                    orow = conn.execute("SELECT * FROM recharge_orders WHERE order_id = ?", (order_id,)).fetchone()

                auth_sync = None
                if orow["status"] == "PAID":
                    fresh_p = conn.execute(
                        "SELECT display_name, save_json FROM players WHERE username = ?", (prow["username"],)
                    ).fetchone()
                    if fresh_p:
                        parsed_raw = json.loads(fresh_p["save_json"])
                        auth_sync = build_signed_auth_payload(
                            fresh_p["display_name"], sanitize_save(parsed_raw, None), extract_save_rev(parsed_raw), now
                        )
            return self.send_json({"ok": True, "order": format_order_dict(orow), "authSync": auth_sync})

        if path == "/api/pay/orders":
            token = self.extract_token()
            prow = resolve_authenticated_player(token, now)
            if not prow:
                return self.send_json({"ok": False, "error": "请先登录账号"}, 401)
            if REAL_PAY_ENABLED:
                sync_real_afdian_payments(now_ms=now, force=True)
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                conn.execute(
                    "UPDATE recharge_orders SET status = 'EXPIRED' WHERE username = ? AND status = 'PENDING' AND expires_at < ?",
                    (prow["username"], now),
                )
                conn.commit()
                rows = conn.execute(
                    "SELECT * FROM recharge_orders WHERE username = ? ORDER BY created_at DESC LIMIT 15",
                    (prow["username"],),
                ).fetchall()
                stats = conn.execute(
                    "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_fen), 0) AS fen, COALESCE(SUM(credited_beans), 0) AS beans FROM recharge_orders WHERE username = ? AND status = 'PAID'",
                    (prow["username"],),
                ).fetchone()
            return self.send_json(
                {
                    "ok": True,
                    "firstBonusEligible": int(stats["cnt"]) == 0,
                    "totalPaidCount": int(stats["cnt"]),
                    "totalPaidYuan": round(int(stats["fen"]) / 100.0, 2),
                    "totalCreditedBeans": int(stats["beans"]),
                    "orders": [format_order_dict(r) for r in rows],
                }
            )
        if path == "/api/auth/ticket":
            c_status, c_data = proxy_cloud_api("GET", "/api/auth/ticket")
            if c_status == 200 and isinstance(c_data, dict) and c_data.get("ticket"):
                return self.send_json(c_data, 200)
            ip_hash = self.client_ip_hash()
            return self.send_json({"ok": True, "ticket": make_ticket(ip_hash, now)})
        if path == "/api/run_log":
            tok_hdr = self.extract_token()
            if not tok_hdr:
                return self.send_json({"ok": False, "error": "未登录"}, 401)
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                prow = conn.execute("SELECT username, display_name FROM players WHERE token = ?", (tok_hdr,)).fetchone()
                if not prow:
                    return self.send_json({"ok": False, "error": "登录已失效"}, 401)
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS run_history (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      player_key TEXT NOT NULL,
                      username TEXT,
                      mode TEXT NOT NULL,
                      hero TEXT NOT NULL,
                      single_dist INTEGER NOT NULL,
                      beans_earned INTEGER NOT NULL,
                      boss_kills INTEGER NOT NULL,
                      duration_sec INTEGER NOT NULL,
                      extra_note TEXT,
                      created_at INTEGER NOT NULL
                    )
                    """
                )
                rows = conn.execute(
                    "SELECT mode, hero, single_dist, beans_earned, boss_kills, duration_sec, extra_note, created_at FROM run_history WHERE player_key = ? ORDER BY id DESC LIMIT 15",
                    (f"u:{prow['username']}",),
                ).fetchall()
            return self.send_json({"ok": True, "username": prow["display_name"], "runs": [dict(r) for r in rows]})

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
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                local_fast = conn.execute(
                    "SELECT username, display_name, save_json FROM players WHERE token = ?", (token,)
                ).fetchone()
                local_is_paid = has_local_paid_orders(conn, local_fast["username"]) if local_fast else False
            if local_fast and local_is_paid:
                parsed_raw = json.loads(local_fast["save_json"])
                return self.send_json(
                    build_signed_auth_payload(
                        local_fast["display_name"], sanitize_save(parsed_raw, None), extract_save_rev(parsed_raw), now
                    ),
                    200,
                )
            c_status, c_data = proxy_cloud_api("GET", "/api/auth/me", None, f"Bearer {token}")
            if c_status == 200 and isinstance(c_data, dict) and c_data.get("ok"):
                merged_save, eff_rev = sync_cloud_row_into_local(
                    c_data.get("username"), token, c_data.get("save"), c_data.get("rev") or 1, c_data.get("updatedAt") or now
                )
                return self.send_json(build_signed_auth_payload(c_data.get("username"), merged_save, eff_rev, now), 200)
            if not local_fast:
                return self.send_json({"ok": False, "error": "登录已失效"}, 401)
            parsed_raw = json.loads(local_fast["save_json"])
            rev = extract_save_rev(parsed_raw)
            clean_save = sanitize_save(parsed_raw, None)
            return self.send_json(build_signed_auth_payload(local_fast["display_name"], clean_save, rev, now), 200)

        # Localhost-only zero-leak dev test panel injection (NEVER touches index.html on disk or Worker!)
        client_ip = (self.client_address[0] if self.client_address else "")
        is_loopback = client_ip in ("127.0.0.1", "::1") or client_ip.startswith("127.")
        dev_panel_path = os.path.join(ROOT_DIR, "_local_dev_panel.js")
        if is_loopback and path == "/__local_dev_panel.js" and os.path.isfile(dev_panel_path):
            with open(dev_panel_path, "rb") as fp:
                js_bytes = fp.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(js_bytes)))
            self.end_headers()
            self.wfile.write(js_bytes)
            return

        if is_loopback and path in ("/", "/index.html") and os.path.isfile(dev_panel_path):
            idx_path = os.path.join(ROOT_DIR, "index.html")
            if os.path.isfile(idx_path):
                with open(idx_path, "r", encoding="utf-8") as fp:
                    html_txt = fp.read()
                inject_tag = f'<script src="/__local_dev_panel.js?t={int(os.path.getmtime(dev_panel_path))}"></script>\n</body>'
                html_out = html_txt.replace("</body>", inject_tag, 1).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(html_out)))
                self.end_headers()
                self.wfile.write(html_out)
                return

        return super().do_GET()

    def send_plain_text(self, text: str, status=200):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        now = int(time.time() * 1000)

        # Official Alipay Async Notify (`application/x-www-form-urlencoded`, RSA2-SHA256 verified!)
        if path == "/api/pay/alipay_notify":
            from urllib.parse import parse_qsl

            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 16384:
                return self.send_plain_text("failure", 400)
            raw_form = self.rfile.read(length).decode("utf-8", errors="replace")
            form_dict = dict(parse_qsl(raw_form, keep_blank_values=True))
            sign_b64 = form_dict.get("sign") or ""
            unsigned = "&".join(
                f"{k}={form_dict[k]}"
                for k in sorted(form_dict)
                if k not in ("sign", "sign_type") and form_dict[k] != ""
            )
            if not _alipay_rsa2_verify(unsigned, sign_b64):
                return self.send_plain_text("failure", 403)
            if form_dict.get("app_id") != ALIPAY_APP_ID:
                return self.send_plain_text("failure", 403)
            t_status = str(form_dict.get("trade_status") or "").upper()
            if t_status in ("TRADE_SUCCESS", "TRADE_FINISHED"):
                oid = str(form_dict.get("out_trade_no") or "").strip()[:48]
                ali_tx = re.sub(r"[^A-Za-z0-9_-]", "", str(form_dict.get("trade_no") or "").strip())[:64]
                try:
                    paid_fen = int(round(float(form_dict.get("total_amount") or 0.0) * 100))
                except (TypeError, ValueError):
                    return self.send_plain_text("failure", 400)
                settle_verified_order(
                    order_id=oid,
                    amount_fen=paid_fen,
                    trade_no=f"ALI_{ali_tx}",
                    nonce=f"alin_{ali_tx}"[:64],
                    is_sandbox=False,
                    now_ms=now,
                    allow_amount_recalc=False,
                )
            return self.send_plain_text("success", 200)

        try:
            body = self.read_json_body(8192)
        except OverflowError:
            return self.send_json({"ok": False, "error": "请求数据过大"}, 413)
        except Exception:
            return self.send_json({"ok": False, "error": "请求格式错误"}, 400)

        ip_hash = self.client_ip_hash()

        if path == "/api/auth/register":
            # Allow legitimate high-bean guest carryover up to 2,000,000 beans without truncating marathon runs!
            if isinstance(body.get("save"), dict):
                body["save"]["beans"] = min(2_000_000, max(0, int(body["save"].get("beans") or 2000)))
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
            if os.environ.get("PELICAN_OFFLINE_TEST") != "1" and not verify_ticket(body.get("ticket"), ip_hash, now):
                return self.send_json({"ok": False, "error": "安全校验超时或过快，请重新打开存档窗口再试"}, 403)

            raw_name = str(body.get("username") or "").strip()
            pwd = str(body.get("password") or "")
            if len(raw_name) < 2 or len(raw_name) > 20 or re.search(r"[\s<>'\"\\/;]", raw_name):
                return self.send_json({"ok": False, "error": "账号需为2~20位常规字符（不含空格或特殊符号）"}, 400)
            if len(pwd) < 4 or len(pwd) > 64:
                return self.send_json({"ok": False, "error": "密码长度需为4~64位"}, 400)

            norm_user = raw_name.lower()
            guest_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(body.get("guestId") or ""))[:36]
            was_guest = bool(body.get("wasGuest"))
            offline_test = os.environ.get("PELICAN_OFFLINE_TEST") == "1"
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                guard = self.get_ip_guard(conn, ip_hash, now)
                if not offline_test:
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
                clean_save["beans"] = min(2_000_000, clean_save["beans"])
                conn.execute(
                    "INSERT INTO players VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)",
                    (norm_user, raw_name, salt, pass_hash, token, serialize_save_with_rev(clean_save, 1), now, now),
                )
                if was_guest and len(guest_id) >= 6:
                    conn.execute("DELETE FROM leaderboard WHERE player_key = ?", (f"g:{guest_id}",))
                if clean_save["bestSingleRun"] >= 5:
                    conn.execute(
                        """
                        INSERT INTO leaderboard (player_key, nickname, hero, best_single, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(player_key) DO UPDATE SET
                          nickname = excluded.nickname,
                          hero = excluded.hero,
                          best_single = MAX(leaderboard.best_single, excluded.best_single),
                          updated_at = excluded.updated_at
                        """,
                        (f"u:{norm_user}", raw_name, clean_save["selectedHero"], clean_save["bestSingleRun"], now),
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

            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                pre_local = conn.execute(
                    "SELECT username, salt FROM players WHERE token = ?", (token,)
                ).fetchone()
                pre_local_only = bool(pre_local and pre_local["salt"] != "cloud_synced")
                pre_local_paid = has_local_paid_orders(conn, pre_local["username"]) if pre_local else False

            # Pull authoritative Cloud D1 state ONLY when account is cloud-backed and has no local-test sandbox recharges
            c_me_status, c_me = (None, None)
            if not pre_local_paid and not pre_local_only:
                c_me_status, c_me = proxy_cloud_api("GET", "/api/auth/me", None, f"Bearer {token}")
                if c_me_status == 401 and not pre_local:
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
                local_paid = has_local_paid_orders(conn, local_row["username"]) if local_row else False

                if c_me_status == 200 and isinstance(c_me, dict) and c_me.get("ok") and not local_paid:
                    disp_name = c_me.get("username")
                    norm_u = str(disp_name).strip().lower()
                    if has_local_paid_orders(conn, norm_u):
                        local_paid = True
                    cloud_sv = c_me.get("save") or {}
                    cloud_rev = int(c_me.get("rev") or 1)
                    cloud_upd = int(c_me.get("updatedAt") or 0)
                    if local_row:
                        local_parsed = json.loads(local_row["save_json"])
                        local_rev = extract_save_rev(local_parsed)
                        if not local_paid and (cloud_upd > int(local_row["updated_at"] or 0) + 500 or cloud_rev > local_rev):
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

            # Push authoritative reconciled state up to Cloud D1 ONLY when account is cloud-backed and has NOT used test-server sandbox recharge!
            if not needs_rebase and not local_paid and not pre_local_only:
                cloud_push_body = dict(body)
                cloud_push_body["save"] = merged_save
                proxy_cloud_api("POST", "/api/save", cloud_push_body, f"Bearer {token}")

            return self.send_json(
                build_signed_auth_payload(
                    disp_name, merged_save, next_rev, now, conflict_resolved=conflict_resolved, needs_rebase=needs_rebase
                ),
                200,
            )

        if path == "/api/pay/create_order":
            token = self.extract_token(body)
            prow = resolve_authenticated_player(token, now)
            if not prow:
                return self.send_json({"ok": False, "error": "请先登录账号再进行充值，确保绿豆永久绑定账号不丢失！"}, 401)

            # Strictly whitelist packId on server — NEVER read price or bean count from client request body!
            pack_id = str(body.get("packId") or "").strip()
            pack = RECHARGE_PACKS.get(pack_id)
            if not pack:
                return self.send_json({"ok": False, "error": "无效的充值档位"}, 400)

            pay_channel = str(body.get("payChannel") or "wechat").strip().lower()
            if pay_channel not in VALID_PAY_CHANNELS:
                return self.send_json({"ok": False, "error": "不支持的支付方式（仅支持微信支付或支付宝）"}, 400)

            norm_u = prow["username"]
            disp_name = prow["display_name"]
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                # Expire timed-out orders first
                conn.execute(
                    "UPDATE recharge_orders SET status = 'EXPIRED' WHERE username = ? AND status = 'PENDING' AND expires_at <= ?",
                    (norm_u, now),
                )
                recent_min_cnt = conn.execute(
                    "SELECT COUNT(*) FROM recharge_orders WHERE username = ? AND created_at > ?",
                    (norm_u, now - 60_000),
                ).fetchone()[0]
                if int(recent_min_cnt) >= 20:
                    conn.commit()
                    return self.send_json({"ok": False, "error": "创建订单过于频繁，请稍后再试"}, 429)

                # Keep at most 4 older pending orders active per user so pending queue cannot be flooded
                pending_rows = conn.execute(
                    "SELECT order_id FROM recharge_orders WHERE username = ? AND status = 'PENDING' ORDER BY created_at DESC",
                    (norm_u,),
                ).fetchall()
                if len(pending_rows) >= 5:
                    stale_ids = [r["order_id"] for r in pending_rows[4:]]
                    conn.executemany(
                        "UPDATE recharge_orders SET status = 'CANCELLED' WHERE order_id = ? AND status = 'PENDING'",
                        [(oid,) for oid in stale_ids],
                    )

                paid_cnt = conn.execute(
                    "SELECT COUNT(*) FROM recharge_orders WHERE username = ? AND status = 'PAID'",
                    (norm_u,),
                ).fetchone()[0]
                first_eligible = int(paid_cnt) == 0

                ts_tag = time.strftime("%Y%m%d%H%M%S", time.gmtime(now / 1000.0))
                order_id = f"PL{ts_tag}{secrets.token_hex(5).upper()}"
                expires_at = now + ORDER_TTL_MS

                conn.execute(
                    """
                    INSERT INTO recharge_orders (
                      order_id, username, display_name, pack_id, pack_name, pay_channel,
                      amount_fen, base_beans, bonus_tier_beans, bonus_first_beans, credited_beans,
                      status, trade_no, is_sandbox, created_at, expires_at, paid_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'PENDING', NULL, 0, ?, ?, NULL)
                    """,
                    (
                        order_id,
                        norm_u,
                        disp_name,
                        pack["id"],
                        pack["name"],
                        pay_channel,
                        pack["amount_fen"],
                        pack["base_beans"],
                        pack["bonus_beans"],
                        now,
                        expires_at,
                    ),
                )
                orow = conn.execute("SELECT * FROM recharge_orders WHERE order_id = ?", (order_id,)).fetchone()
                conn.commit()

            _refresh_alipay_keys_if_needed()
            expected_first = FIRST_RECHARGE_BONUS_BEANS if first_eligible else 0
            checkout_url = ""
            qr_target_url = ""
            if ALIPAY_DIRECT_CONFIGURED:
                if pay_channel == "wechat" and not ALLOW_AFDIAN_FALLBACK:
                    return self.send_json(
                        {
                            "ok": False,
                            "error": "微信官方直连需个体户/企业营业执照；当前个人直连通道请选择【💙 支付宝】（钱直接进你个人支付宝余额，0三方抽成）！",
                        },
                        400,
                    )
                host_hdr = self.headers.get("Host") or "127.0.0.1:8788"
                ali_ok, ali_qr_target, ali_web_url, ali_err = alipay_create_smart_checkout(
                    order_id=order_id,
                    amount_fen=pack["amount_fen"],
                    subject=f"鹈鹕测试大乱斗-{pack['name']}",
                    notify_url="https://nailong.openwaifu-agent.uk/api/pay/alipay_notify",
                    return_url=f"http://{host_hdr}/api/pay/alipay_return",
                )
                if ali_ok:
                    qr_target_url = ali_qr_target
                    checkout_url = ali_web_url
                elif ALLOW_AFDIAN_FALLBACK and AFDIAN_USER_ID and AFDIAN_TOKEN:
                    checkout_url = (
                        f"https://ifdian.net/order/create?user_id={AFDIAN_USER_ID}"
                        f"&custom_order_id={order_id}&custom_price={pack['price_yuan']}&remark={order_id}"
                    )
                    qr_target_url = checkout_url
                else:
                    return self.send_json(
                        {
                            "ok": False,
                            "error": ali_err,
                        },
                        503,
                    )
            elif ALLOW_AFDIAN_FALLBACK and AFDIAN_USER_ID and AFDIAN_TOKEN:
                checkout_url = (
                    f"https://ifdian.net/order/create?user_id={AFDIAN_USER_ID}"
                    f"&custom_order_id={order_id}&custom_price={pack['price_yuan']}&remark={order_id}"
                )
                qr_target_url = checkout_url
            else:
                checkout_url = f"pelicanpay://{pay_channel}/checkout?oid={order_id}&fen={pack['amount_fen']}"
                qr_target_url = checkout_url
            qr_data_url = make_qr_data_url(qr_target_url or checkout_url)

            return self.send_json(
                {
                    "ok": True,
                    "order": format_order_dict(orow),
                    "firstBonusEligible": first_eligible,
                    "expectedFirstBonusBeans": expected_first,
                    "expectedTotalBeans": pack["total_beans"] + expected_first,
                    "realPayEnabled": REAL_PAY_ENABLED,
                    "sandboxEnabled": SANDBOX_PAY_ENABLED,
                    "payCodeUrl": qr_target_url or checkout_url,
                    "checkoutUrl": checkout_url,
                    "qrDataUrl": qr_data_url,
                },
                200,
            )

        if path == "/api/pay/afdian_webhook":
            # Official Afdian Webhook Endpoint: NEVER trusts raw webhook body blindly — re-queries Afdian OpenAPI over HTTPS!
            d_obj = body.get("data") if isinstance(body.get("data"), dict) else {}
            ord_in = d_obj.get("order") if isinstance(d_obj.get("order"), dict) else {}
            out_tx = re.sub(r"[^A-Za-z0-9_-]", "", str(ord_in.get("out_trade_no") or "").strip())[:64]
            if out_tx == "202106232138371083454010626":
                return self.send_json({"ec": 200, "em": ""})
            if out_tx and REAL_PAY_ENABLED:
                sync_real_afdian_payments(now_ms=now, force=True, specific_trade_no=out_tx)
            return self.send_json({"ec": 200, "em": ""})

        if path == "/api/pay/cancel":
            token = self.extract_token(body)
            prow = resolve_authenticated_player(token, now)
            if not prow:
                return self.send_json({"ok": False, "error": "请先登录账号"}, 401)
            order_id = str(body.get("orderId") or "").strip()[:48]
            if not order_id:
                return self.send_json({"ok": False, "error": "缺少订单号"}, 400)
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                orow = conn.execute("SELECT * FROM recharge_orders WHERE order_id = ?", (order_id,)).fetchone()
                if not orow:
                    return self.send_json({"ok": False, "error": "订单不存在"}, 404)
                if orow["username"] != prow["username"]:
                    return self.send_json({"ok": False, "error": "无权操作他人订单"}, 403)
                if orow["status"] == "PAID":
                    return self.send_json({"ok": False, "error": "已支付订单无法取消"}, 409)
                conn.execute(
                    "UPDATE recharge_orders SET status = 'CANCELLED' WHERE order_id = ? AND status = 'PENDING'",
                    (order_id,),
                )
                orow2 = conn.execute("SELECT * FROM recharge_orders WHERE order_id = ?", (order_id,)).fetchone()
                conn.commit()
            return self.send_json({"ok": True, "order": format_order_dict(orow2)})

        if path == "/api/pay/notify":
            # Server-to-Server Signed Payment Callback Webhook (HMAC-SHA256 + Timestamp + Nonce + Idempotency)
            ts_raw = self.headers.get("X-Pay-Timestamp") or body.get("timestamp")
            nonce = str(self.headers.get("X-Pay-Nonce") or body.get("nonce") or "").strip()
            sig = str(self.headers.get("X-Pay-Signature") or body.get("signature") or "").strip()
            try:
                ts_ms = int(ts_raw)
                amount_fen = int(body.get("amountFen"))
            except (TypeError, ValueError):
                return self.send_json({"ok": False, "error": "回调参数格式错误"}, 400)

            order_id = str(body.get("orderId") or "").strip()[:48]
            trade_no = re.sub(r"[^A-Za-z0-9_-]", "", str(body.get("tradeNo") or "").strip())[:72]
            pay_status = str(body.get("status") or "").strip().upper()

            sig_ok, sig_err = verify_pay_webhook_sig(ts_ms, nonce, order_id, amount_fen, trade_no, pay_status, sig, now)
            if not sig_ok:
                return self.send_json({"ok": False, "error": sig_err}, 403)
            if pay_status != "SUCCESS":
                return self.send_json({"ok": False, "error": "非支付成功状态，不予入账"}, 400)

            http_code, resp_payload = settle_verified_order(
                order_id=order_id,
                amount_fen=amount_fen,
                trade_no=trade_no,
                nonce=nonce,
                is_sandbox=bool(body.get("sandbox")),
                now_ms=now,
            )
            return self.send_json(resp_payload, http_code)

        if path == "/api/pay/sandbox_pay":
            # Strictly local-test-server ONLY sandbox simulator (hard-disabled whenever PELICAN_PAY_ENV != 'local_test')
            if not SANDBOX_PAY_ENABLED:
                return self.send_json({"ok": False, "error": "正式环境已禁用测试沙盒支付"}, 403)

            token = self.extract_token(body)
            prow = resolve_authenticated_player(token, now)
            if not prow:
                return self.send_json({"ok": False, "error": "请先登录账号"}, 401)

            order_id = str(body.get("orderId") or "").strip()[:48]
            if not order_id:
                return self.send_json({"ok": False, "error": "缺少订单号"}, 400)

            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                orow = conn.execute("SELECT * FROM recharge_orders WHERE order_id = ?", (order_id,)).fetchone()
            if not orow:
                return self.send_json({"ok": False, "error": "充值订单不存在"}, 404)
            if orow["username"] != prow["username"]:
                return self.send_json({"ok": False, "error": "禁止越权模拟支付他人订单"}, 403)

            amount_fen = int(orow["amount_fen"])
            trade_no = f"SBX_{order_id}"
            nonce = f"sbx_{secrets.token_hex(12)}"
            sig = make_pay_webhook_sig(now, nonce, order_id, amount_fen, trade_no, "SUCCESS")
            sig_ok, sig_err = verify_pay_webhook_sig(now, nonce, order_id, amount_fen, trade_no, "SUCCESS", sig, now)
            if not sig_ok:
                return self.send_json({"ok": False, "error": sig_err}, 403)

            http_code, resp_payload = settle_verified_order(
                order_id=order_id,
                amount_fen=amount_fen,
                trade_no=trade_no,
                nonce=nonce,
                is_sandbox=True,
                now_ms=now,
            )
            return self.send_json(resp_payload, http_code)

        if path == "/api/run_log":
            tok_hdr = self.extract_token(body)
            c_status, c_data = proxy_cloud_api("POST", "/api/run_log", body, f"Bearer {tok_hdr}" if tok_hdr else "")
            if c_status is not None and isinstance(c_data, dict):
                return self.send_json(c_data, c_status)
            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS run_history (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      player_key TEXT NOT NULL,
                      username TEXT,
                      mode TEXT NOT NULL,
                      hero TEXT NOT NULL,
                      single_dist INTEGER NOT NULL,
                      beans_earned INTEGER NOT NULL,
                      boss_kills INTEGER NOT NULL,
                      duration_sec INTEGER NOT NULL,
                      extra_note TEXT,
                      created_at INTEGER NOT NULL
                    )
                    """
                )
                guest_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(body.get("guestId") or ""))[:36]
                pkey = f"g:{guest_id}" if len(guest_id) >= 6 else "g:anon"
                uname = ""
                if tok_hdr:
                    prow = conn.execute("SELECT username, display_name FROM players WHERE token = ?", (tok_hdr,)).fetchone()
                    if prow:
                        pkey = f"u:{prow[0]}"
                        uname = prow[1]
                mode = "pvp" if body.get("mode") == "pvp" else "pve"
                hero = body.get("hero") if body.get("hero") in VALID_HEROES else "nailong"
                s_dist = min(999999, max(0, int(body.get("singleDist") or 0)))
                b_earn = min(2000000, max(0, int(body.get("beansEarned") or 0)))
                b_kills = min(9999, max(0, int(body.get("bossKills") or 0)))
                dur_s = min(86400, max(1, int(body.get("durationSec") or 1)))
                note = str(body.get("extraNote") or "")[:80]
                if s_dist >= 5 or mode == "pvp":
                    conn.execute(
                        "INSERT INTO run_history (player_key, username, mode, hero, single_dist, beans_earned, boss_kills, duration_sec, extra_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (pkey, uname, mode, hero, s_dist, b_earn, b_kills, dur_s, note, now),
                    )
                    conn.commit()
            return self.send_json({"ok": True})

        if path == "/api/leaderboard":
            tok_hdr = self.extract_token(body)
            c_status, c_data = proxy_cloud_api("POST", "/api/leaderboard", body, f"Bearer {tok_hdr}" if tok_hdr else "")
            if c_status is not None and isinstance(c_data, dict):
                return self.send_json(c_data, c_status)
            token = tok_hdr
            score = min(999999, max(0, int(body.get("bestSingle") or 0)))
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

        # ==================== ONLINE MULTIPLAYER PARTY RACE ENDPOINTS ====================
        if path == "/api/party/create":
            pid = _party_clean_id(body.get("playerId"))
            nick = _party_clean_nick(body.get("nickname"), "派对房主")
            hero = _party_clean_hero(body.get("heroId"))
            raw_custom = str(body.get("customCode") or "").strip()
            custom_code = _party_clean_room_code(raw_custom)
            if raw_custom and len(custom_code) < 2:
                return self.send_json({"ok": False, "error": "自定义房号需为 2~8 位数字或字母！"}, 400)
            acct_key, acct_disp = _resolve_party_account_key(self.extract_token(body), body.get("authUser") or "", now)
            try:
                race_dist = min(5000, max(1200, int(body.get("raceDist") or 3500)))
            except (TypeError, ValueError):
                race_dist = 3500
            with PARTY_LOCK:
                room = _create_party_room_locked(
                    pid,
                    nick,
                    hero,
                    race_dist,
                    now,
                    is_quickmatch=False,
                    account_key=acct_key,
                    account_name=acct_disp,
                    custom_code=custom_code,
                )
                if room.get("_error"):
                    return self.send_json({"ok": False, "error": room["_error"]}, 409)
                resp = _build_party_room_response_locked(room, pid, now, drain_inbox=False)
            return self.send_json(resp, 200)

        if path == "/api/party/set_hero":
            rcode = _party_clean_room_code(body.get("roomCode"))
            pid = _party_clean_id(body.get("playerId"))
            hero = _party_clean_hero(body.get("heroId"))
            with PARTY_LOCK:
                room = PARTY_ROOMS.get(rcode)
                if not room or pid not in room["players"]:
                    return self.send_json({"ok": False, "error": "房间不存在或已过期"}, 404)
                caller = room["players"][pid]
                if room.get("status") in ("waiting", "finished") or caller.get("finishedServerMs") is not None:
                    caller["heroId"] = hero
                    if body.get("nickname"):
                        caller["nickname"] = _party_clean_nick(body.get("nickname"), caller["nickname"])
                    caller["lastSyncMs"] = now
                    room["updatedAtMs"] = now
                resp = _build_party_room_response_locked(room, pid, now, drain_inbox=False)
            return self.send_json(resp, 200)

        if path == "/api/party/ready":
            rcode = _party_clean_room_code(body.get("roomCode"))
            pid = _party_clean_id(body.get("playerId"))
            want_ready = bool(body.get("ready", True))
            with PARTY_LOCK:
                room = PARTY_ROOMS.get(rcode)
                if not room or pid not in room["players"]:
                    return self.send_json({"ok": False, "error": "房间不存在或已过期"}, 404)
                caller = room["players"][pid]
                caller["lastSyncMs"] = now
                room["updatedAtMs"] = now
                if body.get("heroId") in VALID_HEROES and room.get("status") == "waiting":
                    caller["heroId"] = body["heroId"]
                if body.get("nickname") and room.get("status") == "waiting":
                    caller["nickname"] = _party_clean_nick(body.get("nickname"), caller["nickname"])
                if room.get("status") == "waiting":
                    caller["ready"] = want_ready
                    plist = list(room["players"].values())
                    if len(plist) >= 2 and all(bool(p.get("ready") or p.get("isBot")) for p in plist):
                        room["status"] = "countdown"
                        room["isQuickmatch"] = False
                        room["startAtMs"] = now + PARTY_COUNTDOWN_MS
                        for pobj in plist:
                            pobj["lastSyncMs"] = now
                resp = _build_party_room_response_locked(room, pid, now, drain_inbox=False)
            return self.send_json(resp, 200)

        if path == "/api/party/join":
            rcode = _party_clean_room_code(body.get("roomCode"))
            pid = _party_clean_id(body.get("playerId"))
            nick = _party_clean_nick(body.get("nickname"), "挑战骑手")
            hero = _party_clean_hero(body.get("heroId"))
            acct_key, acct_disp = _resolve_party_account_key(self.extract_token(body), body.get("authUser") or "", now)
            if len(rcode) < 2:
                return self.send_json({"ok": False, "error": "请输入正确的 2~8 位房间号！"}, 400)
            with PARTY_LOCK:
                _prune_party_rooms_locked(now)
                room = PARTY_ROOMS.get(rcode)
                if not room:
                    return self.send_json({"ok": False, "error": "房间号不存在或已过期，请核对房间号！"}, 404)
                if pid in room["players"]:
                    if room["status"] == "waiting":
                        room["players"][pid]["nickname"] = nick
                        room["players"][pid]["heroId"] = hero
                    room["players"][pid]["lastSyncMs"] = now
                    room["updatedAtMs"] = now
                    return self.send_json(_build_party_room_response_locked(room, pid, now, drain_inbox=False), 200)
                if acct_key and any(not op.get("isBot") and op.get("accountKey") == acct_key for op in room["players"].values()):
                    return self.send_json(
                        {
                            "ok": False,
                            "error": f"不能用相同账号【{acct_disp or nick}】同房互匹！请在另一窗口切换其他账号登录",
                        },
                        409,
                    )
                if len(room["players"]) >= 2 or room.get("status") != "waiting":
                    return self.send_json({"ok": False, "error": "该房间已满员或已发车，请创建新房间或使用快速匹配！"}, 409)

                used_slots = {p.get("slot") for p in room["players"].values()}
                free_slot = 2 if 1 in used_slots else 1
                p2 = _make_party_player_state(
                    pid, free_slot, nick, hero, now, is_bot=False, account_key=acct_key, account_name=acct_disp
                )
                room["players"][pid] = p2
                room["isQuickmatch"] = False
                for pobj in room["players"].values():
                    pobj["lastSyncMs"] = now
                room["updatedAtMs"] = now
                if rcode in PARTY_MATCH_QUEUE:
                    PARTY_MATCH_QUEUE.remove(rcode)
                resp = _build_party_room_response_locked(room, pid, now, drain_inbox=False)
            return self.send_json(resp, 200)

        if path == "/api/party/quickmatch":
            pid = _party_clean_id(body.get("playerId"))
            nick = _party_clean_nick(body.get("nickname"), "派对骑手")
            hero = _party_clean_hero(body.get("heroId"))
            acct_key, acct_disp = _resolve_party_account_key(self.extract_token(body), body.get("authUser") or "", now)
            try:
                race_dist = min(5000, max(1200, int(body.get("raceDist") or 3500)))
            except (TypeError, ValueError):
                race_dist = 3500
            with PARTY_LOCK:
                _prune_party_rooms_locked(now)
                # Reuse caller's own waiting quickmatch room if already queued in THIS tab
                for qcode in list(PARTY_MATCH_QUEUE):
                    qrm = PARTY_ROOMS.get(qcode)
                    if qrm and qrm.get("status") == "waiting" and pid in qrm["players"] and len(qrm["players"]) == 1:
                        qrm["players"][pid]["nickname"] = nick
                        qrm["players"][pid]["heroId"] = hero
                        qrm["players"][pid]["lastSyncMs"] = now
                        qrm["updatedAtMs"] = now
                        resp = _build_party_room_response_locked(qrm, pid, now, drain_inbox=False)
                        resp["matched"] = False
                        return self.send_json(resp, 200)

                # Block same logged-in account from self-matching across two tabs!
                if acct_key:
                    for qcode in list(PARTY_MATCH_QUEUE):
                        qrm = PARTY_ROOMS.get(qcode)
                        if qrm and qrm.get("status") == "waiting" and pid not in qrm["players"]:
                            if any(not op.get("isBot") and op.get("accountKey") == acct_key for op in qrm["players"].values()):
                                return self.send_json(
                                    {
                                        "ok": False,
                                        "error": f"账号【{acct_disp or nick}】已在另一窗口匹配中，不能同号互匹！请切换其他账号登录",
                                    },
                                    409,
                                )

                # Pair into first open waiting quickmatch room from a DIFFERENT account/player
                matched_room = None
                for qcode in list(PARTY_MATCH_QUEUE):
                    qrm = PARTY_ROOMS.get(qcode)
                    if qrm and qrm.get("status") == "waiting" and len(qrm["players"]) == 1 and pid not in qrm["players"]:
                        if acct_key and any(op.get("accountKey") == acct_key for op in qrm["players"].values()):
                            continue
                        matched_room = qrm
                        PARTY_MATCH_QUEUE.remove(qcode)
                        break

                if matched_room:
                    used_slots = {p.get("slot") for p in matched_room["players"].values()}
                    free_slot = 2 if 1 in used_slots else 1
                    p2 = _make_party_player_state(
                        pid, free_slot, nick, hero, now, is_bot=False, account_key=acct_key, account_name=acct_disp
                    )
                    matched_room["players"][pid] = p2
                    matched_room["isQuickmatch"] = False
                    for pobj in matched_room["players"].values():
                        pobj["lastSyncMs"] = now
                    matched_room["updatedAtMs"] = now
                    resp = _build_party_room_response_locked(matched_room, pid, now, drain_inbox=False)
                    resp["matched"] = True
                    return self.send_json(resp, 200)

                room = _create_party_room_locked(
                    pid, nick, hero, race_dist, now, is_quickmatch=True, account_key=acct_key, account_name=acct_disp
                )
                resp = _build_party_room_response_locked(room, pid, now, drain_inbox=False)
                resp["matched"] = False
            return self.send_json(resp, 200)

        if path == "/api/party/add_bot":
            rcode = _party_clean_room_code(body.get("roomCode"))
            pid = _party_clean_id(body.get("playerId"))
            with PARTY_LOCK:
                _prune_party_rooms_locked(now)
                room = PARTY_ROOMS.get(rcode)
                if not room:
                    return self.send_json({"ok": False, "error": "房间不存在或已过期"}, 404)
                if pid not in room["players"]:
                    return self.send_json({"ok": False, "error": "无权操作此房间"}, 403)
                if len(room["players"]) >= 2:
                    if any(p.get("isBot") for p in room["players"].values()):
                        return self.send_json(_build_party_room_response_locked(room, pid, now, drain_inbox=False), 200)
                    return self.send_json({"ok": False, "error": "真人劲敌已进房，请点击准备发车！"}, 409)

                host_hero = room["players"][pid]["heroId"]
                room["players"][pid]["ready"] = True
                room["players"][pid]["lastSyncMs"] = now
                cands = [bp for bp in PARTY_BOT_PERSONAS if bp[1] != host_hero] or list(PARTY_BOT_PERSONAS)
                code_hash = sum(ord(c) for c in rcode)
                bot_nick, bot_hero = cands[(code_hash + now) % len(cands)]
                bot_id = f"bot_{rcode}"
                bot_p = _make_party_player_state(bot_id, 2, bot_nick, bot_hero, now, is_bot=True)
                room["players"][bot_id] = bot_p
                room["status"] = "countdown"
                room["startAtMs"] = now + PARTY_COUNTDOWN_MS
                room["updatedAtMs"] = now
                if rcode in PARTY_MATCH_QUEUE:
                    PARTY_MATCH_QUEUE.remove(rcode)
                resp = _build_party_room_response_locked(room, pid, now, drain_inbox=False)
            return self.send_json(resp, 200)

        if path == "/api/party/sync":
            rcode = _party_clean_room_code(body.get("roomCode"))
            pid = _party_clean_id(body.get("playerId"))
            with PARTY_LOCK:
                room = PARTY_ROOMS.get(rcode)
                if not room:
                    return self.send_json({"ok": False, "error": "房间已结束或过期"}, 404)
                caller = room["players"].get(pid)
                if not caller:
                    return self.send_json({"ok": False, "error": "不在此房间内"}, 403)

                room["updatedAtMs"] = now
                caller["lastSyncMs"] = now

                if room["status"] == "countdown" and room.get("startAtMs") and now >= int(room["startAtMs"]):
                    room["status"] = "racing"

                cur_round_id = int(room.get("roundId") or 1)
                stale_round_sync = body.get("roundId") is not None and int(body["roundId"]) != cur_round_id

                rival = None
                for op_id, op_obj in room["players"].items():
                    if op_id != pid:
                        rival = op_obj
                        break

                # Automatic disconnect/timeout forfeit if human rival stops syncing for > 60s during live race!
                if (
                    rival
                    and not rival.get("isBot")
                    and room.get("status") in ("countdown", "racing")
                    and (now - int(rival.get("lastSyncMs") or now)) > 60000
                ):
                    _forfeit_party_player_locked(room, rival["playerId"], "disconnect", now)
                    rival = None

                if not stale_round_sync and room.get("status") != "finished":
                    # Update live rider telemetry from caller
                    for num_key in ("x", "y", "vx", "vy", "dist"):
                        if isinstance(body.get(num_key), (int, float)):
                            val = float(body[num_key])
                            if math.isfinite(val):
                                caller[num_key] = val
                    if isinstance(body.get("hp"), (int, float)):
                        caller["hp"] = max(0, min(999, int(body["hp"])))
                    if body.get("heroId") in VALID_HEROES and caller.get("finishedServerMs") is None:
                        caller["heroId"] = body["heroId"]
                    if isinstance(body.get("animState"), dict):
                        clean_anim = dict(body["animState"])
                        if now - int(caller.get("shieldConsumedAtMs") or 0) <= 1500:
                            clean_anim["shieldActive"] = False
                        if now - int(caller.get("oneHitConsumedAtMs") or 0) <= 1500:
                            clean_anim["oneHitShield"] = False
                        caller["animState"] = clean_anim

                    # Process item events (supports single useItemEvent and/or batch useItemEvents)
                    raw_ev = body.get("useItemEvent")
                    if isinstance(raw_ev, dict):
                        _process_party_item_event_locked(room, caller, rival, raw_ev, now)
                    raw_evs = body.get("useItemEvents")
                    if isinstance(raw_evs, list):
                        for ev_item in raw_evs[:6]:
                            if isinstance(ev_item, dict):
                                _process_party_item_event_locked(room, caller, rival, ev_item, now)

                    # Optional standalone trapPlaced support
                    raw_tp = body.get("trapPlaced")
                    if isinstance(raw_tp, dict):
                        tp_eid = str(raw_tp.get("trapId") or raw_tp.get("eventId") or f"tp_{pid}_{now}")
                        _process_party_item_event_locked(
                            room,
                            caller,
                            rival,
                            {
                                "eventId": tp_eid,
                                "itemId": "maodie_trap",
                                "trapX": raw_tp.get("x"),
                                "trapY": raw_tp.get("y"),
                            },
                            now,
                        )

                    # Shared road trap trigger notification from victim
                    hit_trap_id = str(body.get("trapHitId") or "").strip()[:64]
                    if hit_trap_id:
                        for trap in room["trackTraps"]:
                            if trap.get("active") and trap["trapId"] == hit_trap_id and trap["ownerId"] != pid:
                                trap["active"] = False
                                owner_p = room["players"].get(trap["ownerId"])
                                if owner_p:
                                    owner_p["itemsLanded"] = int(owner_p.get("itemsLanded") or 0) + 1
                                    if not owner_p.get("isBot"):
                                        owner_p["inbox"].append(
                                            {
                                                "eventId": f"traphit_{hit_trap_id}",
                                                "type": "trap_landed_ack",
                                                "itemId": "maodie_trap",
                                                "fromId": pid,
                                                "fromNick": caller["nickname"],
                                                "banner": f"😾 {caller['nickname']} 一脚踩中了你的圆头耄耋路障！",
                                            }
                                        )
                                break

                    # Tick AI rival if present
                    if rival and rival.get("isBot"):
                        _tick_party_bot_locked(room, rival, caller, now)

                    # Server-authoritative Finish-Line Adjudication
                    if room["status"] in ("racing", "countdown") and float(caller.get("dist") or 0.0) >= float(room["raceDist"]):
                        if room["status"] == "countdown":
                            room["status"] = "racing"
                        if caller.get("finishedServerMs") is None:
                            caller["dist"] = float(room["raceDist"])
                            caller["x"] = max(float(caller["x"]), 120.0 + float(room["raceDist"]) * 18.0)
                            caller["finishedServerMs"] = now
                            fc_ms = body.get("finishedClientMs")
                            caller["finishedClientMs"] = int(fc_ms) if isinstance(fc_ms, (int, float)) else now
                            start_ref = int(room.get("startAtMs") or room["createdAtMs"])
                            caller["elapsedMs"] = max(1000, now - start_ref)

                if room["status"] in ("racing", "finished"):
                    _recompute_party_results_locked(room, now)

                resp = _build_party_room_response_locked(room, pid, now, drain_inbox=not stale_round_sync)
            return self.send_json(resp, 200)

        if path == "/api/party/rematch":
            rcode = _party_clean_room_code(body.get("roomCode"))
            pid = _party_clean_id(body.get("playerId"))
            with PARTY_LOCK:
                room = PARTY_ROOMS.get(rcode)
                if not room or pid not in room["players"]:
                    return self.send_json({"ok": False, "error": "房间已失效，请重新创建房间"}, 404)
                caller = room["players"][pid]
                caller["lastSyncMs"] = now
                if body.get("heroId") in VALID_HEROES:
                    caller["heroId"] = body["heroId"]
                if "rematchVotes" not in room or not isinstance(room["rematchVotes"], set):
                    room["rematchVotes"] = set()
                if room["status"] == "finished" or caller.get("finishedServerMs") is not None:
                    room["rematchVotes"].add(pid)
                    for k, pobj in room["players"].items():
                        if pobj.get("isBot"):
                            room["rematchVotes"].add(k)
                    all_ready = room["status"] == "finished" and len(room["players"]) >= 2 and all(k in room["rematchVotes"] for k in room["players"])
                    if all_ready:
                        new_seed = secrets.randbelow(1_900_000_000) + 100_000
                        room["roundId"] = int(room.get("roundId") or 1) + 1
                        room["trackSeed"] = new_seed
                        room["modulePlan"] = _generate_party_module_plan(new_seed, room["raceDist"])
                        room["trackTraps"] = []
                        room["processedEventIds"] = set()
                        room["results"] = []
                        room["rematchVotes"] = set()
                        for pobj in room["players"].values():
                            is_b = bool(pobj.get("isBot"))
                            fresh = _make_party_player_state(
                                pobj["playerId"],
                                pobj["slot"],
                                pobj["nickname"],
                                pobj["heroId"],
                                now,
                                is_bot=is_b,
                                account_key=pobj.get("accountKey") or "",
                                account_name=pobj.get("accountName") or "",
                            )
                            fresh["ready"] = True
                            pobj.update(fresh)
                        room["status"] = "countdown"
                        room["startAtMs"] = now + PARTY_COUNTDOWN_MS
                room["updatedAtMs"] = now
                resp = _build_party_room_response_locked(room, pid, now, drain_inbox=False)
            return self.send_json(resp, 200)

        if path == "/api/party/leave":
            rcode = _party_clean_room_code(body.get("roomCode"))
            pid = _party_clean_id(body.get("playerId"))
            with PARTY_LOCK:
                room = PARTY_ROOMS.get(rcode)
                if room and pid in room["players"]:
                    _forfeit_party_player_locked(room, pid, "quit", now)
            return self.send_json({"ok": True}, 200)

        return self.send_json({"ok": False, "error": "Not found"}, 404)


class NoReuseThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = False


if __name__ == "__main__":
    init_db()
    listen_port = int(os.environ.get("PORT", "8765"))
    server = NoReuseThreadingHTTPServer(("0.0.0.0", listen_port), GameHandler)
    print(f"Pelican Test Brawl Hardened Full-Stack Server v6.4 listening on http://0.0.0.0:{listen_port}", flush=True)
    server.serve_forever()
