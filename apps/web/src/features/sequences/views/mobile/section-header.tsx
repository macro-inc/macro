import { ViewShell } from '@app/components/view-shell';
import type { SectionHeaderProps } from '../../components/section-header';

/**
 * Touch hides the desktop top bar, so the same parts stack in the content
 * header, under the Customers view strip.
 */
export function MobileSectionHeader(props: SectionHeaderProps) {
  return (
    <ViewShell.Header>
      <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">{props.title}</div>
        <div class="flex flex-wrap items-center gap-2">{props.actions}</div>
      </div>
    </ViewShell.Header>
  );
}
