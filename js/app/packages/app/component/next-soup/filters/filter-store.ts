import { createStore, produce } from 'solid-js/store';
import type { Accessor } from 'solid-js';

type BackendAst =
  | { '&': [BackendAst, BackendAst] }
  | { '|': [BackendAst, BackendAst] }
  | { '!': BackendAst }
  | { l: unknown };

type QueryTarget = 'df' | 'ef' | 'chanf' | 'cf' | 'pf' | 'callf' | 'propf';
export type EmailView = 'inbox' | 'drafts' | 'sent' | 'all';

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
  channelSenderId: { target: 'chanf', field: 'SenderId' },

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
};

export type FilterSetter = (fn: (draft: FilterData) => void) => void;

/** Merge multiple partial FilterData objects into one (OR logic for same fields) */
export function mergeFilterData(...sources: Partial<FilterData>[]): FilterData {
  const include: FieldFilters = {};
  const exclude: FieldFilters = {};
  const properties: PropertyFilters = [];
  let emailView: EmailView | undefined;

  for (const source of sources) {
    if (source.include) {
      for (const [key, values] of Object.entries(source.include) as [FieldName, unknown[]][]) {
        if (!values?.length) continue;
        const existing = include[key] as unknown[] | undefined;
        (include as Record<string, unknown[]>)[key] = existing ? [...existing, ...values] : [...values];
      }
    }

    if (source.exclude) {
      for (const [key, values] of Object.entries(source.exclude) as [FieldName, unknown[]][]) {
        if (!values?.length) continue;
        const existing = exclude[key] as unknown[] | undefined;
        (exclude as Record<string, unknown[]>)[key] = existing ? [...existing, ...values] : [...values];
      }
    }

    if (source.properties?.length) {
      properties.push(...source.properties);
    }

    if (source.emailView) {
      emailView = source.emailView;
    }
  }

  return { include, exclude, properties, emailView };
}

/** Create an empty FilterData object */
export const emptyFilterData = (): FilterData => ({
  include: {},
  exclude: {},
  properties: [],
  emailView: undefined,
});

/** Apply a partial FilterData to a draft (for use with setFilters) */
export function applyFilterData(draft: FilterData, source: Partial<FilterData>): void {
  draft.include = source.include ?? {};
  draft.exclude = source.exclude ?? {};
  draft.properties = source.properties ?? [];
  draft.emailView = source.emailView;
}

export function createFilterStore(initial?: Partial<FilterData>) {
  const [data, setData] = createStore<FilterData>({
    include: initial?.include ?? {},
    exclude: initial?.exclude ?? {},
    properties: initial?.properties ?? [],
    emailView: initial?.emailView,
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

function compileToAst(data: FilterData): TargetAstMap {
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
    if (asts.length === 0) continue;

    result[target as QueryTarget] = AST.and(asts);
  }

  if (data.emailView) {
    result.emailView = data.emailView;
  }

  return result;
}
