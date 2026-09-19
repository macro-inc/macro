import { createAIProjection } from '@queries/ai/projection';
import type { Expiry } from '@service-cognition/generated/schemas/expiry';
import type { RefreshCadence } from '@service-cognition/generated/schemas/refreshCadence';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import { Button, InlineCheckbox, SegmentedControl } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { z } from 'zod';

/** Demo schema for the structured-output variation. Non-strict server-side, so
 * the shape just needs to be representable as plain JSON schema. */
const DEMO_SCHEMA = z.object({
  headline: z.string(),
  items: z.array(z.object({ title: z.string(), detail: z.string() })),
  confidence: z.number(),
});

const DEFAULT_PROMPT =
  'Look at my three most recent unread items and produce a short brief: what they are and why (or why not) they need my attention.';

type OutputMode = 'text' | 'structured';
type ModelChoice = 'default' | 'fast' | 'cerebras' | 'custom';

const MODEL_IDS: Record<Exclude<ModelChoice, 'custom'>, string | undefined> = {
  default: undefined,
  fast: 'anthropic/claude-haiku-4-5',
  cerebras: 'cerebras/llama-3.3-70b',
};

const AI_PROJECTION_UPDATED_MESSAGE_TYPE = 'ai_projection_updated';

/**
 * Dev playground for AI projections (`createAIProjection`).
 *
 * Variations to poke at:
 * - text vs structured output (zod schema -> non-strict JSON generation)
 * - model routing (default / fast / cerebras / custom `provider/model` id)
 * - `await` inline generation vs fire-and-forget + gateway push
 * - reactive `enabled` (the query does nothing until enabled)
 * - `refresh()` re-trigger over a cached result
 *
 * Requires the `read:professional_features` permission (the endpoint is
 * premium-gated). Changing prompt/schema/model revises the projection
 * server-side and regenerates on the next request.
 */
export default function ProjectionPlayground() {
  const [id, setId] = createSignal('playground/projection-demo');
  const [prompt, setPrompt] = createSignal(DEFAULT_PROMPT);
  const [outputMode, setOutputMode] = createSignal<OutputMode>('text');
  const [modelChoice, setModelChoice] = createSignal<ModelChoice>('default');
  const [customModel, setCustomModel] = createSignal('cerebras/llama-3.3-70b');
  const [awaitGeneration, setAwaitGeneration] = createSignal(true);
  const [enabled, setEnabled] = createSignal(false);
  const [cadence, setCadence] = createSignal<RefreshCadence>('low');
  const [expiry, setExpiry] = createSignal<Expiry>('day');

  const model = () =>
    modelChoice() === 'custom'
      ? customModel() || undefined
      : MODEL_IDS[modelChoice() as Exclude<ModelChoice, 'custom'>];

  const projection = createAIProjection(() => ({
    id: id(),
    prompt: prompt(),
    schema: outputMode() === 'structured' ? DEMO_SCHEMA : undefined,
    model: model(),
    awaitGeneration: awaitGeneration(),
    refreshCadence: cadence(),
    expiry: expiry(),
    enabled: enabled(),
  }));

  // Raw gateway frames, so the push path is visible even when the cache
  // update is subtle (e.g. same data regenerated).
  const [events, setEvents] = createSignal<string[]>([]);
  createConnectionWebsocketEffect((message) => {
    if (message.type !== AI_PROJECTION_UPDATED_MESSAGE_TYPE) return;
    const stamp = new Date().toLocaleTimeString();
    setEvents((prev) => [`${stamp} ${message.data}`, ...prev].slice(0, 20));
  });

  const dataDisplay = createMemo(() => {
    const value = projection.data();
    if (value === undefined) return undefined;
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  });

  const timeLabel = (timestamp: string | null | undefined) =>
    timestamp ? new Date(timestamp).toLocaleTimeString() : undefined;
  const generatedAtLabel = () => timeLabel(projection.query.data?.generated_at);
  const staleAtLabel = () => timeLabel(projection.query.data?.stale_at);

  const [busy, setBusy] = createSignal(false);
  const regenerate = async () => {
    setBusy(true);
    try {
      await projection.refresh();
    } catch (error) {
      console.error('projection regenerate failed', error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="flex h-full flex-col bg-surface text-ink">
      <header class="flex h-10 shrink-0 items-center border-edge-muted border-b px-4">
        <div class="text-sm font-medium">AI Projection Playground</div>
        <div class="ml-auto text-ink-muted text-xs">
          POST /ai-projections · gateway `ai_projection_updated`
        </div>
      </header>
      <div class="grid min-h-0 flex-1 grid-cols-[380px_1fr] overflow-hidden">
        <aside class="flex min-h-0 flex-col gap-4 overflow-auto border-edge-muted border-r p-4">
          <section class="space-y-2">
            <div class="text-sm font-medium">Projection id</div>
            <input
              class="w-full rounded-sm border border-edge-muted bg-surface p-1.5 text-sm outline-none focus:border-accent"
              value={id()}
              onInput={(event) => setId(event.currentTarget.value)}
            />
            <div class="text-ink-muted text-xs">
              The cache key. Same id + same prompt/model/schema = cached result;
              changing any of those revises the projection and regenerates.
            </div>
          </section>

          <section class="space-y-2">
            <div class="text-sm font-medium">Prompt</div>
            <textarea
              class="min-h-24 w-full rounded-sm border border-edge-muted bg-surface p-1.5 text-sm outline-none focus:border-accent"
              value={prompt()}
              onInput={(event) => setPrompt(event.currentTarget.value)}
            />
          </section>

          <section class="space-y-2">
            <div class="text-sm font-medium">Output</div>
            <SegmentedControl
              class="w-full"
              size="sm"
              value={outputMode()}
              options={[
                { value: 'text', label: 'Free text' },
                { value: 'structured', label: 'Structured (zod)' },
              ]}
              onChange={(value) => setOutputMode(value)}
            />
            <Show when={outputMode() === 'structured'}>
              <pre class="overflow-auto rounded-sm border border-edge-muted bg-surface p-2 text-xs">
                {'{ headline, items: [{ title, detail }], confidence }'}
              </pre>
            </Show>
          </section>

          <section class="space-y-2">
            <div class="text-sm font-medium">Model</div>
            <SegmentedControl
              class="w-full"
              size="sm"
              value={modelChoice()}
              options={[
                { value: 'default', label: 'Default' },
                { value: 'fast', label: 'Haiku' },
                { value: 'cerebras', label: 'Cerebras' },
                { value: 'custom', label: 'Custom' },
              ]}
              onChange={(value) => setModelChoice(value)}
            />
            <Show when={modelChoice() === 'custom'}>
              <input
                class="w-full rounded-sm border border-edge-muted bg-surface p-1.5 text-sm outline-none focus:border-accent"
                placeholder="provider/model, e.g. cerebras/llama-3.3-70b"
                value={customModel()}
                onInput={(event) => setCustomModel(event.currentTarget.value)}
              />
            </Show>
            <div class="text-ink-muted text-xs">
              Unroutable ids silently fall back to the server default.
            </div>
          </section>

          <section class="space-y-2">
            <div class="text-sm font-medium">Request behavior</div>
            <button
              type="button"
              class="flex w-full items-center gap-2 text-left text-sm hover:bg-hover"
              onClick={() => setAwaitGeneration((prev) => !prev)}
            >
              <InlineCheckbox checked={awaitGeneration()} />
              <span>
                await — generate inline and return the finished result
              </span>
            </button>
            <button
              type="button"
              class="flex w-full items-center gap-2 text-left text-sm hover:bg-hover"
              onClick={() => setEnabled((prev) => !prev)}
            >
              <InlineCheckbox checked={enabled()} />
              <span>enabled — reactive; off = the query never fires</span>
            </button>
            <div class="grid grid-cols-2 gap-2">
              <select
                class="w-full rounded-sm border border-edge-muted bg-surface p-1.5 text-sm outline-none focus:border-accent"
                value={cadence()}
                onChange={(event) =>
                  setCadence(event.currentTarget.value as RefreshCadence)
                }
              >
                <option value="high">cadence: high</option>
                <option value="medium">cadence: medium</option>
                <option value="low">cadence: low</option>
              </select>
              <select
                class="w-full rounded-sm border border-edge-muted bg-surface p-1.5 text-sm outline-none focus:border-accent"
                value={expiry()}
                onChange={(event) =>
                  setExpiry(event.currentTarget.value as Expiry)
                }
              >
                <option value="day">expiry: day</option>
                <option value="week">expiry: week</option>
                <option value="month">expiry: month</option>
              </select>
            </div>
          </section>

          <section class="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={projection.query.isFetching}
              onClick={() => projection.query.refetch()}
            >
              Send request
            </Button>
            <Button
              variant="cta"
              size="sm"
              disabled={busy()}
              onClick={() => void regenerate()}
            >
              Force regenerate
            </Button>
          </section>
        </aside>

        <main class="flex min-h-0 flex-col gap-4 overflow-auto p-4">
          <section class="flex items-center gap-3 text-sm">
            <span class="rounded-sm border border-edge-muted bg-surface px-2 py-0.5">
              status: {projection.status() ?? '—'}
            </span>
            <span class="rounded-sm border border-edge-muted bg-surface px-2 py-0.5">
              generating: {String(projection.isGenerating())}
            </span>
            <span class="rounded-sm border border-edge-muted bg-surface px-2 py-0.5">
              fetching: {String(projection.query.isFetching)}
            </span>
            <Show when={generatedAtLabel()}>
              <span class="text-ink-muted text-xs">
                generated {generatedAtLabel()}
              </span>
            </Show>
            <Show when={staleAtLabel()}>
              <span class="text-ink-muted text-xs">stale {staleAtLabel()}</span>
            </Show>
          </section>

          <Show when={projection.error()}>
            <section class="rounded-sm border border-edge-muted bg-surface p-3 text-failure text-sm">
              {projection.error()}
            </section>
          </Show>

          <section class="space-y-2">
            <div class="text-sm font-medium">Result</div>
            <Show
              when={dataDisplay() !== undefined}
              fallback={
                <div class="rounded-sm border border-edge-muted border-dashed p-4 text-ink-muted text-sm">
                  No result yet. Enable the query (or hit “Send request”) to
                  upsert the projection; with `await` off, watch the gateway
                  event land below.
                </div>
              }
            >
              <pre class="whitespace-pre-wrap rounded-sm border border-edge-muted bg-surface p-3 text-sm">
                {dataDisplay()}
              </pre>
            </Show>
          </section>

          <section class="space-y-2">
            <div class="text-sm font-medium">Raw response</div>
            <pre class="overflow-auto rounded-sm border border-edge-muted bg-surface p-3 text-xs">
              {projection.query.data
                ? JSON.stringify(projection.query.data, null, 2)
                : '—'}
            </pre>
          </section>

          <section class="space-y-2">
            <div class="text-sm font-medium">
              Gateway events ({events().length})
            </div>
            <Show
              when={events().length > 0}
              fallback={
                <div class="text-ink-muted text-sm">
                  No `ai_projection_updated` frames received yet.
                </div>
              }
            >
              <div class="space-y-1">
                <For each={events()}>
                  {(event) => (
                    <pre class="overflow-auto rounded-sm border border-edge-muted bg-surface p-2 text-xs">
                      {event}
                    </pre>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </main>
      </div>
    </div>
  );
}
