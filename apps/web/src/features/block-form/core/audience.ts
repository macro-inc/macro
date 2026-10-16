import type { FormAudience, FormDetail } from './form-model';
import { resolvedWidget } from './question-types';

/** Whether any question asks for a file upload. */
export function hasFileQuestion(detail: FormDetail): boolean {
  return detail.layout.sections.some((section) =>
    section.questions.some((question) => {
      const column = detail.columns.find(
        (item) => item.id === question.columnId
      );
      return (
        !!column && resolvedWidget(column.kind, question.widget) === 'file'
      );
    })
  );
}

/** Why the audience cannot change to `audience`, if it cannot. */
export function audienceRefusal(
  detail: FormDetail,
  audience: FormAudience
): string | undefined {
  if (detail.access !== 'owner')
    return 'Only the owner can change who responds.';
  if (audience === 'public' && hasFileQuestion(detail))
    return 'Anyone-with-the-link forms can’t ask for files. Change or remove the file upload questions first.';
  return undefined;
}
