import { Button, SegmentedControl } from '@ui';
import { decodeImportBlobMeta, LoroDoc } from 'loro-crdt';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';

/** How many blob rows and ops to render before truncating. A dumped op log
 *  runs to thousands of entries and the DOM is the bottleneck, not the decode. */
const RENDER_LIMIT = 300;

type BlobReport = {
  index: number;
  bytes: number;
  /** Loro's own name for the blob shape: snapshot, shallow-snapshot, update, ... */
  mode: string;
  changeNum: number;
  endTimestamp: number;
  startVersion: Record<string, number>;
  endVersion: Record<string, number>;
  /** Peers whose ops this blob actually contributed to the doc. */
  appliedPeers: string[];
  /** Peers whose ops could not be applied yet — deps not in the doc. */
  pendingPeers: string[];
  error?: string;
};

type Report = {
  blobs: BlobReport[];
  /** Blobs that decoded and imported but added nothing new to the doc. */
  redundantCount: number;
  failedCount: number;
  oplogVersion: Record<string, number>;
  frontiers: string[];
  changeCount: number;
  state: string;
  ops: string;
  opsTruncated: boolean;
  error?: string;
};

/** `VersionVector.toJSON()` hands back a Map keyed by PeerID. */
function versionVectorToObject(
  vector: Map<string, number> | undefined
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [peer, counter] of vector ?? []) result[peer] = counter;
  return result;
}

function importedPeers(
  spans: Map<string, { start: number; end: number }> | null | undefined
): string[] {
  return [...(spans ?? [])]
    .filter(([, span]) => span.end > span.start)
    .map(([peer, span]) => `${peer}:${span.start}..${span.end}`);
}

/** Loro hands back Maps and bigints, neither of which `JSON.stringify` handles. */
function stringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, raw) => {
      if (typeof raw === 'bigint') return raw.toString();
      if (raw instanceof Map) return Object.fromEntries(raw);
      return raw;
    },
    2
  );
}

/** Accepts a whole `.b64` file: one base64 blob per line, blanks skipped. */
function parseBlobs(input: string): Uint8Array[] {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line, index) => {
      try {
        return Uint8Array.from(atob(line), (character) =>
          character.charCodeAt(0)
        );
      } catch {
        throw new Error(`line ${index + 1} is not valid base64`);
      }
    });
}

function inspect(input: string): Report {
  const empty: Report = {
    blobs: [],
    redundantCount: 0,
    failedCount: 0,
    oplogVersion: {},
    frontiers: [],
    changeCount: 0,
    state: '',
    ops: '',
    opsTruncated: false,
  };

  let blobs: Uint8Array[];
  try {
    blobs = parseBlobs(input);
  } catch (error) {
    return {
      ...empty,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (blobs.length === 0) return empty;

  const doc = new LoroDoc();
  const reports: BlobReport[] = [];
  let redundantCount = 0;
  let failedCount = 0;

  for (const [index, blob] of blobs.entries()) {
    // Metadata comes straight off the bytes, so it is still readable for a
    // blob the doc cannot apply.
    let metadata: ReturnType<typeof decodeImportBlobMeta> | undefined;
    let decodeError: string | undefined;
    try {
      metadata = decodeImportBlobMeta(blob, false);
    } catch (error) {
      decodeError = error instanceof Error ? error.message : String(error);
    }

    let appliedPeers: string[] = [];
    let pendingPeers: string[] = [];
    let importError: string | undefined;
    try {
      const status = doc.import(blob);
      appliedPeers = importedPeers(status.success);
      pendingPeers = importedPeers(status.pending);
      if (appliedPeers.length === 0 && pendingPeers.length === 0)
        redundantCount++;
    } catch (error) {
      importError = error instanceof Error ? error.message : String(error);
    }

    const error = decodeError ?? importError;
    if (error) failedCount++;

    reports.push({
      index,
      bytes: blob.byteLength,
      mode: metadata?.mode ?? 'undecodable',
      changeNum: metadata?.changeNum ?? 0,
      endTimestamp: metadata?.endTimestamp ?? 0,
      startVersion: versionVectorToObject(
        metadata?.partialStartVersionVector.toJSON()
      ),
      endVersion: versionVectorToObject(
        metadata?.partialEndVersionVector.toJSON()
      ),
      appliedPeers,
      pendingPeers,
      error,
    });
  }

  const updates = doc.exportJsonUpdates();
  const truncated = updates.changes.length > RENDER_LIMIT;

  return {
    blobs: reports,
    redundantCount,
    failedCount,
    oplogVersion: versionVectorToObject(doc.oplogVersion().toJSON()),
    frontiers: doc.frontiers().map(({ peer, counter }) => `${counter}@${peer}`),
    changeCount: updates.changes.length,
    state: stringify(doc.toJSON()),
    ops: stringify(
      truncated
        ? { ...updates, changes: updates.changes.slice(0, RENDER_LIMIT) }
        : updates
    ),
    opsTruncated: truncated,
  };
}

type Tab = 'state' | 'ops' | 'blobs';

/**
 * Dev-only Loro inspector (`loro-inspect` in the split-component registry).
 *
 * Paste base64 Loro bytes and it dumps them: blob metadata straight off the
 * bytes, then the document that results from importing every blob in order.
 * Feeds directly from `services/sync-service/scripts/dump-do-state.ts` —
 * paste `snapshot.loro.b64` for one document, or `ops-all.b64` to replay a
 * durable object's whole retained op log a blob at a time.
 *
 * Blobs are imported in the order pasted, into one fresh doc. An op whose
 * dependencies are missing shows as pending rather than applied, and an op
 * already covered by an earlier blob shows as neither — which is how you tell
 * a genuinely missing op from one the snapshot already contains.
 */
export default function LoroInspector() {
  const [input, setInput] = createSignal('');
  const [submitted, setSubmitted] = createSignal('');
  const [tab, setTab] = createSignal<Tab>('state');

  const report = createMemo(() => inspect(submitted()));
  const lineCount = createMemo(
    () =>
      input()
        .split('\n')
        .filter((line) => line.trim().length > 0).length
  );

  return (
    <div class="flex h-full flex-col bg-surface text-ink">
      <header class="flex h-10 shrink-0 items-center gap-3 border-edge-muted border-b px-4">
        <div class="font-medium text-sm">Loro Inspector</div>
        <div class="ml-auto text-ink-muted text-xs">
          decodeImportBlobMeta · LoroDoc.import · exportJsonUpdates
        </div>
      </header>

      <div class="grid min-h-0 flex-1 grid-cols-[420px_1fr] overflow-hidden">
        <aside class="flex min-h-0 flex-col gap-3 overflow-auto border-edge-muted border-r p-4">
          <section class="flex min-h-0 flex-1 flex-col gap-2">
            <div class="font-medium text-sm">Base64 Loro bytes</div>
            <textarea
              class="min-h-64 flex-1 w-full resize-none rounded-sm border border-edge-muted bg-surface p-1.5 font-mono text-xs outline-none focus:border-accent"
              placeholder="Paste one base64 blob per line — a snapshot, or an op log to replay in order."
              spellcheck={false}
              value={input()}
              onInput={(event) => setInput(event.currentTarget.value)}
            />
            <div class="text-ink-muted text-xs">
              {lineCount()} {lineCount() === 1 ? 'blob' : 'blobs'} · imported in
              order into one fresh doc
            </div>
            <div class="flex gap-2">
              <Button size="sm" onClick={() => setSubmitted(input())}>
                Inspect
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setInput('');
                  setSubmitted('');
                }}
              >
                Clear
              </Button>
            </div>
          </section>

          <Show when={submitted() && !report().error}>
            <section class="space-y-1 border-edge-muted border-t pt-3 text-xs">
              <div class="font-medium text-sm">Document</div>
              <Row label="blobs" value={String(report().blobs.length)} />
              <Row
                label="redundant"
                value={`${report().redundantCount} (added nothing new)`}
              />
              <Row label="failed" value={String(report().failedCount)} />
              <Row label="changes" value={String(report().changeCount)} />
              <Row
                label="peers"
                value={String(Object.keys(report().oplogVersion).length)}
              />
              <div class="pt-1 text-ink-muted">frontiers</div>
              <pre class="overflow-auto rounded-sm border border-edge-muted p-1.5 font-mono">
                {report().frontiers.join('\n') || '(empty)'}
              </pre>
              <div class="pt-1 text-ink-muted">oplog version vector</div>
              <pre class="max-h-40 overflow-auto rounded-sm border border-edge-muted p-1.5 font-mono">
                {stringify(report().oplogVersion)}
              </pre>
            </section>
          </Show>
        </aside>

        <main class="flex min-h-0 flex-col overflow-hidden">
          <Switch>
            <Match when={report().error}>
              <div class="p-4 text-red text-sm">{report().error}</div>
            </Match>
            <Match when={!submitted()}>
              <div class="p-4 text-ink-muted text-sm">
                Paste base64 and hit Inspect.
              </div>
            </Match>
            <Match when={true}>
              <div class="flex h-10 shrink-0 items-center gap-3 border-edge-muted border-b px-4">
                <SegmentedControl
                  size="sm"
                  value={tab()}
                  options={[
                    { value: 'state', label: 'State' },
                    { value: 'ops', label: `Ops (${report().changeCount})` },
                    {
                      value: 'blobs',
                      label: `Blobs (${report().blobs.length})`,
                    },
                  ]}
                  onChange={(value) => setTab(value as Tab)}
                />
              </div>
              <div class="min-h-0 flex-1 overflow-auto p-4">
                <Switch>
                  <Match when={tab() === 'state'}>
                    <pre class="font-mono text-xs">{report().state}</pre>
                  </Match>
                  <Match when={tab() === 'ops'}>
                    <Show when={report().opsTruncated}>
                      <div class="pb-2 text-ink-muted text-xs">
                        showing the first {RENDER_LIMIT} of{' '}
                        {report().changeCount} changes
                      </div>
                    </Show>
                    <pre class="font-mono text-xs">{report().ops}</pre>
                  </Match>
                  <Match when={tab() === 'blobs'}>
                    <BlobTable blobs={report().blobs} />
                  </Match>
                </Switch>
              </div>
            </Match>
          </Switch>
        </main>
      </div>
    </div>
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <div class="flex justify-between gap-2">
      <span class="text-ink-muted">{props.label}</span>
      <span class="font-mono">{props.value}</span>
    </div>
  );
}

function BlobTable(props: { blobs: BlobReport[] }) {
  const shown = () => props.blobs.slice(0, RENDER_LIMIT);
  return (
    <div class="space-y-2">
      <Show when={props.blobs.length > RENDER_LIMIT}>
        <div class="text-ink-muted text-xs">
          showing the first {RENDER_LIMIT} of {props.blobs.length} blobs
        </div>
      </Show>
      <table class="w-full text-left font-mono text-xs">
        <thead class="text-ink-muted">
          <tr>
            <th class="pr-3 pb-1 font-normal">#</th>
            <th class="pr-3 pb-1 font-normal">mode</th>
            <th class="pr-3 pb-1 font-normal">bytes</th>
            <th class="pr-3 pb-1 font-normal">changes</th>
            <th class="pr-3 pb-1 font-normal">end timestamp</th>
            <th class="pr-3 pb-1 font-normal">result</th>
          </tr>
        </thead>
        <tbody>
          <For each={shown()}>
            {(blob) => (
              <tr class="border-edge-muted border-t align-top">
                <td class="py-1 pr-3">{blob.index}</td>
                <td class="py-1 pr-3">{blob.mode}</td>
                <td class="py-1 pr-3">{blob.bytes}</td>
                <td class="py-1 pr-3">{blob.changeNum}</td>
                <td class="py-1 pr-3">
                  {blob.endTimestamp
                    ? new Date(blob.endTimestamp * 1000).toISOString()
                    : '—'}
                </td>
                <td class="py-1 pr-3">
                  <Switch>
                    <Match when={blob.error}>
                      <span class="text-red">{blob.error}</span>
                    </Match>
                    <Match when={blob.pendingPeers.length > 0}>
                      <span class="text-orange">
                        pending {blob.pendingPeers.join(' ')}
                      </span>
                    </Match>
                    <Match when={blob.appliedPeers.length > 0}>
                      <span class="text-green">
                        applied {blob.appliedPeers.join(' ')}
                      </span>
                    </Match>
                    <Match when={true}>
                      <span class="text-ink-muted">
                        redundant — already in the doc
                      </span>
                    </Match>
                  </Switch>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
