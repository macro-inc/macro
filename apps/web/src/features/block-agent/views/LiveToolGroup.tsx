import { splitProps } from 'solid-js';
import { createToolGroupDisclosure } from '../primitives/tool-group-disclosure';
import { ToolGroup, type ToolGroupProps } from '../ui/ToolGroup';

/** Apply live-run timing without making the presentation own tool lifecycle. */
export function LiveToolGroup(
  props: Omit<ToolGroupProps, 'open' | 'onOpenChange'> & {
    /**
     * Whether ongoing work opens the run's scrolling window. Defaults to true;
     * a run carrying the session's live line never opens on its own.
     */
    autoOpen?: boolean;
  }
) {
  const [local, groupProps] = splitProps(props, ['autoOpen']);
  const disclosure = createToolGroupDisclosure({
    active: () =>
      groupProps.active && (local.autoOpen ?? true) && !groupProps.summary,
    defaultOpen: groupProps.defaultOpen,
  });

  return (
    <ToolGroup
      {...groupProps}
      open={disclosure.expanded()}
      onOpenChange={disclosure.setExpanded}
    />
  );
}
