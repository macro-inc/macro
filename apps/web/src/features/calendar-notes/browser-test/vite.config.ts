import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const workspaceDirectory = fileURLToPath(
  new URL('../../../../../../', import.meta.url)
);

const previewAdapters = `${directory}/preview-adapters.tsx`;
const previewImports = [
  '@queries/calendar/calendars',
  '@queries/calendar/mutations',
  '@components/app/split-layout/layout',
  '@app/features/calendar-view/components/use-open-event-composer',
  '@app/features/calendar-view/components/use-forward-event-email',
  '@app/features/calendar/hooks/create-guest-invite-controller',
  '@app/features/calendar/hooks/use-calendar-ui-flag',
  '@app/features/calendar-notes/calendar-meeting-notes',
  '@app/features/calendar-view/components/EventGuests',
  '@app/features/calendar-view/components/EventJoinRequests',
  '@app/features/calendar-team/components/team-event-details',
  '@app/features/calendar/views/event-replacement',
  '@app/features/calendar-view/copy-event-mention',
  '@app/features/calendar-view/download-event-ics',
  '@core/component/LexicalMarkdown/component/core/BlockLink',
  '@core/component/UserIcon',
  '@core/component/Toast/Toast',
  '@core/user/combinedRecipient',
  '@core/user',
  '../utils/calendar-description',
  '../../calendar/hooks/create-calendar-rsvp-controller',
];

/** Real event overlays and notes views, with sample data and preview services. */
export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    tailwind(),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: previewImports.map((find) => ({
      find,
      replacement: previewAdapters,
    })),
  },
  server: {
    host: '127.0.0.1',
    port: 3097,
    strictPort: true,
    fs: { allow: [workspaceDirectory] },
  },
});
