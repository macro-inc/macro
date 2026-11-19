import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createSignal } from 'solid-js';
import type { CreatedCount } from './core/routine';

/**
 * What a delete confirmation says about the routines a routine's runs
 * created, which are deleted with it. `listed` is how many the page holds
 * now; `counted`, a fresh read of them all, replaces it when it answers.
 * Until then, or when that read fails, a routine with none listed still
 * says that any it created go too, so confirming before the read warns.
 */
export function createdNote(
  listed: number,
  counted: Promise<CreatedCount | undefined>
): Accessor<string | undefined> {
  const [answer, setAnswer] = createSignal<CreatedCount>();
  fireAndForget(
    counted.then((count) => {
      if (count) setAnswer(count);
    }),
    'routines'
  );
  return () => {
    const count = answer();
    if (!count) {
      return listed > 0
        ? t('subRoutines.deleteNote', { count: listed })
        : t('subRoutines.deleteNoteUncounted');
    }
    if (count.atLeast) {
      return t('subRoutines.deleteNoteAtLeast', { count: count.count });
    }
    return count.count > 0
      ? t('subRoutines.deleteNote', { count: count.count })
      : undefined;
  };
}
