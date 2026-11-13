import '@fontsource-variable/inter';
import '@app/index.css';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { ImperativeDialogHost } from '@ui';
import { render } from 'solid-js/web';
import { SigningProvider } from '../context/contracts-context';
import { SignerPortal } from '../views/signer-portal';
import { applyFixtureTheme, createFixtureContracts } from './fixture-contracts';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
const token = new URLSearchParams(location.search).get('token') ?? '';

function Fixture() {
  const signing = createFixtureContracts().signing(() => token);
  return (
    <SigningProvider value={signing}>
      <div class="relative h-dvh bg-page text-ink">
        <SignerPortal />
        <ImperativeDialogHost />
        <ToastRegion />
      </div>
    </SigningProvider>
  );
}

async function start(mount: HTMLElement) {
  await applyFixtureTheme();
  render(() => <Fixture />, mount);
}
fireAndForget(start(root), 'contracts.fixture');
