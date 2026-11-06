import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { fireAndForget } from '@core/util/fireAndForget';
import { Accordion } from '@kobalte/core/accordion';
import type { DialogHandle } from '@ui';
import {
  createSignal,
  For,
  getOwner,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { useEmailView } from '../email-view-context';
import { useEmailFilters } from '../filters/use-email-filters';
import { useEmailParticipantSuggestions } from '../queries/use-email-participant-suggestions';
import {
  EmailSavedViewActions,
  EmailSavedViewCreateBanner,
} from '../views/email-saved-views';
import { EmailParticipantsField } from './EmailFilterFields';
import { EmailInboxDrawerSection } from './EmailInboxSelector';

const INBOX_SECTION_ID = 'inbox';

export function EmailFilterDrawer() {
  const { state, setFilters, clearFilters, savedViews, savedViewScope } =
    useEmailView();
  const filters = useEmailFilters();
  const suggestions = useEmailParticipantSuggestions();
  const setConditions = (
    change: Partial<NonNullable<typeof state.conditions>>
  ) => {
    const conditions = state.conditions;
    if (conditions) setFilters({ conditions: { ...conditions, ...change } });
  };
  const sectionCount = (groupId: string) =>
    filters.isGroupActive(groupId)
      ? Math.max(1, filters.selectedIds(groupId).length)
      : 0;
  const showFacetFilters = () => state.tab !== 'scheduled';
  const [open, setOpen] = createSignal(false);
  const owner = getOwner();
  let disposed = false;
  let pending:
    | {
        create: () => DialogHandle | undefined;
        scope: ReturnType<typeof savedViewScope>;
      }
    | undefined;
  onCleanup(() => {
    disposed = true;
    pending = undefined;
  });
  // The drawer finishes closing before its dialog opens; cancelling reopens
  // the filters only if the list is still where it was.
  const onCreate = (create: () => DialogHandle | undefined) => {
    pending = { create, scope: savedViewScope() };
    setOpen(false);
  };
  const reopen = async (
    dialog: DialogHandle,
    scope: ReturnType<typeof savedViewScope>
  ) => {
    await dialog.closed;
    if (!disposed && scope === savedViewScope()) setOpen(true);
  };
  const afterClose = (present: boolean) => {
    if (present || open()) return;
    const action = pending;
    pending = undefined;
    if (!action) return;
    queueMicrotask(() =>
      queueMicrotask(() => {
        if (disposed || open() || action.scope !== savedViewScope()) return;
        const dialog = action.create();
        if (dialog) fireAndForget(reopen(dialog, action.scope), 'saved-views');
      })
    );
  };
  const editingSavedView = () => {
    const view = savedViews?.view();
    return view?.kind === 'saved' && view.dirty;
  };

  return (
    <MobileFilterDrawer
      open={open()}
      onOpenChange={setOpen}
      onContentPresentChange={afterClose}
      contentOverlay={() => (
        <EmailSavedViewCreateBanner dialogOwner={owner} onCreate={onCreate} />
      )}
      footerEnd={() => editingSavedView() && <EmailSavedViewActions />}
      triggerLabel="Open email filters"
      label="Email filters"
      activeCount={filters.activeCount()}
      onClear={clearFilters}
    >
      <MobileDrawer.Label class="pt-4">
        {showFacetFilters() ? 'Filters' : 'Inboxes'}
      </MobileDrawer.Label>
      <Accordion
        multiple
        collapsible
        defaultValue={[INBOX_SECTION_ID, filters.groups()[0].id]}
      >
        <div class="flex flex-col gap-3">
          <EmailInboxDrawerSection value={INBOX_SECTION_ID} />
          <Show when={showFacetFilters()}>
            <For each={filters.groups()}>
              {(group) => (
                <Switch
                  fallback={
                    <MobileFilterDrawer.Section
                      value={group.id}
                      label={group.label}
                      activeCount={sectionCount(group.id)}
                    >
                      <div
                        role={
                          group.selectionMode === 'single'
                            ? 'radiogroup'
                            : 'group'
                        }
                        aria-label={group.label}
                      >
                        <For each={group.options}>
                          {(option) => (
                            <MobileFilterDrawer.Option
                              selectionMode={group.selectionMode}
                              checked={filters.isSelected(group.id, option.id)}
                              onChange={(checked) =>
                                filters.setSelected(
                                  group.id,
                                  option.id,
                                  checked
                                )
                              }
                              icon={option.icon?.()}
                            >
                              {option.label}
                            </MobileFilterDrawer.Option>
                          )}
                        </For>
                      </div>
                    </MobileFilterDrawer.Section>
                  }
                >
                  {/* Inboxes have their own section above; Match from sits under People. */}
                  <Match
                    when={group.id === 'inboxes' || group.id === 'matchFrom'}
                  >
                    {null}
                  </Match>
                  <Match when={group.id === 'people' && state.conditions}>
                    {(conditions) => (
                      <MobileFilterDrawer.Section
                        value={group.id}
                        label={group.label}
                        activeCount={sectionCount(group.id)}
                      >
                        <div class="flex flex-col gap-2 px-1 pb-2">
                          <EmailParticipantsField
                            participants={conditions().participants}
                            participantFields={conditions().participantFields}
                            onParticipantsChange={(participants) =>
                              setConditions({ participants })
                            }
                            onFieldsChange={(participantFields) =>
                              setConditions({ participantFields })
                            }
                            suggestions={suggestions}
                          />
                        </div>
                      </MobileFilterDrawer.Section>
                    )}
                  </Match>
                </Switch>
              )}
            </For>
          </Show>
        </div>
      </Accordion>
    </MobileFilterDrawer>
  );
}
