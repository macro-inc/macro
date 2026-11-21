import { UserMessageBubble } from '@ui';
import { createSignal, Show } from 'solid-js';
import { createDemoPointer } from '../../primitives/createDemoPointer';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { demoTypingActions } from '../../primitives/demoTypingActions';
import { DemoAgentChip } from '../DemoAgentChip';
import { DemoCursor } from '../DemoCursor';
import { DemoMentionText } from '../DemoMention';
import {
  ChannelComposer,
  type ChannelComposerHandle,
} from '../email/frozen/ChannelComposer';
import {
  HomepageConversation,
  type HomepageMessage,
  HomepagePersonAvatar,
} from '../HomepageConversation';
import '../email/email-demos.css';
import './review-stories.css';

const bugReport: readonly HomepageMessage[] = [
  { person: 'julia', text: 'The sign-in button does nothing on my phone.' },
];
const cursor = { id: 'cursor', kind: 'person', label: 'Cursor' } as const;
const cursorToken = '@[Cursor](demo-mention:cursor)';
const requestStart = 'Okay, ';
const requestEnd = ', could you take a look?';
const request = `${requestStart}${cursorToken}${requestEnd}`;

export function GithubCursorDemo() {
  let root!: HTMLDivElement;
  let composer: ChannelComposerHandle | undefined;
  let manual = false;
  const [message, setMessage] = createSignal('');
  const [running, setRunning] = createSignal(false);
  const [target, setTarget] = createSignal<string>();
  const [clicking, setClicking] = createSignal(false);

  const send = (text: string) => {
    const withMention = text.replace(/\B@cursor\b/gi, cursorToken);
    setMessage(withMention);
    if (manual) setRunning(withMention.includes(cursorToken));
  };
  const actions = [
    { delay: 550, run: () => setTarget('[role="textbox"]') },
    ...demoTypingActions(
      'Okay, @Cursor',
      (text) => composer?.setText(text),
      650
    ),
    { delay: 360, run: () => composer?.setContent([requestStart, cursor]) },
    ...demoTypingActions(
      requestEnd,
      (text) => composer?.setContent([requestStart, cursor, text]),
      340
    ),
    { delay: 500, run: () => setTarget('[data-input-action="send"]') },
    {
      delay: 650,
      run: () => {
        setClicking(true);
        composer?.send();
      },
    },
    { delay: 220, run: () => setClicking(false) },
    { delay: 1050, run: () => setRunning(true) },
    { delay: 4200, run: () => setTarget(undefined) },
  ];
  createProductWalkthrough({
    root: () => root,
    steps: actions.length,
    delay: (step) => actions[step - 1].delay,
    advance: (step) => actions[step - 1].run(),
    loop: { hold: 650 },
    reset: () => {
      setMessage('');
      setRunning(false);
      composer?.setText('');
    },
    reduced: () => {
      setMessage(request);
      setRunning(true);
      composer?.setText('');
    },
    onTakeover: () => {
      manual = true;
      setClicking(false);
      if (message().includes(cursorToken)) setRunning(true);
    },
  });
  const pointer = createDemoPointer({ frame: () => root, target });

  return (
    <div ref={root} class="github-chat-demo github-cursor-demo">
      <div
        class="github-cursor-thread"
        data-sent={!!message()}
        data-running={running()}
      >
        <div class="github-cursor-history" inert>
          <HomepageConversation messages={bugReport} />
        </div>
        <Show when={message()}>
          <UserMessageBubble class="github-chat-message">
            <DemoMentionText text={message()} />
          </UserMessageBubble>
        </Show>
        <Show when={running()}>
          <div class="github-chat-message github-cursor-reply">
            <HomepagePersonAvatar person="cursor" />
            <DemoAgentChip
              agentSessionId="cursor-sign-in-investigation"
              requester="Julia"
              request="Okay, @Cursor, could you take a look?"
              showRequest={false}
              running
              markdown="Investigating the mobile sign-in flow…"
            />
          </div>
        </Show>
      </div>
      <div class="github-chat-composer">
        <ChannelComposer
          compact
          richMentions
          label="Message #website"
          placeholder="Message #website"
          onReady={(handle) => (composer = handle)}
          onSend={send}
        />
      </div>
      <Show when={pointer()}>
        {(point) => (
          <DemoCursor
            class="review-flow-pointer"
            clicking={clicking()}
            style={{ transform: `translate(${point().x}px, ${point().y}px)` }}
          />
        )}
      </Show>
    </div>
  );
}
