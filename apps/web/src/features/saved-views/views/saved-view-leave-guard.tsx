import { t } from '@app/lib/i18n';
import { useBeforeLeave } from '@app/lib/split-router';
import { fireAndForget } from '@core/util/fireAndForget';
import { confirmDialog } from '@ui';
import deepEqual from 'fast-deep-equal';
import { createEffect, createRoot, getOwner, on, onCleanup } from 'solid-js';
import type { SavedViewCreation } from '../primitives/create-saved-view-creation';

/** Mounted for one draft so its confirmation cannot outlive that draft. */
export function SavedViewLeaveGuard(props: {
  creation: SavedViewCreation;
  discard: () => void;
  selection: Readonly<Record<string, readonly string[]>>;
  registerLeave?: (run: (action: () => void) => void) => () => void;
}) {
  const owner = getOwner();
  let alive = true;
  let closeConfirmation: (() => void) | undefined;
  onCleanup(() => {
    alive = false;
    closeConfirmation?.();
  });

  const confirmDiscard = async (signal?: AbortSignal) => {
    if (
      !alive ||
      signal?.aborted ||
      closeConfirmation ||
      props.creation.saving()
    )
      return false;
    if (!props.creation.dirty()) return true;

    // Give the existing dialog a disposable owner for navigation cancellation.
    const { confirmation, dispose } = createRoot(
      (dispose) => ({
        dispose,
        confirmation: confirmDialog(
          () => ({
            title: t('viewMenus.leaveDraftTitle'),
            body: t('viewMenus.leaveDraftDescription'),
            confirmLabel: t('common.discard'),
            cancelLabel: t('viewMenus.keepEditing'),
            tone: 'danger',
          }),
          { owner: getOwner() }
        ),
      }),
      owner
    );
    const close = () => {
      if (closeConfirmation === close) closeConfirmation = undefined;
      dispose();
    };
    closeConfirmation = close;
    signal?.addEventListener('abort', close, { once: true });
    try {
      return (await confirmation) && alive && !signal?.aborted;
    } finally {
      signal?.removeEventListener('abort', close);
      close();
    }
  };

  useBeforeLeave(
    async (context) => {
      if (props.creation.isInternalNavigation()) return true;
      const sameRoute =
        context.to &&
        deepEqual(context.from.location.route, context.to.location.route);
      const sameSelection = Object.entries(props.selection).every(
        ([namespace, keys]) =>
          keys.every((key) =>
            deepEqual(
              context.from.location.search?.[namespace]?.[key],
              context.to?.location.search?.[namespace]?.[key]
            )
          )
      );
      if (sameRoute && sameSelection) return true;
      const draftId = props.creation.current()?.id;
      if (!(await confirmDiscard(context.signal))) return false;
      context.onCommit(() => {
        if (props.creation.current()?.id === draftId) props.discard();
      });
      return true;
    },
    { search: Object.keys(props.selection), descendants: true }
  );

  // Some view controls change local settings before publishing their route.
  // Confirm first, then retire this draft before running that local action.
  const run = (action: () => void) => {
    const proceed = async () => {
      if (!(await confirmDiscard()) || !alive) return;
      props.discard();
      action();
    };
    fireAndForget(proceed(), 'saved-view-leave');
  };
  onCleanup(props.creation.register(run));
  const unregisterHost = props.registerLeave?.(run);
  if (unregisterHost) onCleanup(unregisterHost);

  createEffect(
    on(props.creation.dirty, (dirty) => {
      if (!dirty) return;
      const warn = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = '';
      };
      window.addEventListener('beforeunload', warn);
      onCleanup(() => window.removeEventListener('beforeunload', warn));
    })
  );
  return null;
}
