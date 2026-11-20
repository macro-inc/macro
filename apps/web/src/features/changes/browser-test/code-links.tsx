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

const REPLY = [
  'I bumped `b` in `apps/web/src/a.ts:2` and added [the new helpers](/home/agent/macro/crates/x/src/lib.rs#L1-L2).',
  'The setup notes are in [docs/guide.md](docs/guide.md#L3); `b` itself is unchanged elsewhere.',
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
  const context = createMockChangesContext({
    summary: {
      capturing: false,
      changeset: mockChangeset({
        head: { name: 'agent/branch', sha: 'abc123' },
      }),
    },
    patch: MOCK_PATCH,
  });
  // The fixture has no browser to hand GitHub links to; it lists them.
  const [opened, setOpened] = createSignal<string[]>([]);
  context.host.openExternal = (url) => setOpened((list) => [...list, url]);
  const [layout, setLayout] = createSignal<PaneLayout>('closed');
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>('unified');
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
