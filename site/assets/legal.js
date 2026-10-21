/* ===== РЕКВИЗИТЫ: заполнить один раз — подставятся в подвал и во все документы =====
   Пустое поле на сайте не показывается. */
window.REQ = {
  name: 'Рыжиков Пётр Алексеевич',
  inn: '',        // ИНН, 12 цифр
  ogrnip: '',     // ОГРНИП, 15 цифр
  email: '',      // почта для претензий и запросов по персональным данным
  telegram: '',   // ник для связи, например @ryzhikov_help
  updated: '21 октября 2026 г.'
};
(() => {
  const R = window.REQ;
  document.querySelectorAll('[data-req]').forEach(el => {
    const v = R[el.dataset.req];
    if (!v) { el.hidden = true; return; }
    const slot = el.querySelector('[data-v]') || el;
    if (el.dataset.req === 'email') { if (el.tagName === 'A') el.href = 'mailto:' + v; else slot.innerHTML = `<a href="mailto:${v}">${v}</a>`; }
    else if (el.dataset.req === 'telegram') { const u = v.replace(/^@/, ''), href = `https://t.me/${u}`;
      if (el.tagName === 'A') { el.href = href; el.target = '_blank'; el.rel = 'noopener'; } else slot.innerHTML = `<a href="${href}" target="_blank" rel="noopener">@${u}</a>`; }
    else slot.textContent = v;
  });
  document.querySelectorAll('[data-updated]').forEach(el => el.textContent = R.updated);
})();
