import { useSearchParams } from '@solidjs/router';
import DummyWorkspace from '../../features/marketing/components/workspace/DummyWorkspace';
import palette from '../../styles/dark-theme.css?inline';
import uiStyles from '../../styles/site-ui.css?inline';
import { setPageSeo } from '../utils/utilSeo';
import '../../features/marketing/components/workspace-story.css';
import '../../features/setup/cream-preview.css';

// The signed-in app uses neutral dark surfaces; the marketing palette has a blue tint.
const workspacePalette = palette.replaceAll('0.002 250deg', '0 0deg');

const properties =
  uiStyles.match(/@property[^{}]*\{[^}]*\}/g)?.join('\n') ?? '';
const styles = uiStyles
  .replace(/@(font-face|property)[^{]*\{[^}]*\}/g, '')
  .replaceAll(':root', ':scope');

export default function RouteDemo() {
  const [params] = useSearchParams();
  setPageSeo({
    title: 'Macro — Sample workspace',
    description:
      'Explore Macro with an interactive sample workspace. All changes stay in this browser session.',
    path: '/demo',
    noindex: true,
  });
  return (
    <main
      class="dummy-route"
      data-theme-light={params.theme === 'cream' ? 'true' : 'false'}
      data-palette={params.theme === 'cream' ? 'cream' : undefined}
      data-embedded={params.embedded === 'true'}
    >
      <style>{properties}</style>
      <style>{`@scope (.dummy-route) { ${styles} ${workspacePalette.replaceAll(':root', ':scope')} }`}</style>
      <DummyWorkspace />
    </main>
  );
}
