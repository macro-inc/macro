import type { NodeTransformType } from '@core/component/LexicalMarkdown/plugins/node-transform/nodeTransformPlugin';
import {
  EditorInputMsg,
  SelectionMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { InputSettlement } from '@macro-inc/lexical-wasm-view/view/port';
import { sameSelection } from '@macro-inc/lexical-wasm-view/view/selection';
import {
  SessionPort,
  selectionMessage,
} from '@macro-inc/lexical-wasm-view/view/session-port';
import type {
  JsonValue,
  ViewSelection,
} from '@macro-inc/lexical-wasm-view/view/types';
import type { ElementFormatType, TextFormatType } from 'lexical';
import type { Accessor } from 'solid-js';
import { convertibleNativeLists } from '../../../../lib/core/component/LexicalMarkdown/plugins/tables/native';

/** Real queued application admission; never substitute a fixed numeric command. */
export function createNativeFormattingActions(
  view: EditorView,
  canEdit: Accessor<boolean>,
  alive: Accessor<boolean>
) {
  const port = view.port;
  if (!(port instanceof SessionPort))
    throw new Error('Native formatting requires the actual session port');

  const convertibleList = (selection: ViewSelection): number | undefined => {
    if (selection.kind !== 'range') return undefined;
    let node = view.mirror.node(selection.anchor.key);
    while (node && node.parent !== null && node.parent !== 0)
      node = view.mirror.node(node.parent);
    if (node?.parent !== 0) return undefined;
    return convertibleNativeLists(view).includes(node.key)
      ? node.key
      : undefined;
  };

  const captureTarget = () => ({
    generation: view.mirror.keyGeneration,
    selection: view.selection().selection,
  });

  const send = (
    name: string,
    payload: JsonValue | ((selection: ViewSelection) => JsonValue),
    target = captureTarget(),
    after?: (handled: boolean) => void
  ): Promise<InputSettlement> => {
    const { generation, selection: intended } = target;
    const prepare = () => {
      if (!alive() || !view.isMounted)
        throw new Error('Native formatting owner is closed');
      if (!canEdit() || view.root.contentEditable !== 'true')
        throw new Error('Native formatting requires an editable document');
      if (generation === null || view.mirror.keyGeneration !== generation)
        throw new Error('Native formatting target generation changed');
      if (intended.kind === 'keep')
        throw new Error('Native formatting requires an acknowledged selection');
      const scope = port.nativeEnter?.scope();
      if (scope) {
        if (scope.generation !== generation)
          throw new Error('Native formatting callback generation changed');
        const pending = port.nativeEnter?.pendingSelection();
        if (!pending)
          throw new Error('Native formatting callback selection unavailable');
        const actual = SelectionMsg.encode({ ...pending, dirty: false });
        const expected = SelectionMsg.encode({
          ...selectionMessage(intended),
          dirty: false,
        });
        if (
          actual.length !== expected.length ||
          actual.some((value, index) => value !== expected[index])
        )
          throw new Error(
            'Native formatting callback target selection changed'
          );
      } else if (!sameSelection(intended, view.selection().selection))
        throw new Error('Native formatting target selection changed');
      return {
        name,
        json: JSON.stringify(
          typeof payload === 'function' ? payload(intended) : payload
        ),
        generation,
        selection: selectionMessage(intended),
      };
    };
    if (port.nativeEnter?.scope()) {
      if (after)
        throw new Error(
          'Link target capture requires a completed root admission'
        );
      if (name !== 'group-b.link')
        throw new Error(
          'Scoped formatting supports the installed link action only'
        );
      const application = prepare();
      const handled = port.nativeEnter.dispatchScoped(
        EditorInputMsg.fromEditorApplication({
          ...application,
          selection: selectionMessage({ kind: 'keep' }),
          keyboard: false,
          key: '',
          mods: 0,
          code: 0,
        })
      );
      return Promise.resolve({ status: 'success', handled });
    }
    return after
      ? port.inputSettled(prepare, { after })
      : port.inputSettled(prepare);
  };

  return {
    text(format: TextFormatType) {
      return send('group-b.format-text', format);
    },
    align(format: ElementFormatType) {
      return send('group-b.format-element', format);
    },
    block(format: NodeTransformType) {
      return send('group-b.node-transform', format);
    },
    mergeTableSelection() {
      return send('group-b.table', { action: 'format-selection-merge' });
    },
    splitTableSelection() {
      return send('group-b.table', { action: 'format-selection-split' });
    },
    insertTable(rows: number, columns: number) {
      return send('group-b.table', {
        action: 'insert',
        rows: Math.ceil(rows),
        columns: Math.ceil(columns),
        headers: false,
      });
    },
    canConvertList() {
      return convertibleList(view.selection().selection) !== undefined;
    },
    convertList() {
      return send('group-b.table', (selection) => {
        const key = convertibleList(selection);
        if (key === undefined)
          throw new Error(
            'Native formatting requires a convertible selected list'
          );
        return { action: 'convert-list', key };
      });
    },
    prepareLink(after: (handled: boolean) => void) {
      return send(
        'group-b.link',
        { action: 'prepare' },
        captureTarget(),
        after
      );
    },
    captureLinkTarget() {
      const target = captureTarget();
      return {
        insert: (url: string, label: string) =>
          send('group-b.link', { action: 'insert', url, label }, target),
        update: (url: string, label: string) =>
          send('group-b.link', { action: 'update', url, label }, target),
        updateUrl: (url: string | null) =>
          send('group-b.link', { action: 'url', url }, target),
        unlink: () => send('group-b.link', { action: 'unlink' }, target),
      };
    },
    insertLink(url: string, label: string) {
      return send('group-b.link', { action: 'insert', url, label });
    },
    updateLink(url: string, label: string) {
      return send('group-b.link', { action: 'update', url, label });
    },
    updateLinkUrl(url: string | null) {
      return send('group-b.link', { action: 'url', url });
    },
    unlink() {
      return send('group-b.link', { action: 'unlink' });
    },
  };
}
