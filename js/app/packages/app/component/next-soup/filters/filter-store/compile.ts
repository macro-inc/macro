import type { FieldFilters, FieldName, PropertyFilter, Query, QueryState, EmailView } from './types';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

type BackendAst =
  | { '&': [BackendAst, BackendAst] }
  | { '|': [BackendAst, BackendAst] }
  | { '!': BackendAst }
  | { l: unknown };

type QueryTarget = 'df' | 'ef' | 'chanf' | 'cf' | 'pf' | 'callf' | 'propf';

export type TargetAstMap = {
  [K in QueryTarget]?: BackendAst;
} & {
  emailView?: EmailView;
};

type CompiledFieldName = Exclude<FieldName, 'properties'>;

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
  literal(field: string, value: unknown): BackendAst {
    return { l: { [field]: value } };
  },
};

const FIELD_CONFIG: Record<
  CompiledFieldName,
  { target: QueryTarget; field: string }
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
  emailSeen: { target: 'ef', field: 'NotificationSeen' },
  emailDone: { target: 'ef', field: 'NotificationDone' },
  emailImportance: { target: 'ef', field: 'Importance' },
  emailProjectId: { target: 'ef', field: 'ProjectId' },
  emailSender: { target: 'ef', field: 'Sender' },
  emailShared: { target: 'ef', field: 'Shared' },
  channelId: { target: 'chanf', field: 'ChannelId' },
  channelType: { target: 'chanf', field: 'ChannelType' },
  channelSeen: { target: 'chanf', field: 'NotificationSeen' },
  channelDone: { target: 'chanf', field: 'NotificationDone' },
  channelImportance: { target: 'chanf', field: 'Importance' },
  channelSenderId: { target: 'chanf', field: 'Sender' },
  chatId: { target: 'cf', field: 'ChatId' },
  chatOwnerId: { target: 'cf', field: 'Owner' },
  chatProjectId: { target: 'cf', field: 'ProjectId' },
  chatSeen: { target: 'cf', field: 'NotificationSeen' },
  chatDone: { target: 'cf', field: 'NotificationDone' },
  folderId: { target: 'pf', field: 'ProjectId' },
  folderOwnerId: { target: 'pf', field: 'Owner' },
  folderSeen: { target: 'pf', field: 'NotificationSeen' },
  folderDone: { target: 'pf', field: 'NotificationDone' },
  callChannelId: { target: 'callf', field: 'ChannelId' },
  callAttended: { target: 'callf', field: 'Attended' },
};

const propertyToAst = (p: PropertyFilter): BackendAst =>
  p.type === 'select'
    ? { l: { pd: p.propertyId, v: { so: p.value } } }
    : { l: { pd: p.propertyId, v: { er: p.value } } };

const propertyEquals = (a: PropertyFilter, b: PropertyFilter): boolean =>
  a.propertyId === b.propertyId && a.type === b.type && a.value === b.value;

export function compileToAst(state: QueryState): TargetAstMap {
  const byTarget: Record<QueryTarget, BackendAst[]> = {
    df: [],
    ef: [],
    chanf: [],
    cf: [],
    pf: [],
    callf: [],
    propf: [],
  };

  for (const fieldName of Object.keys(FIELD_CONFIG) as CompiledFieldName[]) {
    const config = FIELD_CONFIG[fieldName];
    const includeVal = state.include[fieldName];
    const excludeVal = state.exclude[fieldName];

    if (Array.isArray(includeVal) || Array.isArray(excludeVal)) {
      const includeVals = includeVal as unknown[] | undefined;
      const excludeVals = excludeVal as unknown[] | undefined;

      if (includeVals?.length) {
        byTarget[config.target].push(
          AST.or(includeVals.map((v) => AST.literal(config.field, v)))
        );
      }

      if (excludeVals?.length) {
        const filtered = includeVals?.length
          ? excludeVals.filter((v) => !includeVals.includes(v))
          : excludeVals;

        if (filtered.length > 0) {
          byTarget[config.target].push(
            AST.not(AST.or(filtered.map((v) => AST.literal(config.field, v))))
          );
        }
      }
    } else {
      if (includeVal !== undefined) {
        byTarget[config.target].push(AST.literal(config.field, includeVal));
      } else if (excludeVal !== undefined) {
        byTarget[config.target].push(
          AST.not(AST.literal(config.field, excludeVal))
        );
      }
    }
  }

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
  callf: 'callChannelId',
};

export function defineQueryFilters(input: Query): Query {
  const referencedTargets = new Set<QueryTarget>();

  for (const field of Object.keys(input.include ?? {}) as CompiledFieldName[]) {
    if (field in FIELD_CONFIG) {
      referencedTargets.add(FIELD_CONFIG[field].target);
    }
  }

  for (const field of Object.keys(input.exclude ?? {}) as CompiledFieldName[]) {
    if (field in FIELD_CONFIG) {
      referencedTargets.add(FIELD_CONFIG[field].target);
    }
  }

  if (referencedTargets.size === 0) return input;

  const include: FieldFilters = { ...input.include };

  for (const [target, idFieldName] of Object.entries(ID_FIELD_NAMES)) {
    if (referencedTargets.has(target as QueryTarget)) continue;
    if (idFieldName) {
      (include as Record<string, unknown[]>)[idFieldName] = [NIL_UUID];
    }
  }

  return { ...input, include };
}
