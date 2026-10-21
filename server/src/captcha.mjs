/**
 * 验证码校验统一入口（与前端 CaptchaPayload 契约一致）
 *
 * - simple    → 自研图形码，挑战存 challenges 表（单次有效 / TTL / 失败上限）
 * - turnstile → Cloudflare siteverify（正式上线用）
 */
import crypto from 'node:crypto';

const CAPTCHA_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 生成 6 位挑战码（仅 simple provider） */
export function createChallenge(db, config) {
  let code = '';
  for (let i = 0; i < 6; i++) code += CAPTCHA_ALPHABET[crypto.randomInt(CAPTCHA_ALPHABET.length)];
  const id = crypto.randomUUID();
  db.createChallenge(id, code, Date.now() + config.captchaTtlSec * 1000);
  return { id, code, ttl: config.captchaTtlSec };
}

/**
 * @param {{ provider?: string, challengeId?: string, answer?: string, token?: string }} payload
 * @returns {Promise<{ ok: boolean, msg?: string }>}
 */
export async function verifyCaptcha(db, payload, config) {
  if (!payload || typeof payload !== 'object') return { ok: false, msg: '缺少验证码' };

  if (payload.provider === 'turnstile') {
    return verifyTurnstile(payload.token, config);
  }

  // simple
  const rec = db.getChallenge(String(payload.challengeId || ''));
  if (!rec) return { ok: false, msg: '验证码已失效，请刷新' };
  if (rec.expires_at < Date.now()) {
    db.deleteChallenge(rec.id);
    return { ok: false, msg: '验证码已过期，请刷新' };
  }
  db.incChallengeAttempts(rec.id);
  if (rec.attempts + 1 > config.captchaMaxAttempts) {
    db.deleteChallenge(rec.id);
    return { ok: false, msg: '尝试次数过多，请刷新验证码' };
  }
  if (String(payload.answer || '').trim().toUpperCase() !== rec.code) {
    return { ok: false, msg: '验证码不正确' };
  }
  db.deleteChallenge(rec.id);
  return { ok: true };
}

async function verifyTurnstile(token, config) {
  if (!config.turnstileSecret) return { ok: false, msg: 'Turnstile 未配置' };
  if (!token) return { ok: false, msg: '缺少 Turnstile token' };
  try {
    const body = new URLSearchParams({ secret: config.turnstileSecret, response: String(token) });
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const data = await resp.json();
    return data.success ? { ok: true } : { ok: false, msg: '人机校验未通过' };
  } catch {
    return { ok: false, msg: '人机校验服务不可用，请稍后再试' };
  }
}
