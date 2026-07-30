/**
 * Ойын ағыны: бөлмелер, жүрек жүйесі, ұпай, аяқталу экраны.
 */
import api from './components/api.js';
import audio from './components/audio.js';
import { $, el, clear, showScreen, toast, formatTime, confetti } from './components/ui.js';
import { renderStage } from './components/tasks.js';

const HEARTS = 5;

export class Game {
  constructor(getScene) {
    this.getScene = getScene;
    this.reset();
  }

  reset() {
    this.attemptId = null;
    this.tasks = null;
    this.roomIndex = 0;
    this.hearts = HEARTS;
    this.totalScore = 0;
    this.roomStart = 0;
    this.gameStart = 0;
    this.roomStats = [];
    this.activeStage = null;
    this.characterId = 'batyr_1';
  }

  scene() {
    const s = this.getScene();
    return s && s.scene && s.scene.isActive() ? s : null;
  }

  /* ---------------------------- Ойынды бастау --------------------------- */

  async start(characterId) {
    this.reset();
    this.characterId = characterId;
    const data = await api.startAttempt(characterId);
    this.attemptId = data.attemptId;
    this.attemptNumber = data.attemptNumber;
    this.attemptsLeft = data.attemptsLeft;
    this.tasks = data.tasks;
    this.gameStart = Date.now();

    const scene = this.scene();
    if (scene) scene.setCharacter(characterId);

    showScreen(null);
    $('#hud').classList.add('active');
    audio.playMusic('battle');
    await this.enterRoom(0);
  }

  /* ------------------------------ Бөлмелер ------------------------------ */

  async enterRoom(index) {
    this.roomIndex = index;
    const room = this.tasks.rooms[index];
    if (!room) { await this.finish('finished'); return; }

    this.hearts = HEARTS;
    this.roomCorrect = 0;
    this.roomWrong = 0;
    this.stageIndex = 0;
    this.updateHud();

    $('#task-layer').classList.remove('active');

    const scene = this.scene();
    if (scene) {
      scene.resetCorridor();
      await scene.enterRoom(room.index, room.title);
    }

    this.roomStart = Date.now();
    this.showStage();
  }

  showStage() {
    const room = this.tasks.rooms[this.roomIndex];
    const stage = room.stages[this.stageIndex];
    if (!stage) { this.completeRoom(true); return; }

    const layer = $('#task-layer');
    layer.classList.add('active');
    $('#task-room-title').textContent = `${room.index}-БӨЛМЕ · ${room.title}`;
    this.setProgress(0, stage.total);
    this.setFeedback('');

    if (this.activeStage && this.activeStage.destroy) this.activeStage.destroy();

    const host = $('#task-content');
    clear(host);

    this.activeStage = renderStage(stage, {
      host,
      timeLimitSeconds: room.timeLimitSeconds,
      perQuestionSeconds: room.perQuestionSeconds,
      check: (stageId, itemId, value) => api.answer({
        attemptId: this.attemptId,
        roomIndex: room.index,
        stageId,
        itemId,
        value: String(value),
        timeMs: Date.now() - this.roomStart,
      }),
      onCorrect: () => this.onCorrect(),
      onWrong: () => this.onWrong(),
      onProgress: (done, total) => this.setProgress(done, total),
      onDone: () => this.nextStage(),
      isAlive: () => this.hearts > 0,
      feedback: (text, ok) => this.setFeedback(text, ok),
      setTimer: (left, total) => this.setTimer(left, total),
    });
  }

  nextStage() {
    if (this.hearts <= 0) return;
    this.stageIndex += 1;
    const room = this.tasks.rooms[this.roomIndex];
    if (this.stageIndex >= room.stages.length) this.completeRoom(true);
    else this.showStage();
  }

  /* --------------------------- Жауап реакциясы -------------------------- */

  onCorrect() {
    this.roomCorrect += 1;
    this.totalScore += 1;
    audio.play('sword');
    const scene = this.scene();
    if (scene) scene.attack();
    this.updateHud();
    this.pulseScore();
  }

  onWrong() {
    this.roomWrong += 1;
    this.hearts = Math.max(0, this.hearts - 1);
    audio.play('wrong');
    audio.play('heartLost');
    const scene = this.scene();
    if (scene) scene.hit();
    this.updateHud();
    $('#hearts').classList.add('heart-shake');
    setTimeout(() => $('#hearts').classList.remove('heart-shake'), 600);
    if (this.hearts <= 0) this.gameOver();
  }

  /* --------------------------- Бөлмені аяқтау --------------------------- */

  async completeRoom(cleared) {
    if (this.activeStage && this.activeStage.destroy) this.activeStage.destroy();
    this.setTimer(null);
    const room = this.tasks.rooms[this.roomIndex];
    const timeMs = Date.now() - this.roomStart;

    let result = null;
    try {
      result = await api.completeRoom({
        attemptId: this.attemptId,
        roomIndex: room.index,
        heartsLeft: this.hearts,
        timeMs,
        cleared: Boolean(cleared),
      });
      this.totalScore += result.bonus;
    } catch (err) {
      toast(err.message, 'error');
    }

    this.roomStats.push({
      index: room.index,
      title: room.title,
      score: result ? result.score : this.roomCorrect,
      correct: this.roomCorrect,
      wrong: this.roomWrong,
      bonus: result ? result.bonus : 0,
      timeMs,
      cleared: Boolean(cleared),
    });
    this.updateHud();

    if (!cleared) return;

    $('#task-layer').classList.remove('active');
    const scene = this.scene();
    if (scene) scene.victory();
    audio.play('victory');
    this.showRoomClear(result);
  }

  showRoomClear(result) {
    const room = this.tasks.rooms[this.roomIndex];
    const isLast = this.roomIndex + 1 >= this.tasks.rooms.length;
    const body = $('#overlay-body');
    clear(body).append(
      el('div', { class: 'overlay-big', style: { color: 'var(--gold)' }, text: 'БӨЛМЕ АЛЫНДЫ!' }),
      el('div', { class: 'panel', style: { marginTop: '26px' } }, [
        el('div', { class: 'panel-title', text: `${room.index}-бөлме: ${room.title}` }),
        el('div', { class: 'stat-grid' }, [
          statBox(result ? result.score : this.roomCorrect, 'Ұпай'),
          statBox(this.roomCorrect, 'Дұрыс'),
          statBox(this.roomWrong, 'Қате'),
          statBox(result ? `+${result.bonus}` : '+0', 'Бонус'),
          statBox('❤'.repeat(this.hearts) || '—', 'Қалған жан'),
        ]),
        el('div', { class: 'form-actions' }, [
          el('button', {
            class: 'btn btn-primary btn-xl',
            text: isLast ? 'ОЙЫНДЫ АЯҚТАУ' : 'КЕЛЕСІ БӨЛМЕГЕ →',
            onclick: () => {
              audio.play('click');
              showScreen(null);
              if (isLast) this.finish('finished');
              else this.enterRoom(this.roomIndex + 1);
            },
          }),
        ]),
      ]),
    );
    showScreen('screen-overlay');
    confetti($('#screen-overlay'), 40);
  }

  /* ------------------------------ Game Over ----------------------------- */

  async gameOver() {
    if (this.activeStage && this.activeStage.destroy) this.activeStage.destroy();
    this.setTimer(null);
    $('#task-layer').classList.remove('active');
    audio.stopMusic();
    audio.play('gameover');
    const scene = this.scene();
    if (scene) scene.death();

    await this.completeRoom(false);

    const body = $('#overlay-body');
    clear(body).append(
      el('div', { class: 'overlay-big gameover', text: 'GAME OVER' }),
      el('div', { class: 'panel', style: { marginTop: '26px' } }, [
        el('div', { class: 'panel-sub', text: 'Барлық жүрек таусылды. Ойын бірінші бөлмеден қайта басталады.' }),
        el('div', { class: 'stat-grid' }, [
          statBox(this.totalScore, 'Жиналған ұпай'),
          statBox(this.roomIndex + 1, 'Жеткен бөлме'),
        ]),
        el('div', { class: 'form-actions' }, [
          el('button', {
            class: 'btn btn-primary btn-xl',
            text: '↻ ҚАЙТА БАСТАУ',
            onclick: () => { audio.play('click'); this.restart(); },
          }),
        ]),
      ]),
    );
    showScreen('screen-overlay');
  }

  async restart() {
    // Ағымдағы әрекетті сәтсіз деп жабамыз, содан кейін жаңа әрекет
    try {
      await api.finishAttempt({ attemptId: this.attemptId, status: 'failed' });
    } catch (_) { /* әлдеқашан жабылған */ }

    try {
      const me = await api.me();
      if (me.attemptsLeft <= 0) {
        this.showLimitReached();
        return;
      }
      await this.start(this.characterId);
    } catch (err) {
      if (err.code === 'ATTEMPT_LIMIT') this.showLimitReached();
      else toast(err.message, 'error');
    }
  }

  showLimitReached() {
    const body = $('#overlay-body');
    clear(body).append(
      el('div', { class: 'panel' }, [
        el('div', { class: 'overlay-big gameover', style: { fontSize: '2.2rem' }, text: '⛔' }),
        el('div', { class: 'panel-title', style: { marginTop: '14px' },
          text: 'Сіз бұл ойынды орындау лимитін аяқтадыңыз.' }),
        el('div', { class: 'panel-sub', text: 'Әр студентке тек 3 әрекет беріледі.' }),
        el('div', { class: 'form-actions' }, [
          el('button', {
            class: 'btn btn-ghost',
            text: 'Басты бетке',
            onclick: () => { window.location.reload(); },
          }),
        ]),
      ]),
    );
    showScreen('screen-overlay');
    $('#hud').classList.remove('active');
  }

  /* ------------------------------- Аяқталу ------------------------------ */

  async finish(status) {
    let result = null;
    try {
      result = await api.finishAttempt({ attemptId: this.attemptId, status });
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
    audio.stopMusic();
    audio.play('victory');
    $('#hud').classList.remove('active');
    $('#task-layer').classList.remove('active');
    const scene = this.scene();
    if (scene) scene.victory();

    const titleText = Math.random() > 0.5
      ? 'Ай, маладес, Ақылбек Беделханұлына ұпайыңды көрсет!'
      : 'СІЗ ОЙЫНДЫ АЯҚТАДЫҢЫЗ! АҚЫЛБЕК БЕДЕЛХАНҰЛЫНА ҰПАЙДЫ КӨРСЕТ!';

    const rows = (result.rooms || []).map((r) => el('tr', {}, [
      el('td', { text: `${r.index}` }),
      el('td', { text: r.title || '—' }),
      el('td', { text: String(r.score) }),
      el('td', { class: 'ok', text: String(r.correct) }),
      el('td', { class: 'bad', text: String(r.wrong) }),
      el('td', { text: `+${r.bonus}` }),
      el('td', { text: formatTime(r.timeMs) }),
    ]));

    const body = $('#overlay-body');
    clear(body).append(
      el('div', { class: 'result-title', text: titleText }),
      el('div', { class: 'panel wide', style: { marginTop: '26px' } }, [
        el('div', { class: 'stat-grid' }, [
          statBox(result.totalScore, 'Жалпы ұпай'),
          statBox(result.correct, 'Дұрыс жауап'),
          statBox(result.wrong, 'Қате жауап'),
          statBox(`${result.accuracy.toFixed(1)}%`, 'Дәлдік'),
          statBox(formatTime(result.totalTimeMs), 'Жалпы уақыт'),
          statBox(result.bestScore, 'Best Score'),
          statBox(`${result.roomsCleared}/${result.roomCount}`, 'Бөлмелер'),
          statBox(`${result.attemptNumber}/3`, 'Әрекет'),
        ]),
        el('h3', { style: { marginTop: '28px', color: 'var(--gold)', fontSize: '1.05rem' },
          text: 'Әр бөлме бойынша нәтиже' }),
        el('div', { style: { overflowX: 'auto' } }, [
          el('table', { class: 'room-table' }, [
            el('thead', {}, el('tr', {}, [
              el('th', { text: '№' }), el('th', { text: 'Бөлме' }), el('th', { text: 'Ұпай' }),
              el('th', { text: 'Дұрыс' }), el('th', { text: 'Қате' }),
              el('th', { text: 'Бонус' }), el('th', { text: 'Уақыт' }),
            ])),
            el('tbody', {}, rows),
          ]),
        ]),
        el('div', { class: 'form-actions' }, [
          result.attemptsLeft > 0
            ? el('button', {
                class: 'btn btn-primary',
                text: `↻ ТАҒЫ ОЙНАУ (${result.attemptsLeft} әрекет қалды)`,
                onclick: () => { audio.play('click'); this.start(this.characterId); },
              })
            : el('div', { class: 'alert info show',
                text: 'Сіз бұл ойынды орындау лимитін аяқтадыңыз.' }),
          el('button', {
            class: 'btn btn-ghost',
            text: 'Басты бет',
            onclick: () => window.location.reload(),
          }),
        ]),
      ]),
    );
    showScreen('screen-overlay');
    confetti($('#screen-overlay'), 110);
  }

  /* --------------------------------- HUD -------------------------------- */

  updateHud() {
    const room = this.tasks && this.tasks.rooms[this.roomIndex];
    $('#hud-room').textContent = room
      ? `${room.index}/${this.tasks.rooms.length}`
      : '—';
    $('#hud-score').textContent = String(this.totalScore);
    const hearts = $('#hearts');
    clear(hearts);
    for (let i = 0; i < HEARTS; i++) {
      hearts.append(el('span', {
        class: `heart${i < this.hearts ? '' : ' lost'}`,
        text: i < this.hearts ? '❤️' : '🤍',
      }));
    }
  }

  pulseScore() {
    const node = $('#hud-score');
    node.style.transition = 'transform .18s';
    node.style.transform = 'scale(1.42)';
    setTimeout(() => { node.style.transform = 'scale(1)'; }, 180);
  }

  setProgress(done, total) {
    $('#task-progress').textContent = `Орындалды: ${done} / ${total}`;
  }

  setFeedback(text, ok) {
    const node = $('#task-feedback');
    node.textContent = text || '';
    node.className = `feedback ${text ? (ok ? 'ok' : 'bad') : ''}`;
  }

  setTimer(left, total) {
    const wrap = $('#timer-wrap');
    const bar = $('#timer-fill');
    const label = $('#timer-label');
    if (left == null) {
      wrap.style.visibility = 'hidden';
      return;
    }
    wrap.style.visibility = 'visible';
    const ratio = total ? Math.max(0, left / total) : 0;
    bar.style.transform = `scaleX(${ratio})`;
    label.textContent = `${Math.ceil(left)}с`;
    const box = $('#timer-bar');
    box.classList.toggle('warn', ratio <= 0.5 && ratio > 0.22);
    box.classList.toggle('danger', ratio <= 0.22);
  }
}

function statBox(value, key) {
  return el('div', { class: 'stat-box' }, [
    el('div', { class: 'v', text: String(value) }),
    el('div', { class: 'k', text: key }),
  ]);
}

export default Game;
