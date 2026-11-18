import Hash from '@icon/system/regular/hash.svg';
import { createSignal, onCleanup, Show } from 'solid-js';
import { emailSharingMentions } from '../../core/demo-mentions';
import { homepagePeople } from '../../core/homepage-demo-people';
import { createDemoPointer } from '../../primitives/createDemoPointer';
import { createEmailWalkthrough } from '../../primitives/createEmailWalkthrough';
import { demoTypingActions } from '../../primitives/demoTypingActions';
import { DemoCursor } from '../DemoCursor';
import { DemoMentionText } from '../DemoMention';
import {
  HomepageConversation,
  type HomepageMessage,
} from '../HomepageConversation';
import { ProductDemo } from '../product/ProductPage';
import {
  ChannelComposer,
  type ChannelComposerHandle,
} from './frozen/ChannelComposer';
import './email-chat-sharing-demo.css';

const { email, contact } = emailSharingMentions;
const prefix = 'Here’s the email ';
const between = ' and the contact ';
const content = [prefix, email, between, contact, '.'];
const sentText = `${prefix}@[${email.label}](demo-mention:${email.id})${between}@[${contact.label}](demo-mention:${contact.id}).`;

/** A local chat exchange: rich references stay intact when the composer sends. */
export function EmailChatSharingDemo() {
  let root!: HTMLDivElement;
  let composer: ChannelComposerHandle | undefined;
  let log: HTMLDivElement | undefined;
  let replyTimer: ReturnType<typeof setTimeout> | undefined;
  const question: HomepageMessage = {
    person: 'julia',
    text: 'Can you share the email and contact?',
  };
  const thanks: HomepageMessage = { person: 'julia', text: 'Thanks!' };
  const sharedMessage = (text: string): HomepageMessage => ({
    person: 'jacob',
    text: <DemoMentionText text={text} />,
  });
  const [messages, setMessages] = createSignal<HomepageMessage[]>([question]);
  const [target, setTarget] = createSignal<string>();
  const [clicking, setClicking] = createSignal(false);
  const revealLatest = () =>
    queueMicrotask(() => {
      if (log) log.scrollTop = log.scrollHeight;
    });
  const send = (text: string) => {
    clearTimeout(replyTimer);
    setMessages((items) => [...items, sharedMessage(text)]);
    revealLatest();
    replyTimer = setTimeout(() => {
      setMessages((items) => [...items, thanks]);
      revealLatest();
    }, 900);
  };
  onCleanup(() => clearTimeout(replyTimer));
  const actions = [
    { delay: 900, run: () => setTarget('[role="textbox"]') },
    ...demoTypingActions(prefix, (text) => composer?.setContent([text]), 550),
    ...demoTypingActions(`@${email.label}`, (text) =>
      composer?.setContent([prefix, text])
    ),
    { delay: 500, run: () => composer?.setContent([prefix, email]) },
    ...demoTypingActions(
      between,
      (text) => composer?.setContent([prefix, email, text]),
      350
    ),
    ...demoTypingActions(`@${contact.label}`, (text) =>
      composer?.setContent([prefix, email, between, text])
    ),
    { delay: 500, run: () => composer?.setContent(content) },
    { delay: 650, run: () => setTarget('[data-input-action="send"]') },
    {
      delay: 600,
      run: () => {
        setClicking(true);
        composer?.send();
      },
    },
    {
      delay: 250,
      run: () => {
        setClicking(false);
        setTarget(undefined);
      },
    },
    { delay: 1000, run: () => revealLatest() },
  ];
  const playback = createEmailWalkthrough({
    root: () => root,
    steps: actions.length,
    visibilityThreshold: 0.45,
    delay: (step) => actions[step - 1].delay,
    advance: (step) => actions[step - 1].run(),
    loop: { hold: 8000 },
    reset: () => {
      clearTimeout(replyTimer);
      setMessages([question]);
      setTarget(undefined);
      setClicking(false);
      composer?.setContent([]);
    },
    reduced: () => {
      clearTimeout(replyTimer);
      setMessages([question, sharedMessage(sentText), thanks]);
      composer?.setContent([]);
    },
  });
  const pointer = createDemoPointer({
    frame: () => root,
    target,
    active: () => playback.playing() && !playback.reducedMotion(),
  });
  return (
    <div ref={root} class="email-chat-sharing-demo">
      <ProductDemo
        label="Share email and a contact in chat"
        height={440}
        mobileHeight={480}
        onInteract={playback.pause}
      >
        <div class="email-chat-sharing-channel">
          <header>
            <Hash aria-hidden="true" />
            <span>launch</span>
            <div
              class="email-chat-sharing-members"
              aria-label="Channel members"
            >
              <img
                src={homepagePeople.jacob.photo}
                alt={homepagePeople.jacob.name}
              />
              <img
                src={homepagePeople.julia.photo}
                alt={homepagePeople.julia.name}
              />
            </div>
          </header>
          <div
            ref={log}
            class="email-chat-sharing-messages"
            role="log"
            aria-label="Shared email conversation"
          >
            <HomepageConversation messages={messages()} />
          </div>
          <div class="email-chat-sharing-composer">
            <ChannelComposer
              richMentions
              label="Message #launch"
              placeholder="Message #launch"
              onReady={(handle) => {
                composer = handle;
              }}
              onSend={send}
            />
          </div>
        </div>
      </ProductDemo>
      <Show when={pointer()}>
        {(point) => (
          <DemoCursor
            clicking={clicking()}
            style={{ transform: `translate(${point().x}px, ${point().y}px)` }}
          />
        )}
      </Show>
    </div>
  );
}
