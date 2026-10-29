import { ComposeSubjectField } from '../components/compose-subject-field';
import { useCompose } from '../context/compose-context';
import { subjectLimitHint } from '../core/subject-limit';

export function ComposeSubject(props: {
  inputRef?: (el: HTMLElement) => void;
}) {
  const ctx = useCompose();
  const limitHint = () => {
    const sender = ctx
      .fromInboxes?.()
      .find((option) => option.inboxId === ctx.selectedInboxId?.());
    return subjectLimitHint(ctx.subject(), sender?.provider);
  };
  return (
    <ComposeSubjectField
      value={ctx.subject()}
      onChange={ctx.setSubject}
      disabled={ctx.disabled()}
      compact={ctx.isMobile()}
      limitHint={limitHint()}
      error={ctx.validationError('no_subject')?.message}
      inputRef={props.inputRef}
    />
  );
}
