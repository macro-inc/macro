import { cn } from '@ui';

/**
 * Names when the rows below it arrived: Home's section heading, with its label
 * starting where the inbox cards' text does.
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
          'truncate px-[25px] pt-1 pb-2.5 text-xs font-semibold tracking-tight text-ink-extra-muted/80 mobile:px-3 mobile:pb-1.5',
          !props.isFirst && 'pt-4 mobile:pt-3'
        )}
      >
        {props.label}
      </div>
    </div>
  );
}
