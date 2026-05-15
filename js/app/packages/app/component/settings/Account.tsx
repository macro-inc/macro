import { capitalize } from '@block-pdf/util/StringUtils';
import { useHasPaidAccess } from '@core/auth/license';
import { UserIcon } from '@core/component/UserIcon';
import { useLogout } from '@core/auth/logout';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { toast } from '@core/component/Toast/Toast';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { createStaticFile } from '@core/util/create';
import { Dialog, Button, Panel } from '@ui';
import {
  blockNameToFileExtensions,
  blockNameToMimeTypes,
} from '@core/constant/allBlocks';
import {
  DEV_MODE_ENV,
  ENABLE_AUTO_UPDATE_UI,
  ENABLE_EMAIL,
  ENABLE_PROFILE_PICTURES,
} from '@core/constant/featureFlags';
import { usePaywallState } from '@core/constant/PaywallState';
import { fileSelector } from '@core/directive/fileSelector';
import {
  type ProfilePictureItem,
  useProfilePictureUrl,
} from '@core/signal/profilePicture';
import IconUpload from '@phosphor-icons/core/regular/upload-simple.svg?component-solid';
import SignOutIcon from '@phosphor-icons/core/regular/sign-out.svg?component-solid';
import { authServiceClient } from '@service-auth/client';
import { useEmail, useLicenseStatus, useUserId } from '@core/context/user';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  type JSX,
  Show,
} from 'solid-js';
import { usePermissions } from '@core/context/user';
import { useSettingsState } from '@core/constant/SettingsState';
import PaywallComponent from '../paywall/PaywallComponent';
import {
    useEmailLinks,
  useEmailLinksStatus,
} from '@core/email-link';
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
    await authServiceClient.putProfilePicture({ url });
    return { id, url };
  } catch (_error) {
    return toast.failure('Failed to upload profile picture');
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
    case 'Completed': return 'Update ready';
    case 'Error': return 'An error occurred when checking for updates';
  }
}

function useUserName() {
  const fetchUserName = async () => {
    const [_, response] = await authServiceClient.getUserName();
    if (response) {
      return response;
    }

    return null;
  };

  const [userNameResource] = createResource(fetchUserName);

  const userName = createMemo(() => {
    if (userNameResource.loading) return undefined;
    return userNameResource() || undefined;
  });

  return userName;
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
  const [showEmailModal, setShowEmailModal] = createSignal<boolean>(false);
  const [showEnableEmailModal, setShowEnableEmailModal] = createSignal<boolean>(false);
  const [showDeleteModal, setShowDeleteModal] = createSignal<boolean>(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = createSignal<boolean>(false);

  const { disconnect: disconnectEmail } = useEmailLinks();

  const userName = useUserName();
  const [updatedFirstName, setUpdatedFirstName] = createSignal<
    string | undefined
  >(undefined);
  const [updatedLastName, setUpdatedLastName] = createSignal<
    string | undefined
  >(undefined);

  const emailActive = useEmailLinksStatus();

  const [githubLinkExists, { refetch: refetchGithubLink }] = createResource(async () => {
    const [_, response] = await authServiceClient.checkLinkExists({ idp_name: 'github' });
    return response?.link_exists ?? false;
  });

  const handleGithubEnable = async () => {
    const [_, url] = await authServiceClient.initGithubLink(window.location.href);
    if (url) {
      window.location.href = url;
    }
  };

  const handleGithubDisable = async () => {
    await authServiceClient.deleteGithubLink();
    refetchGithubLink();
  };

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
            <Show when={permissions()?.includes('write:stripe_subscription') && !isNativeMobilePlatform()}>
              <div class="px-4 py-2 w-full">
                <PaywallComponent
                  hideCloseButton
                  cb={() => {}}
                  handleGuest={() => toggleSettings()}
                />
              </div>
            </Show>
          </Panel.Toolbar>

          <Panel.Body scroll class="text-ink">
            <div class="grid gap-px bg-edge-muted border-b border-edge-muted">
              <Show when={ENABLE_PROFILE_PICTURES && userId()}>
                <Row label="Profile Picture">
                  <div
                    class="relative group"
                    use:fileSelector={{
                      acceptedFileExtensions: blockNameToFileExtensions.image,
                      acceptedMimeTypes: blockNameToMimeTypes.image,
                      onSelect: async (files: File[]) => {
                        let response = await uploadProfilePicture(files[0]);
                        if (!response || !userId()) return;
                        let { url } = response;
                        let pic: ProfilePictureItem = {
                          _createdAt: new Date(),
                          url,
                          id: userId()!,
                          loading: false,
                        };
                        // update the cache directly to force a reload
                        const [_, controls] = useProfilePictureUrl(userId());
                        controls.mutate(pic);
                      },
                    }}
                  >
                    <UserIcon
                      id={userId() as string}
                      isDeleted={false}
                      size="lg"
                      class="bg-transparent"
                    />
                    <div class="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                      <IconUpload class="size-5 text-white" />
                    </div>
                  </div>
                </Row>
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

              <Show when={ENABLE_AUTO_UPDATE_UI}>
                <BundleUpdateRow />
              </Show>

              <Show when={ENABLE_EMAIL && (!emailActive() || DEV_MODE_ENV)}>
                <Row label="Email">
                  <Show
                    when={!emailActive()}
                    fallback={
                      <Button
                        variant="base"
                        size="sm"
                        depth={3}
                        onClick={() => setShowEmailModal(true)}
                      >
                        Disable
                      </Button>
                    }
                  >
                    <Show when={!showEnableEmailModal()}>
                      <Button
                        variant="base"
                        size="sm"
                        depth={3}
                        onClick={() => setShowEnableEmailModal(true)}
                      >
                        Enable
                      </Button>
                    </Show>
                  </Show>
                </Row>
              </Show>

              <Row label="GitHub">
                <Show
                  when={!githubLinkExists.loading}
                  fallback={
                    <span class="text-sm text-ink-muted">Loading…</span>
                  }
                >
                  <Show
                    when={!githubLinkExists()}
                    fallback={
                      <Button
                        variant="base"
                        size="sm"
                        depth={3}
                        onClick={handleGithubDisable}
                      >
                        Disable
                      </Button>
                    }
                  >
                    <Button
                      variant="base"
                      size="sm"
                      depth={3}
                      onClick={handleGithubEnable}
                    >
                      Enable
                    </Button>
                  </Show>
                </Show>
              </Row>

              <NotificationToggle />
            </div>

            <div class="flex items-center justify-end h-10 px-6">
              <Button
                variant="base"
                size="sm"
                depth={3}
                onClick={logoutHandler}
              >
                <SignOutIcon class="size-4" />
                Logout
              </Button>
            </div>

            <Show when={showEnableEmailModal()}>
              <div class="flex flex-row items-center">
                <div class="text-sm">
                  Email requires additional Google permissions. Select the permissions on sign-in to enable.
                </div>
                <div class="ml-auto flex flex-row">
                  <Button
                    variant="ghost"
                    size="sm"
                    depth={3}
                    onClick={() => {
                      setShowEnableEmailModal(false);
                      logout();
                    }}
                  >
                    Logout
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    depth={3}
                    onClick={() => setShowEnableEmailModal(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </Show>

            <Show when={showEmailModal()}>
              <div class="flex flex-row items-center">
                <div class="text-sm">
                  Disabling will clear all email data from Macro
                </div>
                <div class="ml-auto flex flex-row">
                  <Button
                    variant="ghost"
                    size="sm"
                    depth={3}
                    onClick={async () => {
                      setShowEmailModal(false);
                      await disconnectEmail().match(
                        () => {
                          toast.success('Email disabled — clearing your email data, this may take a moment.');
                        },
                        () => {
                          toast.failure('Failed to disable email. Please try again.');
                        },
                      );
                    }}
                  >
                    Confirm
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    depth={3}
                    onClick={() => setShowEmailModal(false)}
                  >
                    Cancel
                  </Button>
                </div>
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
    <div class="ph-no-capture group relative flex items-center gap-1 rounded-sm h-7 mobile:h-9 px-2 border text-xs bg-transparent text-ink-muted border-edge-muted hover:text-ink focus-within:text-ink">
      <input
        type="text"
        class="flex-1 min-w-0 bg-transparent outline-none border-0 p-0 text-xs placeholder:text-ink-extra-muted"
        value={inputValue()}
        onInput={(e) => setInputValue(e.currentTarget.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          commit();
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
  cancelWifiWait: () => void,
): { label: string; action: () => void } | null {
  switch (status.status) {
    case 'Idle':
      return { label: 'Check for Update', action: () => invoke('check_for_update') };
    case 'Error':
      return { label: 'Retry', action: () => invoke('check_for_update') };
    case 'UpdateFound':
      return { label: 'Download', action: () => invoke('grant_bundle_update', { approved: true }).catch(console.error) };
    case 'WaitingForWifi':
      return { label: 'Download anyway', action: cancelWifiWait };
    case 'Completed':
      return { label: 'Update', action: () => invoke('perform_update') };
    default:
      return null;
  }
}

function BundleUpdateRow() {
  const tauri = useTauri();
  return (
    <Show when={tauri}>
      {(ctx) => {
        const status = () => ctx().bundleUpdateStatus();
        const action = () => bundleUpdateAction(status(), ctx().cancelWifiWait);
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
      }}
    </Show>
  );
}
