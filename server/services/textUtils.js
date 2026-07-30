'use strict';
/** PDF мәтінін тазарту утилиталары */

const SHORT_WORDS = new Set([
  'мен', 'пен', 'бен', 'және', 'да', 'де', 'та', 'те', 'не', 'ме', 'бе', 'ба',
  'па', 'ға', 'ге', 'қа', 'ке', 'на', 'ж', 'жж', 'ж.', 'жж.', 'б', 'г', 'ғ',
  'вв', 'No', '№', 'үш', 'екі', 'бір', 'ол', 'ер', 'ай', 'ас', 'ат', 'ие',
]);

function normalizeText(raw) {
  let s = String(raw == null ? '' : raw).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/(\p{L})\s+-\s+(\p{L})/gu, '$1-$2');
  s = s.replace(/(\d)\s*[–—-]\s*(\d)/g, '$1–$2');
  const tokens = s.split(' ');
  const out = [];
  for (const t of tokens) {
    const prev = out[out.length - 1];
    if (
      prev &&
      t.length <= 2 &&
      /^\p{Ll}+$/u.test(t) &&
      !SHORT_WORDS.has(t.toLowerCase()) &&
      /\p{L}{3,}$/u.test(prev) &&
      !/[.,:;!?)\]»]$/.test(prev)
    ) {
      out[out.length - 1] = prev + t;
    } else {
      out.push(t);
    }
  }
  return out.join(' ').replace(/\s+([.,;:!?])/g, '$1').trim();
}

const isDivider = (l) => /^[_\-–—]{5,}$/.test(String(l).replace(/\s/g, ''));

module.exports = { normalizeText, isDivider };
