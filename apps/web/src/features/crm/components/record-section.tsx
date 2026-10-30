import { SearchBar } from '@app/components/view-shell';
import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { t } from '@app/lib/i18n';
import { activeElement } from '@app/signal/focus';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { MobileCreateButton } from '@components/app/mobile/MobileCreateButton';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { isEditableInput } from '@core/util/isEditableInput';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui';
import { type JSX, type ParentProps, Show } from 'solid-js';

type RecordCreateAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

/** Shared toolbar and scrolling content for a record's associated tabs. */
export function RecordSection(
  props: ParentProps<{
    title: string;
    search: string;
    onSearchChange: (value: string) => void;
    searchPlaceholder?: string;
    onSearchEscape?: () => void;
    actions?: JSX.Element;
    createAction?: RecordCreateAction;
    /** Preserve existing desktop creation controls; other actions are touch-only. */
    toolbarCreate?: boolean;
  }>
) {
  return (
    <section
      aria-label={props.title}
      class="@container/record flex size-full min-h-0 flex-col"
    >
      <div class="flex min-h-12 min-w-0 shrink-0 flex-wrap items-center gap-3 px-4 py-2 touch:flex-nowrap touch:pt-[calc(var(--mobile-content-inset-top,0px)+1rem)] touch:pb-4">
        <SearchBar
          size="sm"
          label={`Search ${props.title.toLowerCase()}`}
          placeholder={
            props.searchPlaceholder ?? `Search ${props.title.toLowerCase()}…`
          }
          class="w-64 max-w-full touch:w-auto touch:min-w-0 touch:flex-1"
          value={props.search}
          onValueChange={props.onSearchChange}
          onEscape={props.onSearchEscape}
        />
        <Show
          when={
            props.actions ||
            (!isTouchDevice() && props.toolbarCreate && props.createAction)
          }
        >
          <div class="ml-auto flex shrink-0 flex-wrap items-center gap-2.5">
            {props.actions}
            <Show when={props.toolbarCreate && props.createAction}>
              {(action) => (
                <Button
                  variant="secondary"
                  class="touch:hidden"
                  disabled={action().disabled}
                  onClick={() => action().onClick()}
                >
                  <PlusIcon class="size-4" />
                  {action().label}
                </Button>
              )}
            </Show>
          </div>
        </Show>
      </div>
      <Show when={isTouchDevice() && props.createAction}>
        {(action) => (
          <FloatRegion
            region="accessory"
            // Replace the app action (-1), but yield to screen composers (0).
            priority={-0.5}
            active={() =>
              !virtualKeyboardVisible() && !isEditableInput(activeElement())
            }
          >
            <div class="flex justify-end px-(--mobile-chrome-gutter)">
              <MobileCreateButton
                label={action().label}
                disabled={action().disabled}
                onClick={() => action().onClick()}
              />
            </div>
          </FloatRegion>
        )}
      </Show>
      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-6 touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+1.5rem)] touch:[--mobile-content-inset-top:0px]">
        {props.children}
      </div>
    </section>
  );
}

/** Keep record filters beside search without squeezing their controls onto phones. */
export function RecordSectionFilters(
  props: ParentProps<{ activeCount: number; onClear: () => void }>
) {
  return (
    <Show when={isTouchDevice()} fallback={props.children}>
      <MobileFilterDrawer
        triggerLabel={t('viewMenus.openFilterMenu')}
        label={t('viewMenus.filters')}
        activeCount={props.activeCount}
        onClear={props.onClear}
      >
        <div class="flex flex-col items-start gap-4 px-6 py-4">
          {props.children}
        </div>
      </MobileFilterDrawer>
    </Show>
  );
}
