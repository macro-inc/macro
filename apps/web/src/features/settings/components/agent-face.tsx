import { cn } from '@ui';
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import {
  type AgentFaceLook,
  type AgentFacePose,
  RESTING_POSE,
} from '../core/agent-face';
import { paintAgentFace } from './agent-face-paint';

/** Whether the app is in its dark theme, following theme switches. */
export function createDarkTheme() {
  const root = document.documentElement;
  const isDark = () => root.dataset.themeLight !== 'true';
  const [dark, setDark] = createSignal(isDark());
  const observer = new MutationObserver(() => setDark(isDark()));
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-theme-light'],
  });
  onCleanup(() => observer.disconnect());
  return dark;
}

/** Idle blinks and looks around; thinking folds into the mark; done smiles. */
export type AgentFaceState = 'idle' | 'thinking' | 'done';

type Spring = { value: number; velocity: number };
const spring = (s: Spring, target: number, dt: number, period: number) => {
  // Critically damped; substeps keep a slow frame from overshooting.
  const w = (Math.PI * 2) / period;
  const steps = Math.ceil((dt * w) / 0.2);
  const h = dt / steps;
  for (let step = 0; step < steps; step++) {
    s.velocity += (w * w * (target - s.value) - 2 * w * s.velocity) * h;
    s.value += s.velocity * h;
  }
  return s.value;
};

/**
 * An agent's Mark face on a transparent canvas. Animated faces blink, glance
 * around (or follow the pointer), fold into the logo while thinking, and hop
 * when done; static ones draw once, for lists.
 */
export function AgentFace(props: {
  look: AgentFaceLook;
  state?: AgentFaceState;
  animated?: boolean;
  /** Eyes follow the pointer, for a large preview rather than list rows. */
  followPointer?: boolean;
  class?: string;
}) {
  let canvas!: HTMLCanvasElement;
  const dark = createDarkTheme();
  const [pixels, setPixels] = createSignal(0);
  // Under reduced motion an animated face draws like a static one.
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;
  const moving = () => props.animated && !reducedMotion;

  const draw = (pose: AgentFacePose) => {
    const ctx = canvas.getContext('2d');
    const size = pixels();
    if (!ctx || size === 0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    paintAgentFace(ctx, size, props.look, pose, dark());
  };

  onMount(() => {
    const sizeObserver = new ResizeObserver(() => {
      const box = canvas.getBoundingClientRect();
      const size = Math.round(
        Math.min(box.width, box.height) * Math.min(2.5, devicePixelRatio || 1)
      );
      canvas.width = size;
      canvas.height = size;
      setPixels(size);
    });
    sizeObserver.observe(canvas);
    onCleanup(() => sizeObserver.disconnect());

    if (!moving()) return;

    let visible = true;
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    visibility.observe(canvas);

    const pointer = { x: 0, y: 0, at: -Infinity };
    const follow = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.at = performance.now() / 1000;
    };
    if (props.followPointer)
      window.addEventListener('pointermove', follow, { passive: true });

    const look = { x: { value: 0, velocity: 0 }, y: { value: 0, velocity: 0 } };
    const think: Spring = { value: 0, velocity: 0 };
    const happy: Spring = { value: 0, velocity: 0 };
    let glance = { x: 0, y: 0, until: 0 };
    let lastBlink = -Infinity;
    let nextBlink = 1.5;
    let hopAt = -Infinity;
    let last = performance.now() / 1000;
    let frame = 0;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const t = now / 1000;
      const dt = Math.min(1 / 20, Math.max(0, t - last));
      last = t;
      if (!visible) return;
      const state = props.state ?? 'idle';

      let target = { x: 0, y: 0 };
      if (state === 'thinking') target = { x: 0.5, y: -0.7 };
      else if (t - pointer.at < 3) {
        const box = canvas.getBoundingClientRect();
        const dx = pointer.x - (box.left + box.width / 2);
        const dy = pointer.y - (box.top + box.height / 2);
        const distance = Math.hypot(dx, dy) || 1;
        const reach = distance / (distance + 160);
        target = { x: (dx / distance) * reach, y: (dy / distance) * reach };
      } else {
        if (t > glance.until) {
          const angle = Math.random() * Math.PI * 2;
          const reach = Math.random() < 0.45 ? 0.1 : 0.4 + Math.random() * 0.4;
          glance = {
            x: Math.cos(angle) * reach,
            y: Math.sin(angle) * reach * 0.7,
            until: t + 1.4 + Math.random() * 2.6,
          };
        }
        target = glance;
      }
      if (t > nextBlink) {
        lastBlink = t;
        nextBlink = t + 2.4 + Math.random() * 3.6;
      }
      // Eyes close and reopen over 170ms.
      const blink = Math.max(0, 1 - Math.abs((t - lastBlink) / 0.085 - 1));
      const wasHappy = happy.value > 0.5;
      const smile = spring(happy, state === 'done' ? 1 : 0, dt, 0.42);
      if (!wasHappy && smile > 0.5) hopAt = t;
      const hop = (t - hopAt) / 0.46;
      draw({
        time: t,
        lookX: spring(look.x, target.x, dt, 0.24),
        lookY: spring(look.y, target.y, dt, 0.24),
        open: 1 - blink,
        happy: smile,
        think: spring(think, state === 'thinking' ? 1 : 0, dt, 0.6),
        work: 0,
        lift: hop > 0 && hop < 1 ? Math.sin(Math.PI * hop) * 0.22 : 0,
      });
    };
    frame = requestAnimationFrame(tick);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      visibility.disconnect();
      window.removeEventListener('pointermove', follow);
    });
  });

  // Static faces redraw when their look, size, theme, or state changes.
  createEffect(() => {
    if (moving()) return;
    draw({
      ...RESTING_POSE,
      happy: props.state === 'done' ? 1 : 0,
      think: props.state === 'thinking' ? 1 : 0,
    });
  });

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      data-agent-face
      class={cn('block', props.class)}
    />
  );
}
