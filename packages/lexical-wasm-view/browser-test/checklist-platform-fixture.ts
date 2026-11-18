import {
  $createListItemNode,
  $createListNode,
  ListItemNode,
  ListNode,
  registerList,
} from '@lexical/list';
import { registerRichText } from '@lexical/rich-text';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import { $createTextNode, $getRoot, createEditor } from 'lexical';
import { checklistPlugin } from '../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist/checklistPlugin';
import { registerNativeChecklist } from '../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist/native';
import { IS_MAC } from '../../../apps/web/src/lib/core/constant/isMac';
import init, {
  EditorSession,
} from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from '../src/local-session-view';
import { createBuiltinRegistry } from '../src/view/node-views/builtins';
import { registerMacroElementViews } from '../src/view/node-views/macro';

const errors: string[] = [];
const upstreamRoot = document.getElementById('upstream');
const nativeRoot = document.getElementById('native');
if (!upstreamRoot || !nativeRoot) throw new Error('Missing checklist roots');
upstreamRoot.contentEditable = 'true';
const upstream = createEditor({
  namespace: 'checklist-platform',
  nodes: [ListNode, ListItemNode],
  onError: (error) => errors.push(String(error)),
});
upstream.setRootElement(upstreamRoot);
registerRichText(upstream);
registerList(upstream);
checklistPlugin()(upstream);
upstream.update(
  () => {
    $getRoot().append(
      $createListNode('check').append(
        $createListItemNode(false).append($createTextNode('Open row'))
      )
    );
  },
  { discrete: true }
);
await init();
const native = await mountLocalSessionView(
  nativeRoot,
  registerMacroElementViews(createBuiltinRegistry()),
  {
    namespace: 'block-md-main',
    theme: {},
    editable: true,
    preset: 'rich',
    onError: (error) => errors.push(String(error)),
  },
  {
    // Desktop counterpart of the actual root constructor cases. Mobile
    // composition precedence is covered by RustMarkdownEditor.test.tsx.
    viewOs: IS_MAC ? 1 : 0,
    viewEngine: /Firefox/.test(navigator.userAgent)
      ? 3
      : /AppleWebKit/.test(navigator.userAgent) &&
          !/Chrome/.test(navigator.userAgent)
        ? 2
        : 1,
    create: (config, now, wall) =>
      EditorSession.createMacro(ABI_MAJOR, config, now, wall),
  }
);
native.port.setState(JSON.stringify(upstream.getEditorState().toJSON()));
registerNativeChecklist(native.view);
Reflect.set(window, 'checklistPlatformErrors', errors);
