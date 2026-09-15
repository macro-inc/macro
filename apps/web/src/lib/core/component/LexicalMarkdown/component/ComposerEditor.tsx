import { cn } from '@ui/utils/classname';
import {
  MarkdownShell,
  type MarkdownShellProps,
} from '../builder/MarkdownShell';
import type {
  MarkdownEditableProps,
  MarkdownPlaceholderProps,
} from '../builder/MarkdownShellParts';

function ComposerEditable(props: MarkdownEditableProps) {
  return (
    <MarkdownShell.Editable
      {...props}
      class={cn(
        'not-touch:min-h-[24.375px] not-touch:max-h-[195px] not-touch:overflow-y-auto not-touch:[&>p]:my-0 not-touch:[&>p:first-child]:mt-0 not-touch:[&>p:last-child]:mb-0',
        props.class
      )}
    />
  );
}

function ComposerPlaceholder(props: MarkdownPlaceholderProps) {
  return (
    <MarkdownShell.Placeholder
      {...props}
      class={cn('not-touch:text-composer-placeholder', props.class)}
    >
      {props.children ??
        ((text) => (
          <p class="my-1.5 pointer-events-none not-touch:my-0">{text()}</p>
        ))}
    </MarkdownShell.Placeholder>
  );
}

function ComposerEditorRoot(props: MarkdownShellProps) {
  return (
    <MarkdownShell
      {...props}
      class={cn(
        'not-touch:min-h-[24.375px] text-base not-touch:leading-[24.375px] not-touch:text-composer-ink',
        props.class
      )}
    >
      {props.children ?? (
        <>
          <ComposerEditable />
          <ComposerPlaceholder />
        </>
      )}
    </MarkdownShell>
  );
}

/** Shared message editor presentation, composed from generic Markdown parts. */
export const ComposerEditor = Object.assign(ComposerEditorRoot, {
  Editable: ComposerEditable,
  Placeholder: ComposerPlaceholder,
});
