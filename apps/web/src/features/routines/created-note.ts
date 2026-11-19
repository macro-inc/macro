import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createSignal } from 'solid-js';
import type { CreatedCount } from './core/routine';

/**
 * What a delete confirmation says about the routines a routine's runs
 * created, which are deleted with it. `listed` is how many the page holds
 * now, which may leave some out (finished ones, ones a run just made), so
 * until `counted`, a fresh read of them all, answers, or when it fails, the
 * note gives it as a floor; with none listed it says that any it created go
 * too. Confirming before the read answers still warns.
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
    const count = answer() ?? { count: listed, atLeast: true };
    if (count.count === 0) {
      return count.atLeast ? t('subRoutines.deleteNoteUncounted') : undefined;
    }
    return count.atLeast
      ? t('subRoutines.deleteNoteAtLeast', { count: count.count })
      : t('subRoutines.deleteNote', { count: count.count });
  };
}
