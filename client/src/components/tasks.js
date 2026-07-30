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

export function renderMatching(stage, ctx, options = {}) {
  const groups = [...new Set(stage.items.map((i) => i.group || 1))];
  let groupIndex = 0;
  let timerId = null;

  const renderGroup = () => {
    if (groupIndex >= groups.length || !ctx.isAlive()) {
      stopTimer();
      ctx.onDone();
      return;
    }
    const group = groups[groupIndex];
    const source = stage.items.filter((i) => (i.group || 1) === group);
    // Timeline-да сол жақ баған (даталар) хронологиялық ретте қалуы керек
    const items = options.keepOrder ? source : shuffle(source);
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

    clear(ctx.host).append(
      groups.length > 1
        ? el('div', { class: 'task-progress', style: { marginBottom: '12px', textAlign: 'center' },
            text: `${group}-бөлім (${groupIndex + 1}/${groups.length})` })
        : null,
      wrap,
    );
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

    const limit = options.timeLimitSeconds || ctx.timeLimitSeconds;
    if (limit) startTimer(limit, () => {
      ctx.feedback('⏱ Уақыт бітті! Келесі бөлімге өтеміз.', false);
      setTimeout(nextGroup, 900);
    });
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
    el('div', { class: 'match-col-title', style: { marginTop: '20px' }, text: 'Түсіндірмелер' }),
    bank,
  );
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
