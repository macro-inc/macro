import {
  PaneContext,
  useOptionalSplitRouter,
} from '@app/lib/split-router/solid/context';
import { fireAndForget } from '@core/util/fireAndForget';
import { useContext } from 'solid-js';
import type { CrmMergeSurvivor } from './core/record';
import { crmRecordClaim } from './crm-route';

/**
 * Leaves a merged company's or contact's page for the record it was merged
 * into. When another split already shows that record, this one steps back
 * (or closes, if it has nowhere to go back to) and that split comes up, as
 * any open of an entity shown elsewhere does; otherwise `open` shows it here.
 */
export function useOpenMergedRecord(
  open: (survivor: CrmMergeSurvivor) => void
) {
  const router = useOptionalSplitRouter();
  const scope = useContext(PaneContext);
  return (survivor: CrmMergeSurvivor) => {
    const pane = scope?.pane();
    const claim = crmRecordClaim({
      recordType: survivor.type,
      recordId: survivor.id,
    });
    const holder =
      router && pane
        ? router.claims.holderOf(`${claim.namespace}:${claim.id}`, pane)
        : undefined;
    if (!router || !pane || !holder) return open(survivor);
    const leave = async () => {
      if (router.canGo(pane, -1)) await router.navigatePane(pane, -1);
      else await router.close(pane);
      holder.activate();
    };
    fireAndForget(leave(), 'crm');
  };
}
