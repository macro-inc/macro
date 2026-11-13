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

function createAppContractsContext(userId: string): ContractsContext {
  const viewer = (): Viewer => {
    const id = tryMacroId(userId);
    return {
      id: userId,
      name: id ? getDisplayName(id) : userId,
      email: id ? macroIdToEmail(id) : userId,
    };
  };
  const data = createBrowserContracts(userId).context(viewer);

  return {
    ...data,
    copyText: (text) => writeClipboardData({ 'text/plain': text }),
    openSigning: (token) => openExternalUrl(data.signingUrl(token)),
  };
}

function AccountContracts(props: { userId: string }) {
  const context = createAppContractsContext(props.userId);

  return (
    <ContractsProvider value={context}>
      <Show when={isTouchDevice()} fallback={<ContractsWorkspace />}>
        <MobileContractsWorkspace />
      </Show>
    </ContractsProvider>
  );
}

/** The Contracts module, wired to the app. */
export function Contracts() {
  const userId = useUserId();

  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        {/* Keyed: another account gets its own store, never this one's. */}
        <Show when={userId()} keyed>
          {(id) => <AccountContracts userId={id} />}
        </Show>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
