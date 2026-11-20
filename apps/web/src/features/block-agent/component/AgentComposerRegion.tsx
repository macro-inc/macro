import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { children, type ParentProps } from 'solid-js';

/** Keep the editor mounted while another mobile accessory, such as Changes, is active. */
export function AgentComposerRegion(props: ParentProps) {
  const content = children(() => props.children);
  return (
    <FloatRegionOrInline region="accessory">{content()}</FloatRegionOrInline>
  );
}
