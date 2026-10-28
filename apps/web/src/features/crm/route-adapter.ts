import {
  createSearchParams,
  type Entry,
  useNavigate,
  usePaneHistory,
  useParams,
  useRouteState,
} from '@app/lib/split-router';
import {
  companiesRoute,
  crmPipelineRecordRoute,
  crmPipelineRoute,
  crmRecordRoute,
} from '@app/routes/routes';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CrmRoute } from './context/workspace-context';
import { pipelineIdOfTab, pipelineTab } from './core/navigation';
import type { CrmRecordRef, CrmRecordSection } from './core/record';
import {
  type CrmRecordParams,
  crmRecordSearch,
  crmSearch,
  crmSearchCodec,
} from './crm-route';

type CrmBranchParams = Partial<CrmRecordParams> & { pipelineId?: string };

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

/** The Customers location held by the pane's route. */
export function createCrmRoute(): CrmRoute {
  const [search] = createSearchParams(crmSearch);
  const [recordSearch] = createSearchParams(crmRecordSearch);
  const params = useParams<CrmBranchParams>();
  const routeTrail = useRouteState(companiesRoute);
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
    const trail = routeTrail();
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

  const close = () => {
    if (!shown()) return;
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
    close,
  };
}
