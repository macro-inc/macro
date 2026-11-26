import type { ChannelEntity } from '@entity';
import type { Accessor } from 'solid-js';
import type { ChannelsSources } from '../../../queries';
import { SidebarWorkspaceProvider } from '../../context/sidebar-workspace-context';
import { createLiveSidebarWorkspace } from '../../primitives/create-live-sidebar-workspace';
import { ChannelSidebarMobileView } from './ChannelSidebarMobileView';

export type ChannelSidebarMobileProps = {
  sources: ChannelsSources;
  localChannels: Accessor<ChannelEntity[]>;
  openPreview?: (channel: ChannelEntity) => boolean;
};

/**
 * Live Macro mobile/tablet entry for the redesigned Chat sidebar.
 *
 * Mounts behind `enable-channel-sidebar-redesign` inside `MobileChannelsList`.
 */
export function ChannelSidebarMobile(props: ChannelSidebarMobileProps) {
  const workspace = createLiveSidebarWorkspace({
    sources: props.sources,
    localChannels: props.localChannels,
    openPreview: props.openPreview,
  });

  return (
    <SidebarWorkspaceProvider value={workspace}>
      <ChannelSidebarMobileView />
    </SidebarWorkspaceProvider>
  );
}
