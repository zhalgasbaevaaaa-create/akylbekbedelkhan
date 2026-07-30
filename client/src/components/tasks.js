/**
 * Тапсырма рендерерлері.
 * Әр рендерер бір «кезеңді» (stage) көрсетеді және аяқталғанда onDone шақырады.
 *
 * Барлық жауап сервер жағында тексеріледі (api.answer).
 * Дұрыс жауап   -> қылыш соққысы + ұпай
 * Қате жауап    -> 1 жүрек кетеді
 */
import { el, clear, shuffle } from './ui.js';
import { makeDraggable, makeDropZone, enableTouchDrag, enableClickPlace } from './dragdrop.js';

/**
 * Элемент санына қарай тығыздық режимін таңдау.
 *
 * Беттерге бөлумен бірге жұмыс істейді: бір бетте ең көбі getMaxPerPage()
 * элемент болады, ал шрифт пен биіктік сол санға қарай реттеледі.
 * Элемент аз болса — ірі әрі оқуға ыңғайлы күйінде қалады.
 */
function applyDensity(host, count) {
  host.classList.remove('dense', 'ultra-dense');
  if (count >= 9) host.classList.add('ultra-dense');
  else if (count >= 6) host.classList.add('dense');
}

/**
 * @typedef {Object} TaskContext
 * @property {HTMLElement} host       тапсырма контейнері
 * @property {Function} check         async (stageId, itemId, value) => {correct}
 * @property {Function} onCorrect     дұрыс жауап
 * @property {Function} onWrong       қате жауап
 * @property {Function} onProgress    (done, total)
 * @property {Function} onDone        кезең аяқталды
 * @property {Function} isAlive       жүрек қалды ма
 * @property {Function} feedback      (text, ok)
 */

/* ======================= 1. Multiple Choice тест ======================== */

export function renderQuiz(stage, ctx) {
  const items = shuffle(stage.items);
  let index = 0;
  let timerId = null;
  const perQ = ctx.perQuestionSeconds || 15;

  const showQuestion = () => {
    if (index >= items.length || !ctx.isAlive()) {
      stopTimer();
      ctx.onDone();
      return;
    }
    const item = items[index];
    ctx.onProgress(index, items.length);

    const options = shuffle(item.options);
    const optionNodes = options.map((opt) => el('button', {
      class: 'quiz-option',
      type: 'button',
      onclick: () => pick(opt, item, optionNodes),
    }, [
      el('span', { class: 'key', text: opt.id }),
      el('span', { text: opt.text }),
    ]));

    clear(ctx.host).append(
      el('div', { class: 'quiz-question', text: `${index + 1}. ${item.question}` }),
      el('div', { class: 'quiz-options' }, optionNodes),
    );
    applyDensity(ctx.host, 0); // тест бір сұрақтан тұрады — тығыздау қажет емес
    ctx.host.scrollTop = 0;

    startTimer(() => {
      // Уақыт бітті — қате есептеледі, келесі сұраққа автоматты өту
      optionNodes.forEach((n) => { n.disabled = true; });
      ctx.feedback('⏱ Уақыт бітті!', false);
      ctx.check(stage.id, item.id, '__timeout__').catch(() => {});
      ctx.onWrong();
      next(900);
    });
  };

  const pick = async (opt, item, nodes) => {
    stopTimer();
    nodes.forEach((n) => { n.disabled = true; });
    const chosen = nodes.find((n) => n.textContent.includes(opt.text));
    let result = { correct: false };
    try {
      result = await ctx.check(stage.id, item.id, opt.id);
    } catch (err) {
      ctx.feedback('Байланыс қатесі. Қайталап көріңіз.', false);
    }
    if (result.correct) {
      if (chosen) chosen.classList.add('correct');
      ctx.feedback('✔ Дұрыс! +1 ұпай', true);
      ctx.onCorrect();
    } else {
      if (chosen) chosen.classList.add('wrong');
      const right = nodes.find((n) => n.querySelector('.key').textContent === result.expected);
      if (right) right.classList.add('correct');
      ctx.feedback('✖ Қате жауап', false);
      ctx.onWrong();
    }
    next(result.correct ? 700 : 1200);
  };

  const next = (delay) => {
    setTimeout(() => {
      index += 1;
      showQuestion();
    }, delay);
  };

  const startTimer = (onExpire) => {
    stopTimer();
    let left = perQ;
    ctx.setTimer(left, perQ);
    timerId = setInterval(() => {
      left -= 0.1;
      ctx.setTimer(Math.max(0, left), perQ);
      if (left <= 0) {
        stopTimer();
        onExpire();
      }
    }, 100);
  };

  const stopTimer = () => {
    if (timerId) clearInterval(timerId);
    timerId = null;
    ctx.setTimer(null);
  };

  showQuestion();
  return { destroy: stopTimer };
}

/* =================== 2. Matching / Pair (Drag & Drop) =================== */

/* ------------------- Бір беттегі элемент саны -------------------------- */

/** Қолмен реттеуге арналған шектер */
const PAGE_LIMITS = { min: 3, max: 10, fallback: 7 };

/**
 * Бір элементке бөлінетін биіктік (px).
 * Слоттың нақты биіктігінен (32–46px) әдейі үлкен алынған: жолдар
 * бір-біріне жабыспай, көзге еркін көрінуі үшін.
 */
const ROW_HEIGHT = 72;

/**
 * Бір бетте көрсетілетін максимум элемент саны.
 *
 * Басымдық реті:
 *   1) Мұғалім қойған мән (localStorage: kzrpg_page_size)
 *   2) Экран өлшеміне қарай автоматты есептеу
 *
 * Тар экранда (мобильді) сұрақ пен жауап тік орналасады, сондықтан
 * бір элемент екі есе орын алады — ол да ескеріледі.
 */
export function getMaxPerPage() {
  const saved = Number(localStorage.getItem('kzrpg_page_size'));
  if (Number.isFinite(saved) && saved >= PAGE_LIMITS.min && saved <= PAGE_LIMITS.max) {
    return Math.floor(saved);
  }

  const h = (typeof window !== 'undefined' && window.innerHeight) || 0;
  const w = (typeof window !== 'undefined' && window.innerWidth) || 0;
  if (!h) return PAGE_LIMITS.fallback;

  // Тапсырма терезесінен тыс кететін биіктік: HUD + тақырып + feedback + шеттер
  const chrome = h <= 560 ? 150 : h <= 700 ? 180 : 210;
  // 780px-тен тар экранда бағандар тік жинақталады (CSS media query)
  const row = w && w < 780 ? ROW_HEIGHT * 2 : ROW_HEIGHT;
  const fits = Math.floor((h - chrome) / row);

  return Math.max(PAGE_LIMITS.min, Math.min(PAGE_LIMITS.max, fits));
}

/**
 * Бір беттегі элемент санын қолмен орнату (админ/мұғалім үшін).
 * Браузер консолінде: kzrpgSetPageSize(6)
 * Қалпына келтіру:    kzrpgSetPageSize(null)
 */
export function setMaxPerPage(value) {
  if (value == null) {
    localStorage.removeItem('kzrpg_page_size');
    return getMaxPerPage();
  }
  const n = Math.max(PAGE_LIMITS.min, Math.min(PAGE_LIMITS.max, Math.floor(Number(value) || 0)));
  localStorage.setItem('kzrpg_page_size', String(n));
  return n;
}

/**
 * Элементтерді топ (group) және бет бойынша бөлу.
 * PDF-те 25 элементті бөлім болуы мүмкін — оны бірнеше бетке бөлеміз,
 * әйтпесе экранға сыймайды және ойнау ыңғайсыз болады.
 */
function paginate(stage, keepOrder) {
  const maxPerPage = getMaxPerPage();
  const groupIds = [...new Set(stage.items.map((i) => i.group || 1))];
  const pages = [];
  groupIds.forEach((gid) => {
    const source = stage.items.filter((i) => (i.group || 1) === gid);
    const ordered = keepOrder ? source : shuffle(source);
    const pageCount = Math.ceil(ordered.length / maxPerPage);
    // Беттерді біркелкі бөлу (мыс. 25 -> 13+12, 9+8+8 емес)
    const perPage = Math.ceil(ordered.length / pageCount);
    for (let i = 0; i < ordered.length; i += perPage) {
      pages.push({
        group: gid,
        groupCount: groupIds.length,
        page: Math.floor(i / perPage) + 1,
        pageCount,
        items: ordered.slice(i, i + perPage),
      });
    }
  });
  return pages;
}

export function renderMatching(stage, ctx, options = {}) {
  const pages = paginate(stage, options.keepOrder);
  let groupIndex = 0;
  let timerId = null;

  const renderGroup = () => {
    if (groupIndex >= pages.length || !ctx.isAlive()) {
      stopTimer();
      ctx.onDone();
      return;
    }
    const current = pages[groupIndex];
    const items = current.items;
    let solved = 0;

    const leftLabel = options.leftLabel || 'Сұрақ';
    const rightLabel = options.rightLabel || 'Жауап нұсқалары';

    const slots = items.map((item) => {
      const drop = el('div', { class: 'drop', text: 'Осында тастаңыз' });
      const slot = el('div', {
        class: 'match-slot',
        dataset: { itemId: item.id },
      }, [
        options.dateBadge
          ? el('div', { class: 'date-badge', text: item.date })
          : el('div', { class: 'prompt', text: `${item.number}. ${item.left}` }),
        drop,
      ]);
      slot._drop = drop;
      return slot;
    });

    const chips = shuffle(items).map((item) => el('div', {
      class: 'chip',
      dataset: { value: options.rightKey ? item[options.rightKey] : item.right, itemId: item.id },
      text: options.rightKey ? item[options.rightKey] : item.right,
    }));

    const bank = el('div', { class: 'match-list', id: 'chip-bank' }, chips);
    const slotList = el('div', { class: 'match-list' }, slots);

    const wrap = el('div', { class: options.dateBadge ? 'timeline-wrap' : 'match-wrap' }, [
      el('div', {}, [el('div', { class: 'match-col-title', text: leftLabel }), slotList]),
      el('div', {}, [el('div', { class: 'match-col-title', text: rightLabel }), bank]),
    ]);

    const label = [];
    if (current.groupCount > 1) label.push(`${current.group}-бөлім`);
    if (current.pageCount > 1) label.push(`${current.page}/${current.pageCount} бет`);

    clear(ctx.host).append(
      pages.length > 1
        ? el('div', {
            class: 'task-progress',
            style: { marginBottom: '8px', textAlign: 'center' },
            text: `${label.join(' · ')}  (${groupIndex + 1}/${pages.length})`,
          })
        : null,
      wrap,
    );
    applyDensity(ctx.host, items.length);
    ctx.host.scrollTop = 0;
    ctx.onProgress(0, items.length);

    const place = async (chip, slot) => {
      if (chip.classList.contains('locked') || slot.classList.contains('correct')) return;
      // Слот бос болмаса — ескі чипті банкке қайтару
      const prev = slot.querySelector('.chip');
      if (prev) {
        prev.classList.remove('placed');
        bank.append(prev);
      }
      slot._drop.textContent = '';
      slot._drop.append(chip);
      chip.classList.add('placed');

      let result = { correct: false };
      try {
        result = await ctx.check(stage.id, slot.dataset.itemId, chip.dataset.value);
      } catch (err) {
        ctx.feedback('Байланыс қатесі.', false);
        return;
      }
      if (result.correct) {
        slot.classList.add('correct');
        chip.classList.add('locked');
        chip.setAttribute('draggable', 'false');
        ctx.feedback('✔ Дұрыс! +1 ұпай', true);
        ctx.onCorrect();
        solved += 1;
        ctx.onProgress(solved, items.length);
        if (solved >= items.length) {
          stopTimer();
          setTimeout(nextGroup, 800);
        }
      } else {
        slot.classList.add('wrong');
        ctx.feedback('✖ Қате сәйкестік', false);
        ctx.onWrong();
        setTimeout(() => {
          slot.classList.remove('wrong');
          if (chip.parentElement === slot._drop) {
            chip.classList.remove('placed');
            bank.append(chip);
            slot._drop.textContent = 'Осында тастаңыз';
          }
        }, 700);
      }
    };

    chips.forEach(makeDraggable);
    slots.forEach((slot) => makeDropZone(slot, place));
    // Банкке қайтару
    makeDropZone(bank, (chip) => {
      if (chip.classList.contains('locked')) return;
      chip.classList.remove('placed');
      bank.append(chip);
    });
    enableTouchDrag(ctx.host, '.chip', '.match-slot, #chip-bank', place);
    enableClickPlace(ctx.host, '.chip', '.match-slot', place);

    // PDF-тегі уақыт лимиті бүкіл бөлімге берілген. Бөлім бірнеше бетке
    // бөлінсе, уақытты беттер санына пропорционал бөлеміз.
    const baseLimit = options.timeLimitSeconds || ctx.timeLimitSeconds;
    const limit = baseLimit
      ? Math.max(20, Math.round(baseLimit / (current.pageCount || 1)))
      : null;
    if (limit) {
      startTimer(limit, () => {
        const last = groupIndex + 1 >= pages.length;
        ctx.feedback(last ? '⏱ Уақыт бітті!' : '⏱ Уақыт бітті! Келесі бөлімге өтеміз.', false);
        setTimeout(nextGroup, 900);
      });
    }
  };

  const nextGroup = () => {
    groupIndex += 1;
    renderGroup();
  };

  const startTimer = (seconds, onExpire) => {
    stopTimer();
    let left = seconds;
    ctx.setTimer(left, seconds);
    timerId = setInterval(() => {
      left -= 0.1;
      ctx.setTimer(Math.max(0, left), seconds);
      if (left <= 0) {
        stopTimer();
        onExpire();
      }
    }, 100);
  };

  const stopTimer = () => {
    if (timerId) clearInterval(timerId);
    timerId = null;
    ctx.setTimer(null);
  };

  renderGroup();
  return { destroy: stopTimer };
}

/* ========================= 3. Timeline sorting ========================== */

export function renderTimeline(stage, ctx) {
  // Даталар хронологиялық ретпен, оқиғалар араласқан күйде
  const sorted = [...stage.items].sort((a, b) => a.number - b.number);
  return renderMatching(
    { ...stage, items: sorted.map((i) => ({ ...i, group: 1 })) },
    ctx,
    {
      dateBadge: true,
      keepOrder: true,
      rightKey: 'event',
      leftLabel: 'Хронологиялық рет',
      rightLabel: 'Оқиғалар',
    },
  );
}

/* ============================ 4. Cards ================================== */

export function renderCards(stage, ctx) {
  const items = shuffle(stage.items);
  let solved = 0;
  let timerId = null;

  const cards = items.map((item) => {
    const drop = el('div', { class: 'drop', text: 'Түсіндірмені осында тастаңыз' });
    const card = el('div', {
      class: 'fact-card',
      dataset: { itemId: item.id },
    }, [
      el('span', { class: 'num', text: `${item.number}-карточка` }),
      el('div', { class: 'text', text: item.fact }),
      drop,
    ]);
    card._drop = drop;
    return card;
  });

  const chips = shuffle(items).map((item) => el('div', {
    class: 'chip',
    dataset: { value: item.explanation, itemId: item.id },
    text: item.explanation,
  }));

  const bank = el('div', { class: 'match-list', id: 'chip-bank' }, chips);

  clear(ctx.host).append(
    el('div', { class: 'match-col-title', text: 'Фактілер' }),
    el('div', { class: 'cards-wrap' }, cards),
    el('div', { class: 'match-col-title', style: { marginTop: '12px' }, text: 'Түсіндірмелер' }),
    bank,
  );
  applyDensity(ctx.host, items.length);
  ctx.onProgress(0, items.length);

  const place = async (chip, card) => {
    if (chip.classList.contains('locked') || card.classList.contains('correct')) return;
    const prev = card.querySelector('.chip');
    if (prev) { prev.classList.remove('placed'); bank.append(prev); }
    card._drop.textContent = '';
    card._drop.append(chip);
    chip.classList.add('placed');

    let result = { correct: false };
    try {
      result = await ctx.check(stage.id, card.dataset.itemId, chip.dataset.value);
    } catch (err) {
      ctx.feedback('Байланыс қатесі.', false);
      return;
    }
    if (result.correct) {
      card.classList.add('correct');
      chip.classList.add('locked');
      ctx.feedback('✔ Дұрыс! +1 ұпай', true);
      ctx.onCorrect();
      solved += 1;
      ctx.onProgress(solved, items.length);
      if (solved >= items.length) { stopTimer(); setTimeout(() => ctx.onDone(), 800); }
    } else {
      card.classList.add('wrong');
      ctx.feedback('✖ Қате сәйкестік', false);
      ctx.onWrong();
      setTimeout(() => {
        card.classList.remove('wrong');
        if (chip.parentElement === card._drop) {
          chip.classList.remove('placed');
          bank.append(chip);
          card._drop.textContent = 'Түсіндірмені осында тастаңыз';
        }
      }, 700);
    }
  };

  chips.forEach(makeDraggable);
  cards.forEach((card) => makeDropZone(card, place));
  makeDropZone(bank, (chip) => {
    if (chip.classList.contains('locked')) return;
    chip.classList.remove('placed');
    bank.append(chip);
  });
  enableTouchDrag(ctx.host, '.chip', '.fact-card, #chip-bank', place);
  enableClickPlace(ctx.host, '.chip', '.fact-card', place);

  const startTimer = (seconds) => {
    let left = seconds;
    ctx.setTimer(left, seconds);
    timerId = setInterval(() => {
      left -= 0.1;
      ctx.setTimer(Math.max(0, left), seconds);
      if (left <= 0) {
        stopTimer();
        ctx.feedback('⏱ Уақыт бітті!', false);
        setTimeout(() => ctx.onDone(), 800);
      }
    }, 100);
  };
  const stopTimer = () => {
    if (timerId) clearInterval(timerId);
    timerId = null;
    ctx.setTimer(null);
  };
  if (ctx.timeLimitSeconds) startTimer(ctx.timeLimitSeconds);

  return { destroy: stopTimer };
}

/* ============================ Dispatcher ================================ */

export function renderStage(stage, ctx) {
  switch (stage.type) {
    case 'quiz': return renderQuiz(stage, ctx);
    case 'timeline': return renderTimeline(stage, ctx);
    case 'cards': return renderCards(stage, ctx);
    case 'matching':
    default: return renderMatching(stage, ctx);
  }
}
