import '@app/index.css';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { Transcript } from '../component/Transcript';
import { session, showTranscript } from './session';

document.documentElement.dataset.touchDevice = String(isTouchDevice());

const message = (
  turn: number,
  author: 'user' | 'agent',
  parts: MessagePart[]
): FoldedMessage => ({
  agentSessionId: session.sessionId(),
  key: `${turn}:${author}`,
  turn,
  author:
    author === 'user'
      ? { kind: 'user', userId: session.userId() }
      : { kind: 'agent' },
  parts,
  requestId: null,
  stop: author === 'agent' ? { kind: 'end_turn' } : null,
  pending: false,
  segments: [],
  phase: null,
  postedAt: null,
});
const read = (id: string): MessagePart => ({
  kind: 'tool_use',
  id,
  name: { kind: 'native', name: 'Read' },
  status: 'completed',
  detail: { kind: 'read', paths: [`src/${id}.rs`] },
});
const paragraph =
  'The agent explains what it found in a few sentences, long enough to wrap across several lines of the transcript.';
const history = Array.from({ length: 4 }, (_, index) => [
  message(index * 2, 'user', [{ kind: 'text', text: `Question ${index}` }]),
  message(index * 2 + 1, 'agent', [
    { kind: 'text', text: `${paragraph}\n\n${paragraph}` },
  ]),
]).flat();
const prompt = message(8, 'user', [
  { kind: 'text', text: 'Read the files and explain them' },
]);
const reply = (sentences: number): FoldedMessage => ({
  ...message(9, 'agent', [
    { kind: 'text', text: 'Reading the files first.' },
    read('first'),
    read('second'),
    {
      kind: 'text',
      text: Array.from(
        { length: sentences },
        (_, index) => `Sentence ${index} of the streaming answer.`
      ).join(' '),
    },
  ]),
  stop: null,
});

function Fixture() {
  let sentences = 1;
  showTranscript([...history, prompt, reply(sentences)], 'running');
  // A sentence every 80 ms, like a model streaming its answer.
  const stream = setInterval(() => {
    sentences += 1;
    showTranscript([...history, prompt, reply(sentences)], 'running');
  }, 80);
  onCleanup(() => clearInterval(stream));
  return (
    <main class="flex h-dvh flex-col bg-surface">
      <Transcript />
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(
  () => (
    <QueryClientProvider client={new QueryClient()}>
      <UserContextProvider>
        <StaticMarkdownContext>
          <Fixture />
        </StaticMarkdownContext>
      </UserContextProvider>
    </QueryClientProvider>
  ),
  root
);
