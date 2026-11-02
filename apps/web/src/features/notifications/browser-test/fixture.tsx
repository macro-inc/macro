import { ThreadList } from '@channel/Channel/ThreadList';
import { createMemo, createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import {
  MarkMessageNotifications,
  MessageNotificationIndexContext,
} from '../components/MarkMessageNotifications';
import { MessageReadVisibilityProvider } from '../components/MessageReadVisibility';
import { indexUnreadMessageNotifications } from '../unread-message-notifications';
import { addNotification, notifications } from './source';

function Message(props: { id: string }) {
  const [element, setElement] = createSignal<HTMLDivElement>();
  return (
    <div
      ref={setElement}
      data-message={props.id}
      style={{
        height: '96px',
        'box-sizing': 'border-box',
        padding: '24px',
        'border-bottom': '1px solid #ccc',
      }}
    >
      <MarkMessageNotifications
        messageId={props.id}
        parent={{ type: 'channel', id: 'channel-fixture' }}
        element={element()}
      >
        Reply {props.id}
      </MarkMessageNotifications>
    </div>
  );
}

function Fixture() {
  const mode = new URLSearchParams(location.search).get('mode');
  const [insets, setInsets] = createSignal({ start: 64, end: 96 });
  const [hidden, setHidden] = createSignal(false);
  const keys = Array.from({ length: 30 }, (_, index) => String(index));
  const index = createMemo(() =>
    indexUnreadMessageNotifications(notifications())
  );
  const notify = (id: string) => addNotification(id);
  return (
    <main
      style={{
        'font-family': 'sans-serif',
        'max-width': '700px',
        margin: '0 auto',
      }}
    >
      <h1>Reply notifications</h1>
      <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
        <button onClick={() => notify(mode === 'panel' ? '0' : '23')}>
          Notify offscreen reply
        </button>
        <button onClick={() => notify(mode === 'panel' ? '5' : '29')}>
          Notify covered reply
        </button>
        <button onClick={() => setInsets({ start: 0, end: 0 })}>
          Remove overlays
        </button>
        <button onClick={() => setHidden(!hidden())}>Toggle pane</button>
        <button
          onClick={() => {
            const scroller = document.querySelector('[data-channel-scroll]');
            if (scroller) scroller.scrollTop = scroller.scrollHeight;
            notify('23');
          }}
        >
          Scroll away and notify
        </button>
      </div>
      <ul aria-label="Notification states">
        <For each={notifications()}>
          {(n) => (
            <li
              data-notification={
                n.notification_metadata.tag === 'channel_message_reply'
                  ? n.notification_metadata.content.messageId
                  : ''
              }
            >
              {n.state === 'unseen' ? 'Unread' : 'Read'}
            </li>
          )}
        </For>
      </ul>
      <MessageNotificationIndexContext.Provider value={index}>
        <section
          style={{
            position: 'relative',
            height: '384px',
            display: hidden() ? 'none' : 'block',
            border: '1px solid #999',
          }}
        >
          {mode === 'panel' ? (
            <MessageReadVisibilityProvider>
              <div
                ref={(el) => {
                  queueMicrotask(() => {
                    el.scrollTop = 384;
                  });
                }}
                data-channel-scroll
                style={{ height: '384px', overflow: 'auto' }}
              >
                <For each={keys}>{(id) => <Message id={id} />}</For>
              </div>
            </MessageReadVisibilityProvider>
          ) : (
            <ThreadList keys={() => keys} insets={insets()}>
              {({ id }) => <Message id={id} />}
            </ThreadList>
          )}
          {mode !== 'panel' && (
            <>
              <div
                aria-label="Header overlay"
                style={{
                  position: 'absolute',
                  top: 0,
                  height: `${insets().start}px`,
                  left: 0,
                  right: 0,
                  background: '#eee',
                  'pointer-events': 'none',
                }}
              >
                Header
              </div>
              <div
                aria-label="Composer overlay"
                style={{
                  position: 'absolute',
                  bottom: 0,
                  height: `${insets().end}px`,
                  left: 0,
                  right: 0,
                  background: '#eee',
                  'pointer-events': 'none',
                }}
              >
                Composer
              </div>
            </>
          )}
        </section>
      </MessageNotificationIndexContext.Provider>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
render(() => <Fixture />, root);
