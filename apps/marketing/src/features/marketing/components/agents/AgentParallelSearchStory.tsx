import { createSignal, For, Show } from 'solid-js';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { ProductDemo } from '../product/ProductPage';
import { wallpapers } from '../TutorialWallpaper';
import { AgentSession } from './AgentSession';
import {
  AgentAnswer,
  type AgentMention,
  AgentPrompt,
  AgentToolGroup,
  AgentTurn,
  type SearchHit,
} from './AgentTranscript';
import './agent-parallel-search.css';

const searches: { query: string; hit: SearchHit }[] = [
  {
    query: 'Northwind checkout',
    hit: {
      kind: 'email',
      title: 'Checkout keeps timing out',
      sender: 'Sam',
      snippet: 'Customers on Safari can’t finish their orders.',
      time: 'Mon 9:41 AM',
    },
  },
  {
    query: 'Safari timeout',
    hit: {
      kind: 'channel',
      title: 'Engineering',
      sender: 'Julia',
      snippet: 'Reproduced on Safari. The retry drops the session cookie.',
      time: 'Mon 10:24 AM',
    },
  },
  {
    query: 'Retry design',
    hit: {
      kind: 'document',
      title: 'Checkout retry flow',
      snippet: 'Preserve the session cookie when retrying a payment.',
      time: 'Mon 2:00 PM',
    },
  },
  {
    query: 'Checkout fix',
    hit: {
      kind: 'task',
      title: 'Fix checkout timeout',
      sender: 'Priya',
      snippet: 'Completed. Safari regression tests pass.',
      time: 'Tue 2:10 PM',
    },
  },
  {
    query: 'Northwind call',
    hit: {
      kind: 'call',
      title: 'Northwind follow-up',
      snippet: 'Sam confirmed checkout works after the fix.',
      time: 'Wed 11:00 AM',
    },
  },
];

/** Local fixture: all searches start together; results arrive before synthesis. */
export function AgentParallelSearchStory() {
  const [phase, setPhase] = createSignal(0);
  const [source, setSource] = createSignal<SearchHit>();
  const [turns, setTurns] = createSignal<string[]>([]);
  let root!: HTMLDivElement;
  const finish = () => setPhase(2);
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 2,
    delay: (step) => (step === 1 ? 3200 : 1200),
    reset: () => {
      setPhase(0);
      setSource(undefined);
      setTurns([]);
    },
    advance: setPhase,
    reduced: finish,
    onTakeover: finish,
  });
  const openSource = (hit: SearchHit) => {
    setSource(hit);
    queueMicrotask(() =>
      root
        .querySelector('.agent-search-source')
        ?.scrollIntoView({ block: 'nearest' })
    );
  };
  const mentions: Record<string, AgentMention> = Object.fromEntries(
    searches.map(({ hit }) => [
      hit.kind,
      { kind: hit.kind, onOpen: () => openSource(hit) },
    ])
  );
  const calls = () =>
    searches.map(({ query, hit }) => ({
      kind: 'search' as const,
      query,
      scope: hit.kind,
      pending: phase() === 0,
      hits: phase() === 0 ? [] : [{ ...hit, onOpen: () => openSource(hit) }],
    }));
  return (
    <ProductDemo
      ref={(element) => {
        root = element;
      }}
      label="Search five workspace surfaces in parallel"
      height={620}
      mobileHeight={720}
      onInteract={playback.pause}
    >
      <div
        class="agent-parallel-search"
        data-search-phase={phase()}
        style={{
          '--search-email': wallpapers.mail.colors[1],
          '--search-channel': wallpapers.chat.colors[1],
          '--search-document': wallpapers.docs.colors[1],
          '--search-task': wallpapers.tasks.colors[1],
          '--search-call': wallpapers.calls.colors[1],
        }}
      >
        <AgentSession
          title="Northwind checkout"
          onSend={(text) => setTurns((all) => [...all, text])}
        >
          <AgentTurn>
            <AgentPrompt text="What caused Northwind’s checkout issue, and is it resolved?" />
          </AgentTurn>
          <AgentTurn>
            <div class="text-sm text-ink-extra-muted">
              5 parallel search tool calls
            </div>
            <AgentToolGroup
              calls={calls()}
              active={phase() === 0}
              defaultOpen
            />
            <Show when={phase() === 1}>
              <span class="magic-chip-shimmer text-sm">
                Combining results from all five surfaces…
              </span>
            </Show>
            <Show when={phase() === 2}>
              <AgentAnswer
                mentions={mentions}
                text="@[Sam’s email](agent:email) and @[Engineering](agent:channel) point to a session-cookie bug in the @[retry flow](agent:document). The @[fix](agent:task) is complete; the @[follow-up call](agent:call) confirms it works."
              />
            </Show>
            <Show when={source()}>
              {(hit) => (
                <aside
                  class="agent-search-source"
                  aria-label="Search source preview"
                  data-source-kind={hit().kind}
                >
                  <button type="button" onClick={() => setSource(undefined)}>
                    Close source
                  </button>
                  <strong>{hit().title}</strong>
                  <span>{hit().time}</span>
                  <p>{hit().snippet}</p>
                </aside>
              )}
            </Show>
          </AgentTurn>
          <For each={turns()}>
            {(text) => (
              <>
                <AgentTurn>
                  <AgentPrompt text={text} />
                </AgentTurn>
                <AgentTurn>
                  <AgentAnswer
                    mentions={{}}
                    text="This preview uses the Northwind example. Expand any of the five searches to inspect its result."
                  />
                </AgentTurn>
              </>
            )}
          </For>
        </AgentSession>
      </div>
    </ProductDemo>
  );
}
