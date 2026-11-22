import '@fontsource-variable/inter';
import '../../../index.css';
import { For } from 'solid-js';
import { render } from 'solid-js/web';
import { ImportPlanRow } from '../../agent-reviews/components/import-plan-row';
import type { ImportPlanNode } from '../../agent-reviews/core/import-plan';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { themeCssVars } from '../../theme/utils/themeCssVars';

// This agent-reviews fixture shares the existing database browser CI harness;
// it renders the production row without starting an app stack or backend.
const node: ImportPlanNode = {
  id: 'plan',
  parentId: null,
  kind: 'database',
  title: 'Engineering Handbook plan',
  decision: 'copy',
  reason: null,
  rows: 128,
  sampleTitles: [],
  taskFields: null,
  status: 'staged',
  error: null,
  shared: false,
  sharedReason: null,
  shareable: true,
  alreadyImported: null,
  depth: 1,
  childIds: ['child'],
  inlineOn: ['Project notes'],
};
for (const [key, token] of Object.entries(themeCssVars(macroLightTheme)))
  document.documentElement.style.setProperty(key, token);
document.documentElement.dataset.touchDevice = String(
  matchMedia('(pointer: coarse)').matches
);
const root = document.getElementById('root');
if (!root) throw new Error('Import row fixture root missing');
render(
  () => (
    <main class="mx-auto flex max-w-3xl flex-col gap-6 bg-panel p-4 text-ink">
      <For each={['Thread card', 'Full review sheet']}>
        {(label) => (
          <section aria-label={label} class="min-w-0 border border-edge p-3">
            <ul aria-label="Import plan">
              <ImportPlanRow
                node={node}
                collapsed
                showingRows={false}
                excluded={false}
                shared={false}
                choosing
                disabled={false}
                showStatus={false}
                onToggleExpanded={() => {}}
                onToggleRows={() => {}}
                onIncludedChange={() => {}}
                onSharedChange={() => {}}
              />
            </ul>
          </section>
        )}
      </For>
    </main>
  ),
  root
);
