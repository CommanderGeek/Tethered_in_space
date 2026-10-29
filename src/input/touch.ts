// Touch-Steuerung fürs Handy: schwebender Joystick auf der linken Bildschirmhälfte,
// Anker-Knopf rechts. Läuft komplett im DOM (scharf und günstig zu rendern).

import type { PlayerInput } from '../sim/sim';

const RADIUS = 60; // maximaler Ausschlag des Knüppels in px

class TouchControls {
  private root?: HTMLElement;
  private base?: HTMLElement;
  private knob?: HTMLElement;
  private anchorBtn?: HTMLElement;
  private stickId: number | null = null;
  private anchorIds = new Set<number>();
  private origin = { x: 0, y: 0 };
  private vec = { x: 0, y: 0 };
  /** true, sobald der Touch-Modus einmal benutzt wurde */
  used = false;

  mount(root: HTMLElement) {
    this.root = root;
    this.base = root.querySelector<HTMLElement>('.stick-base')!;
    this.knob = root.querySelector<HTMLElement>('.stick-knob')!;
    this.anchorBtn = root.querySelector<HTMLElement>('.anchor-btn')!;
    const zone = root.querySelector<HTMLElement>('.stick-zone')!;

    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault();
      this.used = true;
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.origin = { x: e.clientX, y: e.clientY };
      this.base!.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.base!.classList.add('active');
      this.move(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.move(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.vec = { x: 0, y: 0 };
      this.knob!.style.transform = 'translate(-50%, -50%)';
      this.base!.classList.remove('active');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    const btn = this.anchorBtn;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.used = true;
      this.anchorIds.add(e.pointerId);
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('pressed');
      navigator.vibrate?.(12);
    });
    const release = (e: PointerEvent) => {
      this.anchorIds.delete(e.pointerId);
      if (this.anchorIds.size === 0) btn.classList.remove('pressed');
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);

    // kein Kontextmenü / Text-Markieren beim langen Drücken
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private move(x: number, y: number) {
    let dx = x - this.origin.x;
    let dy = y - this.origin.y;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) {
      // Basis wandert mit, wenn man weit zieht – fühlt sich natürlicher an
      this.origin.x += (dx / d) * (d - RADIUS);
      this.origin.y += (dy / d) * (d - RADIUS);
      this.base!.style.transform = `translate(${this.origin.x}px, ${this.origin.y}px)`;
      dx = (dx / d) * RADIUS;
      dy = (dy / d) * RADIUS;
    }
    this.knob!.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // kleine Totzone, danach linear
    const mag = Math.min(1, Math.hypot(dx, dy) / RADIUS);
    const strength = mag < 0.15 ? 0 : (mag - 0.15) / 0.85;
    const ang = Math.atan2(dy, dx);
    this.vec = { x: Math.cos(ang) * strength, y: Math.sin(ang) * strength };
  }

  setVisible(v: boolean) {
    this.root?.classList.toggle('visible', v);
    if (!v) {
      this.stickId = null;
      this.anchorIds.clear();
      this.vec = { x: 0, y: 0 };
    }
  }

  read(): PlayerInput {
    return { x: this.vec.x, y: this.vec.y, anchor: this.anchorIds.size > 0 };
  }
}

export const touch = new TouchControls();
