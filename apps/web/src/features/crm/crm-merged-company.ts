import {
  PaneContext,
  useOptionalSplitRouter,
} from '@app/lib/split-router/solid/context';
import { fireAndForget } from '@core/util/fireAndForget';
import { useContext } from 'solid-js';
import { crmRecordClaim } from './crm-route';

/**
 * Leaves a merged company's page for the company it was merged into. When
 * another split already shows that company, this one steps back (or closes,
 * if it has nowhere to go back to) and that split comes up, as any open of
 * an entity shown elsewhere does; otherwise `open` shows it here.
 */
export function useOpenMergedCompany(open: (survivorId: string) => void) {
  const router = useOptionalSplitRouter();
  const scope = useContext(PaneContext);
  return (survivorId: string) => {
    const pane = scope?.pane();
    const claim = crmRecordClaim({
      recordType: 'company',
      recordId: survivorId,
    });
    const holder =
      router && pane
        ? router.claims.holderOf(`${claim.namespace}:${claim.id}`, pane)
        : undefined;
    if (!router || !pane || !holder) return open(survivorId);
    const leave = async () => {
      if (router.canGo(pane, -1)) await router.navigatePane(pane, -1);
      else await router.close(pane);
      holder.activate();
    };
    fireAndForget(leave(), 'crm');
  };
}
