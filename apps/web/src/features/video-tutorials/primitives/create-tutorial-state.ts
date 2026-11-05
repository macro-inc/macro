import { analytics } from '@app/lib/analytics';
import { makePersistedState } from '@app/lib/persistence';
import { createSignal } from 'solid-js';
import { z } from 'zod';
import { type TutorialId, tutorialDismissedKey } from '../core/tutorial-id';

const DISMISSED_VALUE = z.literal('true');

/**
 * One tutorial entry's state: whether its video dialog is open, and whether
 * the person dismissed the entry on this device (remembered until they clear
 * site data).
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

  const track = (
    action: 'opened' | 'played' | 'dismissed' | 'support_clicked'
  ) => analytics.track('tutorial_video', { tutorial: `macro-${id}`, action });

  return {
    open,
    setOpen,
    dismissed,
    openVideo: () => {
      track('opened');
      setOpen(true);
    },
    dismiss: () => {
      track('dismissed');
      setDismissed(true);
    },
    recordPlay: () => track('played'),
    recordSupportClick: () => track('support_clicked'),
  };
}

export type TutorialState = ReturnType<typeof createTutorialState>;
