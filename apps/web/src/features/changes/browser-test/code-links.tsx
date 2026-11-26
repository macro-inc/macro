import '@app/index.css';
import { Message } from '@app/features/block-agent/component/AgentMessage';
import { ChangesProvider, ChangesSplit } from '@app/features/changes/changes';
import type { DiffStyle, PaneLayout } from '@app/features/changes/core/layout';
import {
  createMockChangesContext,
  MOCK_PATCH,
  mockChangeset,
} from '@app/features/changes/tests/mock-context';
import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';

// A file whose new lines sit far from the old ones with the same numbers:
// 60 lines added above three that were there.
const LONG_ADDED = Array.from(
  { length: 60 },
  (_, i) => `export const row${i + 1} = ${i + 1};`
);
const LONG_PATCH = [
  'diff --git a/apps/web/src/long.ts b/apps/web/src/long.ts',
  'index 4444444..5555555 100644',
  '--- a/apps/web/src/long.ts',
  '+++ b/apps/web/src/long.ts',
  '@@ -1,3 +1,63 @@',
  ...LONG_ADDED.map((line) => `+${line}`),
  ' const tail1 = 1;',
  ' const tail2 = 2;',
  ' const tail3 = 3;',
  '',
].join('\n');

const REPLY = [
  'I bumped `b` in `apps/web/src/a.ts:2` and added [the new helpers](file:///home/agent/macro/crates/x/src/lib.rs#L1-L2).',
  'The setup notes are in [docs/guide.md](docs/guide.md#L3); `b` itself is unchanged elsewhere.',
  'The generated rows start at `apps/web/src/long.ts:2`.',
].join('\n\n');

const reply: FoldedMessage = {
  agentSessionId: 'session-1',
  key: '0:agent',
  requestId: null,
  pending: false,
  postedAt: null,
  segments: [
    { index: 0, kind: 'activity', start: 0, end: 1, sealed: true, rows: [] },
  ],
  phase: null,
  turn: 0,
  author: { kind: 'agent' },
  parts: [{ kind: 'text', text: REPLY }],
  stop: { kind: 'end_turn' },
};

function Fixture() {
  const changeset = mockChangeset({
    head: { name: 'agent/branch', sha: 'abc123' },
  });
  const style = new URLSearchParams(location.search).get('style');
  const context = createMockChangesContext({
    summary: {
      capturing: false,
      changeset: {
        ...changeset,
        files: [
          ...changeset.files,
          {
            path: 'apps/web/src/long.ts',
            kind: 'modified',
            additions: 60,
            deletions: 0,
            binary: false,
            patchOmitted: false,
          },
        ],
        additions: changeset.additions + 60,
      },
    },
    patch: MOCK_PATCH + LONG_PATCH,
  });
  // The fixture has no browser to hand GitHub links to; it lists them.
  const [opened, setOpened] = createSignal<string[]>([]);
  context.host.openExternal = (url) => setOpened((list) => [...list, url]);
  const [layout, setLayout] = createSignal<PaneLayout>('closed');
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>(
    style === 'split' ? 'split' : 'unified'
  );
  return (
    <main class="h-dvh max-w-full bg-page text-ink">
      <ChangesProvider
        context={context}
        view={{ layout, setLayout, diffStyle, setDiffStyle }}
        storage={sessionStorage}
      >
        <ChangesSplit hostMinWidth={480}>
          <section aria-label="Agent session" class="size-full p-6">
            <Message message={reply} inFlight={false} />
            <ul aria-label="Opened outside" class="mt-6 text-sm text-ink-muted">
              <For each={opened()}>{(url) => <li>{url}</li>}</For>
            </ul>
          </section>
        </ChangesSplit>
      </ChangesProvider>
    </main>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
