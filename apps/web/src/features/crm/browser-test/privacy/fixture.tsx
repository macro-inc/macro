import '../../../../index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Button } from '@ui';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import {
  CrmEmailOptInBanner,
  CrmEmailPrivacyDialog,
} from '../../views/email-privacy';
import { lastChange } from './preview-adapters';

document.documentElement.dataset.touchDevice = String(isTouchDevice());

function Fixture() {
  const [open, setOpen] = createSignal(false);
  return (
    <main class="min-h-dvh bg-page text-ink">
      <CrmEmailOptInBanner />
      <div class="p-6">
        <Button onClick={() => setOpen(true)}>Email settings</Button>
        <pre class="overflow-auto text-xs" data-testid="last-change">
          {lastChange()}
        </pre>
      </div>
      <CrmEmailPrivacyDialog open={open()} onOpenChange={setOpen} />
    </main>
  );
}
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
