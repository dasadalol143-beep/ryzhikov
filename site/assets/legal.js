/* ===== РЕКВИЗИТЫ: заполнить один раз — подставятся в подвал и во все документы =====
   Пустое поле на сайте не показывается. */
window.REQ = {
  name: 'Рыжиков Пётр Алексеевич',
  inn: '252233079364',
  ogrnip: '325750000044659',
  city: 'Забайкальский край, г. Чита',   // полный адрес ИП не публикуем: в открытом ЕГРИП его тоже нет
  account: '40802810200008912618',
  bank: 'АО «ТБанк»',
  bik: '044525974',
  corr: '30101810145250000974',
  email: '',      // почта для претензий и запросов по персональным данным
  telegram: '@ryzhikovpa',
  updated: '22 октября 2026 г.'
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
