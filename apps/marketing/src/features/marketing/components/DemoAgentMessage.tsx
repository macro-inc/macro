import { Collapsible } from '@kobalte/core/collapsible';
import CaretRight from '@phosphor/caret-right.svg';
import FileText from '@phosphor/file-text.svg';
import Pencil from '@phosphor/pencil-simple.svg';
import Terminal from '@phosphor/terminal.svg';
import { UserMessageBubble } from '@ui/components/UserMessageBubble';
import {
  createSignal,
  For,
  type JSX,
  lazy,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import type {
  DemoAgentMessage,
  DemoMessagePart,
} from '../core/deploy-agent-demo';
import { TextPart } from './DemoMarkdown';

const DeployDiff = lazy(() => import('./DemoDeployDiff'));

type ToolPart = Extract<DemoMessagePart, { kind: 'tool_use' }>;

function Thought(props: { text: string }) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <div class="relative text-xs leading-5 text-ink-extra-muted">
      <button
        type="button"
        aria-expanded={expanded()}
        class="flex min-h-7 items-center gap-1 py-1 text-left text-ink-extra-muted hover:text-ink-muted"
        onClick={() => setExpanded(!expanded())}
      >
        <CaretRight
          class="size-4 shrink-0"
          classList={{ 'rotate-90': expanded() }}
        />
        Thought
      </button>
      <Show when={expanded()}>
        <div class="pl-5 text-ink-muted whitespace-pre-wrap wrap-break-word select-text">
          {props.text}
        </div>
      </Show>
    </div>
  );
}

function ToolRow(props: { part: ToolPart }) {
  const [expanded, setExpanded] = createSignal(false);
  const detail = () => props.part.detail;
  const terminal = () => {
    const value = detail();
    return value.kind === 'terminal' ? value : undefined;
  };
  const read = () => {
    const value = detail();
    return value.kind === 'read' ? value : undefined;
  };
  const edit = () => {
    const value = detail();
    return value.kind === 'edit' ? value : undefined;
  };
  const subtitle = () => {
    const value = detail();
    if (value.kind === 'terminal') return value.command;
    const paths =
      value.kind === 'read'
        ? value.paths
        : value.diffs.map((diff) => diff.path);
    return paths.length > 1 ? `${paths.length} files` : paths[0];
  };
  const result = () => {
    const value = detail();
    if (value.kind === 'read')
      return `${value.paths.length} ${value.paths.length === 1 ? 'file' : 'files'}`;
    if (value.kind === 'edit')
      return (
        <div class="flex shrink-0 items-center gap-2">
          <span class="font-mono tabular-nums text-success">+8</span>
          <span class="font-mono tabular-nums text-failure">−1</span>
        </div>
      );
    return 'Succeeded';
  };
  return (
    <div
      class="min-w-0 text-ink-extra-muted"
      data-tool-row
      data-tool-status="completed"
    >
      <Collapsible open={expanded()} onOpenChange={setExpanded}>
        <Collapsible.Trigger class="group flex min-h-8 w-full min-w-0 items-center gap-2 py-1 text-left text-sm leading-6 outline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
          <span
            aria-hidden="true"
            class="flex size-4 shrink-0 items-center justify-center text-ink-extra-muted [&>svg]:size-4"
          >
            <Switch fallback={<Pencil />}>
              <Match when={detail().kind === 'terminal'}>
                <Terminal />
              </Match>
              <Match when={detail().kind === 'read'}>
                <FileText />
              </Match>
            </Switch>
          </span>
          <span class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <span
              class="min-w-0 truncate text-ink-muted"
              title={props.part.name.name}
            >
              {props.part.name.name}
            </span>
            <span aria-hidden="true" class="shrink-0 text-ink-placeholder">
              ·
            </span>
            <span class="truncate font-mono" title={subtitle()}>
              {subtitle()}
            </span>
          </span>
          <span class="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap text-xs tabular-nums text-ink-extra-muted">
            {result()}
            <CaretRight
              aria-hidden="true"
              class="size-3.5 shrink-0 group-data-expanded:rotate-90"
            />
          </span>
        </Collapsible.Trigger>
        <Collapsible.Content class="data-closed:hidden">
          <Show when={expanded()}>
            <div class="min-w-0 pb-2 pl-6 text-xs leading-5">
              <Switch>
                <Match when={terminal()}>
                  {(value) => (
                    <pre class="overflow-x-auto rounded bg-surface p-2 font-mono text-xs whitespace-pre-wrap text-ink-muted wrap-break-word">
                      {value().output}
                    </pre>
                  )}
                </Match>
                <Match when={read()}>
                  {(value) => (
                    <div class="-mx-3 -my-2">
                      <For each={value().paths}>
                        {(path) => (
                          <div class="flex min-h-8 items-center gap-2 px-3 py-1.5 text-xs leading-4">
                            <div class="flex size-4 shrink-0 items-center justify-center text-ink-extra-muted">
                              <FileText class="size-4" />
                            </div>
                            <div class="min-w-0 flex-1">
                              <span class="truncate font-mono text-xs">
                                {path}
                              </span>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </Match>
                <Match when={edit()}>
                  <div class="flex flex-col gap-2">
                    <Suspense
                      fallback={
                        <div class="rounded border border-edge-muted px-3 py-2 font-mono text-xs text-ink-muted">
                          Loading diff…
                        </div>
                      }
                    >
                      <DeployDiff />
                    </Suspense>
                  </div>
                </Match>
              </Switch>
            </div>
          </Show>
        </Collapsible.Content>
      </Collapsible>
    </div>
  );
}

function Part(props: { part: DemoMessagePart }) {
  return (
    <Switch>
      <Match when={props.part.kind === 'text' && props.part}>
        {(part) => <TextPart text={part().text} />}
      </Match>
      <Match when={props.part.kind === 'thought' && props.part}>
        {(part) => <Thought text={part().text} />}
      </Match>
      <Match when={props.part.kind === 'tool_use' && props.part}>
        {(part) => <ToolRow part={part()} />}
      </Match>
    </Switch>
  );
}

function ToolGroup(props: { parts: DemoMessagePart[] }) {
  const [expanded, setExpanded] = createSignal(false);
  const count = () =>
    props.parts.filter((part) => part.kind === 'tool_use').length;
  return (
    <Collapsible
      open={expanded()}
      onOpenChange={setExpanded}
      class="min-w-0 text-sm leading-6 text-ink-extra-muted"
    >
      <Collapsible.Trigger class="group flex min-h-8 items-center gap-2 py-1 text-left text-ink-extra-muted hover:text-ink-muted">
        Called {count()} {count() === 1 ? 'tool' : 'tools'}
        <CaretRight
          aria-hidden="true"
          class="size-4 shrink-0 opacity-0 group-data-expanded:rotate-90 group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </Collapsible.Trigger>
      <Collapsible.Content class="data-closed:hidden">
        <Show when={expanded()}>
          <div class="flex min-w-0 flex-col pl-6">
            <For each={props.parts}>{(part) => <Part part={part} />}</For>
          </div>
        </Show>
      </Collapsible.Content>
    </Collapsible>
  );
}

function segments(parts: DemoMessagePart[]) {
  const groups: DemoMessagePart[][] = [];
  for (const part of parts) {
    const previous = groups.at(-1);
    if (
      part.kind !== 'text' &&
      previous?.every((value) => value.kind !== 'text')
    )
      previous.push(part);
    else groups.push([part]);
  }
  return groups;
}

/** Fixture-only transcript; no app sessions, providers, model calls, or editor. */
export function AgentMessage(props: {
  message: DemoAgentMessage;
  inFlight?: boolean;
}): JSX.Element {
  return (
    <Show
      when={props.message.author.kind === 'user'}
      fallback={
        <div class="flex flex-col gap-1 min-w-0">
          <For each={segments(props.message.parts)}>
            {(parts) => (
              <Show
                when={
                  parts.length > 1 &&
                  parts.some((part) => part.kind === 'tool_use')
                }
                fallback={
                  <For each={parts}>{(part) => <Part part={part} />}</For>
                }
              >
                <ToolGroup parts={parts} />
              </Show>
            )}
          </For>
          <Show when={props.inFlight}>
            <p class="py-2 text-sm text-ink-extra-muted" role="status">
              Working…
            </p>
          </Show>
        </div>
      }
    >
      <div class="flex w-full flex-col items-end gap-0.5">
        <UserMessageBubble>
          <For each={props.message.parts}>{(part) => <Part part={part} />}</For>
        </UserMessageBubble>
      </div>
    </Show>
  );
}
