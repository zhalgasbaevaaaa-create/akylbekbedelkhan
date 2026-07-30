/**
 * Қамал сахнасы.
 * Кейіпкер коридормен жүгіріп келеді, есік анимациямен ашылады,
 * бөлмеге кіреді — сол кезде тапсырма қабаты (DOM) ашылады.
 */
import { CharacterAnimator } from '../animations/characterAnimator.js';

const W = 1280;
const H = 720;

export class CastleScene extends Phaser.Scene {
  constructor() {
    super('Castle');
    this.animator = null;
    this.characterId = 'batyr_1';
  }

  create() {
    this.cameras.main.setBackgroundColor('#080b14');

    // Фон қабаттары (параллакс)
    this.bgFar = this.add.image(W / 2, H / 2, 'corridor')
      .setDisplaySize(W * 1.25, H * 1.25).setAlpha(0.55).setTint(0x5a6a90);
    this.bgNear = this.add.image(W / 2, H / 2, 'corridor')
      .setDisplaySize(W, H);

    // Қараңғылатқыш винетка
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.55);
    g.fillRect(0, 0, W, 120);
    g.fillRect(0, H - 90, W, 90);

    // Алау жарығы
    this.torches = [];
    [190, 520, 860, 1150].forEach((x) => {
      const flame = this.add.ellipse(x, 220, 70, 130, 0xffa32e, 0.16);
      this.tweens.add({
        targets: flame,
        alpha: { from: 0.1, to: 0.26 },
        scaleY: { from: 0.9, to: 1.14 },
        duration: 380 + Math.random() * 320,
        yoyo: true,
        repeat: -1,
      });
      this.torches.push(flame);
    });

    // Есік (екі жарты)
    this.doorGroup = this.add.container(W / 2, H * 0.52);
    this.doorL = this.add.image(-104, 0, 'doorLeft').setOrigin(0.5).setScale(0.86);
    this.doorR = this.add.image(104, 0, 'doorRight').setOrigin(0.5).setScale(0.86);
    this.doorGlow = this.add.ellipse(0, 20, 300, 400, 0xffd54a, 0);
    this.doorGroup.add([this.doorGlow, this.doorL, this.doorR]);
    this.doorGroup.setVisible(false);

    // Бөлме нөмірінің жазуы
    this.roomLabel = this.add.text(W / 2, 96, '', {
      fontFamily: 'Cinzel, Georgia, serif',
      fontSize: '40px',
      color: '#e8b923',
      align: 'center',
    }).setOrigin(0.5).setAlpha(0);

    this.buildCharacter(this.characterId);
    this.scale.on('resize', () => this.cameras.main.setZoom(1));

    window.dispatchEvent(new CustomEvent('kzrpg:castleready'));
  }

  /* ------------------------- Кейіпкерді құру ------------------------- */

  buildCharacter(id) {
    if (this.charContainer) this.charContainer.destroy();
    if (this.animator) this.animator.destroy();
    this.characterId = id;

    const groundY = H * 0.9;
    const container = this.add.container(-240, groundY);

    const shadow = this.add.ellipse(0, 6, 150, 34, 0x000000, 0.42);
    const glow = this.add.ellipse(0, -150, 300, 340, 0xffd54a, 0);
    const body = this.add.image(0, 0, id).setOrigin(0.5, 1);
    const targetH = 320;
    body.setScale(targetH / body.height);

    // Қылыш соққысының ізі
    const sword = this.add.graphics();
    sword.lineStyle(9, 0xdff6ff, 0.9);
    sword.beginPath();
    sword.arc(0, -150, 165, Phaser.Math.DegToRad(-58), Phaser.Math.DegToRad(58));
    sword.strokePath();
    sword.setAlpha(0);

    container.add([shadow, glow, body, sword]);
    this.charContainer = container;
    this.animator = new CharacterAnimator(this, container, { body, sword, shadow, glow });
    return container;
  }

  setCharacter(id) {
    if (!this.scene.isActive()) return;
    this.buildCharacter(id);
  }

  /* --------------------------- Анимациялар --------------------------- */

  /** Кейіпкер бөлмеге жүгіріп кіреді, есік ашылады */
  enterRoom(roomIndex, title) {
    return new Promise((resolve) => {
      const c = this.charContainer;
      if (!c) { resolve(); return; }

      this.roomLabel.setText(`${roomIndex}-БӨЛМЕ\n${title || ''}`).setAlpha(0);
      this.tweens.add({ targets: this.roomLabel, alpha: 1, duration: 600 });

      // Есікті көрсету (жабық)
      this.doorGroup.setVisible(true).setAlpha(1);
      this.doorL.x = -104; this.doorR.x = 104;
      this.doorL.setAlpha(1); this.doorR.setAlpha(1);
      this.doorGlow.setAlpha(0);

      c.x = -240;
      c.setAlpha(1);
      this.animator.play('run');

      // 1) Есікке қарай жүгіру
      this.tweens.add({
        targets: c,
        x: W / 2 - 250,
        duration: 1750,
        ease: 'Sine.easeInOut',
      });
      // Фон параллаксы
      this.tweens.add({ targets: this.bgNear, x: W / 2 - 70, duration: 1750, yoyo: true });
      this.tweens.add({ targets: this.bgFar, x: W / 2 - 26, duration: 1750, yoyo: true });

      this.time.delayedCall(1750, () => {
        this.animator.play('idle');
        window.dispatchEvent(new CustomEvent('kzrpg:door'));

        // 2) Есік ашылады
        this.tweens.add({ targets: this.doorGlow, alpha: 0.5, duration: 500, yoyo: true });
        this.tweens.add({
          targets: this.doorL,
          x: -330,
          alpha: 0.35,
          scaleX: 0.55,
          duration: 1200,
          ease: 'Cubic.easeInOut',
        });
        this.tweens.add({
          targets: this.doorR,
          x: 330,
          alpha: 0.35,
          scaleX: 0.55,
          duration: 1200,
          ease: 'Cubic.easeInOut',
          onComplete: () => {
            // 3) Бөлмеге кіру
            this.animator.play('run');
            this.tweens.add({
              targets: c,
              x: W / 2,
              scaleX: 0.55,
              scaleY: 0.55,
              alpha: 0.15,
              duration: 950,
              ease: 'Quad.easeIn',
              onComplete: () => {
                this.tweens.add({ targets: this.roomLabel, alpha: 0, duration: 400 });
                this.doorGroup.setVisible(false);
                this.showRoomInterior();
                resolve();
              },
            });
          },
        });
      });
    });
  }

  /** Бөлме ішіндегі көрініс (тапсырма кезінде фонда тұрады) */
  showRoomInterior() {
    this.bgNear.setTexture('roombg').setDisplaySize(W, H).setAlpha(1);
    this.bgFar.setAlpha(0.2);
    const c = this.charContainer;
    if (!c) return;
    c.setScale(0.62).setAlpha(1);
    c.x = 150;
    c.y = H * 0.94;
    this.animator.baseScale = 0.62;
    this.animator.play('idle');
  }

  /** Коридорға оралу (келесі бөлмеге көшу) */
  resetCorridor() {
    this.bgNear.setTexture('corridor').setDisplaySize(W, H);
    this.bgFar.setAlpha(0.55);
    const c = this.charContainer;
    if (!c) return;
    c.setScale(1).setAlpha(1);
    c.x = -240;
    c.y = H * 0.9;
    this.animator.baseScale = 1;
    this.animator.baseY = H * 0.9;
  }

  attack() { if (this.animator) this.animator.play('attack'); }
  hit() { if (this.animator) this.animator.play('hit'); }
  victory() { if (this.animator) this.animator.play('victory'); }
  death() { if (this.animator) this.animator.play('death'); }
  idle() { if (this.animator) this.animator.play('idle'); }
}

export default CastleScene;
