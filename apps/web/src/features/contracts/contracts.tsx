import { useQueryAccount } from '@app/lib/queries/auth/use-query-account';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName, macroIdToEmail, tryMacroId } from '@core/user';
import { writeClipboardData } from '@core/util/dataTransfer';
import { openExternalUrl } from '@core/util/url';
import { downloadFile } from '@filesystem/download';
import { Show } from 'solid-js';
import { createBrowserContracts } from './browser-contracts';
import { PerSignIn } from './components/per-sign-in';
import {
  type ContractsContext,
  ContractsProvider,
  type Viewer,
} from './context/contracts-context';
import { DriveDocumentSource } from './drive-document-source';
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
    saveFile: async (file, name) => (await downloadFile(file, name)).saved,
    openSigning: (token) => openExternalUrl(data.signingUrl(token)),
  };
}

function AccountContracts(props: { userId: string }) {
  const context = createAppContractsContext(props.userId);

  return (
    <ContractsProvider value={context}>
      <Show
        when={isTouchDevice()}
        fallback={<ContractsWorkspace documentSource={DriveDocumentSource} />}
      >
        <MobileContractsWorkspace />
      </Show>
    </ContractsProvider>
  );
}

/** The Contracts module, wired to the app. */
export function Contracts() {
  // Undefined while a new login is being confirmed: the app keeps showing the
  // previous identity then, and its contracts must not stay open under it.
  const account = useQueryAccount();

  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <PerSignIn signIn={account()}>
          {(userId) => <AccountContracts userId={userId} />}
        </PerSignIn>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
