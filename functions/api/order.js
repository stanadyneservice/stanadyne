// Cloudflare Pages Function: POST /api/order
// Приймає заявку з сайту і надсилає її вам у Telegram.
// Токен бота НЕ зберігається в коді сайту: він лежить у змінних середовища Cloudflare
//   TELEGRAM_BOT_TOKEN  — токен від @BotFather
//   TELEGRAM_CHAT_ID    — ваш chat id (число)
//   TURNSTILE_SECRET    — (необов'язково) секретний ключ Cloudflare Turnstile

const clean = (v, max = 300) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

export async function onRequestPost({ request, env }) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return json({ ok: false, error: 'telegram-not-configured' }, 500);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad-json' }, 400); }

  // Антибот: honeypot і занадто швидка відправка
  if (body.website) return json({ ok: true });
  if (Number(body.elapsed) < 1500) return json({ ok: false, error: 'too-fast' }, 400);

  // Turnstile (якщо задано секрет)
  if (env.TURNSTILE_SECRET) {
    const form = new FormData();
    form.append('secret', env.TURNSTILE_SECRET);
    form.append('response', clean(body.turnstile, 2048));
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) form.append('remoteip', ip);
    const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const vr = await v.json().catch(() => ({}));
    if (!vr.success) return json({ ok: false, error: 'captcha' }, 400);
  }

  const name = clean(body.name, 120);
  const phone = clean(body.phone, 25);
  if (name.split(/\s+/).filter(Boolean).length < 2 || phone.replace(/\D/g, '').length < 10) {
    return json({ ok: false, error: 'validation' }, 400);
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
    '🕒 ' + new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })
  ];

  const tg = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: lines.join('\n'), disable_web_page_preview: true })
  });
  if (!tg.ok) return json({ ok: false, error: 'telegram-failed' }, 502);
  return json({ ok: true });
}
