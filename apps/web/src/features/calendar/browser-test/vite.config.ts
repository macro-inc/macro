import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';
import { shellStubs } from './stub-plugin';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const workspaceDirectory = fileURLToPath(
  new URL('../../../../../../', import.meta.url)
);
const source = (path: string) => `${webDirectory}src/${path}`;
const stub = (name: string) => `${directory}stubs/${name}`;

// The app's shell, replaced by its real file path so relative imports of
// these modules are caught too: the account, feature flags, the query
// client's persistence, and the contexts a mounted calendar provides.
const STUBS: Record<string, string> = {
  [source('components/app/split-layout/split-router/mention-links.ts')]:
    stub('mention-links.ts'),
  [source('lib/queries/client.ts')]: stub('query-client.ts'),
  [source('lib/core/context/user.ts')]: stub('user-context.ts'),
  [source('lib/core/user/index.ts')]: stub('user.ts'),
  [source('lib/core/component/UserIcon.tsx')]: stub('user-icon.tsx'),
  [source('lib/analytics/posthog.tsx')]: stub('posthog.tsx'),
  [source('components/view-shell/index.ts')]: stub('view-shell.tsx'),
  [source('features/calendar/components/CalendarPagerContext.tsx')]: stub(
    'calendar-contexts.ts'
  ),
  [source('features/calendar/components/CalendarViewContext.tsx')]: stub(
    'calendar-contexts.ts'
  ),
  [source('features/calendar-view/calendar-focus-target.ts')]: stub(
    'calendar-contexts.ts'
  ),
};

// Sidebar sections these pages never mount: each export renders nothing.
const EMPTY_COMPONENTS: Record<string, string[]> = {
  // The composer's rich description editor and its people search.
  [source(
    'lib/core/component/LexicalMarkdown/component/core/MarkdownTextarea.tsx'
  )]: ['MarkdownTextarea'],
  [source('features/property/editors/selectors/PropertyEntitySelector.tsx')]: [
    'PropertyEntitySelector',
  ],
  [source('features/calendar/availability/CopyAvailabilityButton.tsx')]: [
    'CopyAvailabilityButton',
  ],
  [source('features/calendar/components/CalendarSettingsDropdown.tsx')]: [
    'CalendarSettingsDropdown',
  ],
  [source('features/calendar/components/SourceControls.tsx')]: [
    'SourceControls',
  ],
  [source('features/routine-suggestions/routine-suggestions.tsx')]: [
    'SidebarRoutineSuggestions',
  ],
  [source('features/scheduling/calendar-actions.tsx')]: [
    'CalendarSchedulingActions',
  ],
  [source('features/video-tutorials/index.ts')]: ['TutorialSidebarItem'],
  [source('features/calendar-view/calendar-call-sidebar.tsx')]: [
    'CalendarCallSidebar',
  ],
  [source('features/calendar-view/components/CalendarCreateItems.tsx')]: [
    'CalendarCreateBookingLinkItem',
    'CalendarCreateCallItem',
    'CalendarCreateEventItem',
  ],
  [source('features/calendar-view/components/CalendarCreateMenu.tsx')]: [
    'CalendarCreateMenu',
  ],
  [source('features/calendar-view/components/CalendarSearch.tsx')]: [
    'CalendarSearch',
  ],
  [source('features/calendar-view/components/ConnectCalendarsPromotion.tsx')]: [
    'ConnectCalendarsPromotion',
  ],
};

/**
 * Real calendar components over the real calendar queries and service
 * clients. The app addresses its services at their hosted gateway, as a
 * development build does; Playwright answers those routes and refuses the rest.
 */
export default defineConfig({
  root: directory,
  cacheDir: `${directory}.vite`,
  plugins: [
    shellStubs({
      stubDirectory: `${directory}stubs/`,
      stubs: STUBS,
      emptyComponents: EMPTY_COMPONENTS,
    }),
    tailwindcss(),
    wasm(),
    solid(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}tsconfig.json`] }),
  ],
  resolve: { dedupe: ['solid-js'] },
  // Every page is scanned at startup: a dependency found only once a page
  // loads makes Vite answer 504 and reload over a socket these tests do not open.
  optimizeDeps: {
    entries: ['team-ooo.html', 'composer.html', 'grid.html'],
    esbuildOptions: { target: 'esnext' },
  },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    fs: { allow: [workspaceDirectory] },
  },
});
