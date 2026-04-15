import { createStore, produce } from 'solid-js/store';
import type { Accessor } from 'solid-js';

type BackendAst =
  | { '&': [BackendAst, BackendAst] }
  | { '|': [BackendAst, BackendAst] }
  | { '!': BackendAst }
  | { l: unknown };

type QueryTarget = 'df' | 'ef' | 'chanf' | 'cf' | 'pf' | 'callf' | 'propf';
export type EmailView = 'inbox' | 'drafts' | 'sent' | 'all';

const ALL_ENTITY_TYPES = [
  'email',
  'document',
  'channel',
  'chat',
  'folder',
  'call',
] as const;
export type EntityType = (typeof ALL_ENTITY_TYPES)[number];
export type TargetFilter = EntityType[] | { exclude: EntityType[] };

const ENTITY_TYPE_TARGETS: Record<EntityType, QueryTarget[]> = {
  email: ['ef'],
  document: ['df'],
  channel: ['chanf'],
  chat: ['cf'],
  folder: ['pf'],
  call: ['callf'],
};

const TARGET_TO_ENTITY: Partial<Record<QueryTarget, EntityType>> = {
  df: 'document',
  ef: 'email',
  chanf: 'channel',
  cf: 'chat',
  pf: 'folder',
  callf: 'call',
};

// ID field for each target - used to generate NOT NIL filters
const TARGET_ID_FIELD: Partial<Record<QueryTarget, string>> = {
  df: 'id',
  ef: 'ThreadId',
  chanf: 'ChannelId',
  cf: 'ChatId',
  pf: 'ProjectId',
  callf: 'ChannelId',
};

type TargetAstMap = {
  [K in QueryTarget]?: BackendAst;
} & {
  emailView?: EmailView;
};

const AST = {
  or(asts: BackendAst[]): BackendAst {
    if (asts.length === 1) return asts[0];
    return asts.reduceRight((acc, ast) => ({ '|': [ast, acc] }));
  },

  and(asts: BackendAst[]): BackendAst {
    if (asts.length === 1) return asts[0];
    return asts.reduceRight((acc, ast) => ({ '&': [ast, acc] }));
  },

  not(ast: BackendAst): BackendAst {
    return { '!': ast };
  },

  literal(field: string, value: unknown): BackendAst {
    return { l: { [field]: value } };
  },

  fieldOr(field: string, values: unknown[]): BackendAst {
    return AST.or(values.map((v) => AST.literal(field, v)));
  },
};

export const NIL = '00000000-0000-0000-0000-000000000000';

type FieldConfig = { target: QueryTarget; field: string };

const FIELD_CONFIG = {
  // Documents (df)
  documentId: { target: 'df', field: 'id' },
  fileType: { target: 'df', field: 'ft' },
  subType: { target: 'df', field: 'dst' },
  projectId: { target: 'df', field: 'pid' },
  documentOwnerId: { target: 'df', field: 'o' },
  documentSeen: { target: 'df', field: 'ns' },
  documentDone: { target: 'df', field: 'nd' },
  isEmailAttachment: { target: 'df', field: 'iea' },

  // Emails (ef)
  threadId: { target: 'ef', field: 'ThreadId' },
  emailSeen: { target: 'ef', field: 'NotificationSeen' },
  emailDone: { target: 'ef', field: 'NotificationDone' },
  emailImportance: { target: 'ef', field: 'Importance' },
  sender: { target: 'ef', field: 'Sender' },
  shared: { target: 'ef', field: 'Shared' },

  // Channels (chanf)
  channelId: { target: 'chanf', field: 'ChannelId' },
  channelType: { target: 'chanf', field: 'ChannelType' },
  channelSeen: { target: 'chanf', field: 'NotificationSeen' },
  channelDone: { target: 'chanf', field: 'NotificationDone' },
  channelImportance: { target: 'chanf', field: 'Importance' },
  channelSenderId: { target: 'chanf', field: 'Sender' },

  // Chats (cf)
  chatId: { target: 'cf', field: 'ChatId' },
  chatOwnerId: { target: 'cf', field: 'Owner' },
  chatSeen: { target: 'cf', field: 'NotificationSeen' },
  chatDone: { target: 'cf', field: 'NotificationDone' },

  // Projects/Folders (pf)
  folderId: { target: 'pf', field: 'ProjectId' },
  folderOwnerId: { target: 'pf', field: 'Owner' },
  folderSeen: { target: 'pf', field: 'NotificationSeen' },
  folderDone: { target: 'pf', field: 'NotificationDone' },

  // Calls (callf)
  callChannelId: { target: 'callf', field: 'ChannelId' },
} as const satisfies Record<string, FieldConfig>;

type FieldName = keyof typeof FIELD_CONFIG;

type FieldValueMap = {
  documentId: string;
  fileType: string;
  subType: string;
  projectId: string;
  documentOwnerId: string;
  documentSeen: boolean;
  documentDone: boolean;
  isEmailAttachment: boolean;
  threadId: string;
  emailSeen: boolean;
  emailDone: boolean;
  emailImportance: boolean;
  sender: string;
  shared: 'exclude' | 'include' | 'only';
  channelId: string;
  channelType: string;
  channelSeen: boolean;
  channelDone: boolean;
  channelImportance: boolean;
  channelSenderId: string;
  chatId: string;
  chatOwnerId: string;
  chatSeen: boolean;
  chatDone: boolean;
  folderId: string;
  folderOwnerId: string;
  folderSeen: boolean;
  folderDone: boolean;
  callChannelId: string;
};

export type PropertyFilter = {
  type: 'select' | 'entity';
  propertyId: string;
  value: string;
  negate?: boolean;
};

type PropertyFilters = (PropertyFilter | PropertyFilter[])[]; // Outer AND, inner OR

type FieldFilters = {
  [K in FieldName]?: FieldValueMap[K][];
};

export type FilterData = {
  include: FieldFilters;
  exclude: FieldFilters;
  properties: PropertyFilters;
  emailView?: EmailView;
  targets?: TargetFilter;
};

export type FilterSetter = (fn: (draft: FilterData) => void) => void;

/** Resolve TargetFilter to an array of EntityTypes */
function resolveTargets(filter: TargetFilter): EntityType[] {
  if (Array.isArray(filter)) return filter;
  return ALL_ENTITY_TYPES.filter((t) => !filter.exclude.includes(t));
}

/** Merge multiple partial FilterData objects into one (OR logic for same fields) */
export function mergeFilterData(...sources: Partial<FilterData>[]): FilterData {
  const include: FieldFilters = {};
  const exclude: FieldFilters = {};
  const properties: PropertyFilters = [];
  let emailView: EmailView | undefined;
  let resolvedTargets: EntityType[] | undefined;

  for (const source of sources) {
    if (source.include) {
      for (const [key, values] of Object.entries(source.include) as [
        FieldName,
        unknown[],
      ][]) {
        if (!values?.length) continue;
        const existing = include[key] as unknown[] | undefined;
        (include as Record<string, unknown[]>)[key] = existing
          ? [...existing, ...values]
          : [...values];
      }
    }

    if (source.exclude) {
      for (const [key, values] of Object.entries(source.exclude) as [
        FieldName,
        unknown[],
      ][]) {
        if (!values?.length) continue;
        const existing = exclude[key] as unknown[] | undefined;
        (exclude as Record<string, unknown[]>)[key] = existing
          ? [...existing, ...values]
          : [...values];
      }
    }

    if (source.properties?.length) {
      properties.push(...source.properties);
    }

    if (source.emailView) {
      emailView = source.emailView;
    }

    if (source.targets) {
      const sourceResolved = resolveTargets(source.targets);
      resolvedTargets = resolvedTargets
        ? Array.from(new Set([...resolvedTargets, ...sourceResolved]))
        : sourceResolved;
    }
  }

  // Normalize: if all types are included, store as undefined
  const targets =
    resolvedTargets && resolvedTargets.length < ALL_ENTITY_TYPES.length
      ? resolvedTargets
      : undefined;

  return { include, exclude, properties, emailView, targets };
}

/** Create an empty FilterData object */
export const emptyFilterData = (): FilterData => ({
  include: {},
  exclude: {},
  properties: [],
  emailView: undefined,
  targets: undefined,
});

/** Apply a partial FilterData to a draft (for use with setFilters) */
export function applyFilterData(
  draft: FilterData,
  source: Partial<FilterData>
): void {
  draft.include = source.include ?? {};
  draft.exclude = source.exclude ?? {};
  draft.properties = source.properties ?? [];
  draft.emailView = source.emailView;
  draft.targets = source.targets;
}

export function createFilterStore(initial?: Partial<FilterData>) {
  const [data, setData] = createStore<FilterData>({
    include: initial?.include ?? {},
    exclude: initial?.exclude ?? {},
    properties: initial?.properties ?? [],
    emailView: initial?.emailView,
    targets: initial?.targets,
  });

  const setFilters: FilterSetter = (fn) => setData(produce(fn));
  const filters: Accessor<FilterData> = () => data;

  return [filters, setFilters, () => compileToAst(data)] as const;
}

function propToAst(p: PropertyFilter): BackendAst {
  const leaf: BackendAst =
    p.type === 'select'
      ? { l: { pd: p.propertyId, v: { so: p.value } } }
      : { l: { pd: p.propertyId, v: { er: p.value } } };

  return p.negate ? AST.not(leaf) : leaf;
}

/** Infer which entity types to query based on explicit targets or fields being filtered */
function inferTargets(data: FilterData): EntityType[] {
  // Explicit targets always win
  if (data.targets) {
    return resolveTargets(data.targets);
  }

  // Collect targets from fields being filtered
  const inferred = new Set<EntityType>();

  for (const field of Object.keys(data.include) as FieldName[]) {
    const config = FIELD_CONFIG[field];
    if (config) {
      const entityType = TARGET_TO_ENTITY[config.target];
      if (entityType) inferred.add(entityType);
    }
  }

  for (const field of Object.keys(data.exclude) as FieldName[]) {
    const config = FIELD_CONFIG[field];
    if (config) {
      const entityType = TARGET_TO_ENTITY[config.target];
      if (entityType) inferred.add(entityType);
    }
  }

  // No fields filtered = query everything
  if (inferred.size === 0) {
    return Array.from(ALL_ENTITY_TYPES);
  }

  return Array.from(inferred);
}

function compileToAst(data: FilterData): TargetAstMap {
  // Determine which targets to include
  const allowedTypes = inferTargets(data);
  const allowedTargets = new Set(
    allowedTypes.flatMap((t) => ENTITY_TYPE_TARGETS[t])
  );

  const byTarget: Record<QueryTarget, BackendAst[]> = {
    df: [],
    ef: [],
    chanf: [],
    cf: [],
    pf: [],
    callf: [],
    propf: [],
  };

  for (const field of Object.keys(data.include) as FieldName[]) {
    const values = data.include[field];
    const config = FIELD_CONFIG[field];

    if (!config || !values?.length) continue;

    byTarget[config.target].push(AST.fieldOr(config.field, values));
  }

  for (const field of Object.keys(data.exclude) as FieldName[]) {
    const values = data.exclude[field];
    const config = FIELD_CONFIG[field];

    if (!config || !values?.length) continue;

    byTarget[config.target].push(AST.not(AST.fieldOr(config.field, values)));
  }

  for (const item of data.properties) {
    if (Array.isArray(item)) {
      byTarget.propf.push(AST.or(item.map(propToAst)));
      continue;
    }

    byTarget.propf.push(propToAst(item));
  }

  const result: TargetAstMap = {};

  for (const [target, asts] of Object.entries(byTarget)) {
    // propf applies across entity types, only include if it has filters
    if (target === 'propf') {
      if (asts.length > 0) {
        result[target as QueryTarget] = AST.and(asts);
      }
      continue;
    }

    const idField = TARGET_ID_FIELD[target as QueryTarget];
    if (!idField) continue;

    const isAllowed = allowedTargets.has(target as QueryTarget);

    if (!isAllowed) {
      // Excluded target: send id = NIL to match nothing
      result[target as QueryTarget] = AST.literal(idField, NIL);
      continue;
    }

    if (asts.length === 0) {
      // Allowed target with no filters: send NOT (id = NIL) to match all
      result[target as QueryTarget] = AST.not(AST.literal(idField, NIL));
      continue;
    }

    // Allowed target with filters: use the filters
    result[target as QueryTarget] = AST.and(asts);
  }

  if (data.emailView) {
    result.emailView = data.emailView;
  }

  return result;
}
