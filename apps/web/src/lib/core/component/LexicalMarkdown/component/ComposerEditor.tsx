import { cn } from '@ui/utils/classname';
import {
  MarkdownShell,
  type MarkdownShellProps,
} from '../builder/MarkdownShell';

/** Shared message editor sizing and colors. */
export function ComposerEditor(props: MarkdownShellProps) {
  return (
    <MarkdownShell
      {...props}
      class={cn(
        'not-touch:min-h-[24.375px] text-base not-touch:leading-[24.375px] not-touch:text-composer-ink',
        'not-touch:[&>[data-markdown-editable]]:min-h-[24.375px] not-touch:[&>[data-markdown-editable]]:max-h-[195px] not-touch:[&>[data-markdown-editable]]:overflow-y-auto not-touch:[&>[data-markdown-editable]>p]:my-0 not-touch:[&>[data-markdown-editable]>p:first-child]:mt-0 not-touch:[&>[data-markdown-editable]>p:last-child]:mb-0',
        'not-touch:[&>[data-markdown-placeholder]]:text-composer-placeholder not-touch:[&>[data-markdown-placeholder]>p]:my-0',
        props.class
      )}
    />
  );
}
