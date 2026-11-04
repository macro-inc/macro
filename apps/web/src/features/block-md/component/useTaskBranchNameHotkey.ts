import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { copyBranchNameToClipboard } from '@core/util/branchName';
import { fireAndForget } from '@core/util/fireAndForget';
import type { Accessor } from 'solid-js';
import { createEffect, on, onCleanup } from 'solid-js';
import type { MarkdownDocumentKind } from '../types';

export function useTaskBranchNameHotkey(options: {
  documentId: Accessor<string>;
  kind: Accessor<MarkdownDocumentKind>;
  scopeId: Accessor<string>;
}) {
  createEffect(
    on([options.scopeId, options.kind], ([scopeId, kind]) => {
      if (kind !== 'task') return;

      const registration = registerHotkey({
        hotkey: 'shift+cmd+b',
        scopeId,
        hotkeyToken: TOKENS.entity.action.copyBranchName,
        description: 'Copy branch name',
        keyDownHandler: () => {
          fireAndForget(
            copyBranchNameToClipboard(options.documentId()),
            'task-branch-name'
          );
          return true;
        },
        runWithInputFocused: true,
      });
      onCleanup(() => registration.dispose());
    })
  );
}
