import '@fontsource-variable/inter';
import '@app/index.css';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { ImperativeDialogHost } from '@ui';
import { render } from 'solid-js/web';
import { ContractsProvider } from '../context/contracts-context';
import { ContractsWorkspace } from '../views/contracts-workspace';
import { applyFixtureTheme, createFixtureContracts } from './fixture-contracts';
import { seedDemoPackets } from './seed';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');

function Fixture() {
  const data = createFixtureContracts().context(() => ({
    id: 'fixture-viewer',
    name: 'Avery Lee',
    email: 'avery.lee@macro.example',
  }));

  return (
    <ContractsProvider
      value={{
        ...data,
        copyText: async (text) => {
          document.body.dataset.copied = text;
          return true;
        },
        openSigning: (token) => {
          document.body.dataset.opened = data.signingUrl(token);
        },
      }}
    >
      <div class="relative h-dvh bg-panel text-ink">
        <ContractsWorkspace />
        <ImperativeDialogHost />
        <FloatRegionHost />
        <ToastRegion />
      </div>
    </ContractsProvider>
  );
}

async function start(mount: HTMLElement) {
  await applyFixtureTheme();
  if (new URLSearchParams(location.search).get('seed') === 'demo') {
    await seedDemoPackets();
  }
  render(() => <Fixture />, mount);
}
fireAndForget(start(root), 'contracts.fixture');
