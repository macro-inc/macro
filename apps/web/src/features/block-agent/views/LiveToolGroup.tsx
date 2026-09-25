import { createToolGroupDisclosure } from '../primitives/tool-group-disclosure';
import { ToolGroup, type ToolGroupProps } from '../ui/ToolGroup';

/** Apply live-run timing without making the presentation own tool lifecycle. */
export function LiveToolGroup(
  props: Omit<ToolGroupProps, 'open' | 'onOpenChange'>
) {
  const disclosure = createToolGroupDisclosure({
    active: () => props.active,
    defaultOpen: props.defaultOpen,
  });

  return (
    <ToolGroup
      {...props}
      open={disclosure.expanded()}
      onOpenChange={disclosure.setExpanded}
    />
  );
}
