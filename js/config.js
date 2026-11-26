// ============================================================================
// 《鹈鹕测试大乱斗》 — Game Balance, Heroes, Bosses, Stages & Upgrade Configuration
// ============================================================================

export const VALID_HERO_IDS = ['nailong', 'ikun', 'pelican', 'naiwa', 'hakimi'];

// 5 Playable Heroes: 奶蛙 sits right next to 奶龙 ("我是奶龙!" / "我才是奶龙!")!
export const HEROES = [
  {
    id: 'nailong', icon: '🐉', name: '大头奶龙', tag: '超长喷火',
    perk: '🐉 高伤脆皮(78HP) · 天赋[超长烈焰喷火+滞空]', cost: 0,
    baseHp: 78, hpStep: 16,
    skillIcon: '🔥', skillLbl: '超长喷火', skillCd: 0
  },
  {
    id: 'naiwa', icon: '🐸', name: '狂笑奶蛙', tag: '雷霆转转舌',
    perk: '🐸 冒牌奶龙(90HP) · 天赋[雷霆长舌满屏旋转扫]', cost: 0,
    baseHp: 90, hpStep: 19,
    skillIcon: '⚡', skillLbl: '雷霆长舌', skillCd: 4.8
  },
  {
    id: 'ikun', icon: '🏀', name: '中分ikun', tag: '巨型弹跳球',
    perk: '🏀 均衡战士(102HP) · 天赋[高弹慢滚巨型篮球]', cost: 0,
    baseHp: 102, hpStep: 22,
    skillIcon: '🏀', skillLbl: '巨型篮球', skillCd: 2.8
  },
  {
    id: 'pelican', icon: '🦩', name: '背带鹈鹕', tag: '吞怪+充能',
    perk: '🦩 重装前排(118HP) · 天赋[大嘴吞怪+超级奖励充能+10%]', cost: 0,
    baseHp: 118, hpStep: 25,
    skillIcon: '🦩', skillLbl: '大嘴吞怪', skillCd: 2.8
  },
  {
    id: 'hakimi', icon: '🐱', name: '哈基米猫', tag: '圆头耄耋',
    perk: '🐱 高血身法坦(136HP) · 天赋[四段跳+狂丢小圆头耄耋]', cost: 0,
    baseHp: 136, hpStep: 28,
    skillIcon: '🐱', skillLbl: '圆头耄耋', skillCd: 3.2
  }
];

// Asymmetric Hero Max-HP Curve (Lv1..Lv6)
export function getHeroLvFromSave(save, heroId) {
  return Math.min(6, Math.max(1, Math.floor((save.heroLv && save.heroLv[heroId]) || 1)));
}

export function getHeroMaxHpFromSave(save, heroId) {
  const h = HEROES.find((x) => x.id === heroId) || HEROES[0];
  const baseCharHp = (h.baseHp || 100) + (getHeroLvFromSave(save, heroId) - 1) * (h.hpStep || 22);
  const hpPctLv = Math.min(5, Math.max(0, Math.floor((save && save.talents && save.talents.maxHpPct) || 0)));
  return Math.round(baseCharHp * (1 + hpPctLv * 0.05));
}

export function getHeroHpUpgradeCost(lv) {
  const table = [0, 1000, 1800, 2800, 4200, 6000];
  return table[lv] || 6000;
}

// 4 Rare Track Props: Starts at 500🌿 and increases per level (500 -> 1100 -> 2000)!
export const GARAGE_MODS = [
  { key: 'claw', ico: '🧲', name: '磁铁爪', baseDur: 4.0, stepDur: 1.0, costs: [500, 1100, 2000], maxLv: 3 },
  { key: 'nitro', ico: '🚀', name: '氮气罐', baseDur: 1.8, stepDur: 0.5, costs: [500, 1100, 2000], maxLv: 3 },
  { key: 'sawBumper', ico: '⚙️', name: '破障锯', baseDur: 4.0, stepDur: 1.0, costs: [500, 1100, 2000], maxLv: 3 },
  { key: 'mortarCat', ico: '🐱', name: '迫击猫', baseDur: 6.5, stepDur: 1.5, costs: [500, 1100, 2000], maxLv: 3 }
];

// Green-Bean Permanent Talent System:
//  1. 🌈 超级奖励充能: +5% charge speed per level (1000🌿/Lv, Max Lv5 -> +25%)
//  2. ❤️ 全角色生命上限: +5% Max HP for all heroes per level (10000🌿/Lv, Max Lv5 -> +25%)
//  3. 💚 自动生命回复: +1 HP per 5s per level (20000🌿/Lv, Max Lv5 -> +5 HP / 5s)
export const BEAN_TALENTS = [
  {
    key: 'superCharge',
    ico: '🌈',
    name: '超级奖励充能',
    costPerLv: 1000,
    maxLv: 5,
    formatCur(lv) { return `+${lv * 5}%`; },
    formatNext(lv) { return `+${(lv + 1) * 5}%`; },
    formatDesc(lv) { return `超级奖励充能速度提高 ${lv * 5}%`; }
  },
  {
    key: 'maxHpPct',
    ico: '❤️',
    name: '全角色生命上限',
    costPerLv: 10000,
    maxLv: 5,
    formatCur(lv) { return `+${lv * 5}%`; },
    formatNext(lv) { return `+${(lv + 1) * 5}%`; },
    formatDesc(lv) { return `全部角色生命上限增加 ${lv * 5}%`; }
  },
  {
    key: 'autoRegen',
    ico: '💚',
    name: '自动生命回复',
    costPerLv: 20000,
    maxLv: 5,
    formatCur(lv) { return `${lv}点/5秒`; },
    formatNext(lv) { return `${lv + 1}点/5秒`; },
    formatDesc(lv) { return `每 5 秒自动回复 ${lv} 点生命`; }
  }
];

export function getTalentLvFromSave(save, key) {
  const def = BEAN_TALENTS.find((t) => t.key === key);
  const maxLv = def ? def.maxLv : 5;
  return Math.min(maxLv, Math.max(0, Math.floor((save && save.talents && save.talents[key]) || 0)));
}

export function getSuperChargeSpeedMultFromSave(save) {
  return +(1 + getTalentLvFromSave(save, 'superCharge') * 0.05).toFixed(2);
}

export function getAutoRegenPer5sFromSave(save) {
  return getTalentLvFromSave(save, 'autoRegen');
}

export function getModPropDuration(save, modKey) {
  const def = GARAGE_MODS.find((m) => m.key === modKey);
  if (!def) return 4.0;
  const lv = Math.min(3, Math.max(0, (save.mods && save.mods[modKey]) || 0));
  return +(def.baseDur + lv * def.stepDur).toFixed(1);
}

// Rich In-Run Track Props (11 distinct offensive/utility props + Shield + Boba!)
export const WORLD_PROP_POOL = [
  { id: 'super_magnet', sprite: 'prop_magnet', badge: '🧲磁铁爪', halo: '#f43f5e', toast: '🧲 磁铁爪激活 · 全屏吸豆!' },
  { id: 'dash_rocket', sprite: 'prop_rocket', badge: '🚀氮气罐', halo: '#38bdf8', toast: '🚀 氮气罐喷射 · 极速冲刺!' },
  { id: 'orbit_saws', sprite: 'prop_saw', badge: '⚙️破障锯', halo: '#a855f7', toast: '⚙️ 破障电锯护体!' },
  { id: 'mortar_cat', sprite: 'prop_mortar_cat', badge: '🐱迫击猫', halo: '#fb923c', toast: '🐱 迫击猫助阵 · 自动轰炸!' },
  { id: 'gatling', sprite: 'prop_gatling', badge: '🏀加特林', halo: '#0ea5e9', toast: '🏀 武器切换：六管篮球加特林!' },
  { id: 'bazooka', sprite: 'prop_bazooka', badge: '🦈火箭筒', halo: '#22c55e', toast: '🦈 武器切换：深海鲨鱼火箭筒!' },
  { id: 'giant_spicy', sprite: 'prop_giant', badge: '🌶️巨人化', halo: '#fde047', toast: '🌶️ 卫龙辣条 · 短暂巨人化!' },
  { id: 'midas_gold', sprite: 'prop_midas', badge: '💰点豆成金', halo: '#facc15', toast: '💰 点豆成金 · 绿豆三倍!' },
  { id: 'maodie_pack', sprite: 'prop_maodie', badge: '🐱耄耋群袭', halo: '#fb923c', toast: '🐱 召唤圆头耄耋大军出击!' },
  { id: 'thunder_drum', sprite: 'prop_lightning', badge: '⚡雷电护体', halo: '#38bdf8', toast: '⚡ 雷电护体 · 自动电击清场!' },
  { id: 'sky_wings', sprite: 'prop_wings', badge: '🕊️滑翔飞翼', halo: '#7dd3fc', toast: '🕊️ 滑翔飞翼 · 五连跳!' }
];

// Scarce Gradual-Regen Healing Boba (~18~20% MaxHP smooth HoT, scarce so HP tension matters!)
export const HEAL_BOBA_PROP = {
  id: 'heal_boba',
  sprite: 'prop_boba',
  badge: '💚回血汤',
  halo: '#4ade80',
  toast: '🍵 绿豆汤 · 缓慢恢复少量生命!'
};

// Timed Expiring Anti-Burst Energy Shield (Absorbs hits, meme-packaged as 背带金钟罩!)
export const TIMED_SHIELD_PROP = {
  id: 'timed_shield',
  sprite: 'prop_shield',
  badge: '🛡️金钟罩',
  halo: '#38bdf8',
  toast: '🛡️ 背带金钟罩 · 黑子不破防!'
};

export const STAGE_SPAN_M = 360;
export const SUPER_BONUS_DURATION = 10.0;
export const MIN_NORMAL_SEC_FOR_BONUS = 210;

export const STAGES = [
  { id: 'court', name: '🏀 练习生球场', skyTop: '#0369a1', skyMid: '#38bdf8', skyBot: '#fef08a', road: '#334155', grass: '#15803d' },
  { id: 'site', name: '🏗️ 背带拆迁工地', skyTop: '#7c2d12', skyMid: '#ea580c', skyBot: '#fde047', road: '#292524', grass: '#b45309' },
  { id: 'swamp', name: '🍃 狂笑弹簧沼泽', skyTop: '#064e3b', skyMid: '#0f766e', skyBot: '#a7f3d0', road: '#1e293b', grass: '#115e59' },
  { id: 'snow', name: '❄️ 冰川极速雪山', skyTop: '#0c4a6e', skyMid: '#7dd3fc', skyBot: '#f8fafc', road: '#475569', grass: '#e0f2fe' },
  { id: 'volcano', name: '🌋 奶龙熔岩火山', skyTop: '#1c1917', skyMid: '#991b1b', skyBot: '#fb923c', road: '#1e1b18', grass: '#7f1d1d' },
  { id: 'bamboo', name: '🎋 哈基米竹林', skyTop: '#022c22', skyMid: '#059669', skyBot: '#d9f99d', road: '#334155', grass: '#166534' },
  { id: 'cyber', name: '🚨 法务赛博都市', skyTop: '#090d16', skyMid: '#311042', skyBot: '#ec4899', road: '#0f172a', grass: '#4c1d95' }
];

// 6 Progressive Multi-Skill Meme Bosses (Crisp 18~28s fights, huge parry reward, minion summons & 《只因你太美》 BGM)
export const BOSS_ROSTER = [
  {
    tier: 1, tierLbl: '初阶', tierBg: '#0284c7',
    kind: 'dingdong_ji', sprite: 'boss_dingdong', name: '🐔 叮咚鸡',
    hp: 190, dmgRate: 18.5, phases: 2, reward: 115
  },
  {
    tier: 2, tierLbl: '次阶', tierBg: '#d97706',
    kind: 'dagou_jiao', sprite: 'boss_dagou', name: '🐕 大狗嚼',
    hp: 240, dmgRate: 19.5, phases: 2, reward: 150
  },
  {
    tier: 3, tierLbl: '中阶', tierBg: '#16a34a',
    kind: 'titan_naiwa', sprite: 'boss_naiwa', name: '🐸 黄金马桶蛙皇',
    hp: 290, dmgRate: 20.5, phases: 2, reward: 188
  },
  {
    tier: 4, tierLbl: '强敌', tierBg: '#ea580c',
    kind: 'kun_mecha', sprite: 'boss_kun_mecha', name: '🏀 两年半机甲坤王',
    hp: 345, dmgRate: 21.5, phases: 2, reward: 235
  },
  {
    tier: 5, tierLbl: '狂暴', tierBg: '#9333ea',
    kind: 'demon_hakimi', sprite: 'boss_hakimi', name: '🐱 双涡轮机甲猫',
    hp: 400, dmgRate: 22.5, phases: 3, reward: 295
  },
  {
    tier: 6, tierLbl: '霸主', tierBg: '#e11d48',
    kind: 'lava_dragon', sprite: 'boss_lava_dragon', name: '🐉 暗黑熔岩暴龙王',
    hp: 460, dmgRate: 24.0, phases: 3, reward: 390
  },
  {
    tier: 4, tierLbl: '抽象', tierBg: '#2563eb',
    kind: 'manbo_queen', sprite: 'boss_manbo', name: '🎵 曼波小蓝帽',
    hp: 340, dmgRate: 21.0, phases: 3, reward: 245
  }
];

export const MEME_CRIES = ['鸡你太美!', '曼波~', '哈基米!', '我才是奶龙!', '叮咚鸡!', '大狗嚼!'];

// Green-Bean Recharge Tiers (1 RMB = 1,000 🌿 baseline + progressive bonus tiers + +2,000 🌿 Account First-Top-Up Gift)
export const FIRST_RECHARGE_BONUS_BEANS = 2000;
export const RECHARGE_PACKS = [
  {
    id: 'pack_1',
    name: '🌱 1元尝鲜包',
    priceYuan: 1,
    amountFen: 100,
    baseBeans: 1000,
    bonusBeans: 0,
    totalBeans: 1000,
    bonusPctLbl: '基准 1元=1000豆',
    badge: '零门槛体验',
    theme: 'slate',
    desc: '1 RMB 兑换 1,000 绿豆标准比例'
  },
  {
    id: 'pack_6',
    name: '🔥 新手破冰包',
    priceYuan: 6,
    amountFen: 600,
    baseBeans: 6000,
    bonusBeans: 800,
    totalBeans: 6800,
    bonusPctLbl: '多送 +13%',
    badge: '🔥 人气首推',
    theme: 'emerald',
    desc: '6,000 基础豆 + 额外加赠 800 🌿'
  },
  {
    id: 'pack_18',
    name: '⚡ 极速冲刺包',
    priceYuan: 18,
    amountFen: 1800,
    baseBeans: 18000,
    bonusBeans: 4000,
    totalBeans: 22000,
    bonusPctLbl: '多送 +22%',
    badge: '⚡ 畅玩爆款',
    theme: 'sky',
    desc: '18,000 基础豆 + 额外加赠 4,000 🌿'
  },
  {
    id: 'pack_30',
    name: '💎 天赋进阶包',
    priceYuan: 30,
    amountFen: 3000,
    baseBeans: 30000,
    bonusBeans: 9000,
    totalBeans: 39000,
    bonusPctLbl: '多送 +30%',
    badge: '💎 冲榜热销',
    theme: 'violet',
    desc: '30,000 基础豆 + 额外加赠 9,000 🌿'
  },
  {
    id: 'pack_68',
    name: '👑 霸主豪华箱',
    priceYuan: 68,
    amountFen: 6800,
    baseBeans: 68000,
    bonusBeans: 27000,
    totalBeans: 95000,
    bonusPctLbl: '多送 +40%',
    badge: '👑 超值特惠',
    theme: 'amber',
    desc: '68,000 基础豆 + 额外加赠 27,000 🌿'
  },
  {
    id: 'pack_128',
    name: '🏆 至尊满配金库',
    priceYuan: 128,
    amountFen: 12800,
    baseBeans: 128000,
    bonusBeans: 60000,
    totalBeans: 188000,
    bonusPctLbl: '多送 +47%',
    badge: '🏆 毕业神档',
    theme: 'rose',
    desc: '128,000 基础豆 + 额外狂送 60,000 🌿'
  }
];
