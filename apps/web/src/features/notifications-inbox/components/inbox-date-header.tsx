import { cn } from '@ui';

/**
 * Names when the rows below it arrived: Home's section heading, with its label
 * starting where the inbox rows' glyphs do.
 */
export function InboxDateHeader(props: {
  id: string;
  label: string;
  isFirst: boolean;
}) {
  return (
    <div id={props.id} role="row">
      <div
        role="gridcell"
        class={cn(
          'mx-(--sidebar-gutter) truncate px-2 py-1.5 text-xs font-semibold tracking-tight text-ink-extra-muted/80',
          !props.isFirst && 'pt-5'
        )}
      >
        {props.label}
      </div>
    </div>
  );
}
