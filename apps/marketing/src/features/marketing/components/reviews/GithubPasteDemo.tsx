import { UserMessageBubble } from '@ui';
import { createSignal, Show } from 'solid-js';
import { createDemoPointer } from '../../primitives/createDemoPointer';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import {
  ChannelComposer,
  type ChannelComposerHandle,
} from '../email/frozen/ChannelComposer';
import {
  HomepageConversation,
  type HomepageMessage,
} from '../HomepageConversation';
import { PrMention, PrPreviewCard } from './ReviewPrMention';
import { type DemoPullRequest, signInPr } from './review-fixtures';
import '../email/email-demos.css';
import './review-stories.css';

const playbackSpeed = 0.7;
const exampleUrl = `https://github.com/${signInPr.repo}/pull/${signInPr.number}`;
const replacementPr: DemoPullRequest = {
  ...signInPr,
  id: 'pr-492',
  title: 'Unify sign-in form submission',
  number: 492,
  status: 'merged',
  additions: 18,
  deletions: 7,
  description: 'Use one submit handler across mobile and desktop.',
  comments: [],
};
const openingMessages: readonly HomepageMessage[] = [
  { person: 'teo', side: 'self', text: 'The mobile sign-in fix is up.' },
  { person: 'julia', text: 'Can you send the PR link?' },
];

export function GithubPasteDemo() {
  let root!: HTMLDivElement;
  let composer: ChannelComposerHandle | undefined;
  const [message, setMessage] = createSignal('');
  const [target, setTarget] = createSignal<string>();
  const [pasting, setPasting] = createSignal(false);
  const [clicking, setClicking] = createSignal(false);
  const [replaced, setReplaced] = createSignal(false);
  const [automaticHover, setAutomaticHover] = createSignal<DemoPullRequest>();
  const [hovered, setHovered] = createSignal<DemoPullRequest>();
  const [expanded, setExpanded] = createSignal<DemoPullRequest>();
  const preview = () => hovered() ?? expanded() ?? automaticHover();
  const send = (text: string) => {
    setHovered(undefined);
    setExpanded(undefined);
    setReplaced(false);
    setMessage(text);
  };
  const mention = (pr: DemoPullRequest) => (
    <PrMention
      pr={pr}
      status={pr.status}
      hovered={preview() === pr}
      onHover={(active) => {
        if (active) setHovered(pr);
        else if (hovered() === pr) setHovered(undefined);
      }}
      onOpen={() =>
        setExpanded((previous) => (previous === pr ? undefined : pr))
      }
    />
  );

  const actions = [
    { delay: 180, run: () => setTarget('.mail-channel-input') },
    {
      delay: 540,
      run: () => {
        composer?.setText(exampleUrl);
        setPasting(true);
      },
    },
    {
      delay: 360,
      run: () => {
        setPasting(false);
        setTarget('[data-input-action="send"]');
      },
    },
    {
      delay: 560,
      run: () => {
        setClicking(true);
        composer?.send();
      },
    },
    {
      delay: 230,
      run: () => {
        setClicking(false);
        setTarget('.github-paste-original [data-pr-mention]');
      },
    },
    { delay: 560, run: () => setAutomaticHover(signInPr) },
    {
      delay: 1850,
      run: () => {
        setAutomaticHover(undefined);
        setReplaced(true);
      },
    },
    {
      delay: 460,
      run: () => setTarget('.github-paste-replacement [data-pr-mention]'),
    },
    { delay: 560, run: () => setAutomaticHover(replacementPr) },
    { delay: 2700, run: () => setTarget(undefined) },
  ];
  createProductWalkthrough({
    root: () => root,
    steps: actions.length,
    delay: (step) => actions[step - 1].delay / playbackSpeed,
    loop: { hold: 500 / playbackSpeed },
    advance: (step) => actions[step - 1].run(),
    reset: () => {
      setMessage('');
      setReplaced(false);
      setAutomaticHover(undefined);
      composer?.setText('');
    },
    reduced: () => {
      setMessage(exampleUrl);
      setReplaced(true);
      setAutomaticHover(replacementPr);
      composer?.setText('');
    },
    onTakeover: () => {
      setAutomaticHover(undefined);
      setPasting(false);
      setClicking(false);
    },
  });

  const pointer = createDemoPointer({ frame: () => root, target });

  return (
    <div
      ref={root}
      class="github-paste-demo"
      style={{ '--github-paste-speed': playbackSpeed }}
    >
      <div
        class="github-paste-result"
        data-sent={!!message()}
        data-replaced={replaced()}
      >
        <div class="github-paste-history" inert>
          <HomepageConversation messages={openingMessages} />
        </div>
        <Show when={message()} keyed>
          {(text) => (
            <UserMessageBubble class="github-paste-message github-paste-original">
              <Show when={text === exampleUrl} fallback={text}>
                {mention(signInPr)}
              </Show>
            </UserMessageBubble>
          )}
        </Show>
        <Show when={replaced()}>
          <div class="github-paste-message github-paste-replacement">
            <HomepageConversation
              label="Replacement pull request"
              messages={[
                {
                  person: 'teo',
                  text: (
                    <>
                      Actually, I superseded it with this one.
                      <br />
                      {mention(replacementPr)}
                    </>
                  ),
                },
              ]}
            />
          </div>
        </Show>
        <Show when={preview()} keyed>
          {(pr) => (
            <PrPreviewCard
              class="github-paste-preview"
              pr={pr}
              status={pr.status}
            />
          )}
        </Show>
      </div>
      <div class="github-paste-composer" data-pasting={pasting() || undefined}>
        <ChannelComposer
          compact
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
