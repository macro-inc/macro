import type { SoupAstBody } from '@queries/soup/items';
import { NIL_UUID } from '../../next-soup/filters/filter-store';
import type { CrmActivityTab } from '../core/navigation';

const NO_CRM_ACTIVITY = {
  calf: { l: { id: NIL_UUID } },
  df: { l: { id: NIL_UUID } },
  chanf: { l: { ChannelId: NIL_UUID } },
  cthf: { l: { ThreadId: NIL_UUID } },
  cf: { l: { cid: NIL_UUID } },
  pf: { l: { pid: NIL_UUID } },
  callf: { l: { CallId: NIL_UUID } },
  ccf: { l: { id: NIL_UUID } },
  fef: { l: { id: NIL_UUID } },
  ef: { l: { ThreadId: NIL_UUID } },
};

/** The server resolves all visible CRM records before filtering and pagination. */
export function crmActivityBody(tab: CrmActivityTab): SoupAstBody {
  const base = { ...NO_CRM_ACTIVITY, crma: 'activity' as const };
  if (tab === 'email') {
    const { ef: _email, ...others } = base;
    return { ...others, emailView: 'all' };
  }
  if (tab === 'calls') {
    const { callf: _calls, ...others } = base;
    return others;
  }
  return {
    ...base,
    df:
      tab === 'tasks'
        ? { l: { dst: 'task' } }
        : {
            '&': [
              { l: { ft: 'md' } },
              {
                '!': {
                  '|': [
                    { l: { dst: 'task' } },
                    {
                      '|': [{ l: { dst: 'snippet' } }, { l: { dst: 'skill' } }],
                    },
                  ],
                },
              },
            ],
          },
  };
}
