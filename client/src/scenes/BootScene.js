/** Ресурстарды жүктеу сахнасы */
export const CHARACTERS = [
  { id: 'batyr_1', name: 'Қабанбай батыр', role: 'Батыр', file: 'batyr_1.png' },
  { id: 'batyr_2', name: 'Наурызбай батыр', role: 'Батыр', file: 'batyr_2.png' },
  { id: 'batyr_3', name: 'Бөгенбай батыр', role: 'Батыр', file: 'batyr_3.png' },
  { id: 'batyr_4', name: 'Райымбек батыр', role: 'Батыр', file: 'batyr_4.png' },
  { id: 'khanshaiym_1', name: 'Айша ханшайым', role: 'Ханшайым', file: 'khanshaiym_1.png' },
  { id: 'khanshaiym_2', name: 'Зере ханшайым', role: 'Ханшайым', file: 'khanshaiym_2.png' },
];

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    this.load.image('corridor', 'assets/maps/corridor.jpg');
    this.load.image('roombg', 'assets/maps/room-bg.jpg');
    this.load.image('doorLeft', 'assets/ui/door-left.png');
    this.load.image('doorRight', 'assets/ui/door-right.png');
    CHARACTERS.forEach((c) => this.load.image(c.id, `assets/characters/${c.file}`));

    this.load.on('progress', (value) => {
      window.dispatchEvent(new CustomEvent('kzrpg:loadprogress', { detail: value }));
    });
  }

  create() {
    window.dispatchEvent(new CustomEvent('kzrpg:ready'));
    this.scene.start('Castle');
  }
}

export default BootScene;
