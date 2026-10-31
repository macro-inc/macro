import {
  SearchBar,
  useViewControlHotkeys,
  ViewShell,
} from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui';
import { type JSX, type ParentProps, Show } from 'solid-js';
import { useCrmWorkspace } from '../context/workspace-context';

/** Workspace lists share the app header; record tabs keep their own toolbar. */
export function ActivitySection(
  props: ParentProps<{
    label: string;
    title?: JSX.Element;
    search: string;
    onSearchChange: (value: string) => void;
    createLabel: string;
    onCreate: () => void;
    controls?: JSX.Element;
  }>
) {
  const view = useCrmWorkspace();
  let focusSearch: (() => void) | undefined;
  const searchLabel = () => `Search ${props.label.toLowerCase()}`;
  useViewControlHotkeys({
    scopeId: view.host.scopeId,
    enabled: view.host.isActive,
    search: {
      description: searchLabel(),
      run: () => {
        focusSearch?.();
        return true;
      },
    },
  });

  return (
    <section
      aria-label={props.label}
      class="@container/record flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <Show
        when={!isTouchDevice()}
        fallback={
          <ViewShell.Header class="py-2">
            <div class="flex min-w-0 items-center gap-3">
              {props.controls}
              <SearchBar
                ref={(element) => {
                  focusSearch = () => {
                    element.focus();
                    element.select();
                  };
                }}
                size="sm"
                label={searchLabel()}
                value={props.search}
                onValueChange={props.onSearchChange}
                onEscape={view.host.focus}
                class="min-w-0 flex-1"
              />
              <Button variant="secondary" onClick={props.onCreate}>
                <PlusIcon class="size-4" />
                {props.createLabel}
              </Button>
            </div>
          </ViewShell.Header>
        }
      >
        <ListHeader title={props.title ?? props.label}>
          {props.controls}
          <ViewCreateButton
            aria-label={props.createLabel}
            tooltip={props.createLabel}
            onClick={props.onCreate}
          />
          <ListHeaderSearch
            label={searchLabel()}
            value={props.search}
            onValueChange={props.onSearchChange}
            onEscape={view.host.focus}
            registerFocus={(focus) => (focusSearch = focus)}
          />
        </ListHeader>
      </Show>
      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-6 touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+1.5rem)] touch:[--mobile-content-inset-top:0px]">
        {props.children}
      </div>
    </section>
  );
}
