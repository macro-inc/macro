import '@app/index.css';
import { ChangesProvider, ChangesSplit } from '@app/features/changes/changes';
import type { DiffStyle, PaneLayout } from '@app/features/changes/core/layout';
import {
  createMockChangesContext,
  MOCK_PATCH,
  mockChangeset,
} from '@app/features/changes/tests/mock-context';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { PR_HOST_MIN_WIDTH } from '../util/pr-layout';

function Fixture() {
  document.documentElement.dataset.touchDevice = String(isTouchDevice());
  const params = new URLSearchParams(location.search);
  const width = Number(params.get('width') ?? window.innerWidth);
  const context = createMockChangesContext({
    summary: { capturing: false, changeset: mockChangeset() },
    patch: MOCK_PATCH,
  });
  const [layout, setLayout] = createSignal<PaneLayout>('split');
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>('split');
  return (
    <main
      class="h-dvh max-w-full bg-page text-ink"
      style={{ width: `${width}px` }}
    >
      <ChangesProvider
        context={context}
        view={{ layout, setLayout, diffStyle, setDiffStyle }}
        storage={sessionStorage}
      >
        <ChangesSplit hostMinWidth={PR_HOST_MIN_WIDTH}>
          <section aria-label="Pull request" class="size-full p-6">
            Pull request description
          </section>
        </ChangesSplit>
      </ChangesProvider>
    </main>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
