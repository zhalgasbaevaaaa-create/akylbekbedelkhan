/**
 * Әмбебап Drag & Drop қозғалтқышы.
 * Тінтуір (HTML5 DnD) + сенсорлы экран (touch) + click-to-place қолдайды.
 */

export function makeDraggable(chip) {
  chip.setAttribute('draggable', 'true');
  chip.addEventListener('dragstart', (e) => {
    if (chip.classList.contains('locked')) { e.preventDefault(); return; }
    chip.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', chip.dataset.value || '');
  });
  chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
}

export function makeDropZone(zone, onDrop) {
  const over = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    zone.classList.add('over');
  };
  zone.addEventListener('dragover', over);
  zone.addEventListener('dragenter', over);
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const chip = document.querySelector('.chip.dragging');
    if (chip) onDrop(chip, zone);
  });
}

/**
 * Сенсорлы экран қолдауы: чипті саусақпен сүйреу.
 * Сондай-ақ «чипті бас — слотты бас» режимі де жұмыс істейді.
 */
const TOUCH_HANDLERS = new WeakMap();

export function enableTouchDrag(container, chipSelector, zoneSelector, onDrop) {
  // Қайта тіркелуден қорғану (беттер ауысқанда listener жиналып қалмауы үшін)
  const previous = TOUCH_HANDLERS.get(container);
  if (previous) {
    container.removeEventListener('touchstart', previous.start);
    container.removeEventListener('touchmove', previous.move);
    container.removeEventListener('touchend', previous.finish);
    container.removeEventListener('touchcancel', previous.finish);
  }

  let active = null;
  let ghost = null;
  let moved = false;

  const findZone = (x, y) => {
    if (ghost) ghost.style.display = 'none';
    const target = document.elementFromPoint(x, y);
    if (ghost) ghost.style.display = '';
    return target ? target.closest(zoneSelector) : null;
  };

  const onStart = (e) => {
    const chip = e.target.closest(chipSelector);
    if (!chip || chip.classList.contains('locked')) return;
    active = chip;
    moved = false;
    const rect = chip.getBoundingClientRect();
    ghost = chip.cloneNode(true);
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      pointerEvents: 'none',
      opacity: '0.9',
      zIndex: '999',
      transform: 'scale(1.04)',
    });
    document.body.append(ghost);
    chip.classList.add('dragging');
    active._offset = {
      x: e.touches[0].clientX - rect.left,
      y: e.touches[0].clientY - rect.top,
    };
  };

  const onMove = (e) => {
    if (!active || !ghost) return;
    moved = true;
    e.preventDefault();
    const t = e.touches[0];
    ghost.style.left = `${t.clientX - active._offset.x}px`;
    ghost.style.top = `${t.clientY - active._offset.y}px`;
    container.querySelectorAll(`${zoneSelector}.over`).forEach((z) => z.classList.remove('over'));
    const zone = findZone(t.clientX, t.clientY);
    if (zone) zone.classList.add('over');
  };

  const finish = (e) => {
    if (!active) return;
    const chip = active;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    if (ghost) { ghost.remove(); ghost = null; }
    chip.classList.remove('dragging');
    container.querySelectorAll(`${zoneSelector}.over`).forEach((z) => z.classList.remove('over'));
    if (moved && t) {
      const zone = findZone(t.clientX, t.clientY);
      if (zone) onDrop(chip, zone);
    }
    active = null;
  };

  container.addEventListener('touchstart', onStart, { passive: true });
  container.addEventListener('touchmove', onMove, { passive: false });
  container.addEventListener('touchend', finish);
  container.addEventListener('touchcancel', finish);
  TOUCH_HANDLERS.set(container, { start: onStart, move: onMove, finish });
}

/**
 * Click-to-place режимі: чипті таңдап, содан кейін слотты басу.
 *
 * Маңызды: бір контейнерге қайта-қайта listener қосылмауы керек.
 * Тапсырма бірнеше бетке бөлінгенде renderGroup() бірнеше рет
 * шақырылады, ал listener жиналып қалса, бір click бірнеше рет
 * өңделіп, ұпай қате есептелер еді. Сондықтан ескі listener алдымен
 * алынып тасталады.
 */
const CLICK_HANDLERS = new WeakMap();

export function enableClickPlace(container, chipSelector, zoneSelector, onDrop) {
  const previous = CLICK_HANDLERS.get(container);
  if (previous) container.removeEventListener('click', previous);

  let selected = null;
  const handler = (e) => {
    const chip = e.target.closest(chipSelector);
    const zone = e.target.closest(zoneSelector);

    if (chip && !chip.classList.contains('locked')) {
      if (selected === chip) {
        chip.classList.remove('selected');
        selected = null;
      } else {
        if (selected) selected.classList.remove('selected');
        selected = chip;
        chip.classList.add('selected');
      }
      return;
    }
    if (zone && selected) {
      const chosen = selected;
      selected.classList.remove('selected');
      selected = null;
      onDrop(chosen, zone);
    }
  };

  container.addEventListener('click', handler);
  CLICK_HANDLERS.set(container, handler);
}
