import '@fontsource-variable/inter';
import '@app/index.css';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { downloadFile } from '@filesystem/download';
import { Button, ImperativeDialogHost } from '@ui';
import { render } from 'solid-js/web';
import {
  ContractsProvider,
  type DocumentSource,
} from '../context/contracts-context';
import { ContractsWorkspace } from '../views/contracts-workspace';
import { applyFixtureTheme, createFixtureContracts } from './fixture-contracts';
import dpaUrl from './fixtures/data-processing-addendum.pdf?url';
import { seedDemoPackets } from './seed';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');

/**
 * Stands in for the host's Drive picker: one press hands over a document the
 * sender already has, and a second offers one that is not a PDF.
 */
const FixtureDocumentSource: DocumentSource = (props) => {
  async function choose() {
    const bytes = await (await fetch(dpaUrl)).arrayBuffer();
    await props.onFile(new File([bytes], 'Data Processing Addendum.pdf'));
    props.onRejected('Meeting notes', 'not_pdf');
  }
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={props.disabled}
      onClick={() => fireAndForget(choose(), 'contracts.fixture')}
    >
      Choose from Drive
    </Button>
  );
};

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
        saveFile: async (file, name) => (await downloadFile(file, name)).saved,
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
        <ContractsWorkspace documentSource={FixtureDocumentSource} />
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
