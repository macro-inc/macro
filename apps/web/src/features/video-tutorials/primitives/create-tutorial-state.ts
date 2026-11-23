import { analytics } from '@app/lib/analytics';
import { makePersistedState } from '@app/lib/persistence';
import { createSignal } from 'solid-js';
import { z } from 'zod';
import { type TutorialId, tutorialDismissedKey } from '../core/tutorial-id';

const DISMISSED_VALUE = z.literal('true');

/**
 * One tutorial entry's state: whether its video dialog is open, which video
 * it shows, and whether the person dismissed the entry on this device
 * (remembered until they clear site data).
 */
export function createTutorialState(id: TutorialId) {
  const key = tutorialDismissedKey(id);
  const [open, setOpen] = createSignal(false);
  const [dismissed, setDismissed] = makePersistedState(createSignal(false), {
    storages: {
      restore: () =>
        DISMISSED_VALUE.safeParse(localStorage.getItem(key)).success
          ? true
          : undefined,
      write: (value) => {
        if (value) localStorage.setItem(key, 'true');
      },
    },
  });

  // The video the dialog shows: the entry's own, or another one picked from
  // the shelf after a video ends.
  const [shown, setShown] = createSignal<TutorialId>(id);

  const track = (
    tutorial: TutorialId,
    action: 'opened' | 'played' | 'dismissed' | 'support_clicked'
  ) =>
    analytics.track('tutorial_video', {
      tutorial: `macro-${tutorial}`,
      action,
    });

  return {
    open,
    setOpen,
    dismissed,
    shown,
    openVideo: () => {
      setShown(id);
      track(id, 'opened');
      setOpen(true);
    },
    /** Switch the open dialog to another tutorial. */
    show: (next: TutorialId) => {
      setShown(next);
      track(next, 'opened');
    },
    dismiss: () => {
      track(id, 'dismissed');
      setDismissed(true);
    },
    recordPlay: () => track(shown(), 'played'),
    recordSupportClick: () => track(shown(), 'support_clicked'),
  };
}

export type TutorialState = ReturnType<typeof createTutorialState>;
