import {
  createSearchParams,
  type Entry,
  routeParams,
  useNavigate,
  usePaneHistory,
  useParams,
  useRouteState,
} from '@app/lib/split-router';
import {
  companiesRoute,
  crmItemRoute,
  crmPipelineItemRoute,
  crmPipelineRecordFileItemRoute,
  crmPipelineRecordItemRoute,
  crmPipelineRecordRoute,
  crmPipelineRoute,
  crmRecordFileItemRoute,
  crmRecordItemRoute,
  crmRecordRoute,
} from '@app/routes/routes';
import {
  blockNameToDefaultFile,
  fileTypeToBlockName,
  fileTypeToResolvedBlockName,
} from '@core/constant/allBlocks';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import type {
  CrmRecordNavigation,
  CrmRoute,
} from './context/workspace-context';
import { pipelineIdOfTab, pipelineTab } from './core/navigation';
import type { CrmRecordRef, CrmRecordSection } from './core/record';
import {
  type CrmItemParams,
  type CrmRecordParams,
  crmItemBlockType,
  crmRecordSearch,
  crmSearch,
  crmSearchCodec,
} from './crm-route';

type CrmBranchParams = Partial<CrmRecordParams & CrmItemParams> & {
  pipelineId?: string;
};

const CRM_ITEM_ROUTES = {
  activity: { workspace: crmItemRoute, pipeline: crmPipelineItemRoute },
  section: {
    workspace: crmRecordItemRoute,
    pipeline: crmPipelineRecordItemRoute,
  },
  files: {
    workspace: crmRecordFileItemRoute,
    pipeline: crmPipelineRecordFileItemRoute,
  },
};

/** The list tab an entry shows, or undefined for a record. */
function listTab(entry: Entry): string | undefined {
  const leaf = entry.location.route.matches.at(-1);
  if (leaf?.id === crmPipelineRoute.id) {
    const { pipelineId } = leaf.params;
    return typeof pipelineId === 'string' ? pipelineTab(pipelineId) : undefined;
  }
  if (leaf?.id !== companiesRoute.id) return;
  return crmSearchCodec.parse(entry.location.search?.[crmSearch.namespace])
    .value.tab;
}

function itemDestination(source: CrmBranchParams, item: CrmItemParams) {
  let kind: keyof typeof CRM_ITEM_ROUTES = 'activity';
  if (source.recordType && source.recordId) {
    kind =
      !source.section ||
      source.section === 'overview' ||
      source.section === 'files'
        ? 'files'
        : 'section';
  }
  const routes = CRM_ITEM_ROUTES[kind];
  return {
    route: source.pipelineId ? routes.pipeline : routes.workspace,
    params: {
      pipelineId: source.pipelineId,
      recordType: source.recordType,
      recordId: source.recordId,
      section: source.section,
      ...item,
    },
  };
}

/** The Customers location held by the pane's route. */
export function createCrmRoute(captureEntryState?: () => void): CrmRoute {
  const [search] = createSearchParams(crmSearch);
  const [recordSearch] = createSearchParams(crmRecordSearch);
  const params = useParams<CrmBranchParams>();
  const routeTrail = useRouteState(companiesRoute);
  const itemStates = Object.values(CRM_ITEM_ROUTES).flatMap((routes) => [
    useRouteState(routes.workspace),
    useRouteState(routes.pipeline),
  ]);
  const itemState = () => itemStates.find((state) => state())?.();
  const navigate = useNavigate();
  const history = usePaneHistory();

  const tab = () =>
    params.pipelineId ? pipelineTab(params.pipelineId) : search.tab;

  const shown = (): CrmRecordRef | undefined =>
    params.recordType && params.recordId
      ? { type: params.recordType, id: params.recordId, name: '' }
      : undefined;

  const records = (): readonly CrmRecordRef[] => {
    const record = shown();
    if (!record) return [];
    const trail = itemState()?.trail ?? routeTrail();
    const end = trail?.at(-1);
    if (trail && end?.type === record.type && end.id === record.id)
      return trail;
    return [record];
  };

  // Records open where the user asks, even when another split shows them too.
  const showRecord = (
    trail: readonly CrmRecordRef[],
    section: CrmRecordSection | undefined
  ) => {
    const record = trail.at(-1);
    if (!record) return;
    const recordParams = {
      recordType: record.type,
      recordId: record.id,
      section: section === 'overview' ? undefined : section,
    };
    // A message target belongs to the record it was asked for.
    const options = {
      allowDuplicate: true,
      state: [...trail],
      search: { [crmRecordSearch.namespace]: undefined },
    };
    const pipelineId = params.pipelineId;
    fireAndForget(
      pipelineId
        ? navigate(
            {
              route: crmPipelineRecordRoute,
              params: { pipelineId, ...recordParams },
            },
            options
          )
        : navigate({ route: crmRecordRoute, params: recordParams }, options),
      'crm'
    );
  };

  const showList = (next: string, replace?: boolean) => {
    const pipelineId = pipelineIdOfTab(next);
    const options = {
      allowDuplicate: true,
      replace,
      search: {
        [crmSearch.namespace]: pipelineId
          ? undefined
          : crmSearchCodec.serialize({ tab: next }),
        [crmRecordSearch.namespace]: undefined,
      },
    };
    fireAndForget(
      pipelineId
        ? navigate({ route: crmPipelineRoute, params: { pipelineId } }, options)
        : navigate({ route: companiesRoute, params: {} }, options),
      'crm'
    );
  };

  const item = () => {
    if (!params.itemType || !params.itemId) return;
    const state = itemState();
    const current = {
      itemType: params.itemType,
      itemId: params.itemId,
      itemFileType: params.itemFileType,
      itemSubType: params.itemSubType,
    };
    return {
      ...current,
      name:
        state?.name ??
        blockNameToDefaultFile(fileTypeToBlockName(crmItemBlockType(current))),
    };
  };

  const openItem: CrmRecordNavigation['openItem'] = (entity, event) => {
    if (
      event &&
      (event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        (event instanceof MouseEvent && event.button !== 0))
    )
      return false;
    if (
      entity.type !== 'document' &&
      entity.type !== 'email' &&
      entity.type !== 'call'
    )
      return false;
    const itemParams: CrmItemParams = {
      itemType: entity.type,
      itemId: entity.id,
      ...(entity.type === 'document'
        ? {
            itemFileType: fileTypeToResolvedBlockName(entity.fileType ?? 'md'),
            itemSubType: entity.subType?.type,
          }
        : {}),
    };
    captureEntryState?.();
    const trail = records();
    const destination = itemDestination(params, itemParams);
    fireAndForget(
      Telemetry.span('crm.item.open', async (span) => {
        span.setAttr('entity.id', entity.id);
        span.setAttr('entity.type', entity.type);
        await navigate(destination, {
          state: {
            trail: trail.length ? [...trail] : undefined,
            name: entity.name,
          },
        });
      }),
      'crm'
    );
    return true;
  };

  const restoreItemSource = () => {
    const snapshot = history();
    if (!snapshot) return false;
    const currentRecord = shown();
    for (let index = snapshot.index - 1; index >= 0; index--) {
      const previous = snapshot.entries[index];
      const matches = previous.location.route.matches;
      if (!matches.some((match) => match.id === companiesRoute.id)) break;
      const previousParams = routeParams<CrmBranchParams>(
        previous.location.route
      );
      if (previousParams.itemId) continue;
      const sameSource = currentRecord
        ? previousParams.recordId === currentRecord.id &&
          previousParams.recordType === currentRecord.type &&
          previousParams.section === params.section &&
          (!params.pipelineId ||
            previousParams.pipelineId === params.pipelineId)
        : listTab(previous) === tab();
      if (!sameSource) break;
      fireAndForget(navigate(index - snapshot.index), 'crm');
      return true;
    }
    return false;
  };

  const closeItem = () => {
    if (!item() || restoreItemSource()) return;
    const trail = records();
    if (trail.length) showRecord(trail, params.section);
    else showList(tab());
  };

  const close = () => {
    if (!shown()) return closeItem();
    const current = tab();
    // The list's own entry restores its scroll position.
    const snapshot = history();
    if (snapshot) {
      for (let index = snapshot.index - 1; index >= 0; index--) {
        const entry = snapshot.entries[index];
        const matches = entry.location.route.matches;
        if (!matches.some((match) => match.id === companiesRoute.id)) break;
        const entryTab = listTab(entry);
        if (entryTab === undefined) continue;
        if (entryTab !== current) break;
        fireAndForget(navigate(index - snapshot.index), 'crm');
        return;
      }
    }
    showList(current);
  };

  return {
    tab,
    setTab: (next, options) => showList(next, options?.replace),
    records,
    section: () => params.section,
    commentTarget: () =>
      shown() && recordSearch.commentId
        ? { commentId: recordSearch.commentId, seek: recordSearch.seek }
        : undefined,
    open: (trail) => showRecord(trail, undefined),
    setSection: (section) => showRecord(records(), section),
    item,
    openItem,
    closeItem,
    close,
  };
}
