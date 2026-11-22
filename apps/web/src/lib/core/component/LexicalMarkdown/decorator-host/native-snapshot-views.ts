import { fireAndForget } from '@core/util/fireAndForget';
import { SnapshotNode } from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view';
import type { EditorThemeClasses } from 'lexical';
import type { SnapshotUIProps } from '../component/decorator/Snapshot';
import { dispatchApplicationCommandSettled } from '../plugins/group-b/command';
import { createNativeDecoratorAdapter } from './native-adapter';
import { createNativeContactContext } from './native-contact-host';
import type { SnapshotHost } from './snapshot-host';

export function createNativeSnapshotContext(theme: EditorThemeClasses) {
  const enter = createNativeContactContext(theme);
  let view: Parameters<typeof enter.bindView>[0] | undefined;
  let generation: number | null = null;
  const current = () =>
    view && generation !== null && view.mirror.keyGeneration === generation
      ? view
      : undefined;
  const snapshot: SnapshotHost = {
    isSelected: enter.host.isSelected,
    isEditable: () => current()?.root.contentEditable === 'true',
    registerNormalEnter: enter.host.registerNormalEnter,
    remove(key) {
      const mounted = current();
      const index = Number(key);
      if (
        !mounted ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index > 0xffff_ffff ||
        String(index) !== key ||
        mounted.node(index)?.type !== 'snapshot'
      )
        return;
      fireAndForget(
        dispatchApplicationCommandSettled(mounted, 'group-b.snapshot-delete', {
          key: index,
        }).then((result) => {
          if (result.status === 'error') throw result.error;
        }),
        'native-snapshot-remove'
      );
    },
  };
  return {
    theme,
    host: { ...enter.host, snapshot },
    bindView(incoming: Parameters<typeof enter.bindView>[0]) {
      enter.bindView(incoming);
      view = incoming;
      generation = incoming.mirror.keyGeneration;
    },
    dispose() {
      view = undefined;
      generation = null;
      enter.dispose();
    },
  };
}

export function createNativeSnapshotViews(
  context: ReturnType<typeof createNativeSnapshotContext>
): Pick<MacroDecorators, 'snapshot'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    snapshot: bind<SnapshotUIProps>(SnapshotNode, (node) => {
      const {
        documentId,
        documentName,
        blockName,
        content,
        snapshotDate,
        mentionUuid,
      } = node.props();
      if (
        typeof documentId !== 'string' ||
        typeof documentName !== 'string' ||
        typeof blockName !== 'string' ||
        typeof content !== 'string' ||
        (snapshotDate !== undefined && typeof snapshotDate !== 'string') ||
        (mentionUuid != null && typeof mentionUuid !== 'string')
      )
        throw new Error('Invalid native Snapshot payload');
      return {
        key: String(node.key),
        documentId,
        documentName,
        blockName,
        content,
        snapshotDate,
        mentionUuid,
        theme: context.theme,
      };
    }),
  };
}
