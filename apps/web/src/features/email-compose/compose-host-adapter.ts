import { useSplitBackInterceptor } from '@components/app/split-layout/back-interceptor';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import type { EmailComposeHost } from './context/compose-capabilities';
import { createPanelFocusSibling } from './editor-adapter';
export function createEmailComposeHost(): EmailComposeHost {
  const { replaceSplit } = useSplitLayout();
  const panel = useSplitPanel();
  return {
    showThread: (id: string) => {
      replaceSplit({ content: { type: 'email', id }, mergeHistory: true });
    },
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
