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

function enqueue(action: () => Promise<RecentBackgroundImage[] | null>) {
  const result = pending.then(action);
  pending = result.catch(() => {});
  return result
    .then((images) => {
      if (images) setRecent(images);
    })
    .catch(() => {
      // Storage is optional. Never change the list on a failed transaction.
    });
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
    fireAndForget(
      Promise.resolve(options.onSelect({ type: 'image', ...image })).then(
        (applied) => {
          if (applied) return rememberRecentBackgroundImage(image);
        }
      ),
      'recent-background-images'
    );
  };

  return { current, removing, remove, select };
}
