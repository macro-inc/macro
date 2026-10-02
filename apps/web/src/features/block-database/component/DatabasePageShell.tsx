import { SidePanel } from '@components/app/side-panel';
import type { ParentProps } from 'solid-js';

/**
 * The database page inside its block container, beside its side panel. One
 * element: the side panel layout renders several roots, and the container
 * marks only a single element as the block.
 */
export function DatabasePageShell(props: ParentProps) {
  return (
    <div class="relative flex size-full min-h-0 flex-col overflow-hidden">
      <SidePanel.Layout defaultOpen={false}>{props.children}</SidePanel.Layout>
    </div>
  );
}
