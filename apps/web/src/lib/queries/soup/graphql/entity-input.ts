import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type {
  GraphqlEntityFilterAst,
  SoupInput,
} from '@service-storage/graphql/generated/graphql';
import { match } from 'ts-pattern';

const NIL_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

type OrExpr<T> = T | { or: { left: OrExpr<T>; right: OrExpr<T> } };

// Balanced trees stay below the GraphQL filter ingress depth limit even for
// a full preview batch. A left-folded OR tree does not.
function or<T>(items: T[]): OrExpr<T> | undefined {
  if (items.length < 2) return items[0];
  const middle = Math.floor(items.length / 2);
  return {
    or: { left: or(items.slice(0, middle))!, right: or(items.slice(middle))! },
  };
}

/** Exact multi-entity lookup, with every non-target entity branch excluded. */
export function buildGraphqlEntitiesSoupInput(
  entities: ReadonlyArray<{ entityType: EntityType; entityId: string }>
): SoupInput | undefined {
  const ids = (...types: EntityType[]) =>
    [
      ...new Set(
        entities
          .filter((e) => types.includes(e.entityType))
          .map((e) => e.entityId)
      ),
    ].sort();
  const input = buildGraphqlEntitySoupInput('DOCUMENT', NIL_ENTITY_ID);
  if (!input || !('initial' in input) || !input.initial) return undefined;
  const base = input.initial.filters!;
  const filters: GraphqlEntityFilterAst = {
    ...base,
    documentFilter:
      or(ids('DOCUMENT', 'TASK').map((id) => ({ literal: { id } }))) ??
      base.documentFilter,
    projectFilter:
      or(
        ids('PROJECT').map((projectIdSelf) => ({ literal: { projectIdSelf } }))
      ) ?? base.projectFilter,
    chatFilter:
      or(ids('CHAT').map((chatId) => ({ literal: { chatId } }))) ??
      base.chatFilter,
    emailFilter: {
      tree:
        or(ids('THREAD').map((threadId) => ({ literal: { threadId } }))) ??
        base.emailFilter!.tree,
    },
    channelFilter:
      or(ids('CHANNEL').map((channelId) => ({ literal: { channelId } }))) ??
      base.channelFilter,
    callFilter:
      or(ids('CALL_RECORD').map((callId) => ({ literal: { callId } }))) ??
      base.callFilter,
    crmCompanyFilter:
      or(ids('COMPANY').map((id) => ({ literal: { id } }))) ??
      base.crmCompanyFilter,
    calendarEventFilter:
      or(ids('CALENDAR_EVENT').map((id) => ({ literal: { id } }))) ??
      base.calendarEventFilter,
  };
  const count = new Set(
    entities
      .filter((e) => e.entityType !== 'USER')
      .map(
        (e) =>
          `${e.entityType === 'TASK' ? 'DOCUMENT' : e.entityType}:${e.entityId}`
      )
  ).size;
  if (!count) return undefined;
  return { initial: { ...input.initial, limit: count, filters } };
}

/** Builds an exact single-entity Soup query with every non-target branch excluded. */
export function buildGraphqlEntitySoupInput(
  entityType: EntityType,
  entityId: string
): SoupInput | undefined {
  const targetFilter: Partial<GraphqlEntityFilterAst> | undefined = match(
    entityType
  )
    .with('DOCUMENT', 'TASK', () => ({
      documentFilter: { literal: { id: entityId } },
    }))
    .with('PROJECT', () => ({
      projectFilter: { literal: { projectIdSelf: entityId } },
    }))
    .with('CHAT', () => ({
      chatFilter: { literal: { chatId: entityId } },
    }))
    .with('THREAD', () => ({
      emailFilter: { tree: { literal: { threadId: entityId } } },
    }))
    .with('CHANNEL', () => ({
      channelFilter: { literal: { channelId: entityId } },
    }))
    .with('CALL_RECORD', () => ({
      callFilter: { literal: { callId: entityId } },
    }))
    .with('COMPANY', () => ({
      crmCompanyFilter: { literal: { id: entityId } },
    }))
    .with('CALENDAR_EVENT', () => ({
      calendarEventFilter: { literal: { id: entityId } },
    }))
    .with('USER', () => undefined)
    .exhaustive();
  if (!targetFilter) return undefined;

  const filters: GraphqlEntityFilterAst = {
    calendarEventFilter: { literal: { id: NIL_ENTITY_ID } },
    documentFilter: { literal: { id: NIL_ENTITY_ID } },
    projectFilter: { literal: { projectIdSelf: NIL_ENTITY_ID } },
    chatFilter: { literal: { chatId: NIL_ENTITY_ID } },
    emailFilter: {
      tree: { literal: { threadId: NIL_ENTITY_ID } },
    },
    channelFilter: { literal: { channelId: NIL_ENTITY_ID } },
    channelThreadFilter: { literal: { threadId: NIL_ENTITY_ID } },
    callFilter: { literal: { callId: NIL_ENTITY_ID } },
    crmCompanyFilter: { literal: { id: NIL_ENTITY_ID } },
    foreignEntityFilter: { literal: { id: NIL_ENTITY_ID } },
    ...targetFilter,
  };

  return {
    initial: {
      limit: 1,
      expand: true,
      sortMethod: 'UPDATED_AT',
      emailView: 'ALL',
      filters,
    },
  };
}
