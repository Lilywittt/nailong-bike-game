// ============================================================================
// Official Alipay Direct Payment & Atomic D1 Recharge Engine (`pay_worker.js`)
// Supports:
//   1. `alipay.trade.precreate` (当面付原生扫码)
//   2. Automatic fallback to `alipay.trade.wap.pay` (手机网站支付) +
//      `alipay.trade.page.pay` (电脑网站支付) via crisp `/api/pay/go?oid=...` QR!
//   3. WebCrypto RSA2 (`RSASSA-PKCS1-v1_5` SHA-256) signing & gateway/notify verification
//   4. Pure-JS ISO/IEC 18004 Scannable SVG QR Code Generator (zero external deps!)
// ============================================================================

export const RECHARGE_PACKS = {
  pack_1: {
    id: 'pack_1',
    name: '🌱 1元尝鲜包',
    priceYuan: 1,
    amountFen: 100,
    baseBeans: 1000,
    bonusBeans: 0,
    totalBeans: 1000,
    bonusPctLbl: '基准 1元=1000豆',
    badge: '零门槛体验'
  },
  pack_6: {
    id: 'pack_6',
    name: '🔥 新手破冰包',
    priceYuan: 6,
    amountFen: 600,
    baseBeans: 6000,
    bonusBeans: 800,
    totalBeans: 6800,
    bonusPctLbl: '多送 +13%',
    badge: '🔥 人气首推'
  },
  pack_18: {
    id: 'pack_18',
    name: '⚡ 极速冲刺包',
    priceYuan: 18,
    amountFen: 1800,
    baseBeans: 18000,
    bonusBeans: 4000,
    totalBeans: 22000,
    bonusPctLbl: '多送 +22%',
    badge: '⚡ 畅玩爆款'
  },
  pack_30: {
    id: 'pack_30',
    name: '💎 天赋进阶包',
    priceYuan: 30,
    amountFen: 3000,
    baseBeans: 30000,
    bonusBeans: 9000,
    totalBeans: 39000,
    bonusPctLbl: '多送 +30%',
    badge: '💎 冲榜热销'
  },
  pack_68: {
    id: 'pack_68',
    name: '👑 霸主豪华箱',
    priceYuan: 68,
    amountFen: 6800,
    baseBeans: 68000,
    bonusBeans: 27000,
    totalBeans: 95000,
    bonusPctLbl: '多送 +40%',
    badge: '👑 超值特惠'
  },
  pack_128: {
    id: 'pack_128',
    name: '🏆 至尊满配金库',
    priceYuan: 128,
    amountFen: 12800,
    baseBeans: 128000,
    bonusBeans: 60000,
    totalBeans: 188000,
    bonusPctLbl: '多送 +47%',
    badge: '🏆 毕业神档'
  }
};

const FIRST_RECHARGE_BONUS_BEANS = 2000;
const ORDER_TTL_MS = 20 * 60 * 1000;
let payTablesReady = false;

export async function ensurePayTables(env) {
  if (payTablesReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS recharge_orders (
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
    )`
  ).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_orders_user_created ON recharge_orders(username, created_at DESC)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_orders_user_status ON recharge_orders(username, status)').run();
  await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_trade_no ON recharge_orders(trade_no) WHERE trade_no IS NOT NULL').run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS pay_webhook_nonces (
      nonce TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    )`
  ).run();
  payTablesReady = true;
}

function b64ToBytes(b64) {
  const clean = String(b64 || '').replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function getAlipayConfig(env) {
  const appId = String(env.ALIPAY_APP_ID || '').trim();
  const privKey = String(env.ALIPAY_PRIVATE_KEY || '').trim();
  const pubKey = String(env.ALIPAY_PUBLIC_KEY || '').trim();
  return {
    appId,
    privKey,
    pubKey,
    configured: Boolean(appId && privKey && pubKey)
  };
}

function formatBeijingTimestamp(nowMs = Date.now()) {
  const bj = new Date(nowMs + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}:${pad(bj.getUTCSeconds())}`;
}

export async function alipayRsa2Sign(privKeyB64, unsignedStr) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    b64ToBytes(privKeyB64),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsignedStr));
  return bytesToB64(new Uint8Array(sig));
}

export async function alipayRsa2Verify(pubKeyB64, unsignedStr, signB64) {
  if (!pubKeyB64 || !signB64) return false;
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      b64ToBytes(pubKeyB64),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64ToBytes(signB64),
      new TextEncoder().encode(unsignedStr)
    );
  } catch (_) {
    return false;
  }
}

async function buildSignedAlipayParams(cfg, method, bizDict, extraParams = {}) {
  const params = {
    app_id: cfg.appId,
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: formatBeijingTimestamp(),
    version: '1.0',
    biz_content: JSON.stringify(bizDict),
    ...extraParams
  };
  const keys = Object.keys(params).filter((k) => params[k] !== '' && params[k] !== undefined && params[k] !== null).sort();
  const unsigned = keys.map((k) => `${k}=${params[k]}`).join('&');
  params.sign = await alipayRsa2Sign(cfg.privKey, unsigned);
  return params;
}

export async function buildAlipayRedirectUrl(cfg, method, bizDict, notifyUrl = '', returnUrl = '') {
  const extra = {};
  if (notifyUrl) extra.notify_url = notifyUrl;
  if (returnUrl) extra.return_url = returnUrl;
  const params = await buildSignedAlipayParams(cfg, method, bizDict, extra);
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== undefined && v !== null) usp.set(k, String(v));
  }
  return `https://openapi.alipay.com/gateway.do?${usp.toString()}`;
}

export async function alipayGatewayCall(cfg, method, bizDict, notifyUrl = '') {
  const extra = notifyUrl ? { notify_url: notifyUrl } : {};
  const params = await buildSignedAlipayParams(cfg, method, bizDict, extra);
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) usp.set(k, String(v));

  const resp = await fetch('https://openapi.alipay.com/gateway.do?charset=utf-8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: usp.toString()
  });
  const rawTxt = await resp.text();
  const parsed = JSON.parse(rawTxt);
  const respKey = method.replace(/\./g, '_') + '_response';
  const signB64 = parsed.sign || '';
  const keyToken = `"${respKey}":`;
  const idx = rawTxt.indexOf(keyToken);
  if (idx !== -1 && signB64) {
    const subStart = rawTxt.indexOf('{', idx + keyToken.length);
    let depth = 0;
    let inStr = false;
    let esc = false;
    let subEnd = -1;
    for (let pos = subStart; pos < rawTxt.length; pos++) {
      const ch = rawTxt[pos];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (!inStr) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { subEnd = pos + 1; break; }
        }
      }
    }
    if (subStart !== -1 && subEnd !== -1) {
      const slice = rawTxt.slice(subStart, subEnd);
      const valid = await alipayRsa2Verify(cfg.pubKey, slice, signB64);
      if (!valid) return { code: 'SIGN_ERR', sub_msg: '支付宝网关响应 RSA2 验签未通过' };
    }
  }
  return parsed[respKey] || {};
}

async function probeAlipayWebUrlLive(targetUrl) {
  try {
    const r = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile' },
      redirect: 'follow'
    });
    const buf = await r.arrayBuffer();
    let txt = '';
    try {
      txt = new TextDecoder('gbk').decode(buf);
    } catch (_) {
      txt = new TextDecoder('utf-8').decode(buf);
    }
    if (
      txt.includes('insufficient-isv-permissions') ||
      txt.includes('ISV权限不足') ||
      txt.includes('invalid-signature') ||
      txt.includes('调试错误')
    ) {
      return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function createSmartAlipayCheckout(cfg, origin, orderId, amountFen, subject) {
  const notifyUrl = `${origin}/api/pay/alipay_notify`;
  const returnUrl = `${origin}/api/pay/alipay_return`;
  const yuanStr = (Number(amountFen) / 100).toFixed(2);

  // 1. Try Face-to-Face Scan-to-Pay (`alipay.trade.precreate`) first
  let preErr = '';
  try {
    const preRes = await alipayGatewayCall(
      cfg,
      'alipay.trade.precreate',
      {
        out_trade_no: orderId,
        total_amount: yuanStr,
        subject: subject.slice(0, 64),
        timeout_express: '20m'
      },
      notifyUrl
    );
    if (String(preRes.code) === '10000' && preRes.qr_code) {
      const qr = String(preRes.qr_code);
      return { ok: true, qrTargetUrl: qr, checkoutUrl: qr, mode: 'precreate' };
    }
    preErr = `${preRes.sub_msg || preRes.msg || '暂未开通'} (${preRes.sub_code || preRes.code || ''})`;
  } catch (e) {
    preErr = String(e.message || e);
  }

  // 2. Fallback to Mobile Web (`alipay.trade.wap.pay`) / PC Web (`alipay.trade.page.pay`)
  const wapUrl = await buildAlipayRedirectUrl(
    cfg,
    'alipay.trade.wap.pay',
    {
      out_trade_no: orderId,
      total_amount: yuanStr,
      subject: subject.slice(0, 64),
      product_code: 'QUICK_WAP_WAY',
      timeout_express: '20m'
    },
    notifyUrl,
    returnUrl
  );
  const pageUrl = await buildAlipayRedirectUrl(
    cfg,
    'alipay.trade.page.pay',
    {
      out_trade_no: orderId,
      total_amount: yuanStr,
      subject: subject.slice(0, 64),
      product_code: 'FAST_INSTANT_TRADE_PAY',
      timeout_express: '20m'
    },
    notifyUrl,
    returnUrl
  );

  const [wapLive, pageLive] = await Promise.all([
    probeAlipayWebUrlLive(wapUrl),
    probeAlipayWebUrlLive(pageUrl)
  ]);

  if (wapLive || pageLive) {
    const shortGoUrl = `${origin}/api/pay/go?oid=${encodeURIComponent(orderId)}`;
    return {
      ok: true,
      qrTargetUrl: shortGoUrl,
      checkoutUrl: pageLive ? pageUrl : wapUrl,
      mode: wapLive ? 'wap_or_page' : 'page_only'
    };
  }

  return {
    ok: false,
    error: `支付宝网关验签通过(AppID: ${cfg.appId})，但接口权限待生效 [${preErr}] —— 请在支付宝开放平台进入该应用确认已绑定【当面付/手机网站/电脑网站支付】并点击右上角【提交上线】！`
  };
}

function formatOrderObj(row) {
  return {
    orderId: row.order_id,
    username: row.display_name,
    packId: row.pack_id,
    packName: row.pack_name,
    payChannel: row.pay_channel,
    amountFen: Number(row.amount_fen),
    priceYuan: Math.round(Number(row.amount_fen)) / 100,
    baseBeans: Number(row.base_beans),
    bonusTierBeans: Number(row.bonus_tier_beans),
    bonusFirstBeans: Number(row.bonus_first_beans),
    creditedBeans: Number(row.credited_beans),
    status: row.status,
    tradeNo: row.trade_no || '',
    isSandbox: Boolean(row.is_sandbox),
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    paidAt: row.paid_at ? Number(row.paid_at) : null
  };
}

async function settleVerifiedOrderD1(env, helpers, orderId, paidFen, tradeNo, nonce, nowMs) {
  const { sanitizeSave, extractSaveRev, serializeSaveWithRev, buildSignedAuthPayload, maybeWriteSaveBackup } = helpers;
  if (!orderId || !tradeNo || Number(paidFen) < 100) {
    return { status: 400, payload: { ok: false, error: '无效的订单流水或金额' } };
  }
  await ensurePayTables(env);
  const orderRow = await env.DB.prepare('SELECT * FROM recharge_orders WHERE order_id = ?').bind(orderId).first();
  if (!orderRow) return { status: 404, payload: { ok: false, error: '充值订单不存在' } };
  if (Number(paidFen) !== Number(orderRow.amount_fen)) {
    return { status: 400, payload: { ok: false, error: '实付金额与订单金额不一致' } };
  }

  if (orderRow.status === 'PAID') {
    if (orderRow.trade_no === tradeNo) {
      const pRow = await env.DB.prepare('SELECT display_name, save_json FROM players WHERE username = ?').bind(orderRow.username).first();
      let authSync = null;
      if (pRow) {
        let raw = null;
        try { raw = JSON.parse(pRow.save_json); } catch (_) {}
        authSync = await buildSignedAuthPayload(pRow.display_name, sanitizeSave(raw, null), extractSaveRev(raw), nowMs);
      }
      return {
        status: 200,
        payload: { ok: true, idempotentReplay: true, credited: false, order: formatOrderObj(orderRow), authSync }
      };
    }
    return { status: 409, payload: { ok: false, error: '该订单已由其他流水号完成入账' } };
  }

  try {
    await env.DB.prepare('INSERT INTO pay_webhook_nonces (nonce, created_at) VALUES (?, ?)').bind(nonce, nowMs).run();
  } catch (_) {
    return { status: 409, payload: { ok: false, error: '重复回调已拦截' } };
  }

  const paidBeforeRow = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM recharge_orders WHERE username = ? AND status = 'PAID'"
  ).bind(orderRow.username).first();
  const firstBonus = Number(paidBeforeRow?.cnt || 0) === 0 ? FIRST_RECHARGE_BONUS_BEANS : 0;
  const effBase = Number(orderRow.base_beans);
  const effTier = Number(orderRow.bonus_tier_beans);
  const totalGrant = effBase + effTier + firstBonus;

  const upd = await env.DB.prepare(
    `UPDATE recharge_orders
     SET status = 'PAID', trade_no = ?, bonus_first_beans = ?, credited_beans = ?, is_sandbox = 0, paid_at = ?
     WHERE order_id = ? AND status IN ('PENDING', 'EXPIRED', 'CANCELLED')`
  ).bind(tradeNo, firstBonus, totalGrant, nowMs, orderId).run();

  if (!upd.meta || Number(upd.meta.changes || 0) !== 1) {
    return { status: 409, payload: { ok: false, error: '并发结算冲突，未重复入账' } };
  }

  const playerRow = await env.DB.prepare('SELECT username, display_name, save_json FROM players WHERE username = ?').bind(orderRow.username).first();
  if (!playerRow) {
    return { status: 404, payload: { ok: false, error: '所属玩家账号不存在' } };
  }
  let parsed = null;
  try { parsed = JSON.parse(playerRow.save_json); } catch (_) {}
  const curRev = extractSaveRev(parsed);
  const cleanSave = sanitizeSave(parsed, null);
  cleanSave.beans = Math.min(999999999, cleanSave.beans + totalGrant);
  const nextRev = curRev + 1;

  await env.DB.prepare('UPDATE players SET save_json = ?, updated_at = ? WHERE username = ?')
    .bind(serializeSaveWithRev(cleanSave, nextRev), nowMs, playerRow.username).run();
  await maybeWriteSaveBackup(env, playerRow.username, cleanSave, nextRev, 'alipay_paid', nowMs, true);

  const freshOrder = await env.DB.prepare('SELECT * FROM recharge_orders WHERE order_id = ?').bind(orderId).first();
  const authSync = await buildSignedAuthPayload(playerRow.display_name, cleanSave, nextRev, nowMs);
  return {
    status: 200,
    payload: {
      ok: true,
      credited: true,
      creditedBeans: totalGrant,
      bonusFirstBeans: firstBonus,
      newBeansBalance: cleanSave.beans,
      order: formatOrderObj(freshOrder),
      authSync
    }
  };
}

async function queryAndSettleAlipayOrderD1(env, cfg, helpers, orderId, nowMs) {
  if (!cfg.configured || !orderId) return false;
  try {
    const res = await alipayGatewayCall(cfg, 'alipay.trade.query', { out_trade_no: orderId });
    if (String(res.code) !== '10000') return false;
    const st = String(res.trade_status || '').toUpperCase();
    if (st !== 'TRADE_SUCCESS' && st !== 'TRADE_FINISHED') return false;
    const aliTradeNo = String(res.trade_no || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    const paidFen = Math.round(Number(res.total_amount || 0) * 100);
    if (!aliTradeNo || paidFen < 100) return false;
    const out = await settleVerifiedOrderD1(env, helpers, orderId, paidFen, `ALI_${aliTradeNo}`, `aliq_${aliTradeNo}`.slice(0, 64), nowMs);
    return Boolean(out.status === 200 && out.payload.credited);
  } catch (_) {
    return false;
  }
}

// ============================================================================
// Pure-JS ISO/IEC 18004 Scannable QR Code SVG Generator (Byte Mode, EC Level L, V1..V10)
// ============================================================================
const QR_V_SPEC_L = [
  null,
  { total: 26, ecPerBlock: 7, blocks: [19], align: [] },
  { total: 44, ecPerBlock: 10, blocks: [34], align: [6, 18] },
  { total: 70, ecPerBlock: 15, blocks: [55], align: [6, 22] },
  { total: 100, ecPerBlock: 20, blocks: [80], align: [6, 26] },
  { total: 134, ecPerBlock: 26, blocks: [108], align: [6, 30] },
  { total: 172, ecPerBlock: 18, blocks: [68, 68], align: [6, 34] },
  { total: 196, ecPerBlock: 20, blocks: [78, 78], align: [6, 22, 38], vInfo: 0x07C94 },
  { total: 242, ecPerBlock: 24, blocks: [97, 97], align: [6, 24, 42], vInfo: 0x085BC },
  { total: 292, ecPerBlock: 30, blocks: [116, 116], align: [6, 26, 46], vInfo: 0x09A99 },
  { total: 346, ecPerBlock: 18, blocks: [68, 68, 69, 69], align: [6, 28, 50], vInfo: 0x0A4D3 }
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  return (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsEncodeBlock(dataBytes, ecLen) {
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    const root = GF_EXP[i];
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], root);
    }
    gen = next;
  }
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < dataBytes.length; i++) {
    const factor = dataBytes[i] ^ rem[0];
    for (let j = 0; j < ecLen - 1; j++) rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], factor);
    rem[ecLen - 1] = gfMul(gen[ecLen], factor);
  }
  return rem;
}

function calcFormatBitsL(maskId) {
  const data = (0b01 << 3) | (maskId & 7); // EC Level L = 01
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= (0x537 << (i - 10));
  }
  return ((data << 10) | rem) ^ 0x5412;
}

export function makeQrSvgDataUrl(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  let ver = 1;
  while (ver <= 10) {
    const capBits = QR_V_SPEC_L[ver].blocks.reduce((a, b) => a + b, 0) * 8;
    const lenBits = ver <= 9 ? 8 : 16;
    if (4 + lenBits + bytes.length * 8 <= capBits) break;
    ver++;
  }
  if (ver > 10) throw new Error('QR payload exceeds V10 capacity');
  const spec = QR_V_SPEC_L[ver];
  const totalDataBytes = spec.blocks.reduce((a, b) => a + b, 0);

  const bits = [];
  const pushBits = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);
  const maxBits = totalDataBytes * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const dataCw = new Uint8Array(totalDataBytes);
  for (let i = 0; i < bits.length / 8; i++) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b];
    dataCw[i] = v;
  }
  const pads = [0xEC, 0x11];
  for (let i = bits.length / 8, p = 0; i < totalDataBytes; i++, p ^= 1) dataCw[i] = pads[p];

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const blen of spec.blocks) {
    const slice = dataCw.slice(offset, offset + blen);
    offset += blen;
    dataBlocks.push(slice);
    ecBlocks.push(rsEncodeBlock(slice, spec.ecPerBlock));
  }
  const finalCw = [];
  const maxD = Math.max(...spec.blocks);
  for (let c = 0; c < maxD; c++) {
    for (const db of dataBlocks) if (c < db.length) finalCw.push(db[c]);
  }
  for (let c = 0; c < spec.ecPerBlock; c++) {
    for (const eb of ecBlocks) finalCw.push(eb[c]);
  }

  const size = 17 + ver * 4;
  const baseMat = Array.from({ length: size }, () => new Uint8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setFn = (r, c, dark) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    baseMat[r][c] = dark ? 1 : 0;
    reserved[r][c] = 1;
  };

  const placeFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r0 + dr, cc = c0 + dc;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFn(rr, cc, inOuter && (onBorder || inCore));
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) setFn(6, i, i % 2 === 0);
    if (!reserved[i][6]) setFn(i, 6, i % 2 === 0);
  }

  for (const r0 of spec.align) {
    for (const c0 of spec.align) {
      if (reserved[r0][c0]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFn(r0 + dr, c0 + dc, dark);
        }
      }
    }
  }

  // Reserve format info & dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) { reserved[8][i] = 1; reserved[i][8] = 1; }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = 1;
    reserved[size - 1 - i][8] = 1;
  }
  setFn(size - 8, 8, true);

  if (spec.vInfo) {
    for (let i = 0; i < 18; i++) {
      const bit = (spec.vInfo >>> i) & 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(b, a, bit === 1);
      setFn(a, b, bit === 1);
    }
  }

  // Place data bits upward/downward zigzag
  let bitIdx = 0;
  const totalStreamBits = finalCw.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      const r = upward ? (size - 1 - v) : v;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!reserved[r][c]) {
          let bit = 0;
          if (bitIdx < totalStreamBits) {
            bit = (finalCw[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
            bitIdx++;
          }
          baseMat[r][c] = bit;
        }
      }
    }
    upward = !upward;
  }

  const maskFns = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];

  const writeFormat = (mat, maskId) => {
    const f = calcFormatBitsL(maskId);
    for (let i = 0; i <= 5; i++) mat[8][i] = (f >>> (14 - i)) & 1;
    mat[8][7] = (f >>> 8) & 1;
    mat[8][8] = (f >>> 7) & 1;
    mat[7][8] = (f >>> 6) & 1;
    for (let i = 9; i < 15; i++) mat[14 - i][8] = (f >>> (14 - i)) & 1;
    for (let i = 0; i < 8; i++) mat[8][size - 1 - i] = (f >>> i) & 1;
    for (let i = 8; i < 15; i++) mat[size - 15 + i][8] = (f >>> i) & 1;
  };

  let bestMat = null;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const cand = baseMat.map((row) => Uint8Array.from(row));
    const fn = maskFns[m];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!reserved[r][c] && fn(r, c)) cand[r][c] ^= 1;
      }
    }
    writeFormat(cand, m);
    let score = 0;
    for (let r = 0; r < size; r++) {
      let run = 1;
      for (let c = 1; c < size; c++) {
        if (cand[r][c] === cand[r][c - 1]) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
    for (let c = 0; c < size; c++) {
      let run = 1;
      for (let r = 1; r < size; r++) {
        if (cand[r][c] === cand[r - 1][c]) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
    if (score < bestScore) { bestScore = score; bestMat = cand; }
  }

  const border = 2;
  const full = size + border * 2;
  let dPath = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (bestMat[r][c]) dPath += `M${c + border} ${r + border}h1v1h-1z`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="#ffffff"/><path d="${dPath}" fill="#0f172a"/></svg>`;
  return 'data:image/svg+xml;base64,' + bytesToB64(new TextEncoder().encode(svg));
}

// ============================================================================
// HTTP Route Dispatcher for `/api/pay/*`
// ============================================================================
export async function handlePayApi(request, env, url, path, helpers) {
  const { extractToken, readSafeJson, jsonResp, randomHex } = helpers;
  const now = Date.now();
  const cfg = getAlipayConfig(env);
  await ensurePayTables(env);

  if (path === '/api/pay/alipay_notify' && request.method === 'POST') {
    const rawForm = await request.text();
    if (!rawForm || rawForm.length > 16384 || !cfg.configured) {
      return new Response('failure', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const usp = new URLSearchParams(rawForm);
    const formDict = {};
    for (const [k, v] of usp.entries()) formDict[k] = v;
    const signB64 = formDict.sign || '';
    const unsigned = Object.keys(formDict)
      .filter((k) => k !== 'sign' && k !== 'sign_type' && formDict[k] !== '')
      .sort()
      .map((k) => `${k}=${formDict[k]}`)
      .join('&');
    const sigOk = await alipayRsa2Verify(cfg.pubKey, unsigned, signB64);
    if (!sigOk || formDict.app_id !== cfg.appId) {
      return new Response('failure', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const tStatus = String(formDict.trade_status || '').toUpperCase();
    if (tStatus === 'TRADE_SUCCESS' || tStatus === 'TRADE_FINISHED') {
      const oid = String(formDict.out_trade_no || '').trim().slice(0, 48);
      const aliTx = String(formDict.trade_no || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
      const paidFen = Math.round(Number(formDict.total_amount || 0) * 100);
      if (oid && aliTx && paidFen >= 100) {
        await settleVerifiedOrderD1(env, helpers, oid, paidFen, `ALI_${aliTx}`, `alin_${aliTx}`.slice(0, 64), now);
      }
    }
    return new Response('success', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  if (path === '/api/pay/alipay_return' && request.method === 'GET') {
    const oid = String(url.searchParams.get('out_trade_no') || '').trim().slice(0, 48);
    if (oid && cfg.configured) {
      await queryAndSettleAlipayOrderD1(env, cfg, helpers, oid, now);
    }
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>支付完成 · 鹈鹕测试大乱斗</title></head><body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;"><div><h2 style="color:#4ade80;">✅ 支付宝付款已完成</h2><p>绿豆正在同步入账，正在自动返回车库...</p><a href="/" style="display:inline-block;margin-top:12px;padding:10px 22px;background:#38bdf8;color:#0f172a;border-radius:999px;font-weight:900;text-decoration:none;">立即返回游戏</a></div><script>setTimeout(()=>location.replace('/'),1200);</script></body></html>`;
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  if (path === '/api/pay/go' && request.method === 'GET') {
    const oid = String(url.searchParams.get('oid') || '').trim().slice(0, 48);
    if (!oid || !cfg.configured) return new Response('Invalid order', { status: 400 });
    const orow = await env.DB.prepare('SELECT * FROM recharge_orders WHERE order_id = ?').bind(oid).first();
    if (!orow || orow.status !== 'PENDING') return Response.redirect(`${url.origin}/`, 302);
    const ua = String(request.headers.get('User-Agent') || '');
    const isMobile = /Mobile|Android|iPhone|iPad|AlipayClient/i.test(ua);
    const notifyUrl = `${url.origin}/api/pay/alipay_notify`;
    const returnUrl = `${url.origin}/api/pay/alipay_return`;
    const yuanStr = (Number(orow.amount_fen) / 100).toFixed(2);
    const target = await buildAlipayRedirectUrl(
      cfg,
      isMobile ? 'alipay.trade.wap.pay' : 'alipay.trade.page.pay',
      {
        out_trade_no: oid,
        total_amount: yuanStr,
        subject: `鹈鹕测试大乱斗-${orow.pack_name}`.slice(0, 64),
        product_code: isMobile ? 'QUICK_WAP_WAY' : 'FAST_INSTANT_TRADE_PAY',
        timeout_express: '20m'
      },
      notifyUrl,
      returnUrl
    );
    return Response.redirect(target, 302);
  }

  if (path === '/api/pay/catalog' && request.method === 'GET') {
    const token = extractToken(request, null);
    let loggedIn = false;
    let usernameDisp = '';
    let firstEligible = true;
    if (token) {
      const prow = await env.DB.prepare('SELECT username, display_name FROM players WHERE token = ?').bind(token).first();
      if (prow) {
        loggedIn = true;
        usernameDisp = prow.display_name;
        const cntRow = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM recharge_orders WHERE username = ? AND status = 'PAID'").bind(prow.username).first();
        firstEligible = Number(cntRow?.cnt || 0) === 0;
      }
    }
    return jsonResp({
      ok: true,
      loggedIn,
      username: usernameDisp,
      firstBonusBeans: FIRST_RECHARGE_BONUS_BEANS,
      firstBonusEligible: firstEligible,
      realPayEnabled: cfg.configured,
      sandboxEnabled: false,
      packs: Object.values(RECHARGE_PACKS)
    });
  }

  if (path === '/api/pay/create_order' && request.method === 'POST') {
    const parsed = await readSafeJson(request, 2048);
    if (parsed.err) return jsonResp({ ok: false, error: parsed.err }, parsed.status);
    const body = parsed.body || {};
    const token = extractToken(request, body);
    if (!token) return jsonResp({ ok: false, error: '请先登录账号再进行充值，确保绿豆永久绑定账号不丢失！' }, 401);
    const prow = await env.DB.prepare('SELECT username, display_name FROM players WHERE token = ?').bind(token).first();
    if (!prow) return jsonResp({ ok: false, error: '登录已失效，请重新登录' }, 401);

    const pack = RECHARGE_PACKS[String(body.packId || '').trim()];
    if (!pack) return jsonResp({ ok: false, error: '无效的充值档位' }, 400);
    const payChannel = String(body.payChannel || 'alipay').trim().toLowerCase();
    if (payChannel === 'wechat') {
      return jsonResp({ ok: false, error: '微信官方直连需个体户/企业营业执照；当前个人直连通道请选择【💙 支付宝】（0三方抽成）！' }, 400);
    }
    if (payChannel !== 'alipay') return jsonResp({ ok: false, error: '不支持的支付方式' }, 400);
    if (!cfg.configured) return jsonResp({ ok: false, error: '服务端尚未配置支付宝密钥' }, 503);

    await env.DB.prepare("UPDATE recharge_orders SET status = 'EXPIRED' WHERE username = ? AND status = 'PENDING' AND expires_at <= ?")
      .bind(prow.username, now).run();
    const recentCnt = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM recharge_orders WHERE username = ? AND created_at > ?')
      .bind(prow.username, now - 60000).first();
    if (Number(recentCnt?.cnt || 0) >= 20) {
      return jsonResp({ ok: false, error: '创建订单过于频繁，请稍后再试' }, 429);
    }

    const paidCntRow = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM recharge_orders WHERE username = ? AND status = 'PAID'")
      .bind(prow.username).first();
    const firstEligible = Number(paidCntRow?.cnt || 0) === 0;

    const d = new Date(now);
    const pad = (n) => String(n).padStart(2, '0');
    const tsTag = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
    const orderId = `PL${tsTag}${randomHex(5).toUpperCase()}`;
    const expiresAt = now + ORDER_TTL_MS;

    await env.DB.prepare(
      `INSERT INTO recharge_orders (
        order_id, username, display_name, pack_id, pack_name, pay_channel,
        amount_fen, base_beans, bonus_tier_beans, bonus_first_beans, credited_beans,
        status, trade_no, is_sandbox, created_at, expires_at, paid_at
      ) VALUES (?, ?, ?, ?, ?, 'alipay', ?, ?, ?, 0, 0, 'PENDING', NULL, 0, ?, ?, NULL)`
    ).bind(orderId, prow.username, prow.display_name, pack.id, pack.name, pack.amountFen, pack.baseBeans, pack.bonusBeans, now, expiresAt).run();

    const orow = await env.DB.prepare('SELECT * FROM recharge_orders WHERE order_id = ?').bind(orderId).first();
    const checkout = await createSmartAlipayCheckout(cfg, url.origin, orderId, pack.amountFen, `鹈鹕测试大乱斗-${pack.name}`);
    if (!checkout.ok) {
      return jsonResp({ ok: false, error: checkout.error }, 503);
    }
    const qrDataUrl = makeQrSvgDataUrl(checkout.qrTargetUrl);
    const expectedFirst = firstEligible ? FIRST_RECHARGE_BONUS_BEANS : 0;
    return jsonResp({
      ok: true,
      order: formatOrderObj(orow),
      firstBonusEligible: firstEligible,
      expectedFirstBonusBeans: expectedFirst,
      expectedTotalBeans: pack.totalBeans + expectedFirst,
      realPayEnabled: true,
      sandboxEnabled: false,
      payCodeUrl: checkout.qrTargetUrl,
      checkoutUrl: checkout.checkoutUrl,
      qrDataUrl
    });
  }

  if (path === '/api/pay/status' && request.method === 'GET') {
    const token = extractToken(request, null);
    if (!token) return jsonResp({ ok: false, error: '请先登录账号' }, 401);
    const prow = await env.DB.prepare('SELECT username, display_name FROM players WHERE token = ?').bind(token).first();
    if (!prow) return jsonResp({ ok: false, error: '登录已失效' }, 401);
    const orderId = String(url.searchParams.get('orderId') || '').trim().slice(0, 48);
    if (!orderId) return jsonResp({ ok: false, error: '缺少订单号' }, 400);
    let orow = await env.DB.prepare('SELECT * FROM recharge_orders WHERE order_id = ?').bind(orderId).first();
    if (!orow) return jsonResp({ ok: false, error: '订单不存在' }, 404);
    if (orow.username !== prow.username) return jsonResp({ ok: false, error: '无权查询他人订单' }, 403);

    if (orow.status === 'PENDING' && cfg.configured) {
      await queryAndSettleAlipayOrderD1(env, cfg, helpers, orderId, now);
      orow = await env.DB.prepare('SELECT * FROM recharge_orders WHERE order_id = ?').bind(orderId).first();
    }
    if (orow.status === 'PENDING' && now > Number(orow.expires_at)) {
      await env.DB.prepare("UPDATE recharge_orders SET status = 'EXPIRED' WHERE order_id = ? AND status = 'PENDING'").bind(orderId).run();
      orow.status = 'EXPIRED';
    }
    let authSync = null;
    if (orow.status === 'PAID') {
      const freshP = await env.DB.prepare('SELECT display_name, save_json FROM players WHERE username = ?').bind(prow.username).first();
      if (freshP) {
        let raw = null;
        try { raw = JSON.parse(freshP.save_json); } catch (_) {}
        authSync = await helpers.buildSignedAuthPayload(freshP.display_name, helpers.sanitizeSave(raw, null), helpers.extractSaveRev(raw), now);
      }
    }
    return jsonResp({ ok: true, order: formatOrderObj(orow), authSync });
  }

  if (path === '/api/pay/orders' && request.method === 'GET') {
    const token = extractToken(request, null);
    if (!token) return jsonResp({ ok: false, error: '请先登录账号' }, 401);
    const prow = await env.DB.prepare('SELECT username, display_name FROM players WHERE token = ?').bind(token).first();
    if (!prow) return jsonResp({ ok: false, error: '登录已失效' }, 401);
    await env.DB.prepare("UPDATE recharge_orders SET status = 'EXPIRED' WHERE username = ? AND status = 'PENDING' AND expires_at < ?")
      .bind(prow.username, now).run();
    const listRes = await env.DB.prepare('SELECT * FROM recharge_orders WHERE username = ? ORDER BY created_at DESC LIMIT 15')
      .bind(prow.username).all();
    const stats = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_fen), 0) AS fen, COALESCE(SUM(credited_beans), 0) AS beans FROM recharge_orders WHERE username = ? AND status = 'PAID'"
    ).bind(prow.username).first();
    return jsonResp({
      ok: true,
      firstBonusEligible: Number(stats?.cnt || 0) === 0,
      totalPaidCount: Number(stats?.cnt || 0),
      totalPaidYuan: Math.round(Number(stats?.fen || 0)) / 100,
      totalCreditedBeans: Number(stats?.beans || 0),
      orders: (listRes.results || []).map(formatOrderObj)
    });
  }

  if (path === '/api/pay/cancel' && request.method === 'POST') {
    const parsed = await readSafeJson(request, 1024);
    if (parsed.err) return jsonResp({ ok: false, error: parsed.err }, parsed.status);
    const body = parsed.body || {};
    const token = extractToken(request, body);
    if (!token) return jsonResp({ ok: false, error: '请先登录账号' }, 401);
    const prow = await env.DB.prepare('SELECT username FROM players WHERE token = ?').bind(token).first();
    if (!prow) return jsonResp({ ok: false, error: '登录已失效' }, 401);
    const orderId = String(body.orderId || '').trim().slice(0, 48);
    const orow = await env.DB.prepare('SELECT * FROM recharge_orders WHERE order_id = ?').bind(orderId).first();
    if (!orow) return jsonResp({ ok: false, error: '订单不存在' }, 404);
    if (orow.username !== prow.username) return jsonResp({ ok: false, error: '无权操作他人订单' }, 403);
    if (orow.status === 'PAID') return jsonResp({ ok: false, error: '已支付订单无法取消' }, 409);
    await env.DB.prepare("UPDATE recharge_orders SET status = 'CANCELLED' WHERE order_id = ? AND status = 'PENDING'").bind(orderId).run();
    const orow2 = await env.DB.prepare('SELECT * FROM recharge_orders WHERE order_id = ?').bind(orderId).first();
    return jsonResp({ ok: true, order: formatOrderObj(orow2) });
  }

  return jsonResp({ ok: false, error: 'Not Found' }, 404);
}
