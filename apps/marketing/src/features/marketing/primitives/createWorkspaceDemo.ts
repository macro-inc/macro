import { createSignal, onCleanup } from 'solid-js';
import {
  DEMO_CHANNEL,
  DEMO_DOCUMENT,
  DEMO_TASKS,
  type DemoMessage,
  type DemoPage,
  demoAgentReply,
} from '../core/workspace-demo';

export function createWorkspaceDemo() {
  const [page, setPage] = createSignal<DemoPage>('messages');
  const [visited, setVisited] = createSignal(new Set<DemoPage>(['messages']));
  const showPage = (next: DemoPage) => {
    setVisited((previous) => new Set([...previous, next]));
    setPage(next);
  };
  const [navigation, setNavigation] = createSignal<DemoPage>('home');
  const [session, setSession] = createSignal<'roster' | 'macro' | 'cursor'>(
    'roster'
  );
  const [document, setDocument] = createSignal(DEMO_DOCUMENT);
  const [messages, setMessages] = createSignal(DEMO_CHANNEL);
  const [tasks, setTasks] = createSignal(DEMO_TASKS);
  const [replies, setReplies] = createSignal<
    {
      id: string;
      session: 'macro' | 'cursor';
      prompt: string;
      answer?: string;
    }[]
  >([]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const [busy, setBusy] = createSignal(false);
  const open = (next: DemoPage) => {
    setNavigation(next);
    showPage(next === 'home' ? 'messages' : next);
    if (next === 'agents') setSession('roster');
  };
  const openSession = (next: 'macro' | 'cursor') => {
    setNavigation('agents');
    showPage('agents');
    setSession(next);
  };
  const post = (text: string) => {
    const body = text.trim();
    if (!body) return;
    setMessages((previous) => [
      ...previous,
      { id: crypto.randomUUID(), person: 'jacob', body } satisfies DemoMessage,
    ]);
  };
  const ask = (text: string) => {
    const prompt = text.trim();
    const current = session();
    if (!prompt || busy() || current === 'roster') return;
    const id = crypto.randomUUID();
    setReplies((previous) => [...previous, { id, session: current, prompt }]);
    setBusy(true);
    timer = setTimeout(() => {
      setReplies((previous) =>
        previous.map((reply) =>
          reply.id === id
            ? { ...reply, answer: demoAgentReply(prompt, current === 'cursor') }
            : reply
        )
      );
      setBusy(false);
    }, 650);
  };
  onCleanup(() => clearTimeout(timer));
  return {
    page,
    visited,
    navigation,
    session,
    open,
    openSession,
    document,
    setDocument,
    messages,
    post,
    tasks,
    toggleTask: (id: string) =>
      setTasks((previous) =>
        previous.map((task) =>
          task.id === id ? { ...task, done: !task.done } : task
        )
      ),
    replies,
    busy,
    ask,
  };
}
export type WorkspaceDemo = ReturnType<typeof createWorkspaceDemo>;
