// The request-to-join row as a channel first mounts it: the request still
// loading and the requester's name not yet resolved. The test then delivers
// each later state through `window.update`.
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import {
  AccessRequestActivityRow,
  type AccessRequestOutcome,
} from '../components/AccessRequestActivityRow';
import '@fontsource-variable/inter';
import '../../../index.css';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
applyTheme('Macro Dark');

export type RowState = {
  requesterName: string;
  outcome: AccessRequestOutcome;
  busy: boolean;
};

declare global {
  interface Window {
    update: (next: Partial<RowState>) => void;
  }
}

// `?pane=` narrows the row to a channel pane beside other splits.
const PANE_WIDTH = new URLSearchParams(location.search).get('pane') ?? 'none';

function Fixture() {
  const [row, setRow] = createStore<RowState>({
    requesterName: 'Someone',
    outcome: { kind: 'loading' },
    busy: false,
  });
  window.update = (next) => setRow(next);

  return (
    <div
      class="[--message-padding-x:12px] [--user-icon-width:32px]"
      style={{ 'max-width': PANE_WIDTH }}
    >
      <AccessRequestActivityRow
        eventId="request-1"
        occurredAt="2026-11-12T15:04:00Z"
        requesterName={row.requesterName}
        requesterEmail="alex.requester@example.com"
        outcome={row.outcome}
        busy={row.busy}
        onApprove={() => setRow('busy', true)}
        onDeny={() => setRow('busy', true)}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
