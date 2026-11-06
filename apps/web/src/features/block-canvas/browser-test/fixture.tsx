import { noopChatter } from '@macro-inc/collaboration/collab/chatter';
import { InMemoryWALStore } from '@macro-inc/collaboration/collab/wal';
import {
  createGraphicsEditorFromBackend,
  createScene,
  type GraphicsEditor,
  translation,
} from '@macro-inc/graphics';
import { createLoroGraphicsBackendFromDoc } from '@macro-inc/graphics/loro';
import { CollaborativeGraphicsSurface } from '@macro-inc/graphics/loro/solid';
import type { LoroDoc } from 'loro-crdt';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { MemorySyncServer } from '../../block-fig/browser-test/memory-sync';
import { createCanvasPresence } from '../primitives/create-canvas-presence';
import {
  type CanvasSession,
  createCanvasSession,
} from '../queries/canvas-session';

const server = new MemorySyncServer();
const initial = {
  version: 2,
  document: createScene([
    {
      id: 'box',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(80, 100),
      geometry: { width: 120, height: 80 },
      appearance: { fill: '#ddd', stroke: '#333' },
    },
  ]),
} as const;
const people = new Map<
  string,
  { editor: GraphicsEditor; session: CanvasSession }
>();
declare global {
  interface Window {
    canvasFixture: {
      people: typeof people;
      reopen: (name: string) => void;
    };
  }
}
function Person(props: { name: string }) {
  let snapshot: Uint8Array | null = null;
  const session = createCanvasSession({
    documentId: 'canvas-browser',
    initial,
    userId: props.name,
    canEdit: () => props.name !== 'Viewer',
    exists: () => server.exists(),
    initialize: (value) => server.initialize(value),
    connect: () => server.connect('canvas-browser'),
    persistence: {
      snapshots: {
        load: async () => snapshot,
        save: async (value) => {
          snapshot = value;
        },
        delete: async () => {
          snapshot = null;
        },
      },
      wal: new InMemoryWALStore(),
      makeChatter: noopChatter,
    },
  });
  const doc = () => {
    const state = session.state();
    return state.t === 'ready' ? state.doc : undefined;
  };
  return (
    <section data-person={props.name} style={{ flex: 1, 'min-width': 0 }}>
      <h2>{props.name}</h2>
      <div
        style={{
          position: 'relative',
          height: '480px',
          border: '1px solid #aaa',
        }}
      >
        <Show when={doc()} keyed>
          {(doc) => <Scene doc={doc} session={session} name={props.name} />}
        </Show>
      </div>
    </section>
  );
}
function Scene(props: { doc: LoroDoc; session: CanvasSession; name: string }) {
  const backend = createLoroGraphicsBackendFromDoc(
    props.doc,
    initial.document.rootId,
    () => props.name !== 'Viewer'
  );
  const editor = createGraphicsEditorFromBackend(backend);
  const presence = createCanvasPresence(
    editor,
    props.session,
    backend.getClock,
    (id) => id ?? 'Someone'
  );
  people.set(props.name, { editor, session: props.session });
  onCleanup(() => {
    people.delete(props.name);
    editor.dispose();
    backend.dispose();
  });
  return (
    <CollaborativeGraphicsSurface
      editor={editor}
      presence={presence}
      input={{ tool: () => 'select', editing: props.name !== 'Viewer' }}
    />
  );
}
function Fixture() {
  const [attempts, setAttempts] = createSignal({ Alice: 1, Bob: 1, Viewer: 1 });
  window.canvasFixture = {
    people,
    reopen: (name) =>
      setAttempts((value) => ({
        ...value,
        [name]: value[name as keyof typeof value] + 1,
      })),
  };
  return (
    <div style={{ display: 'flex', gap: '12px' }}>
      <For each={['Alice', 'Bob', 'Viewer']}>
        {(name) => (
          <Show
            when={attempts()[name as keyof ReturnType<typeof attempts>]}
            keyed
          >
            {(_attempt) => <Person name={name} />}
          </Show>
        )}
      </For>
    </div>
  );
}
render(() => <Fixture />, document.getElementById('root')!);
