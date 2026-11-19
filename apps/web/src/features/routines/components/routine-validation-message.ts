import { t } from '@app/lib/i18n';
import { match } from 'ts-pattern';
import type { RoutineValidationError } from '../core/routine-draft';

export function routineValidationMessage(error: RoutineValidationError | null) {
  if (typeof error === 'string' || error === null) return error;
  return match(error)
    .with({ kind: 'definition' }, ({ title, message }) =>
      t('subRoutines.definitionInvalid', { title, message })
    )
    .with({ kind: 'codeStepLimit' }, ({ count }) =>
      t('subRoutines.codeStepLimit', { count })
    )
    .with({ kind: 'unsupportedApps' }, ({ definitionTitle }) =>
      definitionTitle === undefined
        ? t('subRoutines.routineAppsUnsupported')
        : t('subRoutines.definitionAppsUnsupported', {
            title: definitionTitle,
          })
    )
    .exhaustive();
}
