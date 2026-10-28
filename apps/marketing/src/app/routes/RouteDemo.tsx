import { useSearchParams } from '@solidjs/router';
import { lazy, Show, Suspense } from 'solid-js';
import { DemoInteractionScope } from '../../features/marketing/components/DemoInteractionBoundary';
import DummyWorkspace from '../../features/marketing/components/workspace/DummyWorkspace';
import palette from '../../styles/dark-theme.css?inline';
import uiStyles from '../../styles/site-ui.css?inline';
import { setPageSeo } from '../utils/utilSeo';
import '../../features/marketing/components/workspace-story.css';
import '../../features/setup/cream-preview.css';
import { createSitePalette } from '../../features/setup/sitePalette';

// The signed-in app uses neutral dark surfaces; the marketing palette has a blue tint.
const workspacePalette = palette.replaceAll('0.002 250deg', '0 0deg');

const properties =
  uiStyles.match(/@property[^{}]*\{[^}]*\}/g)?.join('\n') ?? '';
const styles = uiStyles
  .replace(/@(font-face|property)[^{]*\{[^}]*\}/g, '')
  .replaceAll(':root', ':scope');

const HomepageScene = lazy(
  () => import('../../features/marketing/components/homepage/HomepageScene')
);

export default function RouteDemo() {
  const [params] = useSearchParams();
  const palette = createSitePalette();
  setPageSeo({
    title: 'Macro — Sample workspace',
    description:
      'Explore Macro with an interactive sample workspace. All changes stay in this browser session.',
    path: '/demo',
    noindex: true,
  });
  return (
    <DemoInteractionScope>
      <main
        class="dummy-route"
        data-theme-light={palette() === 'cream' ? 'true' : 'false'}
        data-palette={palette() === 'cream' ? 'cream' : undefined}
        data-embedded={params.embedded === 'true'}
      >
        <style>{properties}</style>
        <style>{`@scope (.dummy-route) { ${styles} ${workspacePalette.replaceAll(':root', ':scope')} }`}</style>
        <Show
          when={params.scene === 'homepage'}
          fallback={
            <DummyWorkspace
              initialView={
                typeof params.document === 'string' ? 'documents' : undefined
              }
              initialDocument={
                typeof params.document === 'string'
                  ? params.document
                  : undefined
              }
            />
          }
        >
          <Suspense
            fallback={
              <div class="email-desktop-loading">Opening your workspace…</div>
            }
          >
            <HomepageScene
              initialView={
                typeof params.view === 'string' ? params.view : undefined
              }
            />
          </Suspense>
        </Show>
      </main>
    </DemoInteractionScope>
  );
}
