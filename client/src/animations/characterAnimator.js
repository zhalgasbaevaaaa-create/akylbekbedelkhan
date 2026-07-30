/**
 * Кейіпкер анимацияларының қозғалтқышы.
 *
 * Кейіпкерлер бір суреттен (sprite) тұратындықтан, анимациялар Phaser Tween
 * арқылы процедуралық түрде жасалады. Әр кейіпкерде толық жиынтық бар:
 *   idle · run · attack (қылыш шабу) · hit · victory · death
 */

export const ANIMATIONS = ['idle', 'run', 'attack', 'hit', 'victory', 'death'];

export class CharacterAnimator {
  /**
   * @param {Phaser.Scene} scene
   * @param {Phaser.GameObjects.Container} container кейіпкер + қылыш
   * @param {object} parts { body, sword, shadow, glow }
   */
  constructor(scene, container, parts) {
    this.scene = scene;
    this.c = container;
    this.parts = parts;
    this.current = null;
    this.tweens = [];
    this.baseY = container.y;
    this.baseScale = container.scaleX;
    this.play('idle');
  }

  _clear() {
    this.tweens.forEach((t) => t && t.remove && t.remove());
    this.tweens = [];
    const { body, sword } = this.parts;
    this.scene.tweens.killTweensOf([this.c, body, sword].filter(Boolean));
    if (body) { body.setAngle(0); body.setScale(1); body.y = 0; body.setAlpha(1); }
    if (sword) { sword.setAngle(0); sword.setAlpha(0); }
    this.c.setAngle(0);
    this.c.setScale(this.baseScale);
    this.c.y = this.baseY;
    this.c.setAlpha(1);
  }

  play(name, onComplete) {
    if (this.current === name && ['idle', 'run'].includes(name)) return;
    this._clear();
    this.current = name;
    const fn = this[`_${name}`];
    if (typeof fn === 'function') fn.call(this, onComplete);
    else this._idle();
  }

  /* ------------------------------- Idle ------------------------------- */
  _idle() {
    const { body } = this.parts;
    this.tweens.push(this.scene.tweens.add({
      targets: body,
      y: -8,
      scaleY: 1.018,
      duration: 1450,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    }));
    this.tweens.push(this.scene.tweens.add({
      targets: body,
      angle: { from: -0.7, to: 0.7 },
      duration: 2600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    }));
  }

  /* -------------------------------- Run -------------------------------- */
  _run() {
    const { body, shadow } = this.parts;
    this.tweens.push(this.scene.tweens.add({
      targets: body,
      y: -26,
      duration: 210,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeOut',
    }));
    this.tweens.push(this.scene.tweens.add({
      targets: body,
      angle: { from: -5, to: 5 },
      duration: 210,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    }));
    if (shadow) {
      this.tweens.push(this.scene.tweens.add({
        targets: shadow,
        scaleX: 0.78,
        alpha: 0.28,
        duration: 210,
        yoyo: true,
        repeat: -1,
      }));
    }
  }

  /* ------------------------ Attack (қылыш шабу) ------------------------ */
  _attack(onComplete) {
    const { body, sword } = this.parts;
    if (sword) {
      sword.setAlpha(1);
      sword.setAngle(-115);
      this.tweens.push(this.scene.tweens.add({
        targets: sword,
        angle: 75,
        duration: 190,
        ease: 'Cubic.easeIn',
        yoyo: true,
        hold: 60,
        onComplete: () => sword.setAlpha(0),
      }));
    }
    this.tweens.push(this.scene.tweens.add({
      targets: body,
      x: 34,
      angle: 9,
      scaleX: 1.06,
      duration: 130,
      ease: 'Back.easeOut',
      yoyo: true,
      onComplete: () => {
        body.x = 0;
        if (onComplete) onComplete();
        this.play('idle');
      },
    }));
    this._flash(0x9ff5ff, 0.5, 200);
  }

  /* ------------------------- Hit (соққы алу) -------------------------- */
  _hit(onComplete) {
    const { body } = this.parts;
    body.setTint(0xff6a5c);
    this.tweens.push(this.scene.tweens.add({
      targets: body,
      x: { from: 0, to: -20 },
      angle: -8,
      duration: 70,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        body.clearTint();
        body.x = 0;
        if (onComplete) onComplete();
        this.play('idle');
      },
    }));
    this.scene.cameras.main.shake(220, 0.006);
    this._flash(0xff4433, 0.42, 260);
  }

  /* ---------------------------- Victory ------------------------------- */
  _victory(onComplete) {
    const { body, sword } = this.parts;
    if (sword) {
      sword.setAlpha(1);
      sword.setAngle(-70);
      this.tweens.push(this.scene.tweens.add({
        targets: sword,
        angle: -95,
        duration: 620,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }));
    }
    this.tweens.push(this.scene.tweens.add({
      targets: body,
      y: -46,
      duration: 380,
      yoyo: true,
      repeat: 3,
      ease: 'Quad.easeOut',
      onComplete: () => { if (onComplete) onComplete(); },
    }));
    this.tweens.push(this.scene.tweens.add({
      targets: body,
      angle: { from: -6, to: 6 },
      duration: 380,
      yoyo: true,
      repeat: 7,
    }));
    this._flash(0xffd54a, 0.55, 900);
  }

  /* ----------------------------- Death -------------------------------- */
  _death(onComplete) {
    const { body, shadow } = this.parts;
    if (shadow) this.scene.tweens.add({ targets: shadow, alpha: 0, duration: 800 });
    this.tweens.push(this.scene.tweens.add({
      targets: body,
      angle: 88,
      y: 68,
      alpha: 0.22,
      duration: 950,
      ease: 'Quad.easeIn',
      onComplete: () => { if (onComplete) onComplete(); },
    }));
    body.setTint(0x88424a);
    this._flash(0x330000, 0.5, 900);
  }

  /* ------------------------------ Utils ------------------------------- */
  _flash(color, alpha, duration) {
    const { glow } = this.parts;
    if (!glow) return;
    glow.setFillStyle(color, alpha);
    glow.setAlpha(alpha);
    this.scene.tweens.add({ targets: glow, alpha: 0, duration });
  }

  destroy() {
    this._clear();
  }
}

export default CharacterAnimator;
