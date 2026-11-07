import { cn } from '@ui';

/**
 * Names when the rows below it arrived: Home's section heading, with its label
 * in line with the rows' avatars.
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
          'truncate pt-1 pr-4 pb-1.5 pl-6 mobile:pl-7 text-xs font-semibold tracking-tight text-ink-extra-muted/80',
          !props.isFirst && 'pt-4'
        )}
      >
        {props.label}
      </div>
    </div>
  );
}
