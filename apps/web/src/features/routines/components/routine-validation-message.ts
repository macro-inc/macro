import { t } from '@app/lib/i18n';
import type { RoutineValidationError } from '../core/routine-draft';

export function routineValidationMessage(error: RoutineValidationError | null) {
  if (typeof error === 'string' || error === null) return error;
  switch (error.kind) {
    case 'definition':
      return t('subRoutines.definitionInvalid', {
        title: error.title,
        message: error.message,
      });
    case 'codeStepLimit':
      return t('subRoutines.codeStepLimit', { count: error.count });
    case 'unsupportedApps':
      return error.definitionTitle === undefined
        ? t('subRoutines.routineAppsUnsupported')
        : t('subRoutines.definitionAppsUnsupported', {
            title: error.definitionTitle,
          });
  }
}
