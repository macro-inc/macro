import { For } from 'solid-js';

const CustomCursorDemo = () => {
  const cursorTypes = [
    // general cursors
    { name: 'auto', cursor: 'auto' },
    { name: 'default', cursor: 'default' },
    { name: 'none', cursor: 'none' },

    // link and status cursors
    { name: 'context-menu', cursor: 'context-menu' },
    { name: 'help', cursor: 'help' },
    { name: 'pointer', cursor: 'pointer' },
    { name: 'progress', cursor: 'progress' },
    { name: 'wait', cursor: 'wait' },

    // selection cursors
    { name: 'cell', cursor: 'cell' },
    { name: 'crosshair', cursor: 'crosshair' },
    { name: 'text', cursor: 'text' },
    { name: 'vertical-text', cursor: 'vertical-text' },

    // drag-and-drop cursors
    { name: 'alias', cursor: 'alias' },
    { name: 'copy', cursor: 'copy' },
    { name: 'move', cursor: 'move' },
    { name: 'no-drop', cursor: 'no-drop' },
    { name: 'not-allowed', cursor: 'not-allowed' },
    { name: 'grab', cursor: 'grab' },
    { name: 'grabbing', cursor: 'grabbing' },

    // resizing and scrolling cursors
    { name: 'all-scroll', cursor: 'all-scroll' },
    { name: 'col-resize', cursor: 'col-resize' },
    { name: 'row-resize', cursor: 'row-resize' },
    { name: 'n-resize', cursor: 'n-resize' },
    { name: 's-resize', cursor: 's-resize' },
    { name: 'e-resize', cursor: 'e-resize' },
    { name: 'w-resize', cursor: 'w-resize' },
    { name: 'ns-resize', cursor: 'ns-resize' },
    { name: 'ew-resize', cursor: 'ew-resize' },
    { name: 'ne-resize', cursor: 'ne-resize' },
    { name: 'nw-resize', cursor: 'nw-resize' },
    { name: 'se-resize', cursor: 'se-resize' },
    { name: 'sw-resize', cursor: 'sw-resize' },
    { name: 'nesw-resize', cursor: 'nesw-resize' },

    // zooming cursors
    { name: 'zoom-in', cursor: 'zoom-in' },
    { name: 'zoom-out', cursor: 'zoom-out' },
  ];

  return (
    <div class="p-8">
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
      <h1 class="text-2xl font-bold mb-6">Custom Cursor Types Demo</h1>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <For each={cursorTypes}>
          {({ name, cursor }) => (
            <div
              class="border border-[var(--color-edge)] p-4 rounded hover:bg-[var(--color-surface-hover)] transition-colors"
              style={{ cursor }}
            >
              {name}
            </div>
          )}
        </For>
      </div>
      <div class="pt-16">
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
    </div>
  );
};

export default CustomCursorDemo;
