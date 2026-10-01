import { createSignal, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import {
  dummyData,
  type EmailRecipients,
  type WorkspaceTask,
  type WorkspaceView,
} from '../core/dummy-workspace';
import { type SampleCompany, sampleToday } from '../core/workspace-fixtures';

/** All commands operate on local fixtures. No app providers, queries, or clients. */
export function createDummyWorkspace(initial: WorkspaceView = 'home') {
  const [data, setData] = createStore(dummyData());
  const [view, setView] = createSignal(initial);
  const [homeSurface, setHomeSurface] = createSignal<WorkspaceView>('home');
  const contentView = () => (view() === 'home' ? homeSurface() : view());
  const [selected, setSelected] = createSignal<string>();
  const [channel, setChannel] = createSignal('launch');
  const [channelThread, setChannelThread] = createSignal<string>();
  const [fileView, setFileView] = createSignal('My Files');
  const [query, setQuery] = createSignal('');
  const [companyLayout, setCompanyLayout] = createSignal<'Board' | 'List'>(
    'Board'
  );
  const [companyFilter, setCompanyFilter] = createSignal('All companies');
  const [calendarDate, setCalendarDate] = createSignal(sampleToday);
  const [calendarMode, setCalendarMode] = createSignal<'Week' | 'Day'>('Week');
  const [showPersonal, setShowPersonal] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [agentReplies, setAgentReplies] = createSignal<
    { prompt: string; answer: string }[]
  >([]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const time = () =>
    new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  const log = (text: string) =>
    setData('activity', (items) => [
      { id: crypto.randomUUID(), text, time: time() },
      ...items,
    ]);
  function open(next: WorkspaceView, id?: string) {
    setChannelThread(undefined);
    setView(next);
    setHomeSurface('home');
    setSelected(id);
    setQuery('');
  }
  function openItem(next: WorkspaceView, id?: string) {
    setChannelThread(undefined);
    if (view() !== 'home') return open(next, id);
    setHomeSurface(next);
    setSelected(id);
    if (next === 'messages' && id) setChannel(id);
    setQuery('');
  }
  function backToCollection(next: WorkspaceView) {
    open(view() === 'home' ? 'home' : next);
  }
  function updateTask(id: string, patch: Partial<Omit<WorkspaceTask, 'id'>>) {
    const index = data.tasks.findIndex((task) => task.id === id);
    if (index < 0) return;
    setData('tasks', index, patch);
    log(`Jacob updated ${data.tasks[index].title}`);
  }
  function createTask(
    title = 'Untitled task',
    description = '',
    source = channel()
  ) {
    const id = crypto.randomUUID();
    setData('tasks', (tasks) => [
      ...tasks,
      {
        id,
        title: title.trim() || 'Untitled task',
        description,
        status: 'Not Started',
        priority: 'Medium',
        owner: 'jacob',
        creator: 'jacob',
        tags: ['Launch'],
        channel: source,
        steps: [],
        comments: [],
      },
    ]);
    log(`Jacob created ${title}`);
    openItem('tasks', id);
    return id;
  }
  function comment(id: string, body: string, document = false) {
    if (!body.trim()) return;
    const key = document ? 'documents' : 'tasks';
    const index = data[key].findIndex((item) => item.id === id);
    if (index < 0) return;
    const message = {
      id: crypto.randomUUID(),
      person: 'jacob' as const,
      body: body.trim(),
      time: time(),
    };
    setData(key, index, 'comments', (items) => [...items, message]);
    log(`Jacob commented on ${data[key][index].title}`);
  }
  function post(
    body: string,
    emailId?: string,
    taskId?: string,
    documentId?: string,
    replyTo?: string
  ) {
    if (!body.trim()) return;
    const index = data.channels.findIndex((item) => item.id === channel());
    if (index < 0) return;
    setData('channels', index, 'messages', (items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        person: 'jacob' as const,
        body: body.trim(),
        time: time(),
        emailId,
        taskId,
        documentId,
        replyTo,
      },
    ]);
    log(`Jacob posted in #${channel()}`);
  }
  function shareEmail(id: string) {
    const index = data.emails.findIndex((email) => email.id === id);
    if (index < 0) return;
    setData('emails', index, 'shared', channel());
    post(`Shared ${data.emails[index].subject}`, id);
    openItem('messages', channel());
  }
  function sendEmail(
    subject: string,
    body: string,
    to: string,
    replyTo?: string,
    scheduled?: string,
    recipients: EmailRecipients = {}
  ) {
    if (!subject.trim() || !body.trim() || !to.trim()) return;
    if (replyTo && !scheduled) {
      const i = data.emails.findIndex((email) => email.id === replyTo);
      if (i >= 0)
        setData('emails', i, 'replies', (items) => [
          ...items,
          {
            id: crypto.randomUUID(),
            person: 'jacob' as const,
            ...recipients,
            to,
            body,
            time: time(),
          },
        ]);
    }
    setData('emails', (emails) => [
      {
        id: crypto.randomUUID(),
        sender: to,
        ...recipients,
        to,
        scheduled,
        subject,
        snippet: body.slice(0, 100),
        time: time(),
        account: 'work',
        folder: scheduled ? 'scheduled' : 'sent',
        body,
        replies: [],
      },
      ...emails,
    ]);
    log(
      scheduled ? `Scheduled ${subject}: ${scheduled}` : `Jacob sent ${subject}`
    );
    openItem('email', replyTo);
  }
  function ask(prompt: string) {
    if (!prompt.trim() || busy()) return;
    setBusy(true);
    timer = setTimeout(() => {
      const pending = data.tasks.filter(
        (task) => task.status !== 'Completed' && task.status !== 'Canceled'
      );
      const answer = /create|add.*task/i.test(prompt)
        ? (() => {
            createTask(
              prompt.replace(/^.*?task[: ]*/i, '') || 'Review the launch plan',
              'Created from the sample agent conversation.'
            );
            return 'I created the task in your task list. You can edit its owner, priority, and checklist.';
          })()
        : `There are ${pending.length} open tasks. ${pending
            .slice(0, 3)
            .map(
              (task) =>
                `${task.title} (${task.owner}, ${task.status.toLowerCase()})`
            )
            .join(
              '; '
            )}. The launch plan and shared emails are in this workspace.`;
      setAgentReplies((items) => [...items, { prompt, answer }]);
      setBusy(false);
      log('Macro reviewed the sample workspace');
    }, 450);
  }
  function createCompany() {
    const company: SampleCompany = {
      id: crypto.randomUUID(),
      name: 'Untitled company',
      domain: 'company.example',
      description: '',
      stage: 'No stage',
      owner: 'jacob',
      revenue: '',
      contacts: [],
      comments: [],
      emailIds: [],
    };
    setData('companies', (items) => [...items, company]);
    open('crm', company.id);
  }
  function createEvent() {
    const id = crypto.randomUUID();
    setData('events', (items) => [
      ...items,
      {
        id,
        title: 'New event',
        date: calendarDate(),
        start: 10,
        duration: 1,
        calendar: 'work',
        description: '',
      },
    ]);
    open('calendar', id);
  }
  function reset() {
    clearTimeout(timer);
    setBusy(false);
    setChannel('launch');
    setFileView('My Files');
    setCompanyFilter('All companies');
    setCompanyLayout('Board');
    setCalendarDate(sampleToday);
    setCalendarMode('Week');
    setShowPersonal(true);
    setData(produce((state) => Object.assign(state, dummyData())));
    setAgentReplies([]);
    open(initial);
  }
  return {
    fileView,
    setFileView,
    companyLayout,
    setCompanyLayout,
    companyFilter,
    setCompanyFilter,
    createCompany,
    calendarDate,
    setCalendarDate,
    calendarMode,
    setCalendarMode,
    showPersonal,
    setShowPersonal,
    createEvent,
    data,
    setData,
    view,
    contentView,
    openItem,
    backToCollection,
    selected,
    open,
    channel,
    setChannel,
    channelThread,
    setChannelThread,
    query,
    setQuery,
    updateTask,
    createTask,
    comment,
    post,
    shareEmail,
    sendEmail,
    ask,
    busy,
    agentReplies,
    reset,
  };
}
export type DummyWorkspace = ReturnType<typeof createDummyWorkspace>;
