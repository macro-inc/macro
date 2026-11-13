import { SplitPanel } from '@components/app/split-panel';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName, macroIdToEmail, tryMacroId } from '@core/user';
import { writeClipboardData } from '@core/util/dataTransfer';
import { openExternalUrl } from '@core/util/url';
import { Show } from 'solid-js';
import { createBrowserContracts } from './browser-contracts';
import {
  type ContractsContext,
  ContractsProvider,
  type Viewer,
} from './context/contracts-context';
import { ContractsWorkspace } from './views/contracts-workspace';
import { MobileContractsWorkspace } from './views/mobile/contracts-workspace';

function createAppContractsContext(): ContractsContext {
  const userId = useUserId();
  const viewer = (): Viewer => {
    const raw = userId() ?? '';
    const id = tryMacroId(raw);
    return {
      id: raw,
      name: id ? getDisplayName(id) : raw,
      email: id ? macroIdToEmail(id) : raw,
    };
  };
  const data = createBrowserContracts().context(viewer);

  return {
    ...data,
    copyText: (text) => writeClipboardData({ 'text/plain': text }),
    openSigning: (token) => openExternalUrl(data.signingUrl(token)),
  };
}

/** The Contracts module, wired to the app. */
export function Contracts() {
  const context = createAppContractsContext();

  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <ContractsProvider value={context}>
          <Show when={isTouchDevice()} fallback={<ContractsWorkspace />}>
            <MobileContractsWorkspace />
          </Show>
        </ContractsProvider>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
