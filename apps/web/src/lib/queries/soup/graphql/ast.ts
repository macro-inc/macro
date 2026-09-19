import type {
  GraphqlCalendarEventLiteral as GraphqlCalendarEventLiteralInput,
  GraphqlCallLiteral as GraphqlCallLiteralInput,
  GraphqlCallStatus,
  GraphqlChannelLiteral as GraphqlChannelLiteralInput,
  GraphqlChannelThreadLiteral as GraphqlChannelThreadLiteralInput,
  GraphqlChatLiteral as GraphqlChatLiteralInput,
  GraphqlCrmCompanyLiteral as GraphqlCrmCompanyLiteralInput,
  GraphqlDateLiteral as GraphqlDateLiteralInput,
  GraphqlDocumentLiteral as GraphqlDocumentLiteralInput,
  GraphqlEmailLiteral as GraphqlEmailLiteralInput,
  GraphqlEmailValue as GraphqlEmailValueInput,
  GraphqlEntityFilterAst as GraphqlEntityFilterAstInput,
  GraphqlForeignEntityLiteral as GraphqlForeignEntityLiteralInput,
  GraphqlGroupByInput,
  GroupedSoupContinuationInput as GraphqlGroupedSoupContinuationInput,
  GroupedSoupInput as GraphqlGroupedSoupInput,
  GraphqlProjectLiteral as GraphqlProjectLiteralInput,
  GraphqlFilterPropertiesLiteral as GraphqlPropertiesLiteralInput,
  GraphqlReminderLiteral as GraphqlReminderLiteralInput,
  SoupInitialInput as GraphqlSoupInitialInput,
  SoupInput as GraphqlSoupInput,
} from '@service-storage/graphql/generated/graphql';
import { match } from 'ts-pattern';

type GraphqlExprInput<TLiteral> =
  | {
      and: {
        left: GraphqlExprInput<TLiteral>;
        right: GraphqlExprInput<TLiteral>;
      };
    }
  | {
      or: {
        left: GraphqlExprInput<TLiteral>;
        right: GraphqlExprInput<TLiteral>;
      };
    }
  | { not: GraphqlExprInput<TLiteral> }
  | { literal: TLiteral };

import type { GroupByField } from '../grouped/types';
import type { SoupAstBody, SoupParams } from '../items';

type RestAst =
  | { '&': [RestAst, RestAst] }
  | { '|': [RestAst, RestAst] }
  | { '!': RestAst }
  | { l: unknown };

type TargetAstKey =
  | 'calf'
  | 'df'
  | 'pf'
  | 'cf'
  | 'ef'
  | 'chanf'
  | 'cthf'
  | 'callf'
  | 'ccf'
  | 'fef'
  | 'remf'
  | 'propf';

type AstBody = Partial<Record<TargetAstKey, RestAst>> & {
  /** CRM-address and CRM-domain filters are REST-only today. */
  eca?: string[];
  ecd?: string[];
  emailView?: 'inbox' | 'drafts' | 'sent' | 'all';
};

type LiteralMapper<TLiteral> = (literal: unknown) => TLiteral;

const GRAPHQL_CALL_STATUSES = [
  'ATTENDED',
  'MISSED',
  'UNATTENDED',
] as const satisfies readonly GraphqlCallStatus[];

function isGraphqlCallStatus(value: string): value is GraphqlCallStatus {
  return GRAPHQL_CALL_STATUSES.includes(value as GraphqlCallStatus);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unsupported(message: string): never {
  throw new Error(`Unsupported GraphQL Soup AST: ${message}`);
}

function compileExpr<TLiteral>(
  ast: RestAst,
  mapLiteral: LiteralMapper<TLiteral>
): GraphqlExprInput<TLiteral> {
  if ('&' in ast) {
    return {
      and: {
        left: compileExpr(ast['&'][0], mapLiteral),
        right: compileExpr(ast['&'][1], mapLiteral),
      },
    };
  }
  if ('|' in ast) {
    return {
      or: {
        left: compileExpr(ast['|'][0], mapLiteral),
        right: compileExpr(ast['|'][1], mapLiteral),
      },
    };
  }
  if ('!' in ast) {
    return { not: compileExpr(ast['!'], mapLiteral) };
  }
  return { literal: mapLiteral(ast.l) };
}

function singleLiteralField(literal: unknown): [string, unknown] {
  if (typeof literal === 'string') return [literal, true];
  if (!isRecord(literal))
    unsupported(`expected literal object, got ${typeof literal}`);

  const entries = Object.entries(literal);
  if (entries.length !== 1)
    unsupported(`expected one literal field, got ${entries.length}`);

  return entries[0];
}

function mapDateLiteral(value: unknown): GraphqlDateLiteralInput {
  if (!isRecord(value)) unsupported('expected date literal object');

  if (typeof value.gt === 'string') return { gt: value.gt };
  if (typeof value.gte === 'string') return { gte: value.gte };
  if (typeof value.lt === 'string') return { lt: value.lt };
  if (typeof value.lte === 'string') return { lte: value.lte };

  unsupported('expected one of gt/gte/lt/lte date literal');
}

function mapBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') unsupported(`${field} must be boolean`);
  return value;
}

function mapString(value: unknown, field: string): string {
  if (typeof value !== 'string') unsupported(`${field} must be string`);
  return value;
}

function mapDocumentSubType(value: unknown): 'TASK' | 'SNIPPET' {
  const subType = mapString(value, 'subType');
  if (subType === 'task') return 'TASK';
  if (subType === 'snippet') return 'SNIPPET';
  unsupported(`unsupported document subType ${subType}`);
}

function mapChannelType(
  value: unknown
): 'PUBLIC' | 'PRIVATE' | 'DIRECT_MESSAGE' | 'TEAM' {
  const channelType = mapString(value, 'channelType');
  switch (channelType) {
    case 'public':
      return 'PUBLIC';
    case 'private':
      return 'PRIVATE';
    case 'direct_message':
      return 'DIRECT_MESSAGE';
    case 'team':
      return 'TEAM';
    default:
      unsupported(`unsupported channelType ${channelType}`);
  }
}

function mapEmailShared(value: unknown): 'EXCLUDE' | 'INCLUDE' | 'ONLY' {
  const shared = mapString(value, 'shared');
  switch (shared) {
    case 'exclude':
      return 'EXCLUDE';
    case 'include':
      return 'INCLUDE';
    case 'only':
      return 'ONLY';
    default:
      unsupported(`unsupported shared email filter ${shared}`);
  }
}

function mapEmailValue(value: unknown): GraphqlEmailValueInput {
  if (typeof value === 'string') return { complete: value };
  if (!isRecord(value)) unsupported('expected email value object');

  if (typeof value.Partial === 'string') return { partial: value.Partial };
  if (typeof value.partial === 'string') return { partial: value.partial };
  if (typeof value.Complete === 'string') return { complete: value.Complete };
  if (typeof value.complete === 'string') return { complete: value.complete };
  if (typeof value.Domain === 'string') return { domain: value.Domain };
  if (typeof value.domain === 'string') return { domain: value.domain };

  unsupported('expected partial/complete/domain email value');
}

function mapCalendarEventLiteral(
  literal: unknown
): GraphqlCalendarEventLiteralInput {
  const [field, value] = singleLiteralField(literal);
  switch (field) {
    case 'id':
      return { id: mapString(value, 'id') };
    case 'nd':
      return { notificationDone: mapBoolean(value, 'notificationDone') };
    case 'ns':
      return { notificationSeen: mapBoolean(value, 'notificationSeen') };
    default:
      unsupported(`calendar event literal ${field}`);
  }
}

function mapDocumentLiteral(literal: unknown): GraphqlDocumentLiteralInput {
  const [field, value] = singleLiteralField(literal);
  switch (field) {
    case 'ft':
      return { fileType: mapString(value, 'fileType') };
    case 'fa':
      return unsupported(
        'file association filters are not supported by GraphQL Soup yet'
      );
    case 'id':
      return { id: mapString(value, 'id') };
    case 'pid':
      return { projectId: mapString(value, 'projectId') };
    case 'o':
      return { owner: mapString(value, 'owner') };
    case 'imp':
      return { importance: mapBoolean(value, 'importance') };
    case 'nd':
      return { notificationDone: mapBoolean(value, 'notificationDone') };
    case 'ns':
      return { notificationSeen: mapBoolean(value, 'notificationSeen') };
    case 'cbm':
      return { includeCbmAtmNc: mapBoolean(value, 'includeCbmAtmNc') };
    case 'dst':
      return { subType: mapDocumentSubType(value) };
    case 'iea':
      return { isEmailAttachment: mapBoolean(value, 'isEmailAttachment') };
    case 'ca':
      return { createdAt: mapDateLiteral(value) };
    case 'ua':
      return { updatedAt: mapDateLiteral(value) };
    default:
      unsupported(`document literal ${field}`);
  }
}

function mapProjectLiteral(literal: unknown): GraphqlProjectLiteralInput {
  const [field, value] = singleLiteralField(literal);
  switch (field) {
    case 'pid':
      return { projectId: mapString(value, 'projectId') };
    case 'pids':
      return { projectIdSelf: mapString(value, 'projectIdSelf') };
    case 'o':
      return { owner: mapString(value, 'owner') };
    case 'imp':
      return { importance: mapBoolean(value, 'importance') };
    case 'nd':
      return { notificationDone: mapBoolean(value, 'notificationDone') };
    case 'ns':
      return { notificationSeen: mapBoolean(value, 'notificationSeen') };
    case 'ca':
      return { createdAt: mapDateLiteral(value) };
    case 'ua':
      return { updatedAt: mapDateLiteral(value) };
    default:
      unsupported(`project literal ${field}`);
  }
}

function mapChatLiteral(literal: unknown): GraphqlChatLiteralInput {
  const [field, value] = singleLiteralField(literal);
  switch (field) {
    case 'cid':
      return { chatId: mapString(value, 'chatId') };
    case 'pid':
      return { projectId: mapString(value, 'projectId') };
    case 'o':
      return { owner: mapString(value, 'owner') };
    case 'imp':
      return { importance: mapBoolean(value, 'importance') };
    case 'nd':
      return { notificationDone: mapBoolean(value, 'notificationDone') };
    case 'ns':
      return { notificationSeen: mapBoolean(value, 'notificationSeen') };
    case 'ca':
      return { createdAt: mapDateLiteral(value) };
    case 'ua':
      return { updatedAt: mapDateLiteral(value) };
    default:
      unsupported(`chat literal ${field}`);
  }
}

function mapEmailLiteral(literal: unknown): GraphqlEmailLiteralInput {
  const [field, value] = singleLiteralField(literal);
  switch (field) {
    case 'Sender':
      return { sender: mapEmailValue(value) };
    case 'ThreadId':
      return { threadId: mapString(value, 'threadId') };
    case 'Owner':
      return { owner: mapString(value, 'owner') };
    case 'ProjectId':
      return { projectId: mapString(value, 'projectId') };
    case 'Importance':
      return { importance: mapBoolean(value, 'importance') };
    case 'NotificationDone':
      return { notificationDone: mapBoolean(value, 'notificationDone') };
    case 'NotificationSeen':
      return { notificationSeen: mapBoolean(value, 'notificationSeen') };
    case 'Shared':
      return { shared: mapEmailShared(value) };
    case 'CalendarOnly':
      return { calendarOnly: mapBoolean(value, 'calendarOnly') };
    case 'ca':
      return { createdAt: mapDateLiteral(value) };
    case 'ua':
      return { updatedAt: mapDateLiteral(value) };
    default:
      unsupported(`email literal ${field}`);
  }
}

function mapChannelLiteral(literal: unknown): GraphqlChannelLiteralInput {
  const [field, value] = singleLiteralField(literal);
  switch (field) {
    case 'ThreadId':
      return { threadId: mapString(value, 'threadId') };
    case 'ChannelId':
      return { channelId: mapString(value, 'channelId') };
    case 'Sender':
      return { sender: mapString(value, 'sender') };
    case 'ChannelType':
      return { channelType: mapChannelType(value) };
    case 'Importance':
      return { importance: mapBoolean(value, 'importance') };
    case 'IsParticipant':
      return { isParticipant: mapBoolean(value, 'isParticipant') };
    case 'NotificationDone':
      return { notificationDone: mapBoolean(value, 'notificationDone') };
    case 'NotificationSeen':
      return { notificationSeen: mapBoolean(value, 'notificationSeen') };
    default:
      unsupported(`channel literal ${field}`);
  }
}

type ChannelThreadLiteralField =
  | 'ThreadId'
  | 'ChannelId'
  | 'RootSender'
  | 'Sender'
  | 'Participant'
  | 'NotificationDone'
  | 'NotificationSeen';

const CHANNEL_THREAD_LITERAL_FIELDS = [
  'ThreadId',
  'ChannelId',
  'RootSender',
  'Sender',
  'Participant',
  'NotificationDone',
  'NotificationSeen',
] as const satisfies readonly ChannelThreadLiteralField[];

function isChannelThreadLiteralField(
  field: string
): field is ChannelThreadLiteralField {
  return CHANNEL_THREAD_LITERAL_FIELDS.includes(
    field as ChannelThreadLiteralField
  );
}

function mapChannelThreadLiteral(
  literal: unknown
): GraphqlChannelThreadLiteralInput {
  const [field, value] = singleLiteralField(literal);
  if (!isChannelThreadLiteralField(field)) {
    unsupported(`channel thread literal ${field}`);
  }

  return match(field)
    .with('ThreadId', () => ({ threadId: mapString(value, 'threadId') }))
    .with('ChannelId', () => ({ channelId: mapString(value, 'channelId') }))
    .with('RootSender', 'Sender', () => ({
      rootSender: mapString(value, 'rootSender'),
    }))
    .with('Participant', () => ({
      participant: mapString(value, 'participant'),
    }))
    .with('NotificationDone', () => ({
      notificationDone: mapBoolean(value, 'notificationDone'),
    }))
    .with('NotificationSeen', () => ({
      notificationSeen: mapBoolean(value, 'notificationSeen'),
    }))
    .exhaustive();
}

function mapCallLiteral(literal: unknown): GraphqlCallLiteralInput {
  const [field, value] = singleLiteralField(literal);
  switch (field) {
    case 'CallId':
      return { callId: mapString(value, 'callId') };
    case 'ChannelId':
      return { channelId: mapString(value, 'channelId') };
    case 'Speaker':
      return { speaker: mapString(value, 'speaker') };
    case 'Status': {
      const status = mapString(value, 'status');
      if (!isGraphqlCallStatus(status)) unsupported(`call status ${status}`);
      return { status };
    }
    case 'Attended':
      return { attended: mapBoolean(value, 'attended') };
    default:
      unsupported(`call literal ${field}`);
  }
}

function mapCrmCompanyLiteral(literal: unknown): GraphqlCrmCompanyLiteralInput {
  const [field, value] = singleLiteralField(literal);
  switch (field) {
    case 'id':
      return { id: mapString(value, 'id') };
    case 'hidden':
      return { hidden: mapBoolean(value, 'hidden') };
    default:
      unsupported(`crm company literal ${field}`);
  }
}

function mapForeignEntityLiteral(
  literal: unknown
): GraphqlForeignEntityLiteralInput {
  const [field, value] = singleLiteralField(literal);
  switch (field) {
    case 'id':
      return { id: mapString(value, 'id') };
    case 'feid':
      return { foreignEntityId: mapString(value, 'foreignEntityId') };
    case 'fes':
      return { foreignEntitySource: mapString(value, 'foreignEntitySource') };
    case 'me':
      return { includesMe: mapBoolean(value, 'includesMe') };
    case 'nd':
      return { notificationDone: mapBoolean(value, 'notificationDone') };
    case 'ns':
      return { notificationSeen: mapBoolean(value, 'notificationSeen') };
    default:
      unsupported(`foreign entity literal ${field}`);
  }
}

function mapReminderLiteral(literal: unknown): GraphqlReminderLiteralInput {
  const [field, value] = singleLiteralField(literal);
  switch (field) {
    // `inc` is a unit literal, so it only ever arrives as `true` — which is
    // the only value the server accepts, reminders being opt-in.
    case 'inc':
      return { include: mapBoolean(value, 'include') };
    case 'id':
      return { id: mapString(value, 'id') };
    case 'ent':
      return { entity: mapString(value, 'entity') };
    case 'comp':
      return { completed: mapBoolean(value, 'completed') };
    case 'fired':
      return { fired: mapBoolean(value, 'fired') };
    default:
      unsupported(`reminder literal ${field}`);
  }
}

function mapPropertiesLiteral(literal: unknown): GraphqlPropertiesLiteralInput {
  if (!isRecord(literal)) unsupported('expected property literal object');
  const propertyDefinitionId = mapString(literal.pd, 'propertyDefinitionId');
  const value = literal.v;
  if (!isRecord(value)) unsupported('expected property value matcher object');

  if (typeof value.so === 'string') {
    return { propertyDefinitionId, value: { selectOption: value.so } };
  }
  if (typeof value.er === 'string') {
    return { propertyDefinitionId, value: { entityRef: value.er } };
  }

  unsupported('expected property value so or er');
}

function mapSortDirection(
  sortDirection: SoupParams['sort_direction']
): GraphqlSoupInitialInput['sortDirection'] {
  switch (sortDirection) {
    case 'asc':
      return 'ASC';
    case 'desc':
      return 'DESC';
    case undefined:
      return undefined;
  }
}

function mapSortMethod(
  sortMethod: SoupParams['sort_method']
): GraphqlSoupInitialInput['sortMethod'] {
  switch (sortMethod) {
    case 'viewed_at':
      return 'VIEWED_AT';
    case 'created_at':
      return 'CREATED_AT';
    case 'updated_at':
      return 'UPDATED_AT';
    case 'viewed_updated':
      return 'VIEWED_UPDATED';
    case 'frecency':
      return unsupported('sort_method frecency');
    case 'touched_by_me':
      return unsupported('sort_method touched_by_me');
    case 'notified_at':
      return unsupported('sort_method notified_at');
    case undefined:
      return undefined;
  }
}

function mapEmailView(
  view: AstBody['emailView']
): GraphqlSoupInitialInput['emailView'] {
  switch (view) {
    case 'inbox':
      return 'INBOX';
    case 'drafts':
      return 'DRAFTS';
    case 'sent':
      return 'SENT';
    case 'all':
      return 'ALL';
    case undefined:
      return undefined;
    default:
      return unsupported(`email view ${view}`);
  }
}

function assertGraphqlCompatibleBody(body: AstBody): void {
  if (body.eca !== undefined) {
    unsupported(
      'CRM-scoped email address filters are not supported by GraphQL Soup yet'
    );
  }
  if (body.ecd !== undefined) {
    unsupported(
      'CRM-scoped email domain filters are not supported by GraphQL Soup yet'
    );
  }
}

function makeGraphqlFilters(body: AstBody): GraphqlEntityFilterAstInput {
  assertGraphqlCompatibleBody(body);
  const filters: GraphqlEntityFilterAstInput = {};

  if (body.calf) {
    filters.calendarEventFilter = compileExpr(
      body.calf,
      mapCalendarEventLiteral
    );
  }
  if (body.df)
    filters.documentFilter = compileExpr(body.df, mapDocumentLiteral);
  if (body.pf) filters.projectFilter = compileExpr(body.pf, mapProjectLiteral);
  if (body.cf) filters.chatFilter = compileExpr(body.cf, mapChatLiteral);
  if (body.ef)
    filters.emailFilter = { tree: compileExpr(body.ef, mapEmailLiteral) };
  if (body.chanf)
    filters.channelFilter = compileExpr(body.chanf, mapChannelLiteral);
  if (body.cthf) {
    filters.channelThreadFilter = compileExpr(
      body.cthf,
      mapChannelThreadLiteral
    );
  }
  if (body.callf) filters.callFilter = compileExpr(body.callf, mapCallLiteral);
  if (body.ccf) {
    filters.crmCompanyFilter = compileExpr(body.ccf, mapCrmCompanyLiteral);
  }
  if (body.fef) {
    filters.foreignEntityFilter = compileExpr(
      body.fef,
      mapForeignEntityLiteral
    );
  }
  if (body.remf) {
    filters.reminderFilter = compileExpr(body.remf, mapReminderLiteral);
  }
  if (body.propf) {
    filters.propertiesFilter = compileExpr(body.propf, mapPropertiesLiteral);
  }

  return filters;
}

export function makeGraphqlSoupInput(args: {
  params: SoupParams;
  body: SoupAstBody;
  cursor?: string | null;
}): GraphqlSoupInput {
  const body = args.body as AstBody;
  assertGraphqlCompatibleBody(body);
  const emailView = mapEmailView(body.emailView);

  // The cursor does not carry the direction, so the continuation has to
  // re-send it or page two comes back in the opposite order.
  const sortDirection = mapSortDirection(args.params.sort_direction);

  if (args.cursor != null) {
    return {
      continuation: {
        cursor: args.cursor,
        expand: true,
        emailView,
        sortDirection,
      },
    };
  }

  return {
    initial: {
      limit: args.params.limit ?? undefined,
      expand: true,
      sortMethod: mapSortMethod(args.params.sort_method),
      sortDirection,
      emailView,
      filters: makeGraphqlFilters(body),
    },
  };
}

function makeGraphqlGroupByInput(groupBy: GroupByField): GraphqlGroupByInput {
  return match(groupBy)
    .with({ type: 'date' }, () => ({ field: 'DATE' as const }))
    .with({ type: 'entity_type' }, () => ({
      field: 'ENTITY_TYPE' as const,
    }))
    .with({ type: 'project' }, () => ({ field: 'PROJECT' as const }))
    .with({ type: 'property' }, (field) => ({
      field: 'PROPERTY' as const,
      propertyDefinitionId: field.propertyDefinitionId,
      entityType: field.entityType,
    }))
    .exhaustive();
}

/** Maps the existing grouped Soup request shape to its GraphQL input. */
export function makeGraphqlGroupedSoupInput(args: {
  params: SoupParams;
  body: SoupAstBody;
  groupBy: GroupByField;
}): GraphqlGroupedSoupInput {
  const body = args.body as AstBody;
  assertGraphqlCompatibleBody(body);
  if (body.emailView !== undefined) {
    unsupported('email views are not supported by grouped GraphQL Soup yet');
  }

  return {
    initial: {
      groupBy: makeGraphqlGroupByInput(args.groupBy),
      limit: args.params.limit ?? undefined,
      sortMethod: mapSortMethod(args.params.sort_method),
      filters: makeGraphqlFilters(body),
    },
  };
}

/** Builds the GraphQL input for continuing one grouped Soup bin. */
export function makeGraphqlGroupedSoupContinuationInput(args: {
  groupBy: GroupByField;
  groupKey: string;
  cursor: string;
}): GraphqlGroupedSoupInput {
  const continuation: GraphqlGroupedSoupContinuationInput = {
    groupBy: makeGraphqlGroupByInput(args.groupBy),
    groupKey: args.groupKey,
    cursor: args.cursor,
  };
  return { continuation };
}
