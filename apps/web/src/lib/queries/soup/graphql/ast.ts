import { FileTypeMap } from '@service-storage/fileTypeMap';
import type {
  GraphqlAgentSessionLiteral,
  GraphqlCalendarEventLiteral as GraphqlCalendarEventLiteralInput,
  GraphqlCallLiteral as GraphqlCallLiteralInput,
  GraphqlCallStatus,
  GraphqlChannelLiteral as GraphqlChannelLiteralInput,
  GraphqlChannelThreadLiteral as GraphqlChannelThreadLiteralInput,
  GraphqlChatLiteral as GraphqlChatLiteralInput,
  GraphqlCrmAssociation,
  GraphqlCrmCompanyLiteral as GraphqlCrmCompanyLiteralInput,
  GraphqlCrmContactLiteral,
  GraphqlDateLiteral as GraphqlDateLiteralInput,
  GraphqlDocumentLiteral as GraphqlDocumentLiteralInput,
  GraphqlEmailLiteral as GraphqlEmailLiteralInput,
  GraphqlEmailValue as GraphqlEmailValueInput,
  GraphqlEntityFilterAst as GraphqlEntityFilterAstInput,
  GraphqlForeignEntityLiteral as GraphqlForeignEntityLiteralInput,
  GraphqlGithubPullRequestLiteral as GraphqlGithubPullRequestLiteralInput,
  GraphqlGithubPullRequestReviewStatus,
  GraphqlGithubPullRequestState,
  GraphqlGroupByInput,
  GroupedSoupContinuationInput as GraphqlGroupedSoupContinuationInput,
  GroupedSoupInput as GraphqlGroupedSoupInput,
  GraphqlInitiativeLiteral as GraphqlInitiativeLiteralInput,
  GraphqlProjectLiteral as GraphqlProjectLiteralInput,
  GraphqlFilterPropertiesLiteral as GraphqlPropertiesLiteralInput,
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
  | 'if'
  | 'cf'
  | 'ef'
  | 'chanf'
  | 'cthf'
  | 'callf'
  | 'ccf'
  | 'crmf'
  | 'fef'
  | 'ghprf'
  | 'asf'
  | 'propf';

type AstBody = Partial<Record<TargetAstKey, RestAst>> & {
  favorites_only?: SoupAstBody['favorites_only'];
  crma?: SoupAstBody['crma'];
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
  return compileExprWithLeaf(ast, (literal) => ({
    literal: mapLiteral(literal),
  }));
}

/**
 * The server rejects a `filters` value nested deeper than 64 JSON levels
 * (`graphql_soup_filter_input::MAX_FILTER_DEPTH`), and `filters` wraps an
 * expression in at most two of them (`emailFilter.tree`).
 */
const MAX_EXPR_DEPTH = 62;

/**
 * Filter builders chain clauses one-sidedly and each and/or adds two JSON
 * levels, so about thirty clauses (the Channels view looking up labelled
 * channels by id) exceed the server's depth limit. Those expressions are
 * regrouped into balanced trees; expressions that already fit keep their
 * shape, so their variables and normalized-cache entries stay the same.
 */
function compileExprWithLeaf<TLiteral>(
  ast: RestAst,
  mapLeaf: (literal: unknown) => GraphqlExprInput<TLiteral>
): GraphqlExprInput<TLiteral> {
  const compiled = compileExprNode(ast, mapLeaf);
  return jsonDepth(compiled) > MAX_EXPR_DEPTH
    ? compileExprNode(balanceOperatorRuns(ast), mapLeaf)
    : compiled;
}

function compileExprNode<TLiteral>(
  ast: RestAst,
  mapLeaf: (literal: unknown) => GraphqlExprInput<TLiteral>
): GraphqlExprInput<TLiteral> {
  if ('&' in ast)
    return {
      and: {
        left: compileExprNode(ast['&'][0], mapLeaf),
        right: compileExprNode(ast['&'][1], mapLeaf),
      },
    };
  if ('|' in ast)
    return {
      or: {
        left: compileExprNode(ast['|'][0], mapLeaf),
        right: compileExprNode(ast['|'][1], mapLeaf),
      },
    };
  if ('!' in ast) return { not: compileExprNode(ast['!'], mapLeaf) };
  return mapLeaf(ast.l);
}

function jsonDepth(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 1;
  let deepest = 0;
  for (const child of Object.values(value))
    deepest = Math.max(deepest, jsonDepth(child));
  return 1 + deepest;
}

type AssociativeOperator = '&' | '|';

function operatorPair(
  ast: RestAst,
  operator: AssociativeOperator
): [RestAst, RestAst] | undefined {
  if (operator === '&') return '&' in ast ? ast['&'] : undefined;
  return '|' in ast ? ast['|'] : undefined;
}

/** Flattens nested uses of one operator into its operands, in order. */
function collectOperands(
  ast: RestAst,
  operator: AssociativeOperator,
  operands: RestAst[]
): RestAst[] {
  const pair = operatorPair(ast, operator);
  if (!pair) {
    operands.push(ast);
    return operands;
  }
  collectOperands(pair[0], operator, operands);
  return collectOperands(pair[1], operator, operands);
}

function joinBalanced(
  operator: AssociativeOperator,
  operands: readonly RestAst[]
): RestAst {
  if (operands.length === 1) return operands[0];
  const middle = Math.ceil(operands.length / 2);
  const left = joinBalanced(operator, operands.slice(0, middle));
  const right = joinBalanced(operator, operands.slice(middle));
  return operator === '&' ? { '&': [left, right] } : { '|': [left, right] };
}

function balanceOperatorRuns(ast: RestAst): RestAst {
  if ('!' in ast) return { '!': balanceOperatorRuns(ast['!']) };
  const operator: AssociativeOperator | undefined =
    '&' in ast ? '&' : '|' in ast ? '|' : undefined;
  if (!operator) return ast;
  return joinBalanced(
    operator,
    collectOperands(ast, operator, []).map(balanceOperatorRuns)
  );
}

function mapDocumentPredicate(
  literal: unknown
): GraphqlExprInput<GraphqlDocumentLiteralInput> {
  const [field, value] = singleLiteralField(literal);
  if (field !== 'fa') return { literal: mapDocumentLiteral(literal) };
  if (typeof value !== 'string' || !value.startsWith('assoc:'))
    unsupported('invalid file association');
  const association = value.slice('assoc:'.length);
  const types = Object.values(FileTypeMap);
  if (
    association !== 'other' &&
    !types.some((type) => type.app === association)
  )
    unsupported(`unknown file association ${association}`);
  // Match item_filters::ast::document::other. The Files Other category adds
  // its own image/document/video exclusions on top of this association.
  const extensions = [
    ...new Set(
      types
        .filter((type) =>
          association === 'other'
            ? !['write', 'pdf', 'md', 'canvas', 'code', 'video'].includes(
                type.app
              )
            : type.app === association
        )
        .map((type) => type.extension)
    ),
  ];
  const balanced = (
    start: number,
    end: number
  ): GraphqlExprInput<GraphqlDocumentLiteralInput> => {
    if (end - start === 1) return { literal: { fileType: extensions[start] } };
    const middle = Math.floor((start + end) / 2);
    return {
      or: { left: balanced(start, middle), right: balanced(middle, end) },
    };
  };
  // Balanced expansion keeps large Code/Other sets within the AST depth budget.
  return extensions.length
    ? balanced(0, extensions.length)
    : { literal: { id: '00000000-0000-0000-0000-000000000000' } };
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

function mapDocumentSubType(value: unknown): 'TASK' | 'SNIPPET' | 'SKILL' {
  const subType = mapString(value, 'subType');
  if (subType === 'task') return 'TASK';
  if (subType === 'snippet') return 'SNIPPET';
  if (subType === 'skill') return 'SKILL';
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
    case 'ns':
      return { notificationState: mapNotificationState(value) };
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
    case 'ns':
      return { notificationState: mapNotificationState(value) };
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
    case 'prop':
      return { property: mapPropertiesLiteral(value) };
    case 'eap':
      return { emailAttachmentParticipant: mapEmailValue(value) };
    case 'crm':
      return { crmAssociated: mapCrmAssociation(value) };
    case 'nc':
      return { nameContains: mapString(value, 'nameContains') };
    default:
      unsupported(`document literal ${field}`);
  }
}

function mapCrmAssociation(value: unknown): GraphqlCrmAssociation {
  if (value === 'activity') return { activity: true };
  const [field, id] = singleLiteralField(value);
  if (field === 'company') return { company: mapString(id, 'company') };
  if (field === 'contact') return { contact: mapString(id, 'contact') };
  unsupported(`CRM association ${field}`);
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
    case 'ns':
      return { notificationState: mapNotificationState(value) };
    case 'ca':
      return { createdAt: mapDateLiteral(value) };
    case 'ua':
      return { updatedAt: mapDateLiteral(value) };
    default:
      unsupported(`project literal ${field}`);
  }
}

function mapInitiativeLiteral(literal: unknown): GraphqlInitiativeLiteralInput {
  const [field, value] = singleLiteralField(literal);
  if (field === 'inc' && value === true) return { include: true };
  if (field === 'id') return { id: mapString(value, 'id') };
  if (field === 'o') return { owner: mapString(value, 'owner') };
  if (field === 'ns') return { notificationState: mapNotificationState(value) };
  return unsupported(`initiative literal ${field}`);
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
    case 'ns':
      return { notificationState: mapNotificationState(value) };
    case 'ca':
      return { createdAt: mapDateLiteral(value) };
    case 'ua':
      return { updatedAt: mapDateLiteral(value) };
    default:
      unsupported(`chat literal ${field}`);
  }
}

function mapNotificationState(value: unknown) {
  return match(value)
    .with('unseen', () => 'UNSEEN' as const)
    .with('seen', () => 'SEEN' as const)
    .with('done', () => 'DONE' as const)
    .otherwise(() => unsupported(`notification state ${String(value)}`));
}

function mapEmailLiteral(literal: unknown): GraphqlEmailLiteralInput {
  const [field, value] = singleLiteralField(literal);
  switch (field) {
    case 'Sender':
      return { sender: mapEmailValue(value) };
    case 'Recipient':
      return { recipient: mapEmailValue(value) };
    case 'Cc':
      return { cc: mapEmailValue(value) };
    case 'Bcc':
      return { bcc: mapEmailValue(value) };
    case 'ThreadId':
      return { threadId: mapString(value, 'threadId') };
    case 'Owner':
      return { owner: mapString(value, 'owner') };
    case 'ProjectId':
      return { projectId: mapString(value, 'projectId') };
    case 'Importance':
      return { importance: mapBoolean(value, 'importance') };
    case 'NotificationState':
      return { notificationState: mapNotificationState(value) };
    case 'Read':
      return { read: mapBoolean(value, 'read') };
    case 'InboxVisible':
      return { inboxVisible: mapBoolean(value, 'inboxVisible') };
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
    case 'NotificationState':
      return { notificationState: mapNotificationState(value) };
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
  | 'NotificationState'
  | 'HasReplies';

const CHANNEL_THREAD_LITERAL_FIELDS = [
  'ThreadId',
  'ChannelId',
  'RootSender',
  'Sender',
  'Participant',
  'NotificationState',
  'HasReplies',
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
    .with('HasReplies', () => ({
      hasReplies: mapBoolean(value, 'hasReplies'),
    }))
    .with('NotificationState', () => ({
      notificationState: mapNotificationState(value),
    }))
    .exhaustive(() => ({ threadId: '00000000-0000-0000-0000-000000000000' }));
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

function mapCrmContactLiteral(literal: unknown): GraphqlCrmContactLiteral {
  if (literal === 'include') return { include: true };
  const [field, value] = singleLiteralField(literal);
  switch (field) {
    case 'id':
      return { id: mapString(value, 'id') };
    case 'team_id':
      return { teamId: mapString(value, 'teamId') };
    case 'company_id':
      return { companyId: mapString(value, 'companyId') };
    case 'email':
      return { email: mapString(value, 'email') };
    case 'search':
      return { search: mapString(value, 'search') };
    case 'hidden':
      return { hidden: mapBoolean(value, 'hidden') };
    default:
      unsupported(`crm contact literal ${field}`);
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
    case 'ns':
      return { notificationState: mapNotificationState(value) };
    default:
      unsupported(`foreign entity literal ${field}`);
  }
}

function mapGithubPullRequestState(
  value: unknown
): GraphqlGithubPullRequestState {
  const state = mapString(value, 'status');
  if (state === 'open') return 'OPEN';
  if (state === 'closed') return 'CLOSED';
  if (state === 'merged') return 'MERGED';
  unsupported(`unsupported pull request status ${state}`);
}

function mapGithubPullRequestReviewStatus(
  value: unknown
): GraphqlGithubPullRequestReviewStatus {
  const status = mapString(value, 'reviewStatus');
  if (status === 'none') return 'NONE';
  if (status === 'required') return 'REQUIRED';
  if (status === 'approved') return 'APPROVED';
  if (status === 'changes_requested') return 'CHANGES_REQUESTED';
  unsupported(`unsupported pull request review status ${status}`);
}

function mapGithubPullRequestLiteral(
  literal: unknown
): GraphqlGithubPullRequestLiteralInput {
  const [field, value] = singleLiteralField(literal);
  switch (field) {
    case 'repo':
      return {
        repositoryId:
          typeof value === 'number'
            ? String(value)
            : mapString(value, 'repositoryId'),
      };
    case 'au':
      return { author: mapString(value, 'author') };
    case 'st':
      return { status: mapGithubPullRequestState(value) };
    case 'inv':
      return { involves: mapString(value, 'involves') };
    case 'rr':
      return { reviewRequested: mapString(value, 'reviewRequested') };
    case 'draft':
      return { draft: mapBoolean(value, 'draft') };
    case 'as':
      return { assignee: mapString(value, 'assignee') };
    case 'lbl':
      return { label: mapString(value, 'label') };
    case 'rs':
      return { reviewStatus: mapGithubPullRequestReviewStatus(value) };
    case 'rb':
      return { reviewedBy: mapString(value, 'reviewedBy') };
    default:
      unsupported(`github pull request literal ${field}`);
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
  if (body.favorites_only !== undefined)
    filters.favoritesOnly = body.favorites_only;
  if (body.crma) filters.crmAssociation = mapCrmAssociation(body.crma);

  if (body.calf) {
    filters.calendarEventFilter = compileExpr(
      body.calf,
      mapCalendarEventLiteral
    );
  }
  if (body.df)
    filters.documentFilter = compileExprWithLeaf(body.df, mapDocumentPredicate);
  if (body.pf) filters.projectFilter = compileExpr(body.pf, mapProjectLiteral);
  if (body.if)
    filters.initiativeFilter = compileExpr(body.if, mapInitiativeLiteral);
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
  if (body.crmf) {
    filters.crmContactFilter = compileExpr(body.crmf, mapCrmContactLiteral);
  }
  if (body.fef) {
    filters.foreignEntityFilter = compileExpr(
      body.fef,
      mapForeignEntityLiteral
    );
  }
  if (body.ghprf) {
    filters.githubPullRequestFilter = compileExpr(
      body.ghprf,
      mapGithubPullRequestLiteral
    );
  }
  if (body.asf) {
    filters.agentSessionFilter = compileExpr(
      body.asf,
      (literal): GraphqlAgentSessionLiteral => {
        const [field, value] = singleLiteralField(literal);
        if (field === 'inc' && value === true) return { include: true };
        if (field === 'id' && typeof value === 'string') return { id: value };
        if (field === 'o' && typeof value === 'string') return { owner: value };
        if (field === 'src' && value === 'user') return { source: 'USER' };
        if (field === 'src' && value === 'agent') return { source: 'AGENT' };
        if (field === 'src' && value === 'routine')
          return { source: 'ROUTINE' };
        if (field === 'vis' && value === 'listed')
          return { visibility: 'LISTED' };
        if (field === 'vis' && value === 'unlisted')
          return { visibility: 'UNLISTED' };
        if (field === 'vis' && value === 'hidden')
          return { visibility: 'HIDDEN' };
        return unsupported(`agent session literal ${field}`);
      }
    );
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
    .exhaustive(() => ({ field: 'ENTITY_TYPE' as const }));
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
