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
  ENABLE_EMAIL,
  ENABLE_AUTO_UPDATE_UI_OVERRIDE,
  ENABLE_INBOX_RESYNC,
  ENABLE_INBOX_SYNC_STATUS,
  ENABLE_MULTI_INBOX_OVERRIDE,
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
import ArrowsClockwiseIcon from '@phosphor-icons/core/regular/arrows-clockwise.svg?component-solid';
import PlusIcon from '@phosphor-icons/core/regular/plus.svg?component-solid';
import { authServiceClient } from '@service-auth/client';
import type {
  Link as EmailLink,
  SyncStatus,
} from '@service-email/generated/schemas';
import { useEmail, useLicenseStatus, useUserId } from '@core/context/user';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
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
import { useEmailLinks, useEmailLinksStatus } from '@core/email-link';
import { AddInboxDialog, openAddInboxDialog } from '../AddInboxDialog';
import { useRemoveInboxMutation } from '@queries/email/link';
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

type GithubLinkStatus = 'linked' | 'unlinked' | 'reauthentication_required';

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
  const multiInboxFlag = useFeatureFlag('enable-multi-inbox', {
    enabledOverride: ENABLE_MULTI_INBOX_OVERRIDE,
  });
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
  const [showEmailModal, setShowEmailModal] = createSignal<boolean>(false);
  const [showDeleteModal, setShowDeleteModal] = createSignal<boolean>(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = createSignal<boolean>(false);

  const {
    query: emailLinksQuery,
    connect: connectEmail,
    disconnect: disconnectEmail,
    resyncInbox,
  } = useEmailLinks();
  const removeInboxMutation = useRemoveInboxMutation({
    onSuccess: () => toast.success('Inbox removed'),
    onError: () => toast.failure('Failed to remove inbox. Please try again.'),
  });
  const [removeTarget, setRemoveTarget] = createSignal<{
    id: string;
    email: string;
    isOwn: boolean;
  } | null>(null);
  const [resyncingIds, setResyncingIds] = createSignal<ReadonlySet<string>>(
    new Set()
  );

  // The primary inbox is the one matching the account email; it sorts to the top
  // and is labelled. Everything else (other own inboxes + delegated/shared) follows.
  const inboxes = createMemo(() => {
    const links = emailLinksQuery.data?.links ?? [];
    const primaryEmail = email()?.toLowerCase();
    const primary = links.find(
      (link) => link.email_address.toLowerCase() === primaryEmail
    );
    const others = links.filter((link) => link !== primary);
    return { primary, others };
  });

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

  const emailActive = useEmailLinksStatus();

  const [isEmailActionPending, setIsEmailActionPending] = createSignal(false);

  const onConnectEmail = async () => {
    if (isEmailActionPending()) return;
    setIsEmailActionPending(true);
    await connectEmail().match(
      () => {},
      () => toast.failure('Failed to connect email')
    );
    setIsEmailActionPending(false);
  };


  const handleResyncInbox = async (linkId: string) => {
    setResyncingIds((prev) => new Set(prev).add(linkId));
    await resyncInbox(linkId).match(
      (res) => {
        toast.success(
          res.already_in_progress ? 'Sync already in progress' : 'Re-sync started'
        );
      },
      () => toast.failure('Failed to start re-sync')
    );
    setResyncingIds((prev) => {
      const next = new Set(prev);
      next.delete(linkId);
      return next;
    });
  };

  const handleRemoveInbox = () => {
    const target = removeTarget();
    if (!target) return;
    setRemoveTarget(null);
    removeInboxMutation.mutate(target.id);
  };

  const [githubLinkStatus, { refetch: refetchGithubLinkStatus }] =
    createResource(async (): Promise<GithubLinkStatus> => {
      const response = await authServiceClient.checkGithubLinkStatus();

      if (response.isOk()) {
        return response.value.reauthentication_required
          ? 'reauthentication_required'
          : 'linked';
      }

      const needsReauthentication = response.error.some(
        (error) => error.code === 'REAUTHENTICATION_REQUIRED'
      );
      return needsReauthentication ? 'reauthentication_required' : 'unlinked';
    });

  const handleGithubEnable = async () => {
    const url = await authServiceClient.initGithubLink(window.location.href);
    if (url.isOk()) {
      window.location.href = url.value;
    }
  };

  const handleGithubDisable = async () => {
    await authServiceClient.deleteGithubLink();
    refetchGithubLinkStatus();
  };

  const handleGithubReconnect = async () => {
    const url = await authServiceClient.reauthenticateGithub(
      window.location.href
    );
    if (url.isOk()) {
      window.location.href = url.value;
    } else {
      toast.failure('Failed to start GitHub reconnect flow');
    }
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

              <Show when={ENABLE_EMAIL && !multiInboxFlag().enabled}>
                <Row
                  label={
                    showEmailModal()
                      ? 'Disabling will clear all email data from Macro'
                      : 'Email'
                  }
                >
                  <Show
                    when={showEmailModal()}
                    fallback={
                      <Show
                        when={!emailActive()}
                        fallback={
                          <Button
                            variant="base"
                            size="sm"
                            depth={3}
                            disabled={isEmailActionPending()}
                            onClick={() => setShowEmailModal(true)}
                          >
                            Disable
                          </Button>
                        }
                      >
                        <Button
                          variant="base"
                          size="sm"
                          depth={3}
                          disabled={isEmailActionPending()}
                          onClick={onConnectEmail}
                        >
                          Enable
                        </Button>
                      </Show>
                    }
                  >
                    <div class="flex flex-row">
                      <Button
                        variant="ghost"
                        size="sm"
                        depth={3}
                        disabled={isEmailActionPending()}
                        onClick={async () => {
                          if (isEmailActionPending()) return;
                          setIsEmailActionPending(true);
                          await disconnectEmail().match(
                            () => {
                              setShowEmailModal(false);
                              toast.success(
                                'Email disabled — clearing your data.'
                              );
                            },
                            () => {
                              toast.failure(
                                'Failed to disable email. Please try again.'
                              );
                            }
                          );
                          setIsEmailActionPending(false);
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
                  </Show>
                </Row>
              </Show>

              <Show when={ENABLE_EMAIL && multiInboxFlag().enabled}>
                <div class="bg-surface">
                  <div class="flex items-center justify-between h-15.25 px-6">
                    <div class="text-sm">Inboxes</div>
                    <Show
                      when={!emailLinksQuery.isLoading}
                      fallback={
                        <span class="text-sm text-ink-muted">Loading…</span>
                      }
                    >
                      <Show
                        when={emailActive()}
                        fallback={
                          <Button
                            variant="base"
                            size="sm"
                            depth={3}
                            disabled={isEmailActionPending()}
                            onClick={onConnectEmail}
                          >
                            Enable
                          </Button>
                        }
                      >
                        <Tooltip label="Add inbox">
                          <Button
                            variant="base"
                            size="sm"
                            depth={3}
                            onClick={openAddInboxDialog}
                            aria-label="Add inbox"
                          >
                            <PlusIcon class="size-4" />
                          </Button>
                        </Tooltip>
                      </Show>
                    </Show>
                  </div>
                  <Show when={emailActive()}>
                    <Show when={inboxes().primary}>
                      {(primary) => (
                        <InboxRow
                          link={primary()}
                          isPrimary
                          isOwn={primary().macro_id === userId()}
                          resyncing={resyncingIds().has(primary().id)}
                          onResync={() => handleResyncInbox(primary().id)}
                          onRemove={() =>
                            setRemoveTarget({
                              id: primary().id,
                              email: primary().email_address,
                              isOwn: primary().macro_id === userId(),
                            })
                          }
                        />
                      )}
                    </Show>
                    <Show when={!inboxes().primary && email()}>
                      <DisabledPrimaryRow
                        email={email() ?? ''}
                        onEnable={onConnectEmail}
                      />
                    </Show>
                    <For each={inboxes().others}>
                      {(link) => (
                        <InboxRow
                          link={link}
                          isPrimary={false}
                          isOwn={link.macro_id === userId()}
                          resyncing={resyncingIds().has(link.id)}
                          onResync={() => handleResyncInbox(link.id)}
                          onRemove={() =>
                            setRemoveTarget({
                              id: link.id,
                              email: link.email_address,
                              isOwn: link.macro_id === userId(),
                            })
                          }
                        />
                      )}
                    </For>
                  </Show>
                </div>
              </Show>

              <Row label="GitHub">
                <Show
                  when={!githubLinkStatus.loading}
                  fallback={
                    <span class="text-sm text-ink-muted">Loading…</span>
                  }
                >
                  <Switch
                    fallback={
                      <Button
                        variant="base"
                        size="sm"
                        depth={3}
                        onClick={handleGithubEnable}
                      >
                        Enable
                      </Button>
                    }
                  >
                    <Match
                      when={githubLinkStatus() === 'reauthentication_required'}
                    >
                      <Button
                        variant="base"
                        size="sm"
                        depth={3}
                        onClick={handleGithubReconnect}
                      >
                        Reconnect
                      </Button>
                    </Match>
                    <Match when={githubLinkStatus() === 'linked'}>
                      <Button
                        variant="base"
                        size="sm"
                        depth={3}
                        onClick={handleGithubDisable}
                      >
                        Disable
                      </Button>
                    </Match>
                  </Switch>
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

            <Dialog
              open={removeTarget() !== null}
              onOpenChange={(open) => {
                if (!open) setRemoveTarget(null);
              }}
              position="center"
              class="w-120"
            >
              <Panel active depth={2} class="rounded-xl">
                <Panel.Header class="px-6">
                  <Dialog.Title class="text-ink text-sm font-semibold">
                    Remove inbox
                  </Dialog.Title>
                </Panel.Header>
                <Panel.Body class="p-6 font-sans flex flex-col gap-3">
                  <Dialog.Description class="text-ink-muted text-sm/tight font-normal">
                    <Show
                      when={removeTarget()?.isOwn}
                      fallback={
                        <>
                          Remove access to{' '}
                          <span class="text-ink">{removeTarget()?.email}</span>?
                          The inbox and its data stay with its owner.
                        </>
                      }
                    >

                        Remove{' '}
                        <span class="text-ink">{removeTarget()?.email}</span>?
                        This clears all of its email data from Macro and cannot be
                        undone.

                    </Show>
                  </Dialog.Description>
                  <div class="pt-3 justify-end items-center gap-3 inline-flex">
                    <Button
                      variant="base"
                      depth={3}
                      onClick={() => setRemoveTarget(null)}
                    >
                      Cancel
                    </Button>
                    <Button variant="danger" depth={3} onClick={handleRemoveInbox}>
                      Remove
                    </Button>
                  </div>
                </Panel.Body>
              </Panel>
            </Dialog>

            <AddInboxDialog />

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

function syncStatusLabel(status: SyncStatus): string {
  switch (status) {
    case 'SYNCING':
      return 'Syncing…';
    case 'UP_TO_DATE':
      return 'Up to date';
    case 'ERROR':
      return 'Error — re-sync';
    case 'INACTIVE':
      return 'Disabled';
  }
}

function Chip(props: { label: string }) {
  return (
    <span class="shrink-0 rounded bg-edge-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
      {props.label}
    </span>
  );
}

// Placeholder shown when the account's primary inbox has been removed but other
// inboxes remain. It is not a real link — re-enabling re-runs the Gmail enable
// flow, which re-links and backfills.
function DisabledPrimaryRow(props: { email: string; onEnable: () => void }) {
  return (
    <div class="bg-surface flex items-center justify-between gap-3 h-15.25 px-6">
      <div class="min-w-0 flex flex-col gap-0.5">
        <div class="flex items-center gap-2 min-w-0">
          <span class="ph-no-capture text-sm truncate text-ink-muted">
            {props.email}
          </span>
          <Chip label="Primary" />
          <Chip label="Disabled" />
        </div>
        <span class="text-xs text-ink-muted">Sync disabled</span>
      </div>
      <Button variant="base" size="sm" depth={3} onClick={props.onEnable}>
        Enable
      </Button>
    </div>
  );
}

function InboxRow(props: {
  link: EmailLink;
  isPrimary: boolean;
  isOwn: boolean;
  resyncing: boolean;
  onResync: () => void;
  onRemove: () => void;
}) {
  return (
    <div class="bg-surface flex items-center justify-between gap-3 h-15.25 px-6">
      <div class="min-w-0 flex flex-col gap-0.5">
        <div class="flex items-center gap-2 min-w-0">
          <span class="ph-no-capture text-sm truncate">
            {props.link.email_address}
          </span>
          <Show when={props.isPrimary}>
            <Chip label="Primary" />
          </Show>
          <Show when={!props.isPrimary && !props.isOwn}>
            <Chip label="Shared" />
          </Show>
        </div>
        <Show when={ENABLE_INBOX_SYNC_STATUS}>
          <span
            class="text-xs"
            classList={{
              'text-failure': props.link.sync_status === 'ERROR',
              'text-ink-muted': props.link.sync_status !== 'ERROR',
            }}
          >
            {syncStatusLabel(props.link.sync_status)}
          </span>
        </Show>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <Show when={ENABLE_INBOX_RESYNC}>
          <Tooltip label="Force sync">
            <Button
              variant="base"
              size="sm"
              depth={3}
              disabled={
                props.resyncing ||
                (ENABLE_INBOX_SYNC_STATUS &&
                  props.link.sync_status === 'SYNCING')
              }
              onClick={props.onResync}
              aria-label={`Force sync ${props.link.email_address}`}
            >
              <ArrowsClockwiseIcon class="size-4" />
            </Button>
          </Tooltip>
        </Show>
        <Tooltip label="Remove inbox">
          <Button
            variant="base"
            size="sm"
            depth={3}
            onClick={props.onRemove}
            aria-label={`Remove ${props.link.email_address}`}
          >
            <XIcon class="size-4" />
          </Button>
        </Tooltip>
      </div>
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
