/** UI көмекші функциялары (XSS-тен қорғалған DOM құру) */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Қауіпсіз элемент құру — мәтін әрқашан textContent арқылы қойылады */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.textContent = value; // XSS қорғанысы: HTML енгізілмейді
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') Object.entries(value).forEach(([k, v]) => { node.dataset[k] = v; });
    else node.setAttribute(key, value === true ? '' : String(value));
  });
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child == null || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

export function toast(message, type = '', ms = 3200) {
  const host = $('#toast-host');
  if (!host) return;
  const node = el('div', { class: `toast ${type}`, text: message });
  host.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .35s, transform .35s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(12px)';
    setTimeout(() => node.remove(), 350);
  }, ms);
}

export function setAlert(node, message, type = 'error') {
  if (!node) return;
  if (!message) {
    node.className = 'alert';
    node.textContent = '';
    return;
  }
  node.className = `alert ${type} show`;
  node.textContent = message;
}

/** Массивті араластыру (Fisher–Yates) */
export function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function formatTime(ms) {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function confetti(host, count = 70) {
  const colors = ['#e8b923', '#2ec4c4', '#f6d675', '#ffffff', '#35c26a'];
  const layer = el('div', { class: 'confetti' });
  for (let i = 0; i < count; i++) {
    layer.append(el('i', {
      style: {
        left: `${Math.random() * 100}%`,
        top: `${-10 - Math.random() * 25}%`,
        background: colors[i % colors.length],
        animationDuration: `${2.4 + Math.random() * 2.4}s`,
        animationDelay: `${Math.random() * 1.4}s`,
        transform: `rotate(${Math.random() * 360}deg)`,
      },
    }));
  }
  host.append(layer);
  setTimeout(() => layer.remove(), 7000);
}
