import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { NIL_UUID } from '../../next-soup/filters/filter-store';
import type { CrmActivityTab } from '../core/navigation';
import { emailFilterForAddress, emailFilterForDomains } from './email-filter';

export type CrmActivityScope = {
  companyIds: string[];
  contactIds: string[];
  domains: string[];
  emails: string[];
};

type AstNode = Record<string, unknown>;
const leaf = (value: AstNode): AstNode => ({ l: value });
export const NO_CRM_ACTIVITY = {
  calf: leaf({ id: NIL_UUID }),
  df: leaf({ id: NIL_UUID }),
  chanf: leaf({ ChannelId: NIL_UUID }),
  cthf: leaf({ ThreadId: NIL_UUID }),
  cf: leaf({ cid: NIL_UUID }),
  pf: leaf({ pid: NIL_UUID }),
  callf: leaf({ CallId: NIL_UUID }),
  ccf: leaf({ id: NIL_UUID }),
  fef: leaf({ id: NIL_UUID }),
  ef: leaf({ ThreadId: NIL_UUID }),
};

// A balanced expression avoids excessive recursion for large CRMs.
function anyOf(nodes: unknown[]): unknown {
  if (nodes.length === 0) return undefined;
  if (nodes.length === 1) return nodes[0];
  const middle = Math.floor(nodes.length / 2);
  return { '|': [anyOf(nodes.slice(0, middle)), anyOf(nodes.slice(middle))] };
}

/** Never use an omitted scope as an unfiltered query. */
export function crmActivityBody(tab: CrmActivityTab, scope: CrmActivityScope) {
  if (tab === 'email') {
    const emails = anyOf(
      [
        ...scope.domains.map((domain) => emailFilterForDomains([domain])),
        ...scope.emails.map(emailFilterForAddress),
      ].filter((value) => value !== undefined)
    );
    return emails
      ? { ...NO_CRM_ACTIVITY, ef: emails, emailView: 'all' }
      : NO_CRM_ACTIVITY;
  }
  const associations = anyOf([
    ...scope.companyIds.map((id) =>
      leaf({ pd: SYSTEM_PROPERTY_IDS.COMPANIES, v: { er: id } })
    ),
    ...scope.contactIds.map((id) =>
      leaf({ pd: SYSTEM_PROPERTY_IDS.CONTACTS, v: { er: id } })
    ),
  ]);
  if (!associations) return NO_CRM_ACTIVITY;
  if (tab === 'calls') {
    const { callf: _calls, ...others } = NO_CRM_ACTIVITY;
    return { ...others, propf: associations };
  }
  return {
    ...NO_CRM_ACTIVITY,
    propf: associations,
    df:
      tab === 'tasks'
        ? leaf({ dst: 'task' })
        : {
            '&': [
              leaf({ ft: 'md' }),
              {
                '!': anyOf(
                  ['task', 'snippet', 'skill'].map((dst) => leaf({ dst }))
                ),
              },
            ],
          },
  };
}
