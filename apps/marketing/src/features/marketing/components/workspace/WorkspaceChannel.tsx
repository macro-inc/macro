import CaretRight from '@phosphor/caret-right.svg';
import Envelope from '@phosphor/envelope.svg';
import File from '@phosphor/file.svg';
import Hash from '@phosphor/hash.svg';
import Phone from '@phosphor/phone.svg';
import Plus from '@phosphor/plus.svg';
import Sparkle from '@phosphor/sparkle.svg';
import { Button } from '@ui';
import { createEffect, createSignal, For, on, Show } from 'solid-js';
import { plainDemoMentions } from '../../core/demo-mentions';
import type { WorkspaceComment } from '../../core/dummy-workspace';
import { homepagePeople } from '../../core/homepage-demo-people';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { ViewShell } from '../DemoWorkspaceChrome';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { Segments } from './frozen/DetailPanel';
import { MessageRow } from './frozen/MessageRow';
import { TaskMention } from './frozen/TaskMention';

/** channel/Thread: up to this many replies render inline under the root. */
const THREAD_PREVIEW = 3;

export function WorkspaceChannel(props: {
  workspace: DummyWorkspace;
  /** A walkthrough can show one message's hover toolbar. */
  hoveredMessage?: string;
  /** Replaces the default Task action, e.g. to open the task composer. */
  onTaskMessage?: (message: WorkspaceComment) => void;
}) {
  const w = props.workspace;
  const channel = () => w.data.channels.find((c) => c.id === w.channel());
  const name = () =>
    channel()?.person ? homepagePeople[channel()!.person!].name : w.channel();
  const [tab, setTab] = createSignal<
    'Messages' | 'Attachments' | 'Calls' | 'Participants'
  >('Messages');
  const [reply, setReply] = createSignal<string>();
  const [expanded, setExpanded] = createSignal<string[]>([]);
  let log: HTMLDivElement | undefined;
  const messages = () => channel()?.messages ?? [];
  const children = (id: string) => messages().filter((m) => m.replyTo === id);
  const scrollToConversation = (thread?: string) => {
    const channelId = w.channel();
    queueMicrotask(() => {
      if (!log || w.channel() !== channelId) return;
      const anchor = thread
        ? [...log.querySelectorAll<HTMLElement>('[data-thread-id]')].find(
            (element) => element.dataset.threadId === thread
          )
        : undefined;
      log.scrollTop = anchor
        ? log.scrollTop +
          anchor.getBoundingClientRect().top -
          log.getBoundingClientRect().top -
          16
        : log.scrollHeight;
    });
  };
  createEffect(
    on([w.channel, w.channelThread], ([channelId, thread], previous) => {
      if (channelId !== previous?.[0]) {
        setReply(undefined);
        setExpanded([]);
        setTab('Messages');
      }
      if (thread) {
        setTab('Messages');
        setExpanded((ids) => (ids.includes(thread) ? ids : [...ids, thread]));
      }
      scrollToConversation(thread);
    })
  );
  const startReply = (id: string) => {
    setReply(id);
    setExpanded((ids) => (ids.includes(id) ? ids : [...ids, id]));
  };
  const react = (id: string) =>
    w.setData(
      'channels',
      (c) => c.id === w.channel(),
      'messages',
      (m) => m.id === id,
      'reactions',
      (r) => (r?.length ? [] : ['jacob'])
    );
  const row = (message: WorkspaceComment, rootId = message.id) => (
    <MessageRow
      message={message}
      hovered={props.hoveredMessage === message.id}
      onReact={() => react(message.id)}
      onReply={() => startReply(rootId)}
      onChat={() => w.openItem('agents')}
      onTask={
        props.onTaskMessage
          ? () => props.onTaskMessage?.(message)
          : !message.taskId
            ? () => {
                const id = w.createTask(
                  plainDemoMentions(message.body).slice(0, 90),
                  message.body,
                  w.channel()
                );
                w.setData(
                  'channels',
                  (c) => c.id === w.channel(),
                  'messages',
                  (m) => m.id === message.id,
                  'taskId',
                  id
                );
              }
            : undefined
      }
    >
      <Show when={message.emailId}>
        {(id) => (
          <button
            type="button"
            class="dummy-entity-link"
            onClick={() => w.openItem('email', id())}
          >
            <Envelope class="size-4" />
            {w.data.emails.find((e) => e.id === id())?.subject}
          </button>
        )}
      </Show>
      <Show when={message.documentId}>
        {(id) => (
          <button
            type="button"
            class="dummy-entity-link"
            onClick={() => w.openItem('documents', id())}
          >
            <File class="size-4 text-note" />
            {w.data.documents.find((d) => d.id === id())?.title}
          </button>
        )}
      </Show>
      <For
        each={[
          ...(message.taskId ? [message.taskId] : []),
          ...(message.taskIds ?? []),
        ]}
      >
        {(id) => (
          <Show when={w.data.tasks.find((t) => t.id === id)}>
            {(task) => (
              <div>
                <TaskMention
                  task={task()}
                  onOpen={() => w.openItem('tasks', id)}
                />
              </div>
            )}
          </Show>
        )}
      </For>
    </MessageRow>
  );
  return (
    <>
      <ViewShell.TopBar>
        <Show when={w.view() === 'home'}>
          <button
            type="button"
            class="text-sm text-ink-muted"
            onClick={() => w.open('home')}
          >
            Home
          </button>
          <span class="text-ink-muted px-1">›</span>
        </Show>
        <Show when={channel()?.person} fallback={<Hash class="size-4" />}>
          {(person) => (
            <img
              alt=""
              class="size-5 rounded-full"
              src={homepagePeople[person()].photo}
            />
          )}
        </Show>
        <span class="text-sm font-medium truncate">{name()}</span>
        <Segments
          label="Conversation view"
          items={
            channel()?.person
              ? ['Messages', 'Attachments', 'Calls']
              : ['Messages', 'Attachments', 'Calls', 'Participants']
          }
          value={tab()}
          onChange={(next) => {
            setTab(next);
            if (next === 'Messages') scrollToConversation(w.channelThread());
          }}
        />
        <div class="ml-auto flex items-center gap-1">
          <Button size="sm" variant="plain" onClick={() => setTab('Calls')}>
            <Phone class="size-3" />
            Call
          </Button>
          <Button
            size="sm"
            variant="plain"
            onClick={() => w.openItem('agents')}
          >
            <Sparkle class="size-3" />
            Ask Macro
          </Button>
        </div>
      </ViewShell.TopBar>
      <div
        ref={log}
        class="dummy-scroll sample-chat-log"
        role="log"
        aria-label={`Channel ${w.channel()}`}
        tabIndex={0}
      >
        <Show when={tab() === 'Participants'}>
          <For each={['jacob', 'julia', 'teo'] as const}>
            {(person) => (
              <div class="flex items-center gap-3 py-3">
                <img
                  class="size-8 rounded-full"
                  alt=""
                  src={homepagePeople[person].photo}
                />
                {homepagePeople[person].name}
              </div>
            )}
          </For>
        </Show>
        <Show when={tab() === 'Calls'}>
          <p class="text-sm text-ink-muted text-center py-12">
            No calls in this sample conversation.
          </p>
        </Show>
        <Show when={tab() === 'Attachments'}>
          <For each={messages().filter((m) => m.emailId || m.documentId)}>
            {(message) => row(message)}
          </For>
          <Show when={!messages().some((m) => m.emailId || m.documentId)}>
            <p class="text-sm text-ink-muted text-center py-12">
              No attachments yet.
            </p>
          </Show>
        </Show>
        <Show when={tab() === 'Messages'}>
          <div class="sample-date-divider">
            <span>Today</span>
          </div>
          <For each={messages().filter((m) => !m.replyTo)}>
            {(message) => (
              <div
                class="sample-channel-thread"
                data-thread-id={message.id}
                data-thread-open={
                  children(message.id).length > 0 || reply() === message.id
                }
              >
                {row(message)}
                <Show
                  when={
                    children(message.id).length > 0 || reply() === message.id
                  }
                >
                  <div class="sample-thread-replies">
                    <For
                      each={
                        expanded().includes(message.id)
                          ? children(message.id)
                          : children(message.id).slice(0, THREAD_PREVIEW)
                      }
                    >
                      {(child) => row(child, message.id)}
                    </For>
                    <Show
                      when={
                        !expanded().includes(message.id) &&
                        children(message.id).length > THREAD_PREVIEW
                      }
                    >
                      <button
                        type="button"
                        class="sample-thread-expand"
                        title="Expand thread"
                        onClick={() =>
                          setExpanded((ids) => [...ids, message.id])
                        }
                      >
                        <span class="sample-thread-avatars" aria-hidden="true">
                          <For
                            each={[
                              ...new Set(
                                children(message.id)
                                  .slice(THREAD_PREVIEW)
                                  .map((m) => m.person)
                              ),
                            ].slice(0, 4)}
                          >
                            {(person) => (
                              <img alt="" src={homepagePeople[person].photo} />
                            )}
                          </For>
                        </span>
                        <span class="text-accent">
                          {children(message.id).length - THREAD_PREVIEW}{' '}
                          {children(message.id).length - THREAD_PREVIEW === 1
                            ? 'more reply'
                            : 'more replies'}
                        </span>
                        <span class="text-ink-extra-muted">
                          Last reply today
                        </span>
                        <CaretRight class="size-3 text-ink-extra-muted" />
                      </button>
                    </Show>
                    <Show
                      when={reply() === message.id}
                      fallback={
                        <Show
                          when={
                            expanded().includes(message.id) ||
                            children(message.id).length <= THREAD_PREVIEW
                          }
                        >
                          <button
                            type="button"
                            class="sample-thread-reply-button"
                            aria-label="Reply in thread"
                            onClick={() => startReply(message.id)}
                          >
                            <Plus class="size-4" />
                          </button>
                        </Show>
                      }
                    >
                      <div class="sample-thread-editor">
                        <ChannelComposer
                          richMentions
                          label="Thread reply"
                          placeholder="Send a reply"
                          onSend={(body) => {
                            w.post(
                              body,
                              undefined,
                              undefined,
                              undefined,
                              message.id
                            );
                            setReply(undefined);
                          }}
                        />
                        <Button
                          size="sm"
                          variant="plain"
                          onClick={() => setReply(undefined)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
      <Show when={tab() === 'Messages'}>
        <div class="dummy-composer sample-chat-composer">
          <ChannelComposer
            richMentions
            label={`Message #${w.channel()}`}
            placeholder={`Type @ to share with ${channel()?.person ? homepagePeople[channel()!.person!].shortName : `#${name()}`}`}
            onSend={(body) => {
              w.post(body);
              scrollToConversation();
            }}
          />
        </div>
      </Show>
    </>
  );
}
