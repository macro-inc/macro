import type { ChannelEntity } from '@entity';
import type { Accessor } from 'solid-js';
import type { ChannelsSources } from '../../queries';
import { SidebarWorkspaceProvider } from '../context/sidebar-workspace-context';
import { createLiveSidebarWorkspace } from '../primitives/create-live-sidebar-workspace';
import { ChannelSidebarWorkspace } from './ChannelSidebarWorkspace';

export type ChannelSidebarDesktopProps = {
  sources: ChannelsSources;
  localChannels: Accessor<ChannelEntity[]>;
};

/**
 * Live Macro desktop entry for the redesigned Chat sidebar.
 *
 * Mounts behind `enable-channel-sidebar-redesign` without touching the legacy
 * rail implementation when the flag is off.
 */
export function ChannelSidebarDesktop(props: ChannelSidebarDesktopProps) {
  const workspace = createLiveSidebarWorkspace({
    sources: props.sources,
    localChannels: props.localChannels,
  });

  return (
    <SidebarWorkspaceProvider value={workspace}>
      <ChannelSidebarWorkspace />
    </SidebarWorkspaceProvider>
  );
}
