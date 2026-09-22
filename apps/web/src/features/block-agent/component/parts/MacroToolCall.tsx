/**
 * A Macro tool the fold recognized by name — reached over Macro's MCP
 * server, or called natively by Macro's own agent.
 *
 * Schema-validated results supply compact summaries and useful links. The
 * disclosure always shows the actual exchange, including results a dedicated
 * renderer does not recognize, without nesting another tool row or disclosure.
 */

import { ItemPreview } from '@core/component/ItemPreview';
import ReadIcon from '@phosphor/file-text.svg';
import GlobeIcon from '@phosphor/globe.svg';
import ListIcon from '@phosphor/list-bullets.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import WrenchIcon from '@phosphor/wrench.svg';
import { useSystemSkillsQuery } from '@queries/storage/system-skills';
import type { ToolDetail } from '@service-agent-fold/generated/types';
import {
  deserializeToolCall,
  deserializeToolResponse,
  type NamedTool,
  type ToolName,
} from '@service-cognition/generated/tools/tool';
import {
  createMemo,
  ErrorBoundary,
  For,
  type JSX,
  Show,
  Suspense,
} from 'solid-js';
import { match } from 'ts-pattern';
import { FoldedExchange, ToolCard } from '../../ui';
import type { ToolCallCommon, ToolCallContext } from './shared';

type MacroDetail = Extract<ToolDetail, { kind: 'macro' }>;
type ToolResponse = NamedTool<ToolName, 'response'>;
type ToolCall = NamedTool<ToolName, 'call'>;

export function MacroToolCall(props: {
  detail: MacroDetail;
  common: ToolCallCommon;
  context?: ToolCallContext;
}): JSX.Element {
  const response = createMemo(() =>
    deserializeToolResponse({
      id: props.common.id,
      name: props.common.label,
      json: props.detail.output,
    }).unwrapOr(undefined)
  );
  const call = createMemo(() =>
    deserializeToolCall({
      id: props.common.id,
      name: props.common.label,
      json: props.detail.input,
    }).unwrapOr(undefined)
  );
  const subtitle = () => {
    const input = call()?.data;
    if (input && 'query' in input && typeof input.query === 'string') {
      return input.query;
    }
    if (input && 'url' in input && typeof input.url === 'string') {
      return input.url;
    }
    if (
      (props.common.label === 'WebSearch' ||
        props.common.label === 'WebFetch') &&
      input &&
      'input' in input &&
      typeof input.input === 'string'
    ) {
      return input.input;
    }
    if (
      (props.common.label === 'SearchSkills' ||
        props.common.label === 'NameSearch') &&
      input &&
      'name' in input &&
      typeof input.name === 'string'
    ) {
      return input.name;
    }
    return props.common.server;
  };
  const error = () => props.detail.error ?? responseError(response());
  const failure = () => error() != null;

  return (
    <ToolCard
      icon={<MacroToolIcon name={props.common.label} />}
      title={props.common.label}
      subtitle={subtitle()}
      status={props.common.status}
      muted={props.common.muted || failure()}
      trailing={
        props.common.trailing ??
        (failure()
          ? 'Failed'
          : props.common.status === 'completed'
            ? resultSummary(response())
            : undefined)
      }
      hasContent={
        props.detail.input != null ||
        props.detail.output != null ||
        Boolean(props.detail.error)
      }
    >
      <div class="flex min-w-0 flex-col gap-2">
        <ErrorBoundary fallback={null}>
          <MacroResultLinks call={call()} response={response()} />
        </ErrorBoundary>
        <FoldedExchange
          request={props.detail.input}
          response={props.detail.output}
          error={error()}
        />
      </div>
    </ToolCard>
  );
}

/** Counts come from schema-validated results, never prose or input guesses. */
function resultSummary(response: ToolResponse | undefined): string | undefined {
  if (!response) return undefined;
  const data = response.data;
  if (typeof data !== 'object' || data === null) return undefined;
  if ('results' in data && Array.isArray(data.results)) {
    const additional =
      'additional_matches' in data && Array.isArray(data.additional_matches)
        ? data.additional_matches.length
        : 0;
    const count = data.results.length + additional;
    return `${count} ${count === 1 ? 'result' : 'results'}`;
  }
  if ('items' in data && Array.isArray(data.items)) {
    return `${data.items.length} ${data.items.length === 1 ? 'item' : 'items'}`;
  }
  if (
    isResponse(response, 'WebSearch') &&
    Array.isArray(response.data.content)
  ) {
    const count = response.data.content.length;
    return `${count} ${count === 1 ? 'result' : 'results'}`;
  }
  return undefined;
}

/** The generated NamedTool type does not correlate its name and data unions. */
function isResponse<Name extends ToolName>(
  response: ToolResponse | undefined,
  name: Name
): response is NamedTool<Name, 'response'> {
  return response?.name === name;
}

function responseError(response: ToolResponse | undefined): string | undefined {
  if (!response) return undefined;
  const data = response.data;
  if (typeof data !== 'object' || data === null) return undefined;
  if ('success' in data && data.success === false) {
    return 'message' in data && typeof data.message === 'string'
      ? data.message || 'The tool did not succeed.'
      : 'The tool did not succeed.';
  }
  if (
    isResponse(response, 'WebFetch') &&
    response.data.content.type === 'web_fetch_tool_result_error'
  ) {
    return response.data.content.error_code;
  }
  if (
    isResponse(response, 'WebSearch') &&
    !Array.isArray(response.data.content)
  ) {
    return response.data.content.error_code;
  }
  return undefined;
}

type ResultLink =
  | {
      kind: 'entity';
      id: string;
      type: 'document' | 'chat' | 'project';
      label: string;
    }
  | { kind: 'web'; url: string; label: string };

function resultLinks(
  call: ToolCall | undefined,
  response: ToolResponse | undefined
): ResultLink[] {
  if (
    isResponse(response, 'WebSearch') &&
    Array.isArray(response.data.content)
  ) {
    return response.data.content.map((result) => ({
      kind: 'web',
      url: result.url,
      label: result.title,
    }));
  }
  if (
    isResponse(response, 'WebFetch') &&
    response.data.content.type === 'web_fetch_result'
  ) {
    const result = response.data.content;
    return [
      {
        kind: 'web',
        url: result.url,
        label: result.content.title ?? result.url,
      },
    ];
  }
  if (
    isResponse(response, 'SearchSkills') ||
    isResponse(response, 'ListSkills')
  ) {
    return response.data.results.map((result) => ({
      kind: 'entity',
      id: result.documentId,
      type: 'document',
      label: result.name,
    }));
  }
  if (!call) return [];
  const data = call.data;
  if (
    (call.name === 'ReadContent' || call.name === 'ReadMetadata') &&
    'documentId' in data &&
    typeof data.documentId === 'string'
  ) {
    return [
      {
        kind: 'entity',
        id: data.documentId,
        type: 'document',
        label: 'Document',
      },
    ];
  }
  if (
    call.name === 'ReadChat' &&
    'chatId' in data &&
    typeof data.chatId === 'string'
  ) {
    return [{ kind: 'entity', id: data.chatId, type: 'chat', label: 'Chat' }];
  }
  if (
    call.name === 'ReadProject' &&
    'projectId' in data &&
    typeof data.projectId === 'string'
  ) {
    return [
      { kind: 'entity', id: data.projectId, type: 'project', label: 'Project' },
    ];
  }
  return [];
}

function MacroResultLinks(props: {
  call: ToolCall | undefined;
  response: ToolResponse | undefined;
}) {
  const links = createMemo(() => resultLinks(props.call, props.response));
  return (
    <Show when={links().length > 0}>
      <ul
        class="flex max-h-64 flex-col gap-1 overflow-y-auto"
        aria-label="Tool results"
      >
        <For each={links()}>
          {(link) => (
            <li class="min-w-0">
              {link.kind === 'entity' ? (
                <Suspense fallback={<span>{link.label}</span>}>
                  {link.type === 'document' ? (
                    <DocumentResultLink id={link.id} />
                  ) : (
                    <ItemPreview
                      id={link.id}
                      type={link.type}
                      class="max-w-full ring-0"
                    />
                  )}
                </Suspense>
              ) : (
                <Show
                  when={/^https?:\/\//i.test(link.url)}
                  fallback={<span>{link.label}</span>}
                >
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-link hover:underline wrap-break-word"
                  >
                    {link.label}
                  </a>
                </Show>
              )}
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

/** Built-in skills have readable contents but no document to navigate to. */
function DocumentResultLink(props: { id: string }) {
  const systemSkills = useSystemSkillsQuery();
  return (
    <Show
      when={systemSkills.getSystemSkill(props.id)}
      fallback={
        <ItemPreview id={props.id} type="document" class="max-w-full ring-0" />
      }
    >
      {(skill) => <span class="text-ink">{skill().name}</span>}
    </Show>
  );
}

function MacroToolIcon(props: { name: string }): JSX.Element {
  return match(props.name)
    .with(
      'ContentSearch',
      'NameSearch',
      'SearchSkills',
      'SearchTools',
      'WebSearch',
      () => <SearchIcon class="size-4" />
    )
    .with(
      'ReadContent',
      'ReadMetadata',
      'ReadThread',
      'ReadChat',
      'ReadProject',
      () => <ReadIcon class="size-4" />
    )
    .with('WebFetch', () => <GlobeIcon class="size-4" />)
    .with('EditDocument', 'EditSpreadsheet', 'CreateDocument', () => (
      <PencilIcon class="size-4" />
    ))
    .with('ListEntities', 'ListSkills', 'ListCalendarEvents', () => (
      <ListIcon class="size-4" />
    ))
    .otherwise(() => <WrenchIcon class="size-4" />);
}
