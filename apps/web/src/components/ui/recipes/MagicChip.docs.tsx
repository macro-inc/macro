import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { Button } from '../components/Button';
import {
  MagicChipPreview,
  type MagicChipPreviewProps,
  type MagicChipPreviewStatus,
  MagicChipStatusBadge,
  MagicChipStatusIcon,
} from './MagicChipPreview';

type Example = {
  name: string;
  status: MagicChipPreviewStatus;
  body: string;
  pullRequest?: MagicChipPreviewProps['pullRequest'];
};

const EXAMPLES: Example[] = [
  {
    name: 'Tool running · secondary tool text stays hidden',
    status: {
      label: 'Running command',
      tone: 'tool',
      detail: 'bun run test --filter tablet-drawer',
    },
    body: 'I’m checking the tablet drawer behavior before pushing the fix.',
  },
  {
    name: 'Error explanation takes priority over a PR',
    status: {
      label: 'Failed',
      tone: 'failure',
      detail: 'The run stopped because the repository could not be reached.',
    },
    body: 'I’ll push the changes now.',
    pullRequest: { number: 6963, title: 'Fix drawer focus handling' },
  },
  {
    name: "Agent couldn't answer · last output is not a final result",
    status: {
      label: "Agent couldn't answer",
      tone: 'failure',
      detail: 'Cursor has not reported a result for this run, and has stopped.',
    },
    body: 'The diff looks right. Let me check on the stack build.',
  },
  {
    name: 'Response limit reached · runtime detail without output',
    status: {
      label: 'Response limit reached',
      tone: 'failure',
      detail:
        'The agent reached its response limit before producing an answer.',
    },
    body: '',
  },
  {
    name: 'Completed · PR replaces long output',
    status: { label: 'Done', tone: 'success' },
    body: 'Follow-up fixes completed and pushed: Fixed touch-tablet drawer opening and prefill remount persistence. Corrected permission/loading gates, empty smart results, spacing, and retry UI. Verified 95 email tests, TypeScript, quality checks, desktop, and iPad Air emulation.',
    pullRequest: {
      number: 6959,
      title: 'Add contextual suggested replies to email threads',
      additions: 248,
      deletions: 36,
    },
  },
  {
    name: 'Working · PR replaces streaming output',
    status: { label: 'Working', tone: 'active' },
    body: 'I found the drawer remount issue. I’m updating the focus handling and checking whether the reply survives navigation.',
    pullRequest: {
      number: 6961,
      title: 'Preserve reply state when reopening the tablet drawer',
      additions: 42,
      deletions: 0,
    },
  },
  {
    name: 'Needs input · no PR',
    status: { label: 'Needs input', tone: 'attention' },
    body: 'Should the suggested reply remain available after the message has been archived? I need this decision before finishing the change.',
  },
  {
    name: 'Completed · short output, no PR',
    status: { label: 'Done', tone: 'success' },
    body: 'All checks passed.',
  },
  {
    name: 'Failed · multiline output',
    status: { label: 'Failed', tone: 'failure' },
    body: 'The test command failed.\nThe browser could not connect to the preview server.\nNo changes were pushed. Retry once the server is available.',
  },
  {
    name: 'Queued · no output yet',
    status: { label: 'Queued', tone: 'neutral' },
    body: '',
  },
  {
    name: 'Stopped · long unbroken output',
    status: {
      label: 'Stopped',
      tone: 'stopped',
      detail: 'This run was stopped before it could finish.',
    },
    body: 'Stopped while inspecting src/features/email/suggested-replies/persistence/tablet-drawer-remount-regression-with-an-intentionally-long-filename.test.tsx',
  },
  {
    name: 'Working · PR available before output',
    status: { label: 'Working', tone: 'active' },
    body: '',
    pullRequest: { number: 6962, title: 'Improve loading and retry states' },
  },
];

// #region demo:statuses
function Statuses() {
  const statuses: MagicChipPreviewStatus[] = [
    { label: 'Queued', tone: 'neutral' },
    { label: 'Thinking', tone: 'active' },
    { label: 'Working', tone: 'active' },
    { label: 'Running command', tone: 'tool' },
    { label: 'Needs input', tone: 'attention' },
    { label: 'Done', tone: 'success' },
    { label: 'Stopped', tone: 'stopped' },
    { label: 'Failed', tone: 'failure' },
    { label: "Agent couldn't answer", tone: 'failure' },
    { label: 'Response limit reached', tone: 'failure' },
  ];
  return (
    <div
      class="flex flex-wrap items-center gap-3"
      aria-label="All status badges"
    >
      <div class="flex items-center gap-2">
        <MagicChipStatusIcon
          status={{ label: 'Working', tone: 'active' }}
          loading
        />
        <MagicChipStatusBadge
          status={{ label: 'Working', tone: 'active' }}
          loading
        />
      </div>
      <For each={statuses}>
        {(status) => (
          <div class="flex items-center gap-2">
            <MagicChipStatusIcon status={status} />
            <MagicChipStatusBadge status={status} />
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:playground
function Playground() {
  const [width, setWidth] = createSignal(824);
  const [loading, setLoading] = createSignal(false);
  const [selection, setSelection] = createSignal<{
    example: Example;
    action: string;
  }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));

  const simulateLoading = () => {
    clearTimeout(timer);
    setLoading(true);
    timer = setTimeout(() => setLoading(false), 1500);
  };

  return (
    <div class="flex min-w-0 flex-col gap-6">
      <div class="flex flex-wrap items-center gap-2">
        <For each={[824, 390]}>
          {(size) => (
            <Button
              size="sm"
              variant="outline"
              aria-pressed={width() === size}
              onClick={() => setWidth(size)}
            >
              {size === 824 ? 'Desktop · 824px' : 'Mobile · 390px'}
            </Button>
          )}
        </For>
        <Button size="sm" variant="outline" onClick={simulateLoading}>
          Simulate lazy load
        </Button>
      </div>
      <div
        class="flex max-w-full flex-col gap-5"
        style={{ width: `${width()}px` }}
      >
        <For each={EXAMPLES}>
          {(example) => (
            <section class="flex min-w-0 flex-col gap-2">
              <h3 class="text-xs font-medium text-ink-muted">{example.name}</h3>
              <MagicChipPreview
                agent="Cursor Agent"
                model="Sonnet 4.5"
                status={example.status}
                body={example.body}
                pullRequest={example.pullRequest}
                loading={loading()}
                onOpen={() =>
                  setSelection({ example, action: 'Session output' })
                }
                onPreview={() =>
                  setSelection({
                    example,
                    action: example.pullRequest
                      ? 'Pull request preview'
                      : 'Session details',
                  })
                }
              />
            </section>
          )}
        </For>
      </div>
      <Show when={selection()}>
        {(selected) => (
          <section
            class="flex flex-col gap-3 rounded-lg border border-edge-muted p-4"
            aria-label="Selected fixture"
          >
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">{selected().action}</h3>
              <Button size="sm" onClick={() => setSelection(undefined)}>
                Close preview
              </Button>
            </div>
            <p class="text-sm text-ink-muted">
              {selected().example.status.label}
              {selected().example.status.tone !== 'tool' &&
              selected().example.status.detail
                ? ` · ${selected().example.status.detail}`
                : ''}
            </p>
            <Show when={selected().example.pullRequest}>
              {(pr) => (
                <p class="text-sm">
                  #{pr().number} · {pr().title}
                </p>
              )}
            </Show>
            <p class="whitespace-pre-wrap break-words text-sm">
              {selected().example.body || 'Nothing written yet'}
            </p>
          </section>
        )}
      </Show>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Magic Chip',
  category: 'Data Display',
  description:
    'Shared two-row agent session card. Agent, model, and status above either a full-width PR preview or unchanged single-line output. Error explanations replace the lower preview; tool details remain hidden. Every state reserves 88px.',
  status: 'internal',
  propTypes: [],
  guidelines: {
    do: [
      'Reserve the same 88px for loading and loaded content.',
      'Below 600px, hide the model and the Open session text; retain the accessible action name.',
      'Keep the full agent output intact and truncate visually.',
      'Show error detail first; otherwise show a PR or the body, never both.',
      'Keep runtime status labels and explanations separate from agent-generated text.',
    ],
    dont: [
      'Derive a heading by semantically splitting the agent response.',
      'Let content or touch control sizing change the chip height.',
    ],
  },
  demos: [
    {
      id: 'statuses',
      title: 'All status badges',
      description:
        'Status icons lead the header in a 20px slot. Badge xs: 20px high with 12px text. Open session uses Button sm (24px); PR previews use sm with 8px padding (32px total height). Lazy loading uses a pulsing dot; Working and tool calls use a slower Morph.',
      render: Statuses,
      fill: true,
    },
    {
      id: 'playground',
      title: 'Statuses, output, and linked previews',
      description:
        'Switch widths or simulate loading. Open session and preview actions inspect local fixtures without accessing real sessions or pull requests.',
      render: Playground,
      fill: true,
    },
  ],
});
