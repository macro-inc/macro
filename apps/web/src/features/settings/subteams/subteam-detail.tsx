import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName, macroIdToEmail, tryMacroId } from '@core/user';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import XIcon from '@icon/system/regular/x.svg';
import {
  useDeleteSubteamMutation,
  useNestSubteamMutation,
  useRemoveSubteamMemberMutation,
  useSaveSubteamMemberMutation,
  useUpdateSubteamMutation,
} from '@queries/team/subteams';
import type { Subteam } from '@service-auth/generated/schemas/subteam';
import { SubteamJoinPolicy } from '@service-auth/generated/schemas/subteamJoinPolicy';
import { SubteamRole } from '@service-auth/generated/schemas/subteamRole';
import type { UpdateSubteamRequest } from '@service-auth/generated/schemas/updateSubteamRequest';
import { Button, ConfirmDialog, Dropdown, Tabs } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../primitives';
import { AddSubteamMembersDialog } from './add-subteam-members-dialog';
import { SubteamColorPicker, SubteamMark } from './subteam-mark';
import { SubteamRow } from './subteam-row';

const TOP_LEVEL = 'top-level';

function roleFromValue(value: string): SubteamRole | undefined {
  return Object.values(SubteamRole).find((role) => role === value);
}

/** One team: its name, members, and settings. */
export function SubteamDetail(props: {
  subteam: Subteam;
  subteams: Subteam[];
  workspaceName: string;
  workspaceUserIds: string[];
  viewerId: string | undefined;
  isWorkspaceAdmin: boolean;
  onOpen: (subteamId: string) => void;
  onBack: () => void;
}) {
  const updateSubteam = useUpdateSubteamMutation();
  const nestSubteam = useNestSubteamMutation();
  const deleteSubteam = useDeleteSubteamMutation();
  const saveMember = useSaveSubteamMemberMutation();
  const removeMember = useRemoveSubteamMemberMutation();
  const [addingPeople, setAddingPeople] = createSignal(false);
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);

  const viewerRole = () =>
    props.subteam.members.find((member) => member.userId === props.viewerId)
      ?.role;
  const canManage = (subteam: Subteam) =>
    props.isWorkspaceAdmin ||
    subteam.members.some(
      (member) =>
        member.userId === props.viewerId && member.role === SubteamRole.manager
    );
  const manages = () => canManage(props.subteam);

  const parent = () =>
    props.subteams.find((subteam) => subteam.id === props.subteam.parentId);
  const children = () =>
    props.subteams.filter((subteam) => subteam.parentId === props.subteam.id);
  // Top-level teams this one could move under: ones the viewer manages.
  const parentOptions = createMemo(() =>
    props.subteams.filter(
      (subteam) =>
        subteam.id !== props.subteam.id &&
        !subteam.parentId &&
        canManage(subteam)
    )
  );
  const notOnTeam = () =>
    props.workspaceUserIds.filter(
      (userId) =>
        !props.subteam.members.some((member) => member.userId === userId)
    );

  const update = (request: UpdateSubteamRequest) =>
    updateSubteam.mutate({ subteamId: props.subteam.id, request });

  const rename = (value: string) => {
    const name = value.trim();
    if (name && name !== props.subteam.name) update({ name });
  };

  const describe = (value: string) => {
    const description = value.trim();
    if (description !== props.subteam.description) update({ description });
  };

  const join = () => {
    const viewerId = props.viewerId;
    if (!viewerId) return;

    saveMember.mutate({
      subteamId: props.subteam.id,
      userId: viewerId,
      role: SubteamRole.member,
    });
  };

  const leave = () => {
    const viewerId = props.viewerId;
    if (!viewerId) return;

    removeMember.mutate({ subteamId: props.subteam.id, userId: viewerId });
  };

  const addPeople = (userIds: string[]) => {
    for (const userId of userIds) {
      saveMember.mutate({
        subteamId: props.subteam.id,
        userId,
        role: SubteamRole.member,
      });
    }
  };

  const remove = () =>
    deleteSubteam.mutate(props.subteam.id, {
      onSuccess: () => {
        setConfirmingDelete(false);
        props.onBack();
      },
    });

  return (
    <SettingsPage
      title={props.subteam.name}
      onBack={props.onBack}
      backLabel={t('settingsTeams.back')}
      heading={
        <div class="flex min-w-0 items-center gap-4">
          <SubteamMark
            name={props.subteam.name}
            color={props.subteam.color}
            size="lg"
          />
          <div class="flex min-w-0 flex-1 flex-col">
            <Show when={parent()}>
              {(parentTeam) => (
                <button
                  type="button"
                  class="self-start text-xs text-ink-muted hover:text-ink"
                  onClick={() => props.onOpen(parentTeam().id)}
                >
                  {parentTeam().name} /
                </button>
              )}
            </Show>
            <Show
              when={manages()}
              fallback={
                <>
                  <h1 class="truncate text-[26px]/tight font-medium tracking-[-0.025em] text-ink">
                    {props.subteam.name}
                  </h1>
                  <Show when={props.subteam.description}>
                    <p class="text-sm text-ink/60">
                      {props.subteam.description}
                    </p>
                  </Show>
                </>
              }
            >
              <input
                type="text"
                aria-label={t('settingsTeams.teamName')}
                maxLength={40}
                value={props.subteam.name}
                onChange={(event) => rename(event.currentTarget.value)}
                class="-ml-2 w-full min-w-0 max-w-md rounded-lg border border-transparent bg-transparent px-2 py-0.5 text-[26px]/tight font-medium tracking-[-0.025em] text-ink outline-none hover:border-edge-muted focus:border-edge focus:bg-input-focus"
              />
              <input
                type="text"
                aria-label={t('settingsTeams.descriptionLabel')}
                maxLength={200}
                value={props.subteam.description}
                placeholder={t('settingsTeams.descriptionPlaceholder')}
                onChange={(event) => describe(event.currentTarget.value)}
                class="-ml-2 w-full min-w-0 max-w-md rounded-md border border-transparent bg-transparent px-2 py-0.5 text-sm text-ink/60 outline-none placeholder:text-ink-placeholder hover:border-edge-muted focus:border-edge focus:bg-input-focus"
              />
            </Show>
          </div>
        </div>
      }
      actions={
        <div class="flex flex-col items-end gap-3 @max-[480px]/settings-page:flex-row-reverse @max-[480px]/settings-page:items-center @max-[480px]/settings-page:justify-between">
          <Show
            when={viewerRole()}
            fallback={
              <Show
                when={
                  manages() ||
                  props.subteam.joinPolicy === SubteamJoinPolicy.open
                }
              >
                <Button variant="secondary" size="sm" onClick={join}>
                  {t('settingsTeams.join')}
                </Button>
              </Show>
            }
          >
            <Button variant="secondary" size="sm" onClick={leave}>
              {t('settingsTeams.leave')}
            </Button>
          </Show>
          <Show when={manages()}>
            <SubteamColorPicker
              value={props.subteam.color}
              onChange={(color) => update({ color })}
            />
          </Show>
        </div>
      }
    >
      <SettingsSection
        title={t('settingsTeams.members')}
        actions={
          <Show when={manages()}>
            <Button
              variant="secondary"
              size="sm"
              disabled={notOnTeam().length === 0}
              onClick={() => setAddingPeople(true)}
            >
              <PlusIcon class="size-4" />
              {t('settingsTeams.addPeople')}
            </Button>
          </Show>
        }
      >
        <SettingsCard>
          <For each={props.subteam.members}>
            {(member) => {
              const macroId = () => tryMacroId(member.userId);
              const name = () => getDisplayName(macroId()) || member.userId;
              const email = () => {
                const id = macroId();
                return id ? macroIdToEmail(id) : member.userId;
              };

              return (
                <div class="flex items-center justify-between gap-2 px-4 py-3">
                  <div class="flex min-w-0 flex-1 items-center gap-3">
                    <UserIcon id={member.userId} isDeleted={false} size="lg" />
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-medium text-ink">
                        {name()}
                      </div>
                      <div class="truncate text-xs text-ink-muted">
                        {email()}
                      </div>
                    </div>
                  </div>
                  <Show
                    when={manages()}
                    fallback={
                      <span class="text-xs text-ink-muted">
                        {member.role === SubteamRole.manager
                          ? t('settingsTeams.manager')
                          : t('settingsTeams.member')}
                      </span>
                    }
                  >
                    <Dropdown placement="bottom-end">
                      <Dropdown.Trigger
                        variant="ghost"
                        size="sm"
                        class="h-auto gap-1 rounded-xs border-0 px-1 py-0.5 text-xs text-ink-muted"
                      >
                        {member.role === SubteamRole.manager
                          ? t('settingsTeams.manager')
                          : t('settingsTeams.member')}
                        <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
                      </Dropdown.Trigger>
                      <Dropdown.Content class="min-w-56 max-w-80">
                        <Dropdown.Group>
                          <Dropdown.RadioGroup
                            value={member.role}
                            onChange={(value) => {
                              const role = roleFromValue(value);
                              if (!role || role === member.role) return;
                              saveMember.mutate({
                                subteamId: props.subteam.id,
                                userId: member.userId,
                                role,
                              });
                            }}
                          >
                            <Dropdown.RadioItem
                              closeOnSelect
                              value={SubteamRole.manager}
                            >
                              <span class="flex flex-1 flex-col">
                                <span>{t('settingsTeams.manager')}</span>
                                <span class="text-xs text-ink-extra-muted">
                                  {t('settingsTeams.managerDescription')}
                                </span>
                              </span>
                              <Dropdown.ItemIndicator>
                                <CheckIcon class="size-3.5" />
                              </Dropdown.ItemIndicator>
                            </Dropdown.RadioItem>
                            <Dropdown.RadioItem
                              closeOnSelect
                              value={SubteamRole.member}
                            >
                              <span class="flex flex-1 flex-col">
                                <span>{t('settingsTeams.member')}</span>
                                <span class="text-xs text-ink-extra-muted">
                                  {t('settingsTeams.memberDescription')}
                                </span>
                              </span>
                              <Dropdown.ItemIndicator>
                                <CheckIcon class="size-3.5" />
                              </Dropdown.ItemIndicator>
                            </Dropdown.RadioItem>
                          </Dropdown.RadioGroup>
                        </Dropdown.Group>
                      </Dropdown.Content>
                    </Dropdown>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('settingsTeams.removeFromTeam', {
                        name: name(),
                      })}
                      onClick={() =>
                        removeMember.mutate({
                          subteamId: props.subteam.id,
                          userId: member.userId,
                        })
                      }
                    >
                      <XIcon class="size-4" />
                    </Button>
                  </Show>
                </div>
              );
            }}
          </For>
        </SettingsCard>
      </SettingsSection>

      <Show when={manages()}>
        <SettingsSection title={t('settingsTeams.settings')}>
          <SettingsCard>
            <SettingsRow label={t('settingsTeams.whoCanJoin')} stackOnNarrow>
              <Tabs
                aria-label={t('settingsTeams.whoCanJoin')}
                size="sm"
                value={props.subteam.joinPolicy}
                options={[
                  {
                    value: SubteamJoinPolicy.open,
                    label: t('settingsTeams.anyoneInWorkspace', {
                      workspace: props.workspaceName,
                    }),
                  },
                  {
                    value: SubteamJoinPolicy.invite_only,
                    label: t('settingsTeams.inviteOnly'),
                  },
                ]}
                onChange={(joinPolicy) => update({ joinPolicy })}
              />
            </SettingsRow>
            <SettingsRow
              label={t('settingsTeams.nestedIn')}
              description={
                children().length > 0
                  ? t('settingsTeams.hasNestedTeams')
                  : t('settingsTeams.nestedInDescription')
              }
            >
              <Dropdown placement="bottom-end">
                <Dropdown.Trigger
                  variant="secondary"
                  size="sm"
                  disabled={children().length > 0}
                  class="gap-1"
                >
                  {parent()?.name ?? t('settingsTeams.topLevel')}
                  <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
                </Dropdown.Trigger>
                <Dropdown.Content class="min-w-48 max-w-80">
                  <Dropdown.Group>
                    <Dropdown.RadioGroup
                      value={props.subteam.parentId ?? TOP_LEVEL}
                      onChange={(value) => {
                        const parentId = value === TOP_LEVEL ? null : value;
                        if (parentId === (props.subteam.parentId ?? null)) {
                          return;
                        }
                        nestSubteam.mutate({
                          subteamId: props.subteam.id,
                          parentId,
                        });
                      }}
                    >
                      <Dropdown.RadioItem closeOnSelect value={TOP_LEVEL}>
                        <span class="flex-1 truncate">
                          {t('settingsTeams.topLevel')}
                        </span>
                        <Dropdown.ItemIndicator>
                          <CheckIcon class="size-3.5" />
                        </Dropdown.ItemIndicator>
                      </Dropdown.RadioItem>
                      <For each={parentOptions()}>
                        {(option) => (
                          <Dropdown.RadioItem closeOnSelect value={option.id}>
                            <SubteamMark
                              name={option.name}
                              color={option.color}
                              size="sm"
                            />
                            <span class="flex-1 truncate">{option.name}</span>
                            <Dropdown.ItemIndicator>
                              <CheckIcon class="size-3.5" />
                            </Dropdown.ItemIndicator>
                          </Dropdown.RadioItem>
                        )}
                      </For>
                    </Dropdown.RadioGroup>
                  </Dropdown.Group>
                </Dropdown.Content>
              </Dropdown>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      </Show>

      <Show when={children().length > 0}>
        <SettingsSection title={t('settingsTeams.nestedTeams')}>
          <SettingsCard>
            <For each={children()}>
              {(child) => (
                <SubteamRow
                  subteam={child}
                  onOpen={() => props.onOpen(child.id)}
                />
              )}
            </For>
          </SettingsCard>
        </SettingsSection>
      </Show>

      <Show when={manages()}>
        <SettingsSection>
          <SettingsCard>
            <SettingsRow
              label={t('settingsTeams.deleteTeam')}
              description={t('settingsTeams.deleteDescription')}
            >
              <Button
                variant="danger"
                size="sm"
                onClick={() => setConfirmingDelete(true)}
              >
                <TrashIcon class="size-4" />
                {t('settingsTeams.delete')}
              </Button>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      </Show>

      <AddSubteamMembersDialog
        open={addingPeople()}
        userIds={notOnTeam()}
        onClose={() => setAddingPeople(false)}
        onAdd={addPeople}
      />
      <ConfirmDialog
        open={confirmingDelete()}
        onOpenChange={setConfirmingDelete}
        title={t('settingsTeams.deleteTitle', { name: props.subteam.name })}
        body={t('settingsTeams.deleteBody')}
        tone="danger"
        confirmLabel={t('settingsTeams.delete')}
        pending={deleteSubteam.isPending}
        onConfirm={remove}
      />
    </SettingsPage>
  );
}
