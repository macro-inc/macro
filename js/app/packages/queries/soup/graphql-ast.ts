import type {
  GraphqlCallLiteralInput,
  GraphqlChannelLiteralInput,
  GraphqlChannelThreadLiteralInput,
  GraphqlChatLiteralInput,
  GraphqlCrmCompanyLiteralInput,
  GraphqlDateLiteralInput,
  GraphqlDocumentLiteralInput,
  GraphqlEmailLiteralInput,
  GraphqlEmailValueInput,
  GraphqlEntityFilterAstInput,
  GraphqlExprInput,
  GraphqlForeignEntityLiteralInput,
  GraphqlProjectLiteralInput,
  GraphqlPropertiesLiteralInput,
  GraphqlSoupInput,
} from '@service-storage/graphql-soup';
import type { SoupAstBody, SoupParams } from './items';

type RestAst =
  | { '&': [RestAst, RestAst] }
  | { '|': [RestAst, RestAst] }
  | { '!': RestAst }
  | { l: unknown };

type TargetAstKey =
  | 'df'
  | 'pf'
  | 'cf'
  | 'ef'
  | 'chanf'
  | 'cthf'
  | 'callf'
  | 'ccf'
  | 'fef'
  | 'propf';

type AstBody = Partial<Record<TargetAstKey, RestAst>> & {
  emailView?: 'inbox' | 'drafts' | 'sent' | 'all';
};

type LiteralMapper<TLiteral> = (literal: unknown) => TLiteral;

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
    case 'NotificationDone':
      return { notificationDone: mapBoolean(value, 'notificationDone') };
    case 'NotificationSeen':
      return { notificationSeen: mapBoolean(value, 'notificationSeen') };
    default:
      unsupported(`channel literal ${field}`);
  }
}

function mapChannelThreadLiteral(
  literal: unknown
): GraphqlChannelThreadLiteralInput {
  const [field, value] = singleLiteralField(literal);
  switch (field) {
    case 'ThreadId':
      return { threadId: mapString(value, 'threadId') };
    case 'ChannelId':
      return { channelId: mapString(value, 'channelId') };
    case 'RootSender':
    case 'Sender':
      return { rootSender: mapString(value, 'rootSender') };
    case 'NotificationDone':
      return { notificationDone: mapBoolean(value, 'notificationDone') };
    case 'NotificationSeen':
      return { notificationSeen: mapBoolean(value, 'notificationSeen') };
    default:
      unsupported(`channel thread literal ${field}`);
  }
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
    case 'Status':
      return {
        status: mapString(value, 'status') as
          | 'ATTENDED'
          | 'MISSED'
          | 'UNATTENDED',
      };
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

function mapSortMethod(
  sortMethod: SoupParams['sort_method']
): GraphqlSoupInput['sortMethod'] {
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
    case undefined:
      return undefined;
  }
}

function mapEmailView(
  view: AstBody['emailView']
): GraphqlSoupInput['emailView'] {
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
  }
}

export function makeGraphqlSoupInput(args: {
  params: SoupParams;
  body: SoupAstBody;
  cursor?: string | null;
}): GraphqlSoupInput {
  const body = args.body as AstBody;
  const filters: GraphqlEntityFilterAstInput = {};

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
  if (body.propf) {
    filters.propertiesFilter = compileExpr(body.propf, mapPropertiesLiteral);
  }

  return {
    limit: args.params.limit ?? undefined,
    expand: true,
    sortMethod: mapSortMethod(args.params.sort_method),
    cursor: args.cursor,
    emailView: mapEmailView(body.emailView),
    filters,
  };
}
