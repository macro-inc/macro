import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { createAppViteConfig } from '../../../../../../../vite.base';

const adapter = fileURLToPath(
  new URL('./fixture-adapters.tsx', import.meta.url)
);
const menu = fileURLToPath(new URL('./menu-adapter.tsx', import.meta.url));
const modules = new Set([
  '@core/context/user',
  '@core/context/channels',
  '@queries/channel-labels/channel-labels',
  '@queries/channel/by-ids',
  '@queries/team/teams',
  '@queries/notification/unsubscribes',
  '@queries/channel/join-links',
  '@queries/favorites/favorites',
  '@components/app/GlobalAppState',
  '@components/app/split-layout/layoutUtils',
  '@app/features/next-soup/utils',
]);
const fixtures: Plugin = {
  name: 'chat-sidebar-fixture-adapters',
  enforce: 'pre',
  resolveId(source, importer) {
    if (importer?.split('?')[0] === adapter) return;
    if (modules.has(source)) return adapter;
    if (
      source === '@app/features/soup' ||
      source === '@app/features/soup/SoupEntityContextMenu'
    )
      return menu;
    if (
      importer?.endsWith('/next/ChannelLabelRows.tsx') &&
      source === '../ChannelLabelRows'
    )
      return adapter;
    if (
      source.endsWith('/channels-view-context') ||
      source.endsWith('/queries/channel-list-search-pool') ||
      source.endsWith('/mobile/use-mobile-section-actions') ||
      source.endsWith('/hooks/useChannelCalls')
    )
      return adapter;
    if (
      importer?.endsWith('/mobile/MobileSectionsView.tsx') &&
      (source === '../channel-discovery-source' ||
        source === './use-mobile-section-actions')
    )
      return adapter;
  },
};
export default defineConfig(async (env) => {
  const base = await createAppViteConfig()(env);
  return {
    ...base,
    plugins: [fixtures, ...(base.plugins ?? [])],
    server: { ...base.server, host: '127.0.0.1' },
  };
});
