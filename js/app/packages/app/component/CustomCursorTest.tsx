import { createSignal, For, onMount } from 'solid-js';

const ShadowDOMTest = () => {
  let shadowHost: HTMLDivElement | undefined;

  onMount(() => {
    if (!shadowHost) return;

    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          padding-top: 4rem;
        }
        p {
          margin: 1em 0;
        }
        a {
          color: var(--color-accent, #3b82f6);
          text-decoration: underline;
        }
        code {
          font-family: monospace;
          background: rgba(0, 0, 0, 0.05);
          padding: 0.125em 0.25em;
          border-radius: 0.25em;
        }
        button {
          color: var(--color-accent, #3b82f6);
          padding: 0.5rem;
          border: 1px solid var(--color-accent, #3b82f6);
          background: transparent;
          margin: 0 0.25rem;
        }
        button.cursor-pointer {
          cursor: pointer;
        }
      </style>
      <div class="pt-16">
        <p>
          By creating a 
          <a href="/en-US/docs/Web/API/BroadcastChannel" class="text-accent underline">
            <code>BroadcastChannel</code>
          </a> 
          object, you can receive any messages that are posted to it. You don't have to
          <a href="/en-US/docs/Web/API/BroadcastChannel" class="text-accent underline">
            <span><code>LINK</code></span>
          </a> 
          maintain a reference to the frames or workers you wish to communicate with: they can "subscribe" to a particular channel by constructing their own 
          <a href="/en-US/docs/Web/API/BroadcastChannel" class="text-accent underline">
            <code>BroadcastChannel</code>
          </a> 
          with the same name, and have bi-directional communication between all of them.
        </p>
        <p>
          The API doesn't associate any semantics to messages,
          <button class="text-accent p-2 border-accent border">clicky button</button>
          bar
          <button class="text-accent p-2 border-accent border">
            <span>clicky button 2</span>
          </button>
          foo
          <button class="text-accent p-2 border-accent border cursor-pointer">
            <span>clicky button 3</span>
          </button>
          so it is up to the code to know what kind of messages to expect and what to do with them.
        </p>
      </div>
    `;
  });

  return <div ref={shadowHost} />;
};

const CustomCursorTest = () => {
  const [useClass, setUseClass] = createSignal(true);
  const [useStyle, setUseStyle] = createSignal(false);

  const cursorTypes = [
    // general cursors
    { name: 'auto', cursor: 'auto', tw: 'cursor-auto' },
    { name: 'default', cursor: 'default', tw: 'cursor-default' },
    { name: 'none', cursor: 'none', tw: 'cursor-none' },

    // link and status cursors
    { name: 'context-menu', cursor: 'context-menu', tw: 'cursor-context-menu' },
    { name: 'help', cursor: 'help', tw: 'cursor-help' },
    { name: 'pointer', cursor: 'pointer', tw: 'cursor-pointer' },
    { name: 'progress', cursor: 'progress', tw: 'cursor-progress' },
    { name: 'wait', cursor: 'wait', tw: 'cursor-wait' },

    // selection cursors
    { name: 'cell', cursor: 'cell', tw: 'cursor-cell' },
    { name: 'crosshair', cursor: 'crosshair', tw: 'cursor-crosshair' },
    { name: 'text', cursor: 'text', tw: 'cursor-text' },
    {
      name: 'vertical-text',
      cursor: 'vertical-text',
      tw: 'cursor-vertical-text',
    },

    // drag-and-drop cursors
    { name: 'alias', cursor: 'alias', tw: 'cursor-alias' },
    { name: 'copy', cursor: 'copy', tw: 'cursor-copy' },
    { name: 'move', cursor: 'move', tw: 'cursor-move' },
    { name: 'no-drop', cursor: 'no-drop', tw: 'cursor-no-drop' },
    { name: 'not-allowed', cursor: 'not-allowed', tw: 'cursor-not-allowed' },
    { name: 'grab', cursor: 'grab', tw: 'cursor-grab' },
    { name: 'grabbing', cursor: 'grabbing', tw: 'cursor-grabbing' },

    // resizing and scrolling cursors
    { name: 'all-scroll', cursor: 'all-scroll', tw: 'cursor-all-scroll' },
    { name: 'col-resize', cursor: 'col-resize', tw: 'cursor-col-resize' },
    { name: 'row-resize', cursor: 'row-resize', tw: 'cursor-row-resize' },
    { name: 'n-resize', cursor: 'n-resize', tw: 'cursor-n-resize' },
    { name: 's-resize', cursor: 's-resize', tw: 'cursor-s-resize' },
    { name: 'e-resize', cursor: 'e-resize', tw: 'cursor-e-resize' },
    { name: 'w-resize', cursor: 'w-resize', tw: 'cursor-w-resize' },
    { name: 'ns-resize', cursor: 'ns-resize', tw: 'cursor-ns-resize' },
    { name: 'ew-resize', cursor: 'ew-resize', tw: 'cursor-ew-resize' },
    { name: 'ne-resize', cursor: 'ne-resize', tw: 'cursor-ne-resize' },
    { name: 'nw-resize', cursor: 'nw-resize', tw: 'cursor-nw-resize' },
    { name: 'se-resize', cursor: 'se-resize', tw: 'cursor-se-resize' },
    { name: 'sw-resize', cursor: 'sw-resize', tw: 'cursor-sw-resize' },
    { name: 'nesw-resize', cursor: 'nesw-resize', tw: 'cursor-nesw-resize' },

    // zooming cursors
    { name: 'zoom-in', cursor: 'zoom-in', tw: 'cursor-zoom-in' },
    { name: 'zoom-out', cursor: 'zoom-out', tw: 'cursor-zoom-out' },
  ];

  return (
    <div
      class="p-8"
      ref={(el) => {
        onMount(() => {
          el.parentElement!.style.overflow = 'auto';
        });
      }}
    >
      <style>
        {`
          :where(*, ::before, ::after) {
            user-select: unset;
          }

          :where(input, textarea, select, p *, p span, .pdfViewer *, .markdown-content *, [contenteditable], .md *) {
              user-select: unset;
          }
        `}
      </style>
      <h1 class="text-2xl font-bold mb-6">Custom Cursor Types Test</h1>

      <div class="mb-6 flex gap-2 flex-wrap">
        <button
          class={`px-4 py-2 rounded border transition-colors ${
            useClass() && !useStyle()
              ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
              : 'bg-transparent border-[var(--color-edge)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'
          }`}
          onClick={() => {
            setUseClass(true);
            setUseStyle(false);
          }}
        >
          Class Only
        </button>
        <button
          class={`px-4 py-2 rounded border transition-colors ${
            !useClass() && useStyle()
              ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
              : 'bg-transparent border-[var(--color-edge)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'
          }`}
          onClick={() => {
            setUseClass(false);
            setUseStyle(true);
          }}
        >
          Style Only
        </button>
        <button
          class={`px-4 py-2 rounded border transition-colors ${
            useClass() && useStyle()
              ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
              : 'bg-transparent border-[var(--color-edge)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'
          }`}
          onClick={() => {
            setUseClass(true);
            setUseStyle(true);
          }}
        >
          Both (Class + Style)
        </button>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <For each={cursorTypes}>
          {({ name, cursor, tw }) => (
            <div
              class="border border-[var(--color-edge)] p-4 rounded hover:bg-[var(--color-surface-hover)] transition-colors"
              classList={{ [`${tw}`]: !!tw && useClass() }}
              style={{
                cursor: useStyle() ? cursor : undefined,
              }}
            >
              {name}
            </div>
          )}
        </For>
      </div>
      <div class="pt-16">
        <div
          class="flex items-center text-accent p-2 border-accent border my-4"
          style={{ cursor: 'pointer' }}
        >
          <div>div wrapper with inline style cursor pointer and hr child</div>
          <hr style="border:none;transition:border-color var(--transition);border-top:10px dashed var(--b4);box-sizing:border-box;width:100%;" />
        </div>
        <div class="border border-slate-500 p-2" contenteditable>
          contenteditable
          <ul class="p-2">
            <li class="list-disc mb-6">some text</li>
            <li class="list-disc">some text 2</li>
          </ul>
        </div>
        <p>
          By creating a{' '}
          <a
            href="/en-US/docs/Web/API/BroadcastChannel"
            class="text-accent underline"
          >
            <code>BroadcastChannel</code>
          </a>{' '}
          object, you can receive any messages that are posted to it. You don't
          have to
          <a
            href="/en-US/docs/Web/API/BroadcastChannel"
            class="text-accent underline"
          >
            <span>
              <code>LINK</code>
            </span>
          </a>{' '}
          maintain a reference to the frames or workers you wish to communicate
          with: they can "subscribe" to a particular channel by constructing
          their own{' '}
          <a
            href="/en-US/docs/Web/API/BroadcastChannel"
            class="text-accent underline"
          >
            <code>BroadcastChannel</code>
          </a>{' '}
          with the same name, and have bi-directional communication between all
          of them.
        </p>
        <p>
          The API doesn't associate any semantics to messages,
          <button class="text-accent p-2 border-accent border">
            clicky button
          </button>
          bar
          <button class="text-accent p-2 border-accent border">
            <span>clicky button 2</span>
          </button>
          foo
          <button class="text-accent p-2 border-accent border cursor-pointer">
            <span>clicky button 3</span>
          </button>
          so it is up to the code to know what kind of messages to expect and
          what to do with them.
        </p>
      </div>

      <h2 class="pt-16 text-2xl font-bold">Shadow DOM Demo</h2>
      <ShadowDOMTest />
    </div>
  );
};

export default CustomCursorTest;
