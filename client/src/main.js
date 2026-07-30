/**
 * Қосымшаның кіру нүктесі: Phaser қозғалтқышы + DOM экрандары.
 */
import api, { setToken } from './components/api.js';
import audio from './components/audio.js';
import { $, el, clear, showScreen, toast, setAlert } from './components/ui.js';
import { getMaxPerPage, setMaxPerPage } from './components/tasks.js';
import { BootScene, CHARACTERS } from './scenes/BootScene.js';
import { CastleScene } from './scenes/CastleScene.js';
import { Game } from './game.js';

let phaserGame = null;
let castleScene = null;
let game = null;
let selectedCharacter = CHARACTERS[0].id;

/* ------------------------------ Phaser ------------------------------ */

function bootPhaser() {
  phaserGame = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-root',
    backgroundColor: '#080b14',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 1280,
      height: 720,
    },
    render: { antialias: true, pixelArt: false },
    scene: [BootScene, CastleScene],
  });

  window.addEventListener('kzrpg:castleready', () => {
    castleScene = phaserGame.scene.getScene('Castle');
  });
  window.addEventListener('kzrpg:door', () => audio.play('door'));
  window.addEventListener('kzrpg:loadprogress', (e) => {
    const pct = Math.round(e.detail * 100);
    const node = $('#loading-text');
    if (node) node.textContent = `Жүктелуде… ${pct}%`;
  });
  window.addEventListener('kzrpg:ready', () => {
    setTimeout(() => {
      const loader = $('#loading');
      loader.classList.add('hide');
      setTimeout(() => loader.remove(), 600);
      showScreen('screen-menu');
      audio.playMusic('theme');
    }, 350);
  });
}

/* ------------------------------ Экрандар ---------------------------- */

function renderCharacters() {
  const grid = $('#char-grid');
  clear(grid);
  CHARACTERS.forEach((c, i) => {
    const card = el('button', {
      class: `char-card${i === 0 ? ' selected' : ''}`,
      type: 'button',
      dataset: { id: c.id },
      onclick: () => {
        audio.play('click');
        [...grid.children].forEach((n) => n.classList.remove('selected'));
        card.classList.add('selected');
        selectedCharacter = c.id;
        if (castleScene) castleScene.setCharacter(c.id);
      },
    }, [
      el('img', { src: `assets/characters/${c.file}`, alt: c.name, loading: 'lazy' }),
      el('div', { class: 'name', text: c.name }),
      el('div', { class: 'role', text: c.role }),
    ]);
    grid.append(card);
  });
}

async function handleRegister(event) {
  event.preventDefault();
  const alertNode = $('#register-alert');
  setAlert(alertNode, '');
  const btn = $('#btn-register');
  btn.disabled = true;
  btn.textContent = 'Тексерілуде…';

  const payload = {
    firstName: $('#f-first').value.trim(),
    lastName: $('#f-last').value.trim(),
    group: $('#f-group').value.trim(),
    institution: $('#f-institution').value.trim(),
  };

  try {
    const data = await api.register(payload);
    setToken(data.token);
    $('#char-hint').textContent =
      `${data.student.firstName} ${data.student.lastName} · ${data.attemptsLeft} әрекет қалды`;
    audio.play('click');
    showScreen('screen-character');
  } catch (err) {
    if (err.code === 'ATTEMPT_LIMIT') {
      setAlert(alertNode, 'Сіз бұл ойынды орындау лимитін аяқтадыңыз.', 'error');
    } else if (err.data && err.data.details) {
      setAlert(alertNode, err.data.details.map((d) => d.message).join(' '), 'error');
    } else {
      setAlert(alertNode, err.message, 'error');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'ЖАЛҒАСТЫРУ →';
  }
}

async function startGame() {
  const btn = $('#btn-start-game');
  btn.disabled = true;
  btn.textContent = 'Қамал ашылуда…';
  try {
    await game.start(selectedCharacter);
  } catch (err) {
    if (err.code === 'ATTEMPT_LIMIT') game.showLimitReached();
    else if (err.code === 'NO_PDF') toast('Тапсырма PDF файлы жүктелмеген. Әкімшіге хабарласыңыз.', 'error', 6000);
    else toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⚔ ҚАМАЛҒА КІРУ';
  }
}

/* -------------------------------- Init ------------------------------ */

function init() {
  bootPhaser();
  game = new Game(() => castleScene);
  renderCharacters();

  $('#btn-play').addEventListener('click', () => {
    audio.play('click');
    showScreen('screen-register');
  });
  $('#register-form').addEventListener('submit', handleRegister);
  $('#btn-back-menu').addEventListener('click', () => {
    audio.play('click');
    showScreen('screen-menu');
  });
  $('#btn-back-register').addEventListener('click', () => {
    audio.play('click');
    showScreen('screen-register');
  });
  $('#btn-start-game').addEventListener('click', startGame);

  $('#btn-sound').addEventListener('click', (e) => {
    const on = audio.toggle();
    e.currentTarget.textContent = on ? '🔊' : '🔇';
    if (on) audio.playMusic(game.attemptId ? 'battle' : 'theme');
  });

  $('#btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  });

  // Жасырын админ батырмасы
  $('#btn-admin-secret').addEventListener('click', () => { window.location.href = '/admin'; });
  // Балама: Ctrl+Shift+A
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') window.location.href = '/admin';
  });

  // Ойын кезінде бетті жабуға ескерту
  window.addEventListener('beforeunload', (e) => {
    if (game.attemptId && $('#hud').classList.contains('active')) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Тапсырмалардың бар-жоғын тексеру
  /*
   * Мұғалімге арналған реттеу: бір бетте қанша тапсырма көрсетілетінін
   * браузер консолінен өзгертуге болады.
   *   kzrpgSetPageSize(6)     — бір бетте 6 элемент
   *   kzrpgSetPageSize(null)  — экранға қарай автоматты (әдепкі)
   *   kzrpgPageSize()         — қазіргі мәнді көру
   */
  window.kzrpgSetPageSize = (n) => {
    const applied = setMaxPerPage(n);
    toast(`Бір беттегі тапсырма саны: ${applied}${n == null ? ' (автоматты)' : ''}`, 'success');
    return applied;
  };
  window.kzrpgPageSize = () => getMaxPerPage();

  api.tasks().then((t) => {
    $('#menu-info').textContent = `${t.roomCount} бөлме · ${t.totalQuestions} тапсырма дайын`;
  }).catch(() => {
    $('#menu-info').textContent = 'Тапсырмалар жүктелмеген. Әкімші PDF жүктеуі керек.';
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
