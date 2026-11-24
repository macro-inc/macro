import { triggerFocusNewElement } from '@core/directive/focusInput';
import { isMobile } from '@core/mobile/isMobile';
import MoreIcon from '@icon/system/regular/dots-three.svg';
import RenameIcon from '@icon/system/regular/pencil-line.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import { Dropdown } from '@ui/components/Dropdown';
import { type JSX, Show } from 'solid-js';
import {
  CreateRecordButton,
  DatabaseToolbarFrame,
  ViewOptions,
} from '../../components/database-editor-toolbar';
import {
  createViewControls,
  type DatabaseToolbarProps,
} from '../../components/database-toolbar';

/**
 * The view toolbar on touch devices, in two rows that fit a phone: the
 * table switcher with New record and search, then the view tabs with filter,
 * sort and a menu of the less-used view actions.
 */
export function MobileDatabaseToolbar(
  props: DatabaseToolbarProps & {
    /** A phone's table switcher; wider touch screens keep the header's tabs. */
    tables?: JSX.Element;
  }
) {
  const views = createViewControls(props);
  /** Renaming waits for the view actions menu to close: an open menu holds focus. */
  let renameOnMenuClose: DatabaseView | undefined;

  return (
    <div class="shrink-0 bg-canvas-base">
      <DatabaseToolbarFrame>
        <div class="flex flex-col gap-1.5 px-4 py-1.5">
          {/* Search comes last, so its results, anchored to its end, stay
              on screen. */}
          <div class="flex min-w-0 items-center gap-2">
            <div class="flex min-w-0 flex-1 items-center">
              <Show when={isMobile()}>{props.tables}</Show>
            </div>
            <Show when={props.onCreateRecord}>
              {(createRecord) => (
                <CreateRecordButton
                  onCreateRecord={createRecord()}
                  canCreateRecord={props.canCreateRecord}
                  creating={props.creating}
                />
              )}
            </Show>
            {props.actions}
            {props.search}
          </div>
          <div class="flex min-w-0 items-center gap-2">
            <div class="flex min-w-0 flex-1 items-center">{views.tabs()}</div>
            <Show when={views.canChangeView()}>
              <ViewOptions
                columns={props.columns}
                view={props.view}
                onChangeView={props.onChangeView}
              />
            </Show>
            <Show when={props.canEdit}>
              <Dropdown placement="bottom-end">
                <Dropdown.Trigger
                  aria-label="View actions"
                  size="icon-md"
                  variant="ghost"
                  class="shrink-0"
                >
                  <MoreIcon class="size-4" />
                </Dropdown.Trigger>
                <Dropdown.Content
                  class="min-w-48"
                  onCloseAutoFocus={(event) => {
                    const view = renameOnMenuClose;
                    renameOnMenuClose = undefined;
                    if (!view) return;

                    // The name field takes focus, not the menu button.
                    event.preventDefault();
                    views.beginRename(view);
                  }}
                >
                  <Show when={views.selectedView()}>
                    {(selected) => (
                      <>
                        <Dropdown.Group>
                          <Dropdown.Item
                            onSelect={() => {
                              // iOS raises the keyboard only for a focus
                              // inside the tap; the field mounts after it.
                              triggerFocusNewElement(
                                'input[aria-label="View name"]',
                                { touchOnly: true }
                              );
                              renameOnMenuClose = selected();
                            }}
                          >
                            <RenameIcon class="size-4" />
                            Rename view
                          </Dropdown.Item>
                          <Dropdown.Item
                            onSelect={() => views.confirmDelete(selected())}
                          >
                            <TrashIcon class="size-4" />
                            Delete view
                          </Dropdown.Item>
                        </Dropdown.Group>
                        <Dropdown.Separator class="my-1 border-t border-edge-divider" />
                      </>
                    )}
                  </Show>
                  <Dropdown.Group>
                    <Dropdown.GroupLabel>New view</Dropdown.GroupLabel>
                    {views.newViewItems()}
                  </Dropdown.Group>
                </Dropdown.Content>
              </Dropdown>
            </Show>
          </div>
        </div>
      </DatabaseToolbarFrame>
      {views.feedback()}
    </div>
  );
}
