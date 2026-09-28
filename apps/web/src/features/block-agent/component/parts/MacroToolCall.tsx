/**
 * A Macro tool the fold recognized by name — reached over Macro's MCP
 * server, or called natively by Macro's own agent.
 *
 * Successful calls reuse their registered result renderer and its disclosure.
 * Running, stopped, failed, and unsupported calls keep a summary-only row.
 * Only registered result renderers supply disclosures; raw payloads stay hidden.
 */

import {
  hasToolRenderer,
  RenderTool,
} from '@core/component/AI/component/tool/handler';
import ReadIcon from '@phosphor/file-text.svg';
import GlobeIcon from '@phosphor/globe.svg';
import ListIcon from '@phosphor/list-bullets.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import WrenchIcon from '@phosphor/wrench.svg';
import type { ToolDetail } from '@service-agent-fold/generated/types';
import {
  deserializeToolCall,
  deserializeToolResponse,
  type NamedTool,
  type ToolName,
} from '@service-cognition/generated/tools/tool';
import { createMemo, ErrorBoundary, type JSX, Show, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import { ToolCard } from '../../ui';
import type { ToolCallCommon, ToolCallContext } from './shared';

type MacroDetail = Extract<ToolDetail, { kind: 'macro' }>;
type ToolResponse = NamedTool<ToolName, 'response'>;

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

  const fallback = () => (
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
    />
  );
  const canRenderResults = () =>
    props.common.status === 'completed' &&
    !props.common.muted &&
    props.common.trailing == null &&
    !failure() &&
    call() !== undefined &&
    response() !== undefined &&
    hasToolRenderer(props.common.label);

  return (
    <Show when={canRenderResults()} fallback={fallback()}>
      <ErrorBoundary fallback={fallback()}>
        <Suspense fallback={fallback()}>
          <RenderTool
            tool_id={props.common.id}
            name={props.common.label}
            json={props.detail.input}
            response={{ json: props.detail.output, name: props.common.label }}
            chat_id={props.context?.sessionId ?? ''}
            message_id={props.context?.messageId ?? ''}
            part_index={props.context?.partIndex ?? 0}
            isComplete={true}
            renderContext={{
              renderContext: { isStreaming: false, grouped: true },
            }}
          />
        </Suspense>
      </ErrorBoundary>
    </Show>
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
