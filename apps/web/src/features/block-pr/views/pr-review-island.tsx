import { useChanges } from '@app/features/changes/changes';
import { t } from '@app/lib/i18n';
import CaretDown from '@icon/system/regular/caret-down.svg';
import CaretUp from '@icon/system/regular/caret-up.svg';
import * as Popover from '@kobalte/core/popover';
import { Button, Input, ToggleSwitch } from '@ui';
import { Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { usePrPage } from '../context/pr-page-context';
import { prAdjacentUnviewedFile } from '../primitives/pr-page-state';
import { PrFileList } from './shared/pr-details';
import { PrFinishReviewPopover } from './shared/pr-review';

/** Desktop owns the island; the mobile view composes its own FloatRegion. */
export function PrReviewIsland(props: { insetRight?: number }) {
  const { page, actions } = usePrPage();
  const { model, review, layout } = useChanges();
  const [picker, setPicker] = createStore({
    query: '',
    unviewed: false,
    open: false,
  });
  const viewedCount = () =>
    model.files().filter((file) => page()?.viewedFiles?.includes(file.path))
      .length;
  const neighbor = (direction: -1 | 1) =>
    prAdjacentUnviewedFile(
      model.files().map((file) => file.path),
      page()?.viewedFiles ?? [],
      review.active(),
      direction
    );
  const openFile = (path: string) => {
    layout.open();
    review.activate(path);
  };
  const jump = (direction: -1 | 1) => {
    const path = neighbor(direction);
    if (path) openFile(path);
  };
  return (
    <Show when={page()?.viewedFiles || actions.submitReview.available()}>
      <div
        class="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-3"
        style={{ right: `${props.insetRight ?? 0}px` }}
      >
        <div class="menu-surface pointer-events-auto flex items-center gap-1 rounded-full p-1">
          <Show when={page()?.viewedFiles}>
            <Popover.Root
              open={picker.open}
              onOpenChange={(open) => setPicker('open', open)}
              placement="top"
            >
              <Popover.Trigger as={Button} size="sm" variant="ghost">
                {t('prPage.viewedProgress', {
                  count: viewedCount(),
                  total: model.files().length,
                })}
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  class="menu-surface z-modal flex max-h-96 w-80 max-w-[90vw] flex-col gap-2 overflow-hidden rounded-xl p-3"
                  aria-label={t('prPage.files')}
                >
                  <Input
                    type="search"
                    aria-label={t('prPage.searchFiles')}
                    placeholder={t('prPage.searchFiles')}
                    value={picker.query}
                    onInput={(event) =>
                      setPicker('query', event.currentTarget.value)
                    }
                  />
                  <Show when={page()?.viewedFiles}>
                    <ToggleSwitch
                      size="sm"
                      label={t('prPage.unviewed')}
                      checked={picker.unviewed}
                      onChange={(value) => setPicker('unviewed', value)}
                    />
                  </Show>
                  <div class="min-h-0 overflow-y-auto">
                    <Show when={page()}>
                      {(current) => (
                        <PrFileList
                          page={current()}
                          filter={(path) =>
                            path
                              .toLowerCase()
                              .includes(picker.query.trim().toLowerCase()) &&
                            (!picker.unviewed ||
                              !current().viewedFiles?.includes(path))
                          }
                          onFile={(path) => {
                            openFile(path);
                            setPicker('open', false);
                          }}
                        />
                      )}
                    </Show>
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('prPage.previousFile')}
              disabled={!neighbor(-1)}
              onClick={() => jump(-1)}
            >
              <CaretUp class="size-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('prPage.nextFile')}
              disabled={!neighbor(1)}
              onClick={() => jump(1)}
            >
              <CaretDown class="size-4" />
            </Button>
          </Show>
          <PrFinishReviewPopover />
        </div>
      </div>
    </Show>
  );
}
