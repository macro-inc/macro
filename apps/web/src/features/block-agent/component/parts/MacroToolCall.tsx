/** Macro calls use the session's result surfaces, never nested legacy chat tools. */
import { DashboardToolView } from '@app/features/dynamic-ui/DashboardToolView.lazy';
import { ItemPreview } from '@core/component/ItemPreview';
import Bell from '@phosphor/bell.svg';
import Buildings from '@phosphor/buildings.svg';
import Calendar from '@phosphor/calendar-blank.svg';
import Envelope from '@phosphor/envelope.svg';
import FileText from '@phosphor/file-text.svg';
import Robot from '@phosphor/robot.svg';
import Tag from '@phosphor/tag.svg';
import Wrench from '@phosphor/wrench.svg';
import { TagDot } from '@property/tags/TagDot';
import type { ToolDetail } from '@service-agent-fold/generated/types';
import {
  deserializeToolCall,
  deserializeToolResponse,
  type NamedTool,
} from '@service-cognition/generated/tools/tool';
import {
  createMemo,
  ErrorBoundary,
  For,
  type JSX,
  Show,
  Suspense,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import { FoldedOutput, ToolCard } from '../../ui';
import { resultRecord, resultSummary, ToolResult } from '../../ui/ToolResult';
import type { ToolCallCommon, ToolCallContext } from './shared';

type MacroDetail = Extract<ToolDetail, { kind: 'macro' }>;

export function MacroToolCall(props: {
  detail: MacroDetail;
  common: ToolCallCommon;
  context?: ToolCallContext;
}): JSX.Element {
  const response = createMemo(() => {
    const parsed = deserializeToolResponse({
      id: props.common.id,
      name: props.common.label,
      json: props.detail.output,
    });
    return parsed.isOk() ? parsed.value : undefined;
  });
  const dashboard = createMemo(() => {
    if (props.common.label !== 'DisplayResults') return undefined;
    const call = deserializeToolCall({
      id: props.common.id,
      name: props.common.label,
      json: props.detail.input,
    });
    return call.isOk()
      ? (call.value as NamedTool<'DisplayResults', 'call'>).data.view
      : undefined;
  });
  const createdEntity = () => {
    const tool = response();
    if (tool?.name === 'CreateDocument')
      return (
        <ItemPreview
          id={(tool as NamedTool<'CreateDocument', 'response'>).data.documentId}
          type="document"
          class="ring-0"
        />
      );
    if (tool?.name === 'CreateProject')
      return (
        <ItemPreview
          id={(tool as NamedTool<'CreateProject', 'response'>).data.projectId}
          type="project"
          class="ring-0"
        />
      );
  };
  const tags = () => {
    const tool = response();
    return tool?.name === 'ListTags'
      ? (tool as NamedTool<'ListTags', 'response'>).data.tagSets
      : undefined;
  };
  const icon = () => {
    const name = props.common.label.toLowerCase();
    if (/calendar|event|reminder/.test(name)) return Calendar;
    if (/mail|inbox|thread/.test(name)) return Envelope;
    if (/bot|agent/.test(name)) return Robot;
    if (/tag|label/.test(name)) return Tag;
    if (/compan/.test(name)) return Buildings;
    if (/notification/.test(name)) return Bell;
    if (/document|content|entit|project/.test(name)) return FileText;
    return Wrench;
  };
  // Only schema-validated entities become navigation links.
  const entityLink = (item: unknown) => {
    const tool = response();
    if (tool?.name !== 'ListEntities') return undefined;
    const entity = (
      tool as NamedTool<'ListEntities', 'response'>
    ).data.items.find((entry) => entry.id === resultRecord(item)?.id);
    if (!entity) return undefined;
    return (
      <Suspense
        fallback={
          <span class="text-xs text-ink-extra-muted">Loading item…</span>
        }
      >
        <ItemPreview
          id={entity.id}
          type={match(entity.type)
            .with('aiChat', () => 'chat' as const)
            .with('calendarEvent', () => 'calendar_event' as const)
            .with('channelThread', () => 'channel_thread' as const)
            .with('foreignEntity', () => 'foreign' as const)
            .otherwise((type) => type)}
          class="ring-0"
        />
      </Suspense>
    );
  };
  return (
    <ToolCard
      icon={<Dynamic component={icon()} class="size-4" />}
      title={props.common.label}
      subtitle={props.detail.error ?? resultSummary(props.detail.output)}
      status={props.common.status}
      muted={props.common.muted}
      trailing={props.common.trailing}
    >
      <Show
        when={props.detail.error}
        fallback={
          <Show
            when={dashboard()}
            fallback={
              <Show
                when={props.detail.output != null}
                fallback={
                  <p class="px-4 py-4 text-xs text-ink-extra-muted">
                    {props.common.status === 'completed'
                      ? 'No output returned'
                      : 'Waiting for the result…'}
                  </p>
                }
              >
                <Show
                  when={tags()}
                  fallback={
                    <ToolResult
                      value={props.detail.output}
                      icon={<Dynamic component={icon()} class="size-4" />}
                      renderLink={entityLink}
                    />
                  }
                >
                  {(sets) => (
                    <div class="max-h-80 overflow-y-auto px-4 py-3">
                      <For each={sets()}>
                        {(set) => (
                          <section class="mb-4 last:mb-0">
                            <h4 class="mb-2 text-xs text-ink-extra-muted first-letter:uppercase">
                              {set.scope} · {set.tags.length}
                            </h4>
                            <div class="flex flex-wrap gap-2">
                              <For each={set.tags}>
                                {(tag) => (
                                  <span class="inline-flex max-w-full items-center gap-2 rounded-lg border border-edge-muted bg-ink/3 px-2.5 py-1.5 text-xs text-ink">
                                    <TagDot color={tag.color ?? undefined} />
                                    <span class="truncate" title={tag.label}>
                                      {tag.label}
                                    </span>
                                  </span>
                                )}
                              </For>
                            </div>
                          </section>
                        )}
                      </For>
                    </div>
                  )}
                </Show>
              </Show>
            }
          >
            {(view) => (
              <div class="p-4">
                <ErrorBoundary
                  fallback={<ToolResult value={props.detail.input} />}
                >
                  <Suspense
                    fallback={
                      <p class="text-xs text-ink-muted">Loading results…</p>
                    }
                  >
                    <DashboardToolView view={view()} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
          </Show>
        }
      >
        {(error) => (
          <p class="px-4 py-3 text-sm text-failure whitespace-pre-wrap wrap-break-word">
            {error()}
          </p>
        )}
      </Show>
      <Suspense>
        <Show when={createdEntity()}>
          {(link) => (
            <div class="border-t border-edge-muted px-4 py-3">{link()}</div>
          )}
        </Show>
      </Suspense>
      <details class="group/raw border-t border-edge-muted">
        <summary class="list-none px-4 py-2.5 text-xs text-ink-extra-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
          Request & response <span class="group-open/raw:hidden">↗</span>
        </summary>
        <div class="space-y-3 px-4 pb-4">
          <FoldedOutput
            label="Request"
            text={JSON.stringify(props.detail.input, null, 2) ?? 'No input'}
          />
          <Show when={props.detail.output != null}>
            <FoldedOutput
              label="Response"
              text={JSON.stringify(props.detail.output, null, 2)}
            />
          </Show>
        </div>
      </details>
    </ToolCard>
  );
}
