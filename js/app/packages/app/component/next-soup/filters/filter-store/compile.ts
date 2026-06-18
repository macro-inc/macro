import type {
  DateRangeFilter,
  DocumentFieldFilters,
  DocumentFilterExpression,
  EmailView,
  FieldFilters,
  FieldName,
  PropertyFilter,
  Query,
  QueryState,
} from './types';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

type BackendAst =
  | { '&': [BackendAst, BackendAst] }
  | { '|': [BackendAst, BackendAst] }
  | { '!': BackendAst }
  | { l: unknown };

type QueryTarget =
  | 'df'
  | 'ef'
  | 'chanf'
  | 'cf'
  | 'pf'
  | 'callf'
  | 'fef'
  | 'ccf'
  | 'propf';

export type TargetAstMap = {
  [K in QueryTarget]?: BackendAst;
} & {
  emailView?: EmailView;
};

type DateRangeFieldName =
  | 'documentCreatedAt'
  | 'documentUpdatedAt'
  | 'chatCreatedAt'
  | 'chatUpdatedAt'
  | 'folderCreatedAt'
  | 'folderUpdatedAt'
  | 'emailUpdatedAt';

type CompiledFieldName = Exclude<FieldName, 'properties' | DateRangeFieldName>;

const AST = {
  or(asts: BackendAst[]): BackendAst {
    if (asts.length === 0) return { l: {} };
    if (asts.length === 1) return asts[0];
    return asts.reduceRight((acc, ast) => ({ '|': [ast, acc] }));
  },
  and(asts: BackendAst[]): BackendAst {
    if (asts.length === 0) return { l: {} };
    if (asts.length === 1) return asts[0];
    return asts.reduceRight((acc, ast) => ({ '&': [ast, acc] }));
  },
  not(ast: BackendAst): BackendAst {
    return { '!': ast };
  },
  literal(field: string, value?: unknown): BackendAst {
    return value === undefined ? { l: field } : { l: { [field]: value } };
  },
};

const FIELD_CONFIG: Record<
  CompiledFieldName,
  {
    target: QueryTarget;
    field: string;
    formatValue?: (value: unknown) => unknown;
    // unit: true -> `{ l: field }`; unit: false/undefined -> `{ l: { field: value } }`
    unit?: boolean;
  }
> = {
  documentId: { target: 'df', field: 'id' },
  fileType: { target: 'df', field: 'ft' },
  fileAssoc: { target: 'df', field: 'fa' },
  subType: { target: 'df', field: 'dst' },
  projectId: { target: 'df', field: 'pid' },
  documentOwnerId: { target: 'df', field: 'o' },
  documentSeen: { target: 'df', field: 'ns' },
  documentDone: { target: 'df', field: 'nd' },
  isEmailAttachment: { target: 'df', field: 'iea' },
  threadId: { target: 'ef', field: 'ThreadId' },
  emailLinkId: { target: 'ef', field: 'Owner' },
  emailSeen: { target: 'ef', field: 'NotificationSeen' },
  emailDone: { target: 'ef', field: 'NotificationDone' },
  emailImportance: { target: 'ef', field: 'Importance' },
  emailProjectId: { target: 'ef', field: 'ProjectId' },
  emailSender: {
    target: 'ef',
    field: 'Sender',
    formatValue: (v) => ({ Partial: v }),
  },
  emailShared: { target: 'ef', field: 'Shared' },
  emailCalendarOnly: { target: 'ef', field: 'CalendarOnly' },
  channelId: { target: 'chanf', field: 'ChannelId' },
  channelType: { target: 'chanf', field: 'ChannelType' },
  channelSeen: { target: 'chanf', field: 'NotificationSeen' },
  channelDone: { target: 'chanf', field: 'NotificationDone' },
  channelImportance: { target: 'chanf', field: 'Importance' },
  channelSenderId: { target: 'chanf', field: 'Sender' },
  chatId: { target: 'cf', field: 'cid' },
  chatOwnerId: { target: 'cf', field: 'o' },
  chatProjectId: { target: 'cf', field: 'pid' },
  chatSeen: { target: 'cf', field: 'ns' },
  chatDone: { target: 'cf', field: 'nd' },
  folderId: { target: 'pf', field: 'pid' },
  folderOwnerId: { target: 'pf', field: 'o' },
  folderSeen: { target: 'pf', field: 'ns' },
  folderDone: { target: 'pf', field: 'nd' },
  callId: { target: 'callf', field: 'CallId' },
  callChannelId: { target: 'callf', field: 'ChannelId' },
  callSpeakerId: { target: 'callf', field: 'Speaker' },
  callStatus: { target: 'callf', field: 'Status' },
  callAttended: { target: 'callf', field: 'Attended' },
  foreignEntityRecordId: { target: 'fef', field: 'id' },
  foreignEntitySource: { target: 'fef', field: 'fes' },
  foreignEntitySeen: { target: 'fef', field: 'ns' },
  foreignEntityDone: { target: 'fef', field: 'nd' },
  foreignEntityIncludesMe: { target: 'fef', field: 'me', unit: true },
  crmCompanyId: { target: 'ccf', field: 'id' },
  crmCompanyHidden: { target: 'ccf', field: 'hidden' },
};

const DATE_RANGE_FIELDS: Record<
  string,
  { target: QueryTarget; field: string }
> = {
  documentCreatedAt: { target: 'df', field: 'ca' },
  documentUpdatedAt: { target: 'df', field: 'ua' },
  chatCreatedAt: { target: 'cf', field: 'ca' },
  chatUpdatedAt: { target: 'cf', field: 'ua' },
  folderCreatedAt: { target: 'pf', field: 'ca' },
  folderUpdatedAt: { target: 'pf', field: 'ua' },
  emailUpdatedAt: { target: 'ef', field: 'ua' },
};

const expandDateRange = (
  field: string,
  range: DateRangeFilter
): BackendAst[] => {
  const asts: BackendAst[] = [];
  if (range.gt) asts.push(AST.literal(field, { gt: range.gt }));
  if (range.gte) asts.push(AST.literal(field, { gte: range.gte }));
  if (range.lt) asts.push(AST.literal(field, { lt: range.lt }));
  if (range.lte) asts.push(AST.literal(field, { lte: range.lte }));
  return asts;
};

const propertyToAst = (p: PropertyFilter): BackendAst =>
  p.type === 'select'
    ? { l: { pd: p.propertyId, v: { so: p.value } } }
    : { l: { pd: p.propertyId, v: { er: p.value } } };

const propertyEquals = (a: PropertyFilter, b: PropertyFilter): boolean =>
  a.propertyId === b.propertyId && a.type === b.type && a.value === b.value;

export const normalizeDocumentWhere = (
  documentWhere: Query['documentWhere']
): DocumentFilterExpression[] | undefined => {
  if (!documentWhere) return undefined;
  return Array.isArray(documentWhere) ? documentWhere : [documentWhere];
};

export const queryStateFrom = (query: Query): QueryState => ({
  include: { ...(query.include ?? {}) },
  exclude: { ...(query.exclude ?? {}) },
  documentWhere: normalizeDocumentWhere(query.documentWhere),
  emailView: query.emailView,
});

const emptyTargetAstLists = (): Record<QueryTarget, BackendAst[]> => ({
  df: [],
  ef: [],
  chanf: [],
  cf: [],
  pf: [],
  callf: [],
  fef: [],
  ccf: [],
  propf: [],
});

function pushFieldFiltersToTargets(
  byTarget: Record<QueryTarget, BackendAst[]>,
  include: FieldFilters,
  exclude: FieldFilters,
  options: { onlyTarget?: QueryTarget } = {}
) {
  for (const fieldName of Object.keys(FIELD_CONFIG) as CompiledFieldName[]) {
    const config = FIELD_CONFIG[fieldName];
    if (options.onlyTarget && config.target !== options.onlyTarget) continue;

    const includeVal = include[fieldName];
    const excludeVal = exclude[fieldName];

    if (config.unit) {
      if (includeVal === true) {
        byTarget[config.target].push(AST.literal(config.field));
      } else if (excludeVal === true) {
        byTarget[config.target].push(AST.not(AST.literal(config.field)));
      }
      continue;
    }

    const format = config.formatValue ?? ((v: unknown) => v);

    if (Array.isArray(includeVal) || Array.isArray(excludeVal)) {
      const includeVals = includeVal as unknown[] | undefined;
      const excludeVals = excludeVal as unknown[] | undefined;

      if (includeVals?.length) {
        byTarget[config.target].push(
          AST.or(includeVals.map((v) => AST.literal(config.field, format(v))))
        );
      }

      if (excludeVals?.length) {
        const filtered = includeVals?.length
          ? excludeVals.filter((v) => !includeVals.includes(v))
          : excludeVals;

        if (filtered.length > 0) {
          byTarget[config.target].push(
            AST.not(
              AST.or(filtered.map((v) => AST.literal(config.field, format(v))))
            )
          );
        }
      }
    } else {
      if (includeVal !== undefined) {
        byTarget[config.target].push(
          AST.literal(config.field, format(includeVal))
        );
      } else if (excludeVal !== undefined) {
        byTarget[config.target].push(
          AST.not(AST.literal(config.field, format(excludeVal)))
        );
      }
    }
  }
}

function pushDateRangeFiltersToTargets(
  byTarget: Record<QueryTarget, BackendAst[]>,
  include: FieldFilters,
  exclude: FieldFilters,
  options: { onlyTarget?: QueryTarget } = {}
) {
  for (const [fieldName, config] of Object.entries(DATE_RANGE_FIELDS)) {
    if (options.onlyTarget && config.target !== options.onlyTarget) continue;

    const includeVal = include[fieldName as FieldName] as
      | DateRangeFilter
      | undefined;
    const excludeVal = exclude[fieldName as FieldName] as
      | DateRangeFilter
      | undefined;

    if (includeVal) {
      byTarget[config.target].push(
        ...expandDateRange(config.field, includeVal)
      );
    }
    if (excludeVal) {
      const expanded = expandDateRange(config.field, excludeVal);
      if (expanded.length) {
        byTarget[config.target].push(AST.not(AST.and(expanded)));
      }
    }
  }
}

function compileDocumentClauseToAst(clause: {
  include?: DocumentFieldFilters;
  exclude?: DocumentFieldFilters;
}): BackendAst | undefined {
  const byTarget = emptyTargetAstLists();
  pushFieldFiltersToTargets(
    byTarget,
    clause.include ?? {},
    clause.exclude ?? {},
    { onlyTarget: 'df' }
  );
  pushDateRangeFiltersToTargets(
    byTarget,
    clause.include ?? {},
    clause.exclude ?? {},
    { onlyTarget: 'df' }
  );

  return byTarget.df.length ? AST.and(byTarget.df) : undefined;
}

export function compileDocumentExpressionToAst(
  expression: DocumentFilterExpression
): BackendAst | undefined {
  if ('op' in expression) {
    if (expression.op === 'not') {
      const child = compileDocumentExpressionToAst(expression.clause);
      return child ? AST.not(child) : undefined;
    }

    const clauses = expression.clauses
      .map(compileDocumentExpressionToAst)
      .filter((ast): ast is BackendAst => ast !== undefined);

    if (clauses.length === 0) return undefined;
    return expression.op === 'and' ? AST.and(clauses) : AST.or(clauses);
  }

  return compileDocumentClauseToAst(expression);
}

export function compileToAst(state: QueryState): TargetAstMap {
  const byTarget = emptyTargetAstLists();

  pushFieldFiltersToTargets(byTarget, state.include, state.exclude);

  const includeProps = state.include.properties ?? [];
  const excludeProps = state.exclude.properties ?? [];

  const groupByPropId = (props: PropertyFilter[]) => {
    const map = new Map<string, PropertyFilter[]>();
    for (const p of props) {
      const existing = map.get(p.propertyId);
      if (existing) {
        existing.push(p);
      } else {
        map.set(p.propertyId, [p]);
      }
    }
    return map;
  };

  const includeByPropId = groupByPropId(includeProps);
  const excludeByPropId = groupByPropId(excludeProps);

  const allPropIds = new Set([
    ...includeByPropId.keys(),
    ...excludeByPropId.keys(),
  ]);

  for (const propId of allPropIds) {
    const includeVals = includeByPropId.get(propId);
    const excludeVals = excludeByPropId.get(propId);

    if (includeVals?.length) {
      byTarget.propf.push(AST.or(includeVals.map(propertyToAst)));
    }

    if (excludeVals?.length) {
      const filtered = includeVals?.length
        ? excludeVals.filter(
            (ev) => !includeVals.some((iv) => propertyEquals(iv, ev))
          )
        : excludeVals;

      if (filtered.length > 0) {
        byTarget.propf.push(AST.not(AST.or(filtered.map(propertyToAst))));
      }
    }
  }

  pushDateRangeFiltersToTargets(byTarget, state.include, state.exclude);

  for (const expression of state.documentWhere ?? []) {
    const ast = compileDocumentExpressionToAst(expression);
    if (ast) byTarget.df.push(ast);
  }

  const result: TargetAstMap = {};
  for (const [target, asts] of Object.entries(byTarget)) {
    if (asts.length > 0) {
      result[target as QueryTarget] = AST.and(asts);
    }
  }

  if (state.emailView) {
    result.emailView = state.emailView;
  }

  return result;
}

const ID_FIELD_NAMES: Partial<Record<QueryTarget, FieldName>> = {
  df: 'documentId',
  ef: 'threadId',
  chanf: 'channelId',
  cf: 'chatId',
  pf: 'folderId',
  callf: 'callId',
  fef: 'foreignEntityRecordId',
  ccf: 'crmCompanyId',
};

type DefineQueryFiltersOptions = {
  skipTargets?: QueryTarget[];
  skipTargetsFrom?: Query;
};

const extractQueryTargets = (query: Query): QueryTarget[] => {
  const targets = new Set<QueryTarget>();

  if (query.documentWhere) {
    targets.add('df');
  }

  for (const field of Object.keys(query.include ?? {})) {
    if (field in FIELD_CONFIG) {
      targets.add(FIELD_CONFIG[field as CompiledFieldName].target);
    }
    if (field in DATE_RANGE_FIELDS) {
      targets.add(DATE_RANGE_FIELDS[field].target);
    }
  }

  for (const field of Object.keys(query.exclude ?? {})) {
    if (field in FIELD_CONFIG) {
      targets.add(FIELD_CONFIG[field as CompiledFieldName].target);
    }
    if (field in DATE_RANGE_FIELDS) {
      targets.add(DATE_RANGE_FIELDS[field].target);
    }
  }

  return [...targets];
};

export function defineQueryFilters(
  input: Query,
  options: DefineQueryFiltersOptions = {}
): Query {
  const referencedTargets = new Set<QueryTarget>([
    ...(options.skipTargets ?? []),
    ...(options.skipTargetsFrom
      ? extractQueryTargets(options.skipTargetsFrom)
      : []),
    ...extractQueryTargets(input),
  ]);

  const include: FieldFilters = { ...input.include };

  for (const [target, idFieldName] of Object.entries(ID_FIELD_NAMES)) {
    if (referencedTargets.has(target as QueryTarget)) continue;

    if (idFieldName) {
      (include as Record<string, unknown[]>)[idFieldName] = [NIL_UUID];
    }
  }

  return { ...input, include };
}
