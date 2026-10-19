import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { AccountDeletionReason } from '@app/lib/analytics/app-events';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHasPaidAccess } from '@core/auth';
import { useLogout } from '@core/auth/logout';
import { toast } from '@core/component/Toast/Toast';
import { UserIcon } from '@core/component/UserIcon';
import {
  blockNameToFileExtensions,
  blockNameToMimeTypes,
} from '@core/constant/allBlocks';
import {
  disableAutoUpdateUi,
  ENABLE_PROFILE_PICTURES,
  enableAutoUpdateUiOverride,
} from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { useSettingsTabAvailable } from '@core/constant/settingsTabsConfig';
import { useEmail, useUserId } from '@core/context/user';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import {
  type ProfilePictureItem,
  useProfilePictureUrl,
} from '@core/signal/profilePicture';
import { createStaticFile } from '@core/util/create';
import { fireAndForget } from '@core/util/fireAndForget';
import { openFilePicker } from '@core/util/upload';
import {
  type BundleUpdateStatus,
  nativeUpdateDescription,
  useTauri,
} from '@macro/tauri';
import CheckIcon from '@phosphor/check.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import TrashIcon from '@phosphor/trash.svg';
import WarningIcon from '@phosphor/warning.svg';
import WarningCircleIcon from '@phosphor/warning-circle.svg';
import SignOutIcon from '@phosphor-icons/core/regular/sign-out.svg?component-solid';
import IconUpload from '@phosphor-icons/core/regular/upload-simple.svg?component-solid';
import { useAiBillingSummaryQuery } from '@queries/auth';
import {
  invalidateOwnUserName,
  useOwnUserName,
} from '@queries/auth/user-name-self';
import { authServiceClient } from '@service-auth/client';
import { invoke } from '@tauri-apps/api/core';
import { Button, Dialog, Dropdown, HoldButton, Panel, Tooltip } from '@ui';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { Transition } from 'solid-transition-group';
import {
  ACCOUNT_DELETION_FEEDBACK_MAX_LENGTH,
  ACCOUNT_DELETION_REASON_OPTIONS,
  buildAccountDeletionFeedbackPayload,
  performAccountDeletion,
} from './account-deletion-feedback';
import { CurrentPlanCard } from './components/current-plan-card';
import { resolvePlanTier } from './core/billing-state';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';

const DELETE_HOLD_MS = 5000;

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
    case 'Idle':
      return 'Idle';
    case 'CheckingForUpdate':
      return 'Checking for update...';
    case 'UpdateFound':
      return `Update available: v${status.data.version}`;
    case 'NoUpdateNeeded':
      return 'Up to date';
    case 'WaitingForWifi':
      return 'Waiting for Wi-Fi to download';
    case 'Downloading':
      return `Downloading: ${Math.round(status.data.progress)}%`;
    case 'Unzipping':
      return `Installing: ${Math.round(status.data.progress)}%`;
    case 'ClearRequired':
      return 'Cached update revoked';
    case 'NativeUpdateRequired':
      return 'App update required';
    case 'Completed':
      return 'Update ready';
    case 'Error':
      return 'An error occurred when checking for updates';
  }
}

/**
 * Save one name field with an optimistic update and rollback on failure.
 * Returns whether the save succeeded, which drives NameInput's status icon.
 * This panel renders its own value from a local signal, so the invalidation
 * is for everything else reading the name (see invalidateOwnUserName).
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
    fireAndForget(invalidateOwnUserName(), 'account-settings');
    return true;
  } catch {
    setValue(prev); // rollback if the call throws before returning a Result
    return false;
  }
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
                class="flex size-full items-center justify-center rounded-full bg-edge text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
                class="group block size-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
        <Panel depth={2} class="rounded-xl">
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
                variant="ghost"
                depth={3}
                disabled={isRemoving()}
                onClick={() => setShowRemoveConfirmModal(false)}
              >
                Cancel
              </Button>
              <Button
                variant="strong"
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

function AccountPlanCard() {
  const { openSettings } = useSettingsState();
  const hasPaid = useHasPaidAccess();
  const summary = useAiBillingSummaryQuery();
  // Wait for the summary before falling back to the license, so a Max plan
  // doesn't flash as Pro while it loads.
  const tier = () =>
    summary.isFetching && !summary.isSuccess
      ? undefined
      : resolvePlanTier(
          summary.isSuccess ? summary.data.tier : undefined,
          hasPaid()
        );

  return (
    <CurrentPlanCard tier={tier()} onOpen={() => openSettings('Billing')} />
  );
}

// Not accessible if user is not authenticated
export function Account() {
  const analytics = useAnalytics();
  const email = useEmail();
  const userId = useUserId();
  const logout = useLogout();
  const isSettingsTabAvailable = useSettingsTabAvailable();
  const disableAutoUpdateUIFlag = useFeatureFlag(disableAutoUpdateUi);
  const autoUpdateUIEnabled = createMemo(
    () => enableAutoUpdateUiOverride ?? !disableAutoUpdateUIFlag().enabled
  );
  const [showDeleteModal, setShowDeleteModal] = createSignal<boolean>(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] =
    createSignal<boolean>(false);
  const [deleteReason, setDeleteReason] = createSignal<AccountDeletionReason>();
  const [deleteFeedback, setDeleteFeedback] = createSignal('');
  const [deleteFeedbackCaptured, setDeleteFeedbackCaptured] =
    createSignal(false);
  const [isDeleting, setIsDeleting] = createSignal(false);

  // The shared own-name cache entry (the one saveUserName invalidates), so
  // this panel and other readers can't drift.
  const userName = useOwnUserName();
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

  const resetDeleteFlow = () => {
    setDeleteReason(undefined);
    setDeleteFeedback('');
    setDeleteFeedbackCaptured(false);
  };

  const deleteAccountHandler = async () => {
    if (isDeleting()) return;
    setIsDeleting(true);

    try {
      const deleted = await performAccountDeletion({
        captureFeedback: () => {
          if (deleteFeedbackCaptured()) return;

          analytics.track(
            'account_deletion_feedback',
            buildAccountDeletionFeedbackPayload(
              deleteReason(),
              deleteFeedback()
            ),
            ['posthog'],
            {
              posthog: {
                send_instantly: true,
                transport: 'sendBeacon',
              },
            }
          );
          setDeleteFeedbackCaptured(true);
        },
        deleteUser: () => authServiceClient.deleteUser(),
        logout,
      });

      if (!deleted) {
        setIsDeleting(false);
        toast.failure('Unable to delete your account. Please try again.');
      }
    } catch {
      setIsDeleting(false);
      toast.failure('Unable to delete your account. Please try again.');
    }
  };

  return (
    <SettingsPage title="Account">
      <SettingsSection title="Profile">
        <SettingsCard>
          <Show when={ENABLE_PROFILE_PICTURES}>
            <Show when={userId()} keyed>
              {(id) => <ProfilePictureRow userId={id} />}
            </Show>
          </Show>

          <Row label="Email">
            <Tooltip
              as="span"
              label={email() ?? ''}
              placement="top"
              tabIndex={0}
              class="min-w-0 max-w-full rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span class="ph-no-capture min-w-0 truncate text-sm text-ink-muted">
                {email() ?? ''}
              </span>
            </Tooltip>
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

          <NativeUpdateRow />
          <Show when={autoUpdateUIEnabled()}>
            <BundleVersionRow />
            <BundleUpdateRow />
          </Show>
        </SettingsCard>
      </SettingsSection>

      <Show when={isSettingsTabAvailable('Billing')}>
        <AccountPlanCard />
      </Show>

      {/* A bare card like the plan card above, so the two match in height. */}
      <SettingsCard>
        <SettingsRow
          label="Log out"
          description="Sign out of Macro on this device."
        >
          <Button variant="outline" depth={3} onClick={() => logout()}>
            <SignOutIcon class="size-4" />
            Log out
          </Button>
        </SettingsRow>
      </SettingsCard>

      {/* Deliberately quiet and outside a card, so it isn't mistaken for
          Log out. */}
      <SettingsRow
        class="px-5"
        label="Delete account"
        description="Permanently delete your account and all associated data."
      >
        <Button
          variant="danger"
          size="sm"
          depth={3}
          onClick={() => {
            resetDeleteFlow();
            setShowDeleteModal(true);
          }}
        >
          Delete account
        </Button>
      </SettingsRow>
      <Dialog
        open={showDeleteModal()}
        onOpenChange={(open) => {
          setShowDeleteModal(open);
          if (!open && !showDeleteConfirmModal()) resetDeleteFlow();
        }}
        position="center"
        class="w-120"
      >
        <Panel depth={2} class="rounded-xl">
          <Panel.Header class="px-6">
            <Dialog.Title class="text-ink text-sm font-semibold">
              Delete Account
            </Dialog.Title>
          </Panel.Header>
          <Panel.Body class="p-6 font-sans flex flex-col gap-3">
            <Dialog.Description as="div">
              <IrreversibleWarning />
            </Dialog.Description>
            <p class="text-ink-muted text-sm/tight">
              Only want to sign out?{' '}
              <button
                type="button"
                class="text-ink underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
                onClick={() => logout()}
              >
                Log out instead
              </button>
            </p>
            <div class="flex flex-col gap-3 pt-2">
              <label class="flex flex-col gap-1.5 text-sm" for="delete-reason">
                <span>
                  Why are you leaving?{' '}
                  <span class="text-ink-muted">(optional)</span>
                </span>
                <select
                  id="delete-reason"
                  class="settings-input w-full"
                  value={deleteReason() ?? ''}
                  onChange={(event) =>
                    setDeleteReason(
                      (event.currentTarget.value || undefined) as
                        | AccountDeletionReason
                        | undefined
                    )
                  }
                >
                  <option value="">Select a reason</option>
                  <For each={ACCOUNT_DELETION_REASON_OPTIONS}>
                    {(option) => (
                      <option value={option.value}>{option.label}</option>
                    )}
                  </For>
                </select>
              </label>
              <label
                class="flex flex-col gap-1.5 text-sm"
                for="delete-feedback"
              >
                <span>
                  Anything else you'd like us to know?{' '}
                  <span class="text-ink-muted">(optional)</span>
                </span>
                <textarea
                  id="delete-feedback"
                  class="settings-input ph-no-capture min-h-24 w-full resize-y py-2"
                  rows={3}
                  maxLength={ACCOUNT_DELETION_FEEDBACK_MAX_LENGTH}
                  value={deleteFeedback()}
                  onInput={(event) =>
                    setDeleteFeedback(event.currentTarget.value)
                  }
                  placeholder="Your feedback helps us improve Macro"
                />
                <span class="text-ink-extra-muted text-xs">
                  Please don't include sensitive information.
                </span>
              </label>
            </div>
            <div class="pt-3 justify-end items-center gap-3 inline-flex">
              <Button
                variant="ghost"
                depth={3}
                onClick={() => {
                  setShowDeleteModal(false);
                  resetDeleteFlow();
                }}
              >
                Cancel
              </Button>
              <Button
                variant="strong"
                depth={3}
                onClick={() => {
                  setShowDeleteConfirmModal(true);
                  setShowDeleteModal(false);
                }}
              >
                Continue
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>
      <Dialog
        open={showDeleteConfirmModal()}
        onOpenChange={(open) => {
          setShowDeleteConfirmModal(open);
          if (!open) resetDeleteFlow();
        }}
        position="center"
        class="w-120"
      >
        <Panel depth={2} class="rounded-xl">
          <Panel.Header class="px-6">
            <Dialog.Title class="text-ink text-sm font-semibold">
              Are you absolutely sure?
            </Dialog.Title>
          </Panel.Header>
          <Panel.Body class="p-6 font-sans flex flex-col gap-3">
            <Dialog.Description as="div" class="flex flex-col gap-3">
              <IrreversibleWarning />
              <p class="text-ink-muted text-sm/tight">
                To confirm, press and hold the button below for 5 seconds.
              </p>
            </Dialog.Description>
            <div class="pt-3 justify-end items-center gap-3 inline-flex">
              <Button
                variant="ghost"
                depth={3}
                disabled={isDeleting()}
                onClick={() => {
                  setShowDeleteConfirmModal(false);
                  resetDeleteFlow();
                }}
              >
                Cancel
              </Button>
              <HoldButton
                variant="danger"
                depth={3}
                duration={DELETE_HOLD_MS}
                disabled={isDeleting()}
                onConfirm={deleteAccountHandler}
              >
                <Show when={isDeleting()} fallback="Hold to delete my account">
                  <SpinnerIcon class="size-4 animate-spin" />
                  Deleting…
                </Show>
              </HoldButton>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>
    </SettingsPage>
  );
}

/** The deletion dialogs' warning; people kept deleting accounts by mistake. */
function IrreversibleWarning() {
  return (
    <div class="flex gap-3 rounded-lg border border-failure/30 bg-failure/10 p-3 text-sm/tight">
      <WarningIcon class="size-5 shrink-0 text-failure" />
      <div class="flex flex-col gap-1">
        <span class="font-semibold text-failure">
          This is permanent and irreversible.
        </span>
        <span class="text-ink">
          Your account and everything in it, including your documents, messages,
          files, and settings, will be deleted and cannot be recovered.
        </span>
      </div>
    </div>
  );
}

// Every row's control starts at the same left edge, so values line up down the
// card instead of each hugging the right side at its own width.
function Row(props: { label: string; children?: JSX.Element }) {
  return (
    <SettingsRow label={props.label}>
      <div class="flex w-80 max-w-[55cqw] min-w-0 items-center justify-start text-left">
        {props.children}
      </div>
    </SettingsRow>
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

  // Pull the box out by its padding and border (12px + 1px) so the text, not the
  // border, lines up with the other values in the column.
  return (
    <div class="ph-no-capture group relative -ml-[13px] flex w-[calc(100%+13px)] items-center gap-1.5 rounded-lg h-9 px-3 border text-sm bg-transparent text-ink-muted border-edge-muted hover:text-ink focus-within:text-ink focus-within:border-accent">
      <input
        type="text"
        class="flex-1 min-w-0 bg-transparent outline-none border-0 p-0 text-sm placeholder:text-ink-placeholder"
        value={inputValue()}
        onInput={(e) => setInputValue(e.currentTarget.value)}
        onFocus={() => {
          setIsFocused(true);
          setStatus('idle'); // clear prior status while editing
        }}
        onBlur={() => {
          fireAndForget(commit(), 'account-settings');
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

function bundleUpdateAction(
  status: BundleUpdateStatus
): { label: string; action: () => void } | null {
  const grantBundleUpdate = () =>
    invoke('grant_bundle_update', { approved: true }).catch(console.error);

  switch (status.status) {
    case 'Idle':
      return {
        label: 'Check for Update',
        action: () => invoke('check_for_update'),
      };
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
        <>
          <Row label="Version">
            {info().bundleBuild} ({info().source === 'embedded' ? 'app' : 'ota'}
            ) - {info().nativeBuild}
          </Row>
        </>
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
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span class="text-sm text-ink-muted">
          {formatBundleUpdateStatus(status())}
        </span>
        <Show when={action()}>
          {(a) => (
            <Button variant="accent" size="sm" depth={3} onClick={a().action}>
              {a().label}
            </Button>
          )}
        </Show>
      </div>
    </Row>
  );
}

function NativeUpdateRow() {
  const tauri = useTauri();
  return (
    <Show when={tauri && tauri.nativeUpdateStatus().status !== 'Disabled'}>
      <Row label="Desktop app update">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span class="text-sm text-ink-muted">
            {tauri && nativeUpdateDescription(tauri.nativeUpdateStatus())}
          </span>
          <Show when={tauri?.nativeUpdateStatus().status === 'Ready'}>
            <Button
              variant="accent"
              size="sm"
              depth={3}
              onClick={() =>
                fireAndForget(tauri?.restartNativeUpdate(), 'native-updates')
              }
            >
              Restart to update
            </Button>
          </Show>
        </div>
      </Row>
    </Show>
  );
}
