import '@app/index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { render } from 'solid-js/web';
import { buildConfig } from '../../../builder/MarkdownConfigBuilder';
import { initializeLexical } from '../../../init';
import { ComposerEditor } from '../../ComposerEditor';

initializeLexical();

/**
 * A message composer (`MarkdownShell`) with padding around its text, so a tap
 * can land in the text or beside it.
 */
function Fixture() {
  document.documentElement.dataset.touchDevice = String(isTouchDevice());
  const composer = buildConfig('chat').namespace('caret-composer');
  return (
    <main class="p-6 bg-page text-ink max-w-2xl space-y-6">
      <h1 class="text-xl font-medium">Editor caret</h1>
      <section aria-label="Composer" class="border border-edge rounded">
        <ComposerEditor
          config={composer}
          placeholder="Composer"
          ariaLabel="Composer"
          autofocus={false}
          class="p-4"
        />
      </section>
    </main>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
