import { capitalize } from '@block-pdf/util/StringUtils';
import { useHasPaidAccess } from '@core/auth/license';
import { UserIcon } from '@core/component/UserIcon';
import { useLogout } from '@core/auth/logout';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { toast } from '@core/component/Toast/Toast';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { createStaticFile } from '@core/util/create';
import { Dialog, Button, Panel, Tooltip } from '@ui';
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
import { usePaywallState } from '@core/constant/PaywallState';
import { fileSelector } from '@core/directive/fileSelector';
import {
  type ProfilePictureItem,
  useProfilePictureUrl,
} from '@core/signal/profilePicture';
import IconUpload from '@phosphor-icons/core/regular/upload-simple.svg?component-solid';
import SignOutIcon from '@phosphor-icons/core/regular/sign-out.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { authServiceClient } from '@service-auth/client';
import { useEmail, useLicenseStatus, useUserId } from '@core/context/user';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { usePermissions } from '@core/context/user';
import { PERMISSION_IDS } from '@core/constant/permissions';
import { useSettingsState } from '@core/constant/SettingsState';
import PaywallComponent from '../paywall/PaywallComponent';
import PaywallTeamMemberView from '../paywall/PaywallTeamMemberView';
import PaywallTeamOwnerView from '../paywall/PaywallTeamOwnerView';
import {
  type SupportedNotificationSettings,
  useNotificationSettings,
} from '@notifications';
import { useAnalytics } from '@app/component/analytics-context';
import { useTauri, type BundleUpdateStatus } from '@macro/tauri';
import { invoke } from '@tauri-apps/api/core';

// NOTE: solid directives
false && fileSelector;

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
        <div class="flex items-center gap-3">
          <UserIcon
            id={props.userId}
            isDeleted={false}
            size="lg"
            class="bg-transparent"
          />
          <div class="flex items-center gap-2">
            <Show when={profilePictureUrl()}>
              <Tooltip label="Remove profile picture">
                <Button
                  variant="danger"
                  size="icon-sm"
                  depth={3}
                  disabled={isRemoving()}
                  onClick={() => setShowRemoveConfirmModal(true)}
                  aria-label="Remove profile picture"
                >
                  <XIcon class="size-4" />
                </Button>
              </Tooltip>
            </Show>
            <span
              class="inline-flex"
              use:fileSelector={{
                acceptedFileExtensions: blockNameToFileExtensions.image,
                acceptedMimeTypes: blockNameToMimeTypes.image,
                onSelect: handleUpload,
              }}
            >
              <Button variant="base" size="sm" depth={3}>
                <IconUpload class="size-4" />
                Upload
              </Button>
            </span>
          </div>
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
  const licenseStatus = useLicenseStatus();
  const logout = useLogout();
  const { showPaywall } = usePaywallState();
  const hasPaidAccess = useHasPaidAccess();
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
    return teams.some((t) => t.owner_id !== uid);
  });

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

  const logoutHandler = () => {
    logout();
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
            <div class="text-sm font-semibold">Account</div>
          </Panel.Header>

          <Panel.Toolbar class="h-full w-full">
            <Show when={permissions()?.includes(PERMISSION_IDS.WRITE_STRIPE_SUBSCRIPTION) && !isNativeMobilePlatform()}>
              <div class="px-4 py-2 w-full">
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
                    <Match when={isNonOwnerTeamMember()}>
                      <PaywallTeamMemberView />
                    </Match>
                  </Switch>
                </ShowFeatureFlag>
              </div>
            </Show>
          </Panel.Toolbar>

          <Panel.Body scroll class="text-ink">
            <div class="grid gap-px bg-edge-muted border-b border-edge-muted">
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
                  onSave={(newValue) => {
                    setUpdatedFirstName(newValue);
                    authServiceClient.putUserName({ first_name: newValue });
                  }}
                  placeholder="Enter First Name"
                />
              </Row>

              <Row label="Last Name">
                <NameInput
                  value={lastName()}
                  onSave={(newValue) => {
                    setUpdatedLastName(newValue);
                    authServiceClient.putUserName({ last_name: newValue });
                  }}
                  placeholder="Enter Last Name"
                />
              </Row>

              <Row label="License Status">
                <div class="flex items-center gap-3">
                  <span class="text-sm text-ink-muted">
                    {capitalize(licenseStatus() ?? '')}
                  </span>
                  <Show when={!hasPaidAccess()}>
                    <Button
                      variant="active"
                      size="sm"
                      depth={3}
                      onClick={() => showPaywall()}
                    >
                      Upgrade
                    </Button>
                  </Show>
                </div>
              </Row>

              <Show when={autoUpdateUIEnabled()}>
                <BundleVersionRow />
                <BundleUpdateRow />
              </Show>

              <NotificationToggle />
            </div>

            <div class="flex items-center justify-center px-6 py-6">
              <Button
                variant="danger"
                size="md"
                depth={3}
                class="px-4"
                onClick={logoutHandler}
              >
                <SignOutIcon class="size-4" />
                Logout
              </Button>
            </div>

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

function NameInput(props: {
  value?: string;
  placeholder?: string;
  onSave: (value: string) => void;
}) {
  const [inputValue, setInputValue] = createSignal(props.value ?? '');
  const [isFocused, setIsFocused] = createSignal(false);

  // Keep local input synced with external value, but don't clobber while typing.
  createEffect(() => {
    if (!isFocused()) {
      setInputValue(props.value ?? '');
    }
  });

  const commit = () => {
    const next = inputValue();
    if (next === (props.value ?? '')) return;
    props.onSave(next);
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
    <div class="ph-no-capture group relative flex items-center gap-1 rounded-lg h-7 mobile:h-9 px-2 border text-xs bg-transparent text-ink-muted border-edge-muted hover:text-ink focus-within:text-ink focus-within:border-accent">
      <input
        type="text"
        class="flex-1 min-w-0 bg-transparent outline-none border-0 p-0 text-xs placeholder:text-ink-extra-muted"
        value={inputValue()}
        onInput={(e) => setInputValue(e.currentTarget.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          commit();
          setIsFocused(false);
        }}
        onKeyDown={handleKeyDown}
        placeholder={props.placeholder}
        autocomplete="off"
        spellcheck={false}
        data-1p-ignore
      />
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

  const handleToggle = () =>  {
    analytics.track('notifications_toggled')
    props.settings.toggle(!props.settings.isEnabled())
  }


  return (
    <Row label="Notifications">
      <Button
        variant="base"
        size="sm"
        depth={3}
        onClick={handleToggle}
      >
        {props.settings.isEnabled() ? "Disable" : "Enable"}
      </Button>
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
