import {
  defineQueryFilters,
  type QueryState,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { match } from 'ts-pattern';
import type { ChannelContentKind, SharedReference } from '../core/content-kind';

const EMPTY_ID = '00000000-0000-0000-0000-000000000000';

export function channelContentScope(
  kind: ChannelContentKind,
  channelId: string,
  references: SharedReference[],
  state: QueryState = queryStateFrom({})
): QueryState {
  const ids = (...types: string[]) => {
    const values = [
      ...new Set(
        references
          .filter((reference) => types.includes(reference.entity_type))
          .map((reference) => reference.entity_id)
      ),
    ];
    return values.length ? values : [EMPTY_ID];
  };
  const scope = match(kind)
    .with('files', () =>
      defineQueryFilters({
        include: { documentId: ids('document', 'task') },
        exclude: {
          subType: ['task'],
          fileAssoc: ['assoc:image', 'assoc:video'],
        },
      })
    )
    .with('tasks', () =>
      defineQueryFilters({
        include: { documentId: ids('document', 'task'), subType: ['task'] },
      })
    )
    .with('calls', () =>
      defineQueryFilters({ include: { callChannelId: [channelId] } })
    )
    .with('agents', () =>
      defineQueryFilters({
        include: {
          agentSessionId: ids('agent_session'),
          includeAgentSessions: true,
          chatId: ids('chat'),
        },
      })
    )
    .exhaustive();
  const excludedSubTypes = [
    ...new Set([
      ...(state.exclude.subType ?? []),
      ...(scope.exclude?.subType ?? []),
    ]),
  ];
  const excludedFileTypes = [
    ...new Set([
      ...(state.exclude.fileAssoc ?? []),
      ...(scope.exclude?.fileAssoc ?? []),
    ]),
  ];
  return queryStateFrom({
    ...state,
    include: { ...state.include, ...scope.include },
    exclude: {
      ...state.exclude,
      ...scope.exclude,
      ...(excludedSubTypes.length ? { subType: excludedSubTypes } : {}),
      ...(excludedFileTypes.length ? { fileAssoc: excludedFileTypes } : {}),
    },
  });
}
