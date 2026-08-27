import {
  type BufferedChatMessageStream,
  bufferedStream,
} from '@core/component/AI/util/stream';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { aiChatTheme } from '@core/component/LexicalMarkdown/theme';
import PlayIcon from '@phosphor-icons/core/regular/play.svg?component-solid';
import StopIcon from '@phosphor-icons/core/regular/stop.svg?component-solid';
import TrashIcon from '@phosphor-icons/core/regular/trash.svg?component-solid';
import type { ChatStream } from '@service-cognition/generated/schemas';
import {
  type ChatStreamController,
  createStreamController,
} from '@service-connection/stream';
import { Button, cn } from '@ui';
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';

const SAMPLE_TEXT = `Here is a streamed Macro XML sample:

<m-document-mention>{"documentId":"6a2b138d-dfbe-439a-a78b-282471a1e165","documentName":"Streaming notes","blockName":"md","blockParams":{}}</m-document-mention>

This should render atomically instead of showing partial XML.

\`\`\`ts
const literal = '<m-document-mention>{"documentId":"inside-code"}</m-document-mention>';
\`\`\`

And another tag:

<m-await>{"awaitId":"debug-await","text":"Waiting","inline":true}</m-await>`;

type StreamRun = {
  controller: ChatStreamController;
  dispose: () => void;
  stream: BufferedChatMessageStream;
};

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function textPart(text: string, runId: number): ChatStream {
  return {
    type: 'chat_message_response',
    chat_id: 'static-markdown-stream-debug',
    message_id: `static-markdown-stream-debug-${runId}`,
    stream_id: `static-markdown-stream-debug-${runId}`,
    content: { type: 'text', text },
  };
}

function streamText(parts: ChatStream[]) {
  return parts
    .map((part) =>
      part.type === 'chat_message_response' && part.content.type === 'text'
        ? part.content.text
        : ''
    )
    .join('');
}

function makeRun(runId: number, onData: (text: string) => void): StreamRun {
  return createRoot((dispose) => {
    const controller = createStreamController<'chat'>({
      entity_type: 'chat',
      entity_id: 'static-markdown-stream-debug',
      stream_id: `static-markdown-stream-debug-${runId}`,
    });
    const stream = bufferedStream(controller.stream);

    createEffect(() => {
      onData(streamText(stream.data()));
    });

    return { controller, dispose, stream };
  });
}

export default function StaticMarkdownStreamDebug() {
  const [sourceText, setSourceText] = createSignal(SAMPLE_TEXT);
  const [renderedText, setRenderedText] = createSignal('');
  const [chunkMin, setChunkMin] = createSignal(3);
  const [chunkMax, setChunkMax] = createSignal(18);
  const [delayMin, setDelayMin] = createSignal(15);
  const [delayMax, setDelayMax] = createSignal(70);
  const [activeRun, setActiveRun] = createSignal<StreamRun>();
  const [rawChunks, setRawChunks] = createSignal(0);
  const [startedAt, setStartedAt] = createSignal<number>();
  const [completedAt, setCompletedAt] = createSignal<number>();

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let runId = 0;

  const isStreaming = () => !!activeRun() && completedAt() === undefined;
  const elapsedMs = createMemo(() => {
    const start = startedAt();
    if (!start) return 0;
    return Math.round((completedAt() ?? Date.now()) - start);
  });
  const progress = createMemo(() => {
    const total = sourceText().length;
    if (total === 0) return 100;
    return Math.min(100, Math.round((renderedText().length / total) * 100));
  });

  function clearTimeoutIfNeeded() {
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
  }

  function stopRun() {
    clearTimeoutIfNeeded();
    const run = activeRun();
    if (run && !run.stream.isDone()) {
      run.controller.setDone();
    }
    run?.dispose();
    setActiveRun(undefined);
    if (startedAt() && completedAt() === undefined) {
      setCompletedAt(Date.now());
    }
  }

  function resetOutput() {
    stopRun();
    setRenderedText('');
    setRawChunks(0);
    setStartedAt(undefined);
    setCompletedAt(undefined);
  }

  function nextSize() {
    const min = clampNumber(chunkMin(), 1, 500);
    const max = Math.max(min, clampNumber(chunkMax(), 1, 1000));
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function nextDelay() {
    const min = clampNumber(delayMin(), 0, 2000);
    const max = Math.max(min, clampNumber(delayMax(), 0, 5000));
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function startStream() {
    resetOutput();
    runId += 1;

    const text = sourceText();
    const run = makeRun(runId, setRenderedText);
    setActiveRun(run);
    setStartedAt(Date.now());
    setCompletedAt(undefined);

    let offset = 0;
    const pushNext = () => {
      if (offset >= text.length) {
        run.controller.setDone();
        setCompletedAt(Date.now());
        clearTimeoutIfNeeded();
        return;
      }

      const size = nextSize();
      const chunk = text.slice(offset, offset + size);
      offset += chunk.length;
      setRawChunks((count) => count + 1);
      run.controller.setData((parts) => [...parts, textPart(chunk, runId)]);
      timeout = setTimeout(pushNext, nextDelay());
    };

    pushNext();
  }

  onCleanup(() => {
    stopRun();
  });

  return (
    <div class="size-full overflow-auto bg-surface text-ink">
      <div class="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-edge-muted pb-3">
          <div>
            <h1 class="text-base font-semibold">Static Markdown Stream</h1>
            <div class="text-xs text-ink-muted">
              {renderedText().length.toLocaleString()} /{' '}
              {sourceText().length.toLocaleString()} chars · {rawChunks()} raw
              chunks · {elapsedMs()} ms
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Button
              variant="accent"
              size="sm"
              onClick={startStream}
              disabled={isStreaming()}
            >
              <PlayIcon />
              Stream
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={stopRun}
              disabled={!isStreaming()}
            >
              <StopIcon />
              Stop
            </Button>
            <Button variant="ghost" size="sm" onClick={resetOutput}>
              <TrashIcon />
              Reset
            </Button>
          </div>
        </div>

        <div class="grid min-h-[72vh] grid-cols-1 gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(480px,1.1fr)]">
          <div class="flex min-h-0 flex-col gap-3">
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label class="flex flex-col gap-1 text-xs text-ink-muted">
                Chunk min
                <input
                  value={chunkMin()}
                  type="number"
                  min="1"
                  max="500"
                  onInput={(e) =>
                    setChunkMin(Number(e.currentTarget.value) || 1)
                  }
                  class="h-8 rounded-sm border border-edge-muted bg-transparent px-2 text-sm text-ink outline-none focus:border-accent"
                />
              </label>
              <label class="flex flex-col gap-1 text-xs text-ink-muted">
                Chunk max
                <input
                  value={chunkMax()}
                  type="number"
                  min="1"
                  max="1000"
                  onInput={(e) =>
                    setChunkMax(Number(e.currentTarget.value) || 1)
                  }
                  class="h-8 rounded-sm border border-edge-muted bg-transparent px-2 text-sm text-ink outline-none focus:border-accent"
                />
              </label>
              <label class="flex flex-col gap-1 text-xs text-ink-muted">
                Delay min ms
                <input
                  value={delayMin()}
                  type="number"
                  min="0"
                  max="2000"
                  onInput={(e) =>
                    setDelayMin(Number(e.currentTarget.value) || 0)
                  }
                  class="h-8 rounded-sm border border-edge-muted bg-transparent px-2 text-sm text-ink outline-none focus:border-accent"
                />
              </label>
              <label class="flex flex-col gap-1 text-xs text-ink-muted">
                Delay max ms
                <input
                  value={delayMax()}
                  type="number"
                  min="0"
                  max="5000"
                  onInput={(e) =>
                    setDelayMax(Number(e.currentTarget.value) || 0)
                  }
                  class="h-8 rounded-sm border border-edge-muted bg-transparent px-2 text-sm text-ink outline-none focus:border-accent"
                />
              </label>
            </div>

            <div class="flex min-h-0 flex-1 flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">Input</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSourceText(SAMPLE_TEXT)}
                >
                  Sample
                </Button>
              </div>
              <textarea
                value={sourceText()}
                onInput={(e) => setSourceText(e.currentTarget.value)}
                spellcheck={false}
                class="min-h-[420px] flex-1 resize-none rounded-sm border border-edge-muted bg-transparent p-3 font-mono text-xs leading-relaxed text-ink outline-none focus:border-accent"
              />
            </div>
          </div>

          <div class="flex min-h-0 flex-col gap-3">
            <div class="flex items-center justify-between">
              <div class="text-sm font-medium">Rendered Output</div>
              <div class="flex items-center gap-2 text-xs text-ink-muted">
                <span
                  class={cn(
                    'inline-block size-2 rounded-full',
                    isStreaming() ? 'bg-accent animate-pulse' : 'bg-edge'
                  )}
                />
                {progress()}%
              </div>
            </div>
            <div class="min-h-[420px] flex-1 overflow-auto rounded-sm border border-edge-muted bg-message p-4">
              <Show
                when={renderedText().length > 0}
                fallback={
                  <div class="text-sm text-ink-muted">
                    Paste text and start the stream.
                  </div>
                }
              >
                <StaticMarkdownContext theme={aiChatTheme}>
                  <StaticMarkdown markdown={renderedText()} target="internal" />
                </StaticMarkdownContext>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
