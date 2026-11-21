// Cloudflare Pages Function: POST /api/order
// Надсилає заявку в Telegram. Капча (Turnstile) вмикається ТІЛЬКИ коли запити повторюються.
//
// Змінні середовища (Settings → Variables and Secrets):
//   TELEGRAM_BOT_TOKEN  — токен бота
//   TELEGRAM_CHAT_ID    — ваш chat id
//   TURNSTILE_SECRET    — секретний ключ Turnstile (потрібен для капчі)
// Необов'язково: KV-прив'язка з назвою RATE (точніший лічильник). Без неї працює Cache API.
//
// Пороги (змініть за потреби):
const IP_CAPTCHA_AFTER = 3;      // з однієї IP за вікно: 4-а й далі заявка вимагає капчу
const IP_WINDOW_SEC = 600;       // вікно для IP: 10 хвилин
const SAME_CAPTCHA_AFTER = 1;    // однакова заявка (той самий телефон і позиція): 2-а вимагає капчу
const SAME_WINDOW_SEC = 1800;    // 30 хвилин
const IP_HARD_LIMIT = 15;        // більше 15 за годину з однієї IP: блок навіть із капчею
const IP_HARD_WINDOW_SEC = 3600;

const clean = (v, max = 300) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

async function bump(env, key, ttl) {
  try {
    if (env.RATE) {
      const n = (parseInt(await env.RATE.get(key)) || 0) + 1;
      await env.RATE.put(key, String(n), { expirationTtl: Math.max(60, ttl) });
      return n;
    }
    const cache = caches.default;
    const req = new Request('https://rate.stanadyne.internal/' + encodeURIComponent(key));
    const hit = await cache.match(req);
    const n = (hit ? parseInt(await hit.text()) || 0 : 0) + 1;
    await cache.put(req, new Response(String(n), { headers: { 'Cache-Control': 'max-age=' + ttl } }));
    return n;
  } catch (e) {
    return 0; // якщо лічильник недоступний — не блокуємо клієнта
  }
}

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return json({ ok: false, error: 'telegram-not-configured' }, 500);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad-json' }, 400); }

  if (body.website) return json({ ok: true });                       // honeypot
  if (Number(body.elapsed) < 1500) return json({ ok: false, error: 'too-fast' }, 400);

  const name = clean(body.name, 120);
  const phone = clean(body.phone, 25);
  if (name.split(/\s+/).filter(Boolean).length < 2 || phone.replace(/\D/g, '').length < 10) {
    return json({ ok: false, error: 'validation' }, 400);
  }

  // ---- Лічильники повторів ----
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const sameKey = 'same:' + await sha(phone.replace(/\D/g, '') + '|' + clean(body.itemTitle, 200) + '|' + clean(body.details, 500));
  const nIp = await bump(env, 'ip:' + ip, IP_WINDOW_SEC);
  const nHour = await bump(env, 'iph:' + ip, IP_HARD_WINDOW_SEC);
  const nSame = await bump(env, sameKey, SAME_WINDOW_SEC);

  if (nHour > IP_HARD_LIMIT) return json({ ok: false, error: 'rate-limited' }, 429);

  const needCaptcha = nIp > IP_CAPTCHA_AFTER || nSame > SAME_CAPTCHA_AFTER;
  if (needCaptcha) {
    if (!env.TURNSTILE_SECRET) return json({ ok: false, error: 'rate-limited' }, 429);
    const token = clean(body.turnstile, 2048);
    if (!token) return json({ ok: false, error: 'captcha-required' }, 403);
    const form = new FormData();
    form.append('secret', env.TURNSTILE_SECRET);
    form.append('response', token);
    if (ip !== 'unknown') form.append('remoteip', ip);
    const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const vr = await v.json().catch(() => ({}));
    if (!vr.success) return json({ ok: false, error: 'captcha-invalid' }, 403);
  }

  const lines = [
    '🆕 НОВЕ ЗАМОВЛЕННЯ ЗІ САЙТУ',
    '',
    '📦 Позиція: ' + clean(body.itemTitle, 200),
    '👤 ПІБ: ' + name,
    '📞 Телефон: ' + phone,
    '',
    '🚚 ДОСТАВКА НОВОЮ ПОШТОЮ',
    '🗺 Область: ' + (clean(body.deliveryArea) ? clean(body.deliveryArea) + ' обл.' : '—'),
    '📍 Район: ' + (clean(body.deliveryRegion) || '—'),
    '🏘 Населений пункт: ' + (clean(body.deliveryCity) || '—'),
    '🏤 Відділення / поштомат: ' + (clean(body.deliveryWarehouse) || '—'),
    '',
    '💬 Коментар: ' + (clean(body.details, 500) || '—'),
    '',
    '🕒 ' + new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' }) + (needCaptcha ? ' (повторні запити, капчу пройдено)' : '')
  ];

  const tg = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: lines.join('\n'), disable_web_page_preview: true })
  });
  if (!tg.ok) return json({ ok: false, error: 'telegram-failed' }, 502);
  return json({ ok: true });
}
