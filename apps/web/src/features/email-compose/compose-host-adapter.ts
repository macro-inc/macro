import { useSplitBackInterceptor } from '@components/app/split-layout/back-interceptor';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import type { createComposeRouteDraft } from './compose-route-draft';
import type { EmailComposeHost } from './context/compose-capabilities';
import { createPanelFocusSibling } from './editor-adapter';

function createSplitComposeHost() {
  const { replaceSplit } = useSplitLayout();
  const panel = useSplitPanel();
  const showThread = (id: string) => {
    replaceSplit({ content: { type: 'email', id }, mergeHistory: true });
  };
  return {
    showThread,
    showDraft: (id: string) => {
      replaceSplit({
        content: {
          type: 'component',
          id: 'email-compose',
          params: { draftID: id },
          preserveParams: true,
        },
      });
    },
    goBack: () => panel?.handle.goBack(),
    focusSibling: createPanelFocusSibling(),
    registerBack: (handler: () => boolean) => {
      useSplitBackInterceptor(handler);
    },
  };
}

/** A thread route names the draft's thread, so it follows a moved draft there. */
export function createEmailComposeHost(): EmailComposeHost {
  const host = createSplitComposeHost();
  return {
    ...host,
    showMovedDraft: ({ threadId }) => host.showThread(threadId),
  };
}

/** The compose route keeps a moved draft in place and records its new id instead. */
export function createComposeRouteHost(
  route: Pick<ReturnType<typeof createComposeRouteDraft>, 'record'>
): EmailComposeHost {
  return { ...createSplitComposeHost(), recordDraft: route.record };
}
