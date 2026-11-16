import { type Accessor, createSignal, onMount } from 'solid-js';
import { fireAndForget } from '../util/fireAndForget';
import type { BackgroundEffect } from './background-effect';
import {
  loadRecentBackgroundImages,
  type RecentBackgroundImage,
  removeRecentBackgroundImage,
  saveRecentBackgroundImage,
} from './recent-background-images';

const [recent, setRecent] = createSignal<RecentBackgroundImage[]>([]);
let pending: Promise<unknown> = Promise.resolve();

// Serialize device-local writes before updating the shared list. A failed write
// leaves the previous list intact and never prevents the next queued operation.
function enqueue(action: () => Promise<RecentBackgroundImage[] | null>) {
  const run = async () => {
    await pending;
    try {
      const images = await action();
      if (images) setRecent(images);
    } catch {
      // Storage is optional; preserve the last successful list.
    }
  };
  const result = run();
  pending = result;
  return result;
}

export function rememberRecentBackgroundImage(image: RecentBackgroundImage) {
  return enqueue(() => saveRecentBackgroundImage(image));
}

export { recent };
export const loadRecentBackgrounds = () => enqueue(loadRecentBackgroundImages);
export const removeRecentBackground = (path: string) =>
  enqueue(() => removeRecentBackgroundImage(path));

type RecentBackgroundOptions = {
  effect: Accessor<BackgroundEffect>;
  disabled: Accessor<boolean | undefined>;
  onSelect: (effect: BackgroundEffect) => boolean | Promise<boolean>;
  confirmRemoval: () => Promise<boolean>;
};

export function createRecentBackgrounds(options: RecentBackgroundOptions) {
  onMount(() => {
    fireAndForget(loadRecentBackgrounds(), 'recent-background-images');
  });
  const current = (image: RecentBackgroundImage) => {
    const effect = options.effect();
    return effect.type === 'image' && effect.path === image.path;
  };
  const [removing, setRemoving] = createSignal(false);
  const remove = (image: RecentBackgroundImage) => {
    if (options.disabled() || removing()) return;
    setRemoving(true);
    fireAndForget(
      (async () => {
        try {
          if (current(image)) {
            const confirmed = await options.confirmRemoval();
            if (!confirmed) return;
            if (current(image) && !(await options.onSelect({ type: 'none' })))
              return;
          }
          await removeRecentBackground(image.path);
        } finally {
          setRemoving(false);
        }
      })(),
      'recent-background-images'
    );
  };
  const select = (image: RecentBackgroundImage) => {
    const apply = async () => {
      const applied = await options.onSelect({ type: 'image', ...image });
      if (applied) await rememberRecentBackgroundImage(image);
    };
    fireAndForget(apply(), 'recent-background-images');
  };

  return { current, removing, remove, select };
}
