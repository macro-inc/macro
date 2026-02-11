import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  type JSX,
} from 'solid-js';
import { useQuickAccess } from '../QuickAccessProvider';
import {
  type Bucket,
  type QuickAccessItem,
  ALL_BUCKETS,
  getItemSearchText,
  getItemTimestamps,
  isChannelItem,
} from '../types';
import {
  createFreshSearch,
  type FreshSortResult,
  type FreshSortConfig,
} from '@core/util/freshSort';

type TimingResult = {
  operation: string;
  durationMs: number;
  itemCount: number;
  timestamp: number;
};

function useTimingLog() {
  const [timings, setTimings] = createSignal<TimingResult[]>([]);

  const logTiming = (
    operation: string,
    durationMs: number,
    itemCount: number
  ) => {
    setTimings((prev) => [
      { operation, durationMs, itemCount, timestamp: Date.now() },
      ...prev.slice(0, 49), // Keep last 50 timings
    ]);
  };

  const clearTimings = () => setTimings([]);

  return { timings, logTiming, clearTimings };
}

function measureTime<T>(fn: () => T): { result: T; durationMs: number } {
  const start = performance.now();
  const result = fn();
  const end = performance.now();
  return { result, durationMs: end - start };
}

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <div class="bg-menu rounded-lg border border-edge p-4">
      <h3 class="text-sm font-semibold text-ink mb-3 uppercase tracking-wide">
        {props.title}
      </h3>
      {props.children}
    </div>
  );
}

function TimingBadge(props: { ms: number }) {
  const colorClass = () => {
    if (props.ms < 1) return 'bg-green-500/20 text-green-400';
    if (props.ms < 5) return 'bg-yellow-500/20 text-yellow-400';
    return 'bg-red-500/20 text-red-400';
  };

  return (
    <span class={`text-xs font-mono px-2 py-0.5 rounded ${colorClass()}`}>
      {props.ms.toFixed(3)}ms
    </span>
  );
}

function Button(props: {
  onClick: () => void;
  children: JSX.Element;
  variant?: 'primary' | 'secondary';
}) {
  const baseClass = 'px-3 py-1.5 rounded text-sm font-medium transition-colors';
  const variantClass =
    props.variant === 'primary'
      ? 'bg-accent text-black hover:bg-accent/80'
      : 'bg-menu-hover text-ink hover:bg-edge';

  return (
    <button class={`${baseClass} ${variantClass}`} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

function BucketOverview() {
  const quickAccess = useQuickAccess();

  const bucketCounts = createMemo(() => {
    const counts: Record<Bucket, number> = {} as Record<Bucket, number>;
    for (const bucket of ALL_BUCKETS) {
      const list = quickAccess.useList(bucket);
      counts[bucket] = list().length;
    }
    return counts;
  });

  const totalItems = createMemo(() => {
    return Object.values(bucketCounts()).reduce((sum, count) => sum + count, 0);
  });

  return (
    <Section title="Bucket Overview">
      <div class="grid grid-cols-5 gap-2 mb-4">
        <For each={ALL_BUCKETS}>
          {(bucket) => (
            <div class="bg-menu-hover rounded p-2 text-center">
              <div class="text-xs text-ink-muted mb-1">{bucket}</div>
              <div class="text-lg font-mono font-bold text-ink">
                {bucketCounts()[bucket]}
              </div>
            </div>
          )}
        </For>
      </div>
      <div class="text-xs text-ink-muted">
        Total: <span class="font-mono font-bold text-ink">{totalItems()}</span>{' '}
        items
      </div>
    </Section>
  );
}

function UseListTimingTests() {
  const quickAccess = useQuickAccess();
  const { timings, logTiming, clearTimings } = useTimingLog();

  const testOperations: Array<{
    name: string;
    buckets: Bucket[];
    complexity: string;
  }> = [
    { name: 'useList() - all', buckets: [], complexity: 'O(1)' },
    { name: 'useList(channel)', buckets: ['channel'], complexity: 'O(1)' },
    { name: 'useList(dm)', buckets: ['dm'], complexity: 'O(1)' },
    { name: 'useList(person)', buckets: ['person'], complexity: 'O(1)' },
    { name: 'useList(document)', buckets: ['document'], complexity: 'O(1)' },
    {
      name: 'useList(dm, channel) [pre-baked]',
      buckets: ['dm', 'channel'],
      complexity: 'O(1)',
    },
    {
      name: 'useList(document, note, task, chat, project) [pre-baked]',
      buckets: ['document', 'note', 'task', 'chat', 'project'],
      complexity: 'O(1)',
    },
    {
      name: 'useList(dm, channel, person) [pre-baked]',
      buckets: ['dm', 'channel', 'person'],
      complexity: 'O(1)',
    },
    {
      name: 'useList(channel, person) [merge]',
      buckets: ['channel', 'person'],
      complexity: 'O(n+m)',
    },
    {
      name: 'useList(dm, document, email) [merge]',
      buckets: ['dm', 'document', 'email'],
      complexity: 'O(n+m+o)',
    },
  ];

  const runTest = (op: (typeof testOperations)[0]) => {
    const { result, durationMs } = measureTime(() => {
      const list = quickAccess.useList(...op.buckets);
      return list();
    });
    logTiming(op.name, durationMs, result.length);
  };

  const runAllTests = () => {
    for (const op of testOperations) {
      runTest(op);
    }
  };

  const runTestMultipleTimes = (
    op: (typeof testOperations)[0],
    times: number
  ) => {
    for (let i = 0; i < times; i++) {
      runTest(op);
    }
  };

  return (
    <Section title="useList() Timing Tests">
      <div class="space-y-4">
        <div class="flex gap-2 flex-wrap">
          <Button variant="primary" onClick={runAllTests}>
            Run All Tests
          </Button>
          <Button onClick={clearTimings}>Clear Log</Button>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <For each={testOperations}>
            {(op) => (
              <button
                class="flex items-center justify-between p-2 bg-menu-hover rounded text-left hover:bg-edge transition-colors group"
                onClick={() => runTest(op)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  runTestMultipleTimes(op, 10);
                }}
              >
                <div class="flex-1 min-w-0">
                  <div class="text-xs text-ink truncate">{op.name}</div>
                  <div class="text-[10px] text-ink-muted font-mono">
                    {op.complexity}
                  </div>
                </div>
                <span class="text-[10px] text-ink-extra-muted opacity-0 group-hover:opacity-100">
                  click to run
                </span>
              </button>
            )}
          </For>
        </div>

        <Show when={timings().length > 0}>
          <div class="border-t border-edge pt-4">
            <div class="text-xs text-ink-muted mb-2">
              Recent timings (newest first):
            </div>
            <div class="max-h-48 overflow-y-auto space-y-1">
              <For each={timings()}>
                {(timing) => (
                  <div class="flex items-center justify-between text-xs bg-menu-hover rounded px-2 py-1">
                    <span class="text-ink truncate flex-1">
                      {timing.operation}
                    </span>
                    <div class="flex items-center gap-2 shrink-0">
                      <span class="text-ink-muted font-mono">
                        {timing.itemCount} items
                      </span>
                      <TimingBadge ms={timing.durationMs} />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </Section>
  );
}

function FreshSearchDemo() {
  const quickAccess = useQuickAccess();
  const { timings, logTiming, clearTimings } = useTimingLog();

  const [query, setQuery] = createSignal('');
  const [selectedBuckets, setSelectedBuckets] = createSignal<Bucket[]>([
    'channel',
    'dm',
    'person',
  ]);
  const [results, setResults] = createSignal<
    FreshSortResult<QuickAccessItem>[]
  >([]);

  // Config state
  const [fuzzyWeight, setFuzzyWeight] = createSignal(0.7);
  const [timeWeight, setTimeWeight] = createSignal(0.3);
  const [brevityWeight, setBrevityWeight] = createSignal(0.0);
  const [channelBoost, setChannelBoost] = createSignal(1.0);

  const toggleBucket = (bucket: Bucket) => {
    setSelectedBuckets((prev) =>
      prev.includes(bucket)
        ? prev.filter((b) => b !== bucket)
        : [...prev, bucket]
    );
  };

  const runSearch = () => {
    const q = query();
    if (!q.trim()) {
      setResults([]);
      return;
    }

    const config: FreshSortConfig<QuickAccessItem> = {
      fuzzyWeight: fuzzyWeight(),
      timeWeight: timeWeight(),
      brevityWeight: brevityWeight(),
      channelBoost: channelBoost(),
    };

    const freshSearch = createFreshSearch<QuickAccessItem>(
      config,
      getItemSearchText,
      isChannelItem,
      getItemTimestamps
    );

    const { result, durationMs } = measureTime(() => {
      const items = quickAccess.useList(...selectedBuckets())();
      return freshSearch(items, q);
    });

    setResults(result.slice(0, 20)); // Show top 20
    logTiming(`freshSearch("${q}")`, durationMs, result.length);
  };

  // Auto-search on query change
  createEffect(() => {
    const q = query();
    if (q.length >= 1) {
      runSearch();
    } else {
      setResults([]);
    }
  });

  return (
    <Section title="Fresh Search Demo">
      <div class="space-y-4">
        {/* Search Input */}
        <div class="flex gap-2">
          <input
            type="text"
            placeholder="Type to search..."
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            class="flex-1 px-3 py-2 bg-menu-hover border border-edge rounded text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent"
          />
          <Button onClick={runSearch}>Search</Button>
        </div>

        {/* Bucket Selection */}
        <div class="flex flex-wrap gap-1">
          <For each={ALL_BUCKETS.filter((b) => b !== 'command')}>
            {(bucket) => (
              <button
                class={`px-2 py-1 text-xs rounded transition-colors ${
                  selectedBuckets().includes(bucket)
                    ? 'bg-accent text-black'
                    : 'bg-menu-hover text-ink-muted hover:text-ink'
                }`}
                onClick={() => toggleBucket(bucket)}
              >
                {bucket}
              </button>
            )}
          </For>
        </div>

        {/* Config Sliders */}
        <details class="group">
          <summary class="text-xs text-ink-muted cursor-pointer hover:text-accent">
            Search Config
          </summary>
          <div class="mt-2 grid grid-cols-2 gap-3 p-3 bg-menu-hover rounded">
            <div>
              <label class="text-xs text-ink-muted block mb-1">
                Fuzzy Weight: {fuzzyWeight().toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={fuzzyWeight()}
                onInput={(e) =>
                  setFuzzyWeight(parseFloat(e.currentTarget.value))
                }
                class="w-full"
              />
            </div>
            <div>
              <label class="text-xs text-ink-muted block mb-1">
                Time Weight: {timeWeight().toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={timeWeight()}
                onInput={(e) =>
                  setTimeWeight(parseFloat(e.currentTarget.value))
                }
                class="w-full"
              />
            </div>
            <div>
              <label class="text-xs text-ink-muted block mb-1">
                Brevity Weight: {brevityWeight().toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={brevityWeight()}
                onInput={(e) =>
                  setBrevityWeight(parseFloat(e.currentTarget.value))
                }
                class="w-full"
              />
            </div>
            <div>
              <label class="text-xs text-ink-muted block mb-1">
                Channel Boost: {channelBoost().toFixed(2)}
              </label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={channelBoost()}
                onInput={(e) =>
                  setChannelBoost(parseFloat(e.currentTarget.value))
                }
                class="w-full"
              />
            </div>
          </div>
        </details>

        {/* Search Results */}
        <Show when={results().length > 0}>
          <div class="border-t border-edge pt-4">
            <div class="text-xs text-ink-muted mb-2">
              Results ({results().length}):
            </div>
            <div class="max-h-64 overflow-y-auto space-y-1">
              <For each={results()}>
                {(result, idx) => (
                  <div class="flex items-center gap-2 text-xs bg-menu-hover rounded px-2 py-1.5">
                    <span class="text-ink-muted font-mono w-5">
                      {idx() + 1}.
                    </span>
                    <span
                      class={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        result.item.kind === 'entity'
                          ? 'bg-blue-500/20 text-blue-400'
                          : result.item.kind === 'user'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-purple-500/20 text-purple-400'
                      }`}
                    >
                      {result.item.bucket}
                    </span>
                    <span class="text-ink flex-1 truncate">
                      {result.item.searchText}
                    </span>
                    <div class="flex items-center gap-1 text-[10px] text-ink-muted font-mono shrink-0">
                      <span title="Combined Score">
                        {result.combinedScore.toFixed(3)}
                      </span>
                      <span class="text-ink-extra-muted">|</span>
                      <span title="Fuzzy Score" class="text-blue-400">
                        f:{result.fuzzyScore.toFixed(2)}
                      </span>
                      <span title="Time Score" class="text-green-400">
                        t:{result.timeScore.toFixed(2)}
                      </span>
                      <span title="Brevity Score" class="text-yellow-400">
                        b:{result.brevityScore.toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Timing Log */}
        <Show when={timings().length > 0}>
          <div class="border-t border-edge pt-4">
            <div class="flex items-center justify-between mb-2">
              <div class="text-xs text-ink-muted">Search Timings:</div>
              <button
                class="text-[10px] text-ink-muted hover:text-accent"
                onClick={clearTimings}
              >
                Clear
              </button>
            </div>
            <div class="max-h-32 overflow-y-auto space-y-1">
              <For each={timings()}>
                {(timing) => (
                  <div class="flex items-center justify-between text-xs bg-menu-hover rounded px-2 py-1">
                    <span class="text-ink truncate flex-1">
                      {timing.operation}
                    </span>
                    <div class="flex items-center gap-2 shrink-0">
                      <span class="text-ink-muted font-mono">
                        {timing.itemCount} matches
                      </span>
                      <TimingBadge ms={timing.durationMs} />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </Section>
  );
}

function ItemInspector() {
  const quickAccess = useQuickAccess();
  const [selectedBucket, setSelectedBucket] = createSignal<Bucket>('channel');
  const [selectedItem, setSelectedItem] = createSignal<QuickAccessItem | null>(
    null
  );

  const items = createMemo(() => {
    return quickAccess.useList(selectedBucket())().slice(0, 50);
  });

  return (
    <Section title="Item Inspector">
      <div class="space-y-4">
        {/* Bucket Selector */}
        <div class="flex flex-wrap gap-1">
          <For each={ALL_BUCKETS}>
            {(bucket) => (
              <button
                class={`px-2 py-1 text-xs rounded transition-colors ${
                  selectedBucket() === bucket
                    ? 'bg-accent text-black'
                    : 'bg-menu-hover text-ink-muted hover:text-ink'
                }`}
                onClick={() => {
                  setSelectedBucket(bucket);
                  setSelectedItem(null);
                }}
              >
                {bucket}
              </button>
            )}
          </For>
        </div>

        <div class="grid grid-cols-2 gap-4">
          {/* Item List */}
          <div class="max-h-64 overflow-y-auto space-y-1">
            <For each={items()}>
              {(item) => (
                <button
                  class={`w-full text-left px-2 py-1 text-xs rounded transition-colors ${
                    selectedItem()?.id === item.id
                      ? 'bg-accent text-black'
                      : 'bg-menu-hover text-ink hover:bg-edge'
                  }`}
                  onClick={() => setSelectedItem(item)}
                >
                  <div class="truncate">{item.searchText || '(no name)'}</div>
                  <div class="text-[10px] opacity-70 font-mono truncate">
                    {item.id}
                  </div>
                </button>
              )}
            </For>
            <Show when={items().length === 0}>
              <div class="text-xs text-ink-muted italic p-2">
                No items in this bucket
              </div>
            </Show>
          </div>

          {/* Item Details */}
          <div class="bg-menu-hover rounded p-3 max-h-64 overflow-y-auto">
            <Show
              when={selectedItem()}
              fallback={
                <div class="text-xs text-ink-muted italic">
                  Select an item to inspect
                </div>
              }
            >
              {(item) => (
                <div class="space-y-2 text-xs">
                  <div>
                    <span class="text-ink-muted">ID:</span>
                    <span class="font-mono text-ink ml-1">{item().id}</span>
                  </div>
                  <div>
                    <span class="text-ink-muted">Kind:</span>
                    <span class="text-ink ml-1">{item().kind}</span>
                  </div>
                  <div>
                    <span class="text-ink-muted">Bucket:</span>
                    <span class="text-ink ml-1">{item().bucket}</span>
                  </div>
                  <div>
                    <span class="text-ink-muted">Search Text:</span>
                    <span class="text-ink ml-1">{item().searchText}</span>
                  </div>
                  <div>
                    <span class="text-ink-muted">Sort Timestamp:</span>
                    <span class="font-mono text-ink ml-1">
                      {item().sortTimestamp}
                    </span>
                  </div>
                  <div>
                    <span class="text-ink-muted">Timestamps:</span>
                    <pre class="font-mono text-[10px] text-ink mt-1 bg-menu p-2 rounded overflow-auto">
                      {JSON.stringify(item().timestamps, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <span class="text-ink-muted">Data:</span>
                    <pre class="font-mono text-[10px] text-ink mt-1 bg-menu p-2 rounded overflow-auto max-h-32">
                      {JSON.stringify(item().data, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </Show>
          </div>
        </div>
      </div>
    </Section>
  );
}

function MergeBenchmark() {
  const quickAccess = useQuickAccess();
  const { timings, logTiming, clearTimings } = useTimingLog();

  const runMergeBenchmark = (iterations: number) => {
    const buckets: Bucket[] = ['channel', 'dm', 'person', 'document'];

    for (let i = 0; i < iterations; i++) {
      const { result, durationMs } = measureTime(() => {
        return quickAccess.useList(...buckets)();
      });
      logTiming(
        `merge ${buckets.join('+')} (#${i + 1})`,
        durationMs,
        result.length
      );
    }
  };

  const runPreBakedBenchmark = (iterations: number) => {
    // Test pre-baked combinations
    for (let i = 0; i < iterations; i++) {
      const { result: all, durationMs: allMs } = measureTime(() => {
        return quickAccess.useList()();
      });
      logTiming(`useList() all (#${i + 1})`, allMs, all.length);

      const { result: channels, durationMs: channelsMs } = measureTime(() => {
        return quickAccess.useList('dm', 'channel')();
      });
      logTiming(`useList(dm,channel) (#${i + 1})`, channelsMs, channels.length);

      const { result: messaging, durationMs: messagingMs } = measureTime(() => {
        return quickAccess.useList('dm', 'channel', 'person')();
      });
      logTiming(
        `useList(dm,channel,person) (#${i + 1})`,
        messagingMs,
        messaging.length
      );
    }
  };

  return (
    <Section title="Merge Benchmark">
      <div class="space-y-4">
        <div class="flex gap-2 flex-wrap">
          <Button onClick={() => runMergeBenchmark(10)}>
            Run Custom Merge x10
          </Button>
          <Button onClick={() => runPreBakedBenchmark(10)}>
            Run Pre-baked x10
          </Button>
          <Button onClick={clearTimings}>Clear</Button>
        </div>

        <Show when={timings().length > 0}>
          <div class="border-t border-edge pt-4">
            <div class="text-xs text-ink-muted mb-2">Benchmark Results:</div>
            <div class="max-h-48 overflow-y-auto space-y-1">
              <For each={timings()}>
                {(timing) => (
                  <div class="flex items-center justify-between text-xs bg-menu-hover rounded px-2 py-1">
                    <span class="text-ink truncate flex-1">
                      {timing.operation}
                    </span>
                    <div class="flex items-center gap-2 shrink-0">
                      <span class="text-ink-muted font-mono">
                        {timing.itemCount} items
                      </span>
                      <TimingBadge ms={timing.durationMs} />
                    </div>
                  </div>
                )}
              </For>
            </div>
            <Show when={timings().length > 0}>
              <div class="mt-2 text-xs text-ink-muted">
                Avg:{' '}
                <span class="font-mono text-ink">
                  {(
                    timings().reduce((sum, t) => sum + t.durationMs, 0) /
                    timings().length
                  ).toFixed(3)}
                  ms
                </span>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </Section>
  );
}

export default function QuickAccessDemo() {
  const quickAccess = useQuickAccess();

  return (
    <div class="flex flex-col h-full w-full">
      <SplitHeaderLeft>
        <StaticSplitLabel label="QuickAccess API Demo" />
      </SplitHeaderLeft>

      <div class="flex-1 overflow-y-auto p-4">
        <div class="max-w-6xl mx-auto space-y-4">
          {/* Status Bar */}
          <div class="flex items-center justify-between bg-menu rounded-lg border border-edge px-4 py-2">
            <div class="flex items-center gap-4">
              <div class="text-sm text-ink">
                Status:{' '}
                <span
                  class={`font-medium ${quickAccess.isLoading() ? 'text-yellow-400' : 'text-green-400'}`}
                >
                  {quickAccess.isLoading() ? 'Loading...' : 'Ready'}
                </span>
              </div>
            </div>
            <Button onClick={() => quickAccess.refresh()}>Refresh Data</Button>
          </div>

          {/* Main Grid */}
          <div class="grid grid-cols-2 gap-4">
            <BucketOverview />
            <UseListTimingTests />
          </div>

          <FreshSearchDemo />

          <div class="grid grid-cols-2 gap-4">
            <ItemInspector />
            <MergeBenchmark />
          </div>

          {/* API Reference */}
          <Section title="API Reference">
            <div class="text-xs text-ink-muted space-y-2">
              <div>
                <span class="font-mono text-accent">useList()</span> - Returns
                all items (O(1))
              </div>
              <div>
                <span class="font-mono text-accent">useList(bucket)</span> -
                Returns items from a single bucket (O(1))
              </div>
              <div>
                <span class="font-mono text-accent">useList(dm, channel)</span>{' '}
                - Pre-baked "channels" combination (O(1))
              </div>
              <div>
                <span class="font-mono text-accent">
                  useList(document, note, task, chat, project)
                </span>{' '}
                - Pre-baked "documents" combination (O(1))
              </div>
              <div>
                <span class="font-mono text-accent">
                  useList(dm, channel, person)
                </span>{' '}
                - Pre-baked "messaging" combination (O(1))
              </div>
              <div>
                <span class="font-mono text-accent">useList(...buckets)</span> -
                Custom combination (O(n+m) merge-sort)
              </div>
              <div class="pt-2 border-t border-edge mt-2">
                <span class="font-mono text-accent">createFreshSearch()</span> -
                Creates a search function with fuzzy + recency scoring
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
