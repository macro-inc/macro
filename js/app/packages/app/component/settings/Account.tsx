import { UserIcon } from '@core/component/UserIcon';
import { useLogout } from '@core/auth/logout';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isMobile } from '@core/mobile/isMobile';
import { toast } from '@core/component/Toast/Toast';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { createStaticFile } from '@core/util/create';
import { openFilePicker } from '@core/util/upload';
import { Dialog, Button, Panel, Tooltip, ToggleSwitch, Dropdown } from '@ui';
import {
  blockNameToFileExtensions,
  blockNameToMimeTypes,
} from '@core/constant/allBlocks';
import { ShowFeatureFlag, useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  DISABLE_AUTO_UPDATE_UI_FLAG,
  ENABLE_AUTO_UPDATE_UI_OVERRIDE,
  ENABLE_PROFILE_PICTURES,
  ENABLE_NEW_PRICING_OVERRIDE,
} from '@core/constant/featureFlags';
import { useUserTeamsQuery } from '@queries/team';
import {
  type ProfilePictureItem,
  useProfilePictureUrl,
} from '@core/signal/profilePicture';
import IconUpload from '@phosphor-icons/core/regular/upload-simple.svg?component-solid';
import SignOutIcon from '@phosphor-icons/core/regular/sign-out.svg?component-solid';
import PencilIcon from '@phosphor/pencil-simple.svg';
import TrashIcon from '@phosphor/trash.svg';
import CheckIcon from '@phosphor/check.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import WarningCircleIcon from '@phosphor/warning-circle.svg';
import { authServiceClient } from '@service-auth/client';
import { useEmail, useUserId } from '@core/context/user';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { usePermissions } from '@core/context/user';
import { PERMISSION_IDS } from '@core/constant/permissions';
import { useSettingsState } from '@core/constant/SettingsState';
import PaywallComponent from '../paywall/PaywallComponent';
import PaywallTeamOwnerView from '../paywall/PaywallTeamOwnerView';
import UsersThreeIcon from '@phosphor/users-three.svg';
import {
  type SupportedNotificationSettings,
  useNotificationSettings,
} from '@notifications';
import { useAnalytics } from '@app/component/analytics-context';
import { useTauri, type BundleUpdateStatus } from '@macro/tauri';
import { invoke } from '@tauri-apps/api/core';
import { Transition } from 'solid-transition-group';

// 16 megabytes
const MAX_PROFILE_PICTURE_SIZE = 16 * 1000 * 1000;

async function uploadProfilePicture(
  file: File
): Promise<{ id: string; url: string } | void> {
  if (file.size > MAX_PROFILE_PICTURE_SIZE) {
    return toast.failure('Image size too large');
  }

  try {
    const id = await createStaticFile(file);
    const url = staticFileIdEndpoint(id);
    const response = await authServiceClient.putProfilePicture({ url });
    if (response.isErr()) {
      return toast.failure('Failed to upload profile picture');
    }
    return { id, url };
  } catch (_error) {
    return toast.failure('Failed to upload profile picture');
  }
}

async function removeProfilePicture(): Promise<boolean> {
  try {
    const response = await authServiceClient.putProfilePicture({ url: '' });
    if (response.isErr()) {
      toast.failure('Failed to remove profile picture');
      return false;
    }
    return true;
  } catch (_error) {
    toast.failure('Failed to remove profile picture');
    return false;
  }
}

function formatBundleUpdateStatus(status: BundleUpdateStatus): string {
  switch (status.status) {
    case 'Idle': return 'Idle';
    case 'CheckingForUpdate': return 'Checking for update...';
    case 'UpdateFound': return `Update available: v${status.data.version}`;
    case 'NoUpdateNeeded': return 'Up to date';
    case 'WaitingForWifi': return 'Waiting for Wi-Fi to download';
    case 'Downloading': return `Downloading: ${Math.round(status.data.progress)}%`;
    case 'Unzipping': return `Installing: ${Math.round(status.data.progress)}%`;
    case 'ClearRequired': return 'Cached update revoked';
    case 'NativeUpdateRequired': return 'App update required';
    case 'Completed': return 'Update ready';
    case 'Error': return 'An error occurred when checking for updates';
  }
}

/**
 * Save one name field with an optimistic update and rollback on failure.
 * Returns whether the save succeeded, which drives NameInput's status icon.
 */
async function saveUserName(
  value: string,
  field: 'first_name' | 'last_name',
  prev: string | undefined,
  setValue: (next: string | undefined) => void
): Promise<boolean> {
  setValue(value); // optimistic
  try {
    const res = await authServiceClient.putUserName(
      field === 'first_name' ? { first_name: value } : { last_name: value }
    );
    if (res.isErr()) {
      setValue(prev); // rollback on a returned error
      return false;
    }
    return true;
  } catch {
    setValue(prev); // rollback if the call throws before returning a Result
    return false;
  }
}

function useUserName() {
  const fetchUserName = async () => {
    const response = await authServiceClient.getUserName();
    return response.isOk() ? response.value : null;
  };

  const [userNameResource] = createResource(fetchUserName);

  const userName = createMemo(() => {
    if (userNameResource.loading) return undefined;
    return userNameResource() || undefined;
  });

  return userName;
}

function ProfilePictureRow(props: { userId: string }) {
  const [profilePictureUrl, profilePictureControls] = useProfilePictureUrl(
    props.userId
  );
  const [isRemoving, setIsRemoving] = createSignal(false);
  const [showRemoveConfirmModal, setShowRemoveConfirmModal] =
    createSignal(false);

  const mutateProfilePicture = (url?: string) => {
    const pic: ProfilePictureItem = {
      _createdAt: new Date(),
      url,
      id: props.userId,
      loading: false,
    };
    profilePictureControls.mutate(pic);
  };

  const handleUpload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const response = await uploadProfilePicture(file);
    if (!response) return;
    mutateProfilePicture(response.url);
  };

  const pickProfilePicture = () =>
    openFilePicker(
      {
        acceptedMimeTypes: blockNameToMimeTypes.image,
        acceptedFileExtensions: blockNameToFileExtensions.image,
      },
      handleUpload
    );

  const handleRemove = async () => {
    setIsRemoving(true);
    const removed = await removeProfilePicture();
    setIsRemoving(false);
    if (!removed) return;
    setShowRemoveConfirmModal(false);
    mutateProfilePicture();
  };

  return (
    <>
      <Row label="Profile Picture">
        <div class="relative size-12 shrink-0">
          <Show
            when={profilePictureUrl()}
            fallback={
              // No picture: a filled circle that stands out from the surface,
              // with the upload icon always visible. The whole circle uploads.
              <span
                tabindex="0"
                role="button"
                aria-label="Upload profile picture"
                onClick={pickProfilePicture}
                class="flex size-full cursor-pointer items-center justify-center rounded-full bg-edge text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <IconUpload class="size-5" />
              </span>
            }
          >
            {/* Has picture: hover reveals an edit affordance; clicking opens a
                menu to replace or remove the picture. */}
            <Dropdown>
              <Dropdown.Trigger
                as="div"
                tabindex="0"
                aria-label="Edit profile picture"
                class="group block size-full cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <div class="size-full overflow-hidden rounded-full">
                  <UserIcon
                    id={props.userId}
                    isDeleted={false}
                    size="fill"
                    suppressClick
                    showTooltip={false}
                    class="bg-transparent"
                  />
                </div>
                <div class="pointer-events-none absolute -inset-px z-10 flex items-center justify-center rounded-full bg-overlay text-ink opacity-0 transition-opacity group-hover:opacity-100">
                  <PencilIcon class="size-5" />
                </div>
              </Dropdown.Trigger>
              <Dropdown.Content class="w-48">
                <Dropdown.Group>
                  <Dropdown.Item onSelect={pickProfilePicture}>
                    <IconUpload class="size-4" />
                    Upload new picture
                  </Dropdown.Item>
                  <Dropdown.Item
                    class="text-failure"
                    onSelect={() => setShowRemoveConfirmModal(true)}
                  >
                    <TrashIcon class="size-4" />
                    Remove picture
                  </Dropdown.Item>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>
          </Show>
        </div>
      </Row>
      <Dialog
        open={showRemoveConfirmModal()}
        onOpenChange={setShowRemoveConfirmModal}
        position="center"
        class="w-120"
      >
        <Panel active depth={2} class="rounded-xl">
          <Panel.Header class="px-6">
            <Dialog.Title class="text-ink text-sm font-semibold">
              Remove profile picture
            </Dialog.Title>
          </Panel.Header>
          <Panel.Body class="p-6 font-sans flex flex-col gap-3">
            <Dialog.Description class="text-ink-muted text-sm/tight font-normal">
              Remove your current profile picture?
            </Dialog.Description>
            <div class="pt-3 justify-end items-center gap-3 inline-flex">
              <Button
                variant="base"
                depth={3}
                disabled={isRemoving()}
                onClick={() => setShowRemoveConfirmModal(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                depth={3}
                disabled={isRemoving()}
                onClick={handleRemove}
              >
                Remove
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>
    </>
  );
}

// Not accessible if user is not authenticated
export function Account() {
  const email = useEmail();
  const userId = useUserId();
  const logout = useLogout();
  const permissions = usePermissions();
  const { toggleSettings } = useSettingsState();
  const disableAutoUpdateUIFlag = useFeatureFlag(DISABLE_AUTO_UPDATE_UI_FLAG);
  const autoUpdateUIEnabled = createMemo(
    () => ENABLE_AUTO_UPDATE_UI_OVERRIDE ?? !disableAutoUpdateUIFlag().enabled
  );
  const [showDeleteModal, setShowDeleteModal] = createSignal<boolean>(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = createSignal<boolean>(false);

  const userTeamsQuery = useUserTeamsQuery();
  const ownedTeam = createMemo(() => {
    const teams = userTeamsQuery.data;
    const uid = userId();
    if (!teams || !uid) return undefined;
    return teams.find((t) => t.owner_id === uid);
  });
  const isNonOwnerTeamMember = createMemo(() => {
    const teams = userTeamsQuery.data;
    const uid = userId();
    if (!teams || !uid) return false;
    // Only a "non-owner member" if they own no team at all but belong to one.
    const ownsAnyTeam = teams.some((t) => t.owner_id === uid);
    return !ownsAnyTeam && teams.some((t) => t.owner_id !== uid);
  });

  const newPricingFlag = useFeatureFlag('enable-new-pricing', {
    enabledOverride: ENABLE_NEW_PRICING_OVERRIDE,
  });
  const newPricingEnabled = () => newPricingFlag().enabled;

  const userName = useUserName();
  const [updatedFirstName, setUpdatedFirstName] = createSignal<
    string | undefined
  >(undefined);
  const [updatedLastName, setUpdatedLastName] = createSignal<
    string | undefined
  >(undefined);

  const firstName = () => {
    // Display any updated first name immediately without having to refetch
    if (updatedFirstName() !== undefined) return updatedFirstName();
    const userNameValue = userName();
    if (userNameValue && userNameValue.first_name) {
      return userNameValue.first_name;
    }
    return undefined;
  };

  const lastName = () => {
    // Display any updated last name immediately without having to refetch
    if (updatedLastName() !== undefined) return updatedLastName();
    const userNameValue = userName();
    if (userNameValue && userNameValue.last_name) {
      return userNameValue.last_name;
    }
    return undefined;
  };

  const deleteAccountHandler = async () => {
    await authServiceClient.deleteUser();
    logout();
  };

  return (
      <div class="h-full overflow-hidden flex justify-center p-2">
        <div class="max-w-200 size-full">
          <Panel depth={2} class="h-full overflow-hidden text-ink">
          <Panel.Header class="px-6">
            <div class="flex items-center gap-2">
              <div class="text-sm font-semibold">Account</div>
              <TeamSubscriptionPill show={isNonOwnerTeamMember()} />
            </div>
          </Panel.Header>

          <Panel.Body scroll class="text-ink">
            <Show
              when={
                permissions()?.includes(
                  PERMISSION_IDS.WRITE_STRIPE_SUBSCRIPTION
                ) &&
                // Team members get the header pill instead of a card here, so
                // skip this billing block rather than leaving it empty.
                !(newPricingEnabled() && isNonOwnerTeamMember())
              }
            >
              <div class="px-4 py-2 w-full border-b border-edge-muted">
                <ShowFeatureFlag
                  key="enable-new-pricing"
                  enabledOverride={ENABLE_NEW_PRICING_OVERRIDE}
                  fallback={
                    <PaywallComponent
                      hideCloseButton
                      cb={() => {}}
                      handleGuest={() => toggleSettings()}
                    />
                  }
                >
                  <Switch
                    fallback={
                      <PaywallComponent
                        hideCloseButton
                        cb={() => {}}
                        handleGuest={() => toggleSettings()}
                      />
                    }
                  >
                    <Match when={ownedTeam()}>
                      {(team) => <PaywallTeamOwnerView team={team()} />}
                    </Match>
                  </Switch>
                </ShowFeatureFlag>
              </div>
            </Show>
            <div class="grid settings-row-dividers">
              <Show when={ENABLE_PROFILE_PICTURES}>
                <Show when={userId()} keyed>
                  {(id) => <ProfilePictureRow userId={id} />}
                </Show>
              </Show>

              <Row label="Email">
                <span class="ph-no-capture text-sm text-ink-muted">
                  {email() ?? ''}
                </span>
              </Row>

              <Row label="First Name">
                <NameInput
                  value={firstName()}
                  onSave={(newValue) =>
                    saveUserName(
                      newValue,
                      'first_name',
                      updatedFirstName(),
                      setUpdatedFirstName
                    )
                  }
                  placeholder="Enter First Name"
                />
              </Row>

              <Row label="Last Name">
                <NameInput
                  value={lastName()}
                  onSave={(newValue) =>
                    saveUserName(
                      newValue,
                      'last_name',
                      updatedLastName(),
                      setUpdatedLastName
                    )
                  }
                  placeholder="Enter Last Name"
                />
              </Row>

              <Show when={autoUpdateUIEnabled()}>
                <BundleVersionRow />
                <BundleUpdateRow />
              </Show>

              <NotificationToggle />
            </div>

            <Show when={isMobile()}>
              <div class="flex items-center justify-center px-6 py-6">
                <Button
                  variant="base"
                  size="md"
                  depth={3}
                  class="px-4"
                  onClick={() => logout()}
                >
                  <SignOutIcon class="size-4" />
                  Log out
                </Button>
              </div>
            </Show>

            <Show when={isNativeMobilePlatform()}>
              <div class="border-t border-edge pt-4">
                <Button variant="danger" depth={3} onClick={() => setShowDeleteModal(true)}>
                  Delete Account
                </Button>
                <Dialog
                  open={showDeleteModal()}
                  onOpenChange={setShowDeleteModal}
                  position="center"
                  class="w-120"
                >
                  <Panel active depth={2} class="rounded-xl">
                    <Panel.Header class="px-6">
                      <Dialog.Title class="text-ink text-sm font-semibold">
                        Delete Account
                      </Dialog.Title>
                    </Panel.Header>
                    <Panel.Body class="p-6 font-sans flex flex-col gap-3">
                      <Dialog.Description class="text-ink-muted text-sm/tight font-normal">
                        Are you sure you want to delete your account? This action is
                        permanent and cannot be undone.
                      </Dialog.Description>
                      <div class="pt-3 justify-end items-center gap-3 inline-flex">
                        <Button variant="base" depth={3} onClick={() => setShowDeleteModal(false)}>
                          Cancel
                        </Button>
                        <Button variant="danger" depth={3} onClick={() => {
                          setShowDeleteModal(false);
                          setShowDeleteConfirmModal(true);
                        }}>
                          Delete
                        </Button>
                      </div>
                    </Panel.Body>
                  </Panel>
                </Dialog>
                <Dialog
                  open={showDeleteConfirmModal()}
                  onOpenChange={setShowDeleteConfirmModal}
                  position="center"
                  class="w-120"
                >
                  <Panel active depth={2} class="rounded-xl">
                    <Panel.Header class="px-6">
                      <Dialog.Title class="text-ink text-sm font-semibold">
                        Are you absolutely sure?
                      </Dialog.Title>
                    </Panel.Header>
                    <Panel.Body class="p-6 font-sans flex flex-col gap-3">
                      <Dialog.Description class="text-ink-muted text-sm/tight font-normal">
                        This will permanently delete your account and all associated
                        data. This cannot be undone.
                      </Dialog.Description>
                      <div class="pt-3 justify-end items-center gap-3 inline-flex">
                        <Button variant="base" depth={3} onClick={() => setShowDeleteConfirmModal(false)}>
                          Cancel
                        </Button>
                        <Button variant="danger" depth={3} onClick={deleteAccountHandler}>
                          Delete My Account
                        </Button>
                      </div>
                    </Panel.Body>
                  </Panel>
                </Dialog>
              </div>
            </Show>
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}

function Row(props: { label: string; children?: any }) {
  return (
    <div class="bg-surface flex items-center justify-between h-15.25 px-6">
      <div class="text-sm">{props.label}</div>
      <div class="text-right">{props.children}</div>
    </div>
  );
}

/**
 * Team members can't manage their subscription (the owner does), so instead of
 * a full billing card we show a compact, informational pill next to the Account
 * header with the explanation in a hover tooltip. Gated to the new-pricing
 * rollout, matching where the team-member card used to appear.
 */
function TeamSubscriptionPill(props: { show: boolean }) {
  return (
    <Show when={props.show}>
      <ShowFeatureFlag
        key="enable-new-pricing"
        enabledOverride={ENABLE_NEW_PRICING_OVERRIDE}
      >
        <Tooltip
          label="Your subscription is managed by your team owner. Contact them to make changes."
          placement="bottom"
        >
          <span class="inline-flex items-center gap-1.5 rounded-full border border-edge-muted px-2 py-0.5 text-xs font-medium text-ink-muted">
            <UsersThreeIcon class="size-3.5 shrink-0 text-accent" />
            Team Subscription
          </span>
        </Tooltip>
      </ShowFeatureFlag>
    </Show>
  );
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function NameInput(props: {
  value?: string;
  placeholder?: string;
  /** Returns whether the save succeeded so we can show status / revert. */
  onSave: (value: string) => Promise<boolean>;
}) {
  const [inputValue, setInputValue] = createSignal(props.value ?? '');
  const [isFocused, setIsFocused] = createSignal(false);
  const [status, setStatus] = createSignal<SaveStatus>('idle');
  let savedTimer: ReturnType<typeof setTimeout> | undefined;

  // Keep local input synced with external value, but don't clobber while typing.
  createEffect(() => {
    if (!isFocused()) {
      setInputValue(props.value ?? '');
    }
  });

  onCleanup(() => clearTimeout(savedTimer));

  const commit = async () => {
    const next = inputValue();
    if (next === (props.value ?? '')) return; // nothing changed
    clearTimeout(savedTimer);
    setStatus('saving');
    let ok = false;
    try {
      ok = await props.onSave(next);
    } catch {
      ok = false;
    }
    setStatus(ok ? 'saved' : 'error');
    // Auto-clear the "Saved" check; leave the error visible until next edit.
    if (ok) savedTimer = setTimeout(() => setStatus('idle'), 2000);
  };

  const handleKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (
    e
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setInputValue(props.value ?? '');
      e.currentTarget.blur();
    }
  };

  return (
    <div class="ph-no-capture group relative flex items-center gap-1.5 rounded-lg h-7 mobile:h-9 px-2 border text-xs bg-transparent text-ink-muted border-edge-muted hover:text-ink focus-within:text-ink focus-within:border-accent">
      <input
        type="text"
        class="flex-1 min-w-0 bg-transparent outline-none border-0 p-0 text-xs placeholder:text-ink-extra-muted"
        value={inputValue()}
        onInput={(e) => setInputValue(e.currentTarget.value)}
        onFocus={() => {
          setIsFocused(true);
          setStatus('idle'); // clear prior status while editing
        }}
        onBlur={() => {
          void commit();
          setIsFocused(false);
        }}
        onKeyDown={handleKeyDown}
        placeholder={props.placeholder}
        autocomplete="off"
        spellcheck={false}
        data-1p-ignore
      />
      {/* Fixed-width slot so the status icon never widens / shifts the input. */}
      <div class="flex size-3.5 shrink-0 items-center justify-center">
        <Transition
          mode="outin"
          enterActiveClass="transition-opacity duration-200 ease-out"
          enterClass="opacity-0"
          exitActiveClass="transition-opacity duration-150 ease-in"
          exitToClass="opacity-0"
        >
          <Switch>
            <Match when={status() === 'saving'}>
              <SpinnerIcon class="size-3.5 animate-spin text-ink-muted" />
            </Match>
            <Match when={status() === 'saved'}>
              <CheckIcon class="size-3.5 text-success" />
            </Match>
            <Match when={status() === 'error'}>
              <Tooltip label="Couldn't save — try again" placement="top">
                <WarningCircleIcon class="size-3.5 text-failure" />
              </Tooltip>
            </Match>
          </Switch>
        </Transition>
      </div>
    </div>
  );
}

function NotificationToggle() {
  const settings = useNotificationSettings();

  return (
    <Show
      when={settings.isSupported && settings}
      fallback={<NotificationNotSupported />}
    >
      {(s) => <NotificationSettings settings={s()} />}
    </Show>
  );
}

function NotificationSettings(props: {
  settings: SupportedNotificationSettings;
}) {
  const analytics = useAnalytics()

  const handleToggle = (checked: boolean) =>  {
    analytics.track('notifications_toggled')
    props.settings.toggle(checked)
  }


  return (
    <Row label="Notifications">
      <ToggleSwitch
        checked={props.settings.isEnabled()}
        onChange={handleToggle}
      />
    </Row>
  );
}

function NotificationNotSupported() {
  return (
    <Row label="Notifications">
      <span class="text-sm text-ink-muted">Not supported on this device</span>
    </Row>
  );
}

function bundleUpdateAction(
  status: BundleUpdateStatus,
): { label: string; action: () => void } | null {
  const grantBundleUpdate = () =>
    invoke('grant_bundle_update', { approved: true }).catch(console.error);

  switch (status.status) {
    case 'Idle':
      return { label: 'Check for Update', action: () => invoke('check_for_update') };
    case 'Error':
      return { label: 'Retry', action: () => invoke('check_for_update') };
    case 'UpdateFound':
      return { label: 'Download', action: grantBundleUpdate };
    case 'WaitingForWifi':
      return { label: 'Download anyway', action: grantBundleUpdate };
    case 'ClearRequired':
      return { label: 'Reload', action: () => invoke('perform_update') };
    case 'Completed':
      return { label: 'Update', action: () => invoke('perform_update') };
    default:
      return null;
  }
}

type BundleDebugInfo = {
  bundleBuild: number;
  source: 'embedded' | 'ota';
  nativeBuild: number;
};

function BundleVersionRow() {
  if (!isNativeMobilePlatform()) return null;
  const [bundleDebugInfo] = createResource(() =>
    invoke<BundleDebugInfo>('get_bundle_debug_info').catch((error) => {
      console.error('[bundle-update] get_bundle_debug_info failed', error);
      return null;
    })
  );
  return (
    <Show when={bundleDebugInfo()}>
      {(info) => (
        <Row label="Version">
          <span class="text-sm text-ink-muted">
            {info().bundleBuild} ({info().source === 'embedded' ? 'app' : 'ota'})
            {' '}
            - {info().nativeBuild}
          </span>
        </Row>
      )}
    </Show>
  );
}

function BundleUpdateRow() {
  if (!isNativeMobilePlatform()) return null;
  const tauri = useTauri();
  const status = (): BundleUpdateStatus =>
    tauri?.bundleUpdateStatus() ?? { status: 'Idle' };
  const action = () => bundleUpdateAction(status());
  return (
    <Row label="App Update">
      <div class="flex items-center gap-3">
        <span class="text-sm text-ink-muted">
          {formatBundleUpdateStatus(status())}
        </span>
        <Show when={action()}>
          {(a) => (
            <Button variant="active" size="sm" depth={3} onClick={a().action}>
              {a().label}
            </Button>
          )}
        </Show>
      </div>
    </Row>
  );
}
