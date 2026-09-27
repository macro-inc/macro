import { ShareOptions } from '@app/features/sharing/components/share-options';
import { UserIcon } from '@core/component/UserIcon';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { Button, Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { ProjectDetail } from '../core/project';

/** Collaborator grants are independent of the project's assignee property. */
export function ProjectCollaborators(props: {
  project: ProjectDetail;
  pending: boolean;
  getUserName(id: string): string;
  onMembers(ids: string[]): Promise<void>;
}) {
  const [picking, setPicking] = createSignal(false);
  const [selected, setSelected] = createSignal(new Set<string>());
  const owner = () => props.project.access === 'owner';
  const save = async (ids: string[]) => {
    if (!owner() || props.pending) return;
    try {
      await props.onMembers(ids);
      setPicking(false);
    } catch {
      // The sharing host renders the mutation error and retains the draft.
    }
  };
  return (
    <>
      <For
        each={props.project.memberIds.filter(
          (id) => id !== props.project.ownerId
        )}
      >
        {(id) => (
          <div class="flex justify-between gap-3">
            <div class="flex items-center gap-2 overflow-hidden">
              <UserIcon id={id} size="sm" />
              <span class="font-medium truncate">{props.getUserName(id)}</span>
            </div>
            <ShareOptions
              permissions="edit"
              allowedAccessLevels={['edit']}
              disabled={!owner() || props.pending}
              label={`Access for ${props.getUserName(id)}`}
              setPermissions={(level) => {
                if (level === null)
                  void save(
                    props.project.memberIds.filter((member) => member !== id)
                  );
              }}
            />
          </div>
        )}
      </For>
      <Show when={owner()}>
        <Dropdown
          open={picking()}
          onOpenChange={(value) => {
            if (props.pending) return;
            if (value) setSelected(new Set(props.project.memberIds));
            setPicking(value);
          }}
        >
          <Dropdown.Trigger disabled={props.pending} variant="outline">
            Manage collaborators
          </Dropdown.Trigger>
          <Dropdown.Content portalScope="local" class="min-w-72 p-3">
            <PropertyEntitySelector
              selectedOptions={selected}
              setSelectedOptions={setSelected}
              config={{
                specificEntityType: 'USER',
                isMultiSelect: true,
                placeholder: 'Add collaborators',
              }}
            />
            <div class="mt-3 flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={props.pending}
                onClick={() => setPicking(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={props.pending}
                onClick={() =>
                  void save(
                    [...selected()].filter((id) => id !== props.project.ownerId)
                  )
                }
              >
                Save collaborators
              </Button>
            </div>
          </Dropdown.Content>
        </Dropdown>
      </Show>
    </>
  );
}
