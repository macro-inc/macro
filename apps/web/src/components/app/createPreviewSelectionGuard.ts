import type { NavigationStackChangeReason } from '@app/components/navigation-stack/NavigationStack';
import { goToChannelMessage } from '@block-channel/utils/link';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { createSignal, onCleanup, untrack, useContext } from 'solid-js';
import {
  type PreviewBlockTarget,
  type PreviewPanelSelection,
  previewBlockTarget,
} from './previewTarget';
import type { ContentIdentity } from './split-layout/contentInstanceRegistry';
import { SplitLayoutContext } from './split-layout/context';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

/** A live row, or the block target a route already resolved it to. */
export type PreviewSelectionInput = PreviewPanelSelection | PreviewBlockTarget;

type SelectPreview = (
  selection: PreviewSelectionInput | undefined,
  reason?: NavigationStackChangeReason
) => boolean;

export type PreviewSelectionGuard = SelectPreview & {
  /** Checks a requested selection without claiming it before navigation commits. */
  canSelect: SelectPreview;
};

/** Call after changing selection. Use canSelect before cancellable navigation. */
export function createPreviewSelectionGuard(): PreviewSelectionGuard {
  const layout = useContext(SplitLayoutContext);
  if (!layout) throw new Error('Preview selection requires a split layout');
  const manager = layout.manager;
  const panel = useSplitPanelOrThrow();
  const owner = Symbol('inline-preview');
  const [current, setCurrent] = createSignal<ContentIdentity>();
  const unregister = manager.registerOpenViews(() => {
    const content = current();
    return content
      ? [{ owner, content, activate: () => panel.handle.activate() }]
      : [];
  });
  onCleanup(unregister);

  const targetFor = (selection: PreviewSelectionInput | undefined) => {
    if (!selection) return;
    return 'blockType' in selection ? selection : previewBlockTarget(selection);
  };
  const identity = (target: PreviewBlockTarget | undefined) => {
    if (!target) return;
    return { type: target.blockType, id: target.blockId };
  };
  const canSelect: SelectPreview = (selection, reason = 'navigate') =>
    untrack(() => {
      const target = targetFor(selection);
      const next = identity(target);
      const existing = next && manager.findOpenView(next);
      if (existing && existing.owner !== owner) {
        if (reason === 'navigate') {
          existing.activate?.();
          const params = target?.params;
          const messageId =
            params && 'channel_message_id' in params
              ? params.channel_message_id
              : undefined;
          const threadId =
            params && 'channel_thread_id' in params
              ? params.channel_thread_id
              : undefined;
          if (
            target?.blockType === 'channel' &&
            typeof messageId === 'string'
          ) {
            // Keep the current preview and send the location to its existing owner.
            fireAndForget(
              Telemetry.span('channel.navigate_from_preview', async (span) => {
                span.setAttr('channel.id', target.blockId);
                span.setAttr('message.id', messageId);
                try {
                  await goToChannelMessage(
                    manager.getOrchestrator(),
                    target.blockId,
                    messageId,
                    typeof threadId === 'string' ? threadId : undefined
                  );
                } catch (error) {
                  span.error(error);
                  throw error;
                }
              }),
              'preview-selection'
            );
          } else {
            toast.alert('Content already open');
          }
        }
        return false;
      }
      return true;
    });
  const select: SelectPreview = (selection, reason) => {
    if (!canSelect(selection, reason)) return false;
    setCurrent(identity(targetFor(selection)));
    return true;
  };

  return Object.assign(select, { canSelect });
}
