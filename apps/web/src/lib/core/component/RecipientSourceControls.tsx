import { t } from '@app/lib/i18n';
import type { CombinedRecipientKind } from '@core/user/combinedRecipient';
import type { RecipientSource } from '@core/user/recipient-source';
import { fireAndForget } from '@core/util/fireAndForget';
import { useComboboxContext } from '@kobalte/core/combobox';
import { Button } from '@ui';
import { createEffect, Show } from 'solid-js';

/** Pagination remains available even when a bounded local window has no rows. */
export function RecipientSourceControls(props: {
  source: RecipientSource<CombinedRecipientKind>;
  resetScroll: () => void;
  empty: boolean;
}) {
  const combobox = useComboboxContext();
  let previousWindow: string | undefined;
  createEffect(() => {
    const key = props.source.windowKey();
    if (!key || key === previousWindow) return;
    const reset = previousWindow !== undefined;
    previousWindow = key;
    const state = combobox.listState();
    const focused = state.selectionManager().focusedKey();
    if (
      reset ||
      focused === undefined ||
      !state.collection().getItem(focused)
    ) {
      state.selectionManager().setFocusedKey(state.collection().getFirstKey());
    }
    if (reset) props.resetScroll();
  });
  const keepFocus = (event: Event) => event.preventDefault();
  return (
    <div class="flex flex-col gap-1 px-2 text-xs text-ink-muted">
      <div aria-live="polite">
        <Show when={props.source.loading()}>{t('common.loadingOptions')}</Show>
        <Show when={!props.source.loading() && props.source.error()}>
          {t('common.optionsUnavailable')}
        </Show>
        <Show
          when={
            !props.source.loading() &&
            !props.source.error() &&
            props.source.incomplete()
          }
        >
          {t('common.optionsIncomplete')}
        </Show>
      </div>
      <Show
        when={!props.source.loading() && !props.source.error() && props.empty}
      >
        {t('common.noOptionsInWindow')}
      </Show>
      <Show when={props.source.hasNext() || props.source.error()}>
        <Button
          variant="ghost"
          size="sm"
          fullWidth
          disabled={props.source.loading()}
          aria-keyshortcuts="PageDown"
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() =>
            fireAndForget(
              props.source.error() ? props.source.retry() : props.source.next(),
              'recipient-directory'
            )
          }
        >
          {props.source.error()
            ? t('viewMenus.retryOptions')
            : t('viewMenus.nextOptions')}
        </Button>
      </Show>
    </div>
  );
}
