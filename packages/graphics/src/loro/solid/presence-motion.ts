import type { PeerPresence, PresenceShape } from '../presence-state';

type Spring = { value: number; target: number; velocity: number };
const FREQUENCY = 26;
const settled = (spring: Spring) =>
  Math.abs(spring.value - spring.target) < 0.0001 &&
  Math.abs(spring.velocity) < 0.001;

/** Receiver-only animation. One frame loop; no writes back to presence or the editor. */
export function createPresenceMotion(render: (peers: PeerPresence[]) => void) {
  const springs = new Map<string, Spring>();
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let peers: PeerPresence[] = [];
  let frame: number | undefined;
  let previousTime = 0;
  let disposed = false;
  const stop = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };
  const project = () => {
    const used = new Set<string>();
    const sample = (key: string, target: number, angle = false) => {
      used.add(key);
      let spring = springs.get(key);
      if (!spring) {
        spring = { value: target, target, velocity: 0 };
        springs.set(key, spring);
      }
      // Unwrap rotations across ±π; interpolating matrix entries would shrink/skew shapes.
      if (angle)
        target +=
          Math.round((spring.target - target) / (2 * Math.PI)) * 2 * Math.PI;
      spring.target = target;
      if (reducedMotion?.matches) {
        spring.value = target;
        spring.velocity = 0;
      }
      return spring.value;
    };
    const shape = (key: string, target: PresenceShape): PresenceShape => {
      const [a, b, c, d, x, y] = target.world;
      const scaleX = Math.hypot(a, b);
      const angle = sample(`${key}/angle`, Math.atan2(b, a), true);
      const sx = sample(`${key}/sx`, scaleX);
      const sy = sample(`${key}/sy`, (a * d - b * c) / scaleX);
      const shear = sample(`${key}/shear`, (a * c + b * d) / scaleX);
      const cos = Math.cos(angle),
        sin = Math.sin(angle);
      return {
        ...target,
        width: Math.max(0, sample(`${key}/width`, target.width)),
        height: Math.max(0, sample(`${key}/height`, target.height)),
        world: [
          cos * sx,
          sin * sx,
          cos * shear - sin * sy,
          sin * shear + cos * sy,
          sample(`${key}/x`, x),
          sample(`${key}/y`, y),
        ],
      };
    };
    const result = peers.map((peer) => {
      const key = peer.id;
      const preview = peer.preview;
      return {
        ...peer,
        cursor: peer.cursor
          ? {
              x: sample(`${key}/cursor/x`, peer.cursor.x),
              y: sample(`${key}/cursor/y`, peer.cursor.y),
            }
          : null,
        preview: preview
          ? {
              ...preview,
              shapes: preview.shapes.map((target) =>
                shape(
                  `${key}/${preview.kind}/${target.kind}/${target.id}`,
                  target
                )
              ),
              box: preview.box
                ? {
                    x: sample(`${key}/box/x`, preview.box.x),
                    y: sample(`${key}/box/y`, preview.box.y),
                    width: Math.max(
                      0,
                      sample(`${key}/box/width`, preview.box.width)
                    ),
                    height: Math.max(
                      0,
                      sample(`${key}/box/height`, preview.box.height)
                    ),
                  }
                : null,
            }
          : null,
      };
    });
    for (const key of springs.keys()) if (!used.has(key)) springs.delete(key);
    render(result);
  };
  const moving = () => [...springs.values()].some((spring) => !settled(spring));
  const tick: FrameRequestCallback = (time) => {
    frame = undefined;
    const dt = Math.max(0, (time - previousTime) / 1000);
    previousTime = time;
    const decay = Math.exp(-FREQUENCY * dt);
    for (const spring of springs.values()) {
      // Exact critically damped solution remains stable after a suspended tab resumes.
      const displacement = spring.value - spring.target;
      const impulse = spring.velocity + FREQUENCY * displacement;
      spring.value = spring.target + (displacement + impulse * dt) * decay;
      spring.velocity = (spring.velocity - FREQUENCY * impulse * dt) * decay;
      if (settled(spring)) {
        spring.value = spring.target;
        spring.velocity = 0;
      }
    }
    project();
    if (moving()) frame = requestAnimationFrame(tick);
  };
  const update = (next: PeerPresence[]) => {
    if (disposed) return;
    peers = next;
    project();
    if (!moving()) stop();
    else if (frame === undefined) {
      previousTime = performance.now();
      frame = requestAnimationFrame(tick);
    }
  };
  const preferenceChanged = () => update(peers);
  reducedMotion?.addEventListener('change', preferenceChanged);
  return {
    update,
    dispose() {
      disposed = true;
      stop();
      springs.clear();
      reducedMotion?.removeEventListener('change', preferenceChanged);
    },
  };
}
