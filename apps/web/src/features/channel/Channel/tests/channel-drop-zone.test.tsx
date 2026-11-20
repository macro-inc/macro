import { createPointerCollisionDetector } from '@components/app/pointer-collision';
import { type ChannelEntity, createEntityDraggable } from '@entity';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { DragDropProvider, DragDropSensors } from '@thisbeyond/solid-dnd';
import { createSignal, Match, onCleanup, Show, Switch } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelDropZone } from '../ChannelDropZone';
import { createChannelDragState } from '../create-channel-drag-state';
import { createEntityDropZone } from '../create-entity-drop-zone';

vi.mock('@components/app/ItemDragAndDrop', () => ({
  useOptionalDragOperation: () => ({ isAltKey: () => false }),
}));

const entity: ChannelEntity = {
  id: 'dragged',
  type: 'channel',
  channelType: 'private',
  name: 'A channel',
  ownerId: 'owner',
};

function setup(options: { twice?: boolean } = {}) {
  const insertEntityMention = vi.fn();
  const insertSecondMention = vi.fn();
  const insertThreadMention = vi.fn();
  let hovered: Element | null = null;
  const collision = createPointerCollisionDetector(
    () => ({ x: 0, y: 0 }),
    () => hovered
  );

  function Row() {
    const draggable = createEntityDraggable({ entity, splitId: 'list' });
    return <div ref={draggable} data-testid="row" />;
  }

  function ThreadReply() {
    const zone = createEntityDropZone({
      droppableId: 'thread-reply-entity-drop-thread',
      onDropEntity: insertThreadMention,
    });
    const droppable = zone.droppable;
    false && droppable;
    return (
      <div use:droppable>
        <span data-testid="thread-reply">reply</span>
      </div>
    );
  }

  // The channel creates its drag state up front and renders its content once
  // it loads, after the channel itself has mounted.
  const [loaded, setLoaded] = createSignal(false);
  function Channel() {
    const dragState = createChannelDragState();
    dragState.setEntityMentionInputHandlers({ insertEntityMention });
    return (
      <Show when={loaded()}>
        <ChannelDropZone dragState={dragState}>
          <span data-testid="message">message</span>
          <ThreadReply />
          <span data-testid="composer">composer</span>
        </ChannelDropZone>
      </Show>
    );
  }

  // The same channel open again (beside its call panel, or in another split).
  const [secondOpen, setSecondOpen] = createSignal(options.twice ?? false);
  function SecondView() {
    const dragState = createChannelDragState();
    dragState.setEntityMentionInputHandlers({
      insertEntityMention: insertSecondMention,
    });
    return (
      <ChannelDropZone dragState={dragState}>
        <span data-testid="second-message">message</span>
      </ChannelDropZone>
    );
  }

  const view = render(() => (
    <DragDropProvider collisionDetector={collision}>
      <DragDropSensors />
      <Row />
      <Channel />
      <Show when={secondOpen()}>
        <SecondView />
      </Show>
    </DragDropProvider>
  ));
  setLoaded(true);

  const dragRowOnto = (testId: string) => {
    hovered = view.getByTestId(testId);
    fireEvent.mouseDown(view.getByTestId('row'), {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.mouseMove(document, { clientX: 40, clientY: 0 });
    fireEvent.mouseMove(document, { clientX: 50, clientY: 0 });
    fireEvent.mouseUp(document, { button: 0 });
  };

  return {
    insertEntityMention,
    insertSecondMention,
    insertThreadMention,
    dragRowOnto,
    closeSecondView: () => setSecondOpen(false),
  };
}

type Composer = 'channel' | 'reply' | 'none';

/**
 * A channel whose composer swaps the way `Channel` swaps it: its own input, or
 * the unified reply input that replaces it (always, in the call panel), each
 * registering with the drag state from its `onReady`.
 */
function setupComposers(initial: Composer) {
  const insertInChannel = vi.fn();
  const insertInReply = vi.fn();
  let hovered: Element | null = null;
  const collision = createPointerCollisionDetector(
    () => ({ x: 0, y: 0 }),
    () => hovered
  );
  const [composer, setComposer] = createSignal<Composer>(initial);

  function Row() {
    const draggable = createEntityDraggable({ entity, splitId: 'list' });
    return <div ref={draggable} data-testid="row" />;
  }

  function Channel() {
    const dragState = createChannelDragState();
    const takeEntityDrops = (handle: { insertEntityMention: () => void }) =>
      onCleanup(dragState.setEntityMentionInputHandlers(handle));
    function ComposerInput(props: { insert: () => void }) {
      takeEntityDrops({ insertEntityMention: props.insert });
      return <span data-testid="composer">composer</span>;
    }
    return (
      <ChannelDropZone dragState={dragState}>
        <span data-testid="message">message</span>
        <Switch>
          <Match when={composer() === 'reply'}>
            <ComposerInput insert={insertInReply} />
          </Match>
          <Match when={composer() === 'channel'}>
            <ComposerInput insert={insertInChannel} />
          </Match>
        </Switch>
      </ChannelDropZone>
    );
  }

  const view = render(() => (
    <DragDropProvider collisionDetector={collision}>
      <DragDropSensors />
      <Row />
      <Channel />
    </DragDropProvider>
  ));

  const dropOnMessage = () => {
    hovered = view.getByTestId('message');
    fireEvent.mouseDown(view.getByTestId('row'), {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.mouseMove(document, { clientX: 40, clientY: 0 });
    fireEvent.mouseMove(document, { clientX: 50, clientY: 0 });
    fireEvent.mouseUp(document, { button: 0 });
  };

  return { insertInChannel, insertInReply, setComposer, dropOnMessage };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChannelDropZone', () => {
  it.each(['message', 'composer'])(
    'mentions a list row dropped on the channel %s in the composer',
    (target) => {
      const { dragRowOnto, insertEntityMention, insertThreadMention } = setup();
      dragRowOnto(target);
      expect(insertEntityMention).toHaveBeenCalledOnce();
      expect(insertEntityMention.mock.calls[0]![0]).toMatchObject({
        id: entity.id,
      });
      expect(insertThreadMention).not.toHaveBeenCalled();
    }
  );

  it('leaves a drop on a thread reply to that reply', () => {
    const { dragRowOnto, insertEntityMention, insertThreadMention } = setup();
    dragRowOnto('thread-reply');
    expect(insertThreadMention).toHaveBeenCalledOnce();
    expect(insertEntityMention).not.toHaveBeenCalled();
  });

  it('mentions only in the view of a channel open twice that took the drop', () => {
    const { dragRowOnto, insertEntityMention, insertSecondMention } = setup({
      twice: true,
    });
    dragRowOnto('message');
    expect(insertEntityMention).toHaveBeenCalledOnce();
    expect(insertSecondMention).not.toHaveBeenCalled();

    dragRowOnto('second-message');
    expect(insertSecondMention).toHaveBeenCalledOnce();
    expect(insertEntityMention).toHaveBeenCalledOnce();
  });

  it('keeps taking drops after another view of the channel closes', async () => {
    const { dragRowOnto, insertEntityMention, closeSecondView } = setup({
      twice: true,
    });
    closeSecondView();
    await Promise.resolve();
    dragRowOnto('composer');
    expect(insertEntityMention).toHaveBeenCalledOnce();
  });
});

describe('ChannelDropZone composer routing', () => {
  it('mentions in the reply composer that the call panel shows in place of the channel input', () => {
    const { dropOnMessage, insertInChannel, insertInReply } =
      setupComposers('reply');
    dropOnMessage();
    expect(insertInReply).toHaveBeenCalledOnce();
    expect(insertInChannel).not.toHaveBeenCalled();
  });

  it('follows the composer as a reply opens and closes', () => {
    const { dropOnMessage, insertInChannel, insertInReply, setComposer } =
      setupComposers('channel');
    setComposer('reply');
    dropOnMessage();
    expect(insertInReply).toHaveBeenCalledOnce();
    expect(insertInChannel).not.toHaveBeenCalled();

    setComposer('channel');
    dropOnMessage();
    expect(insertInChannel).toHaveBeenCalledOnce();
    expect(insertInReply).toHaveBeenCalledOnce();
  });

  it('never reaches a composer that has unmounted', () => {
    const { dropOnMessage, insertInChannel, setComposer } =
      setupComposers('channel');
    setComposer('none');
    dropOnMessage();
    expect(insertInChannel).not.toHaveBeenCalled();
  });
});
