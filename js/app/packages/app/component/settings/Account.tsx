import { uploadProfilePicture } from '@core/component/ProfilePicture';
import { TabContentRow } from '@core/component/TabContent';
import EditableField from '@core/component/EditableField';
import { capitalize } from '@block-pdf/util/StringUtils';
import { DeprecatedTextButton } from '@core/component/DeprecatedTextButton';
import { useHasPaidAccess } from '@core/auth/license';
import { UserIcon } from '@core/component/UserIcon';
import { useLogout } from '@core/auth/logout';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { Modal, Overlay, Content, Header, Message, ButtonBar } from '@core/component/Modal';
import { toast } from '@core/component/Toast/Toast';
import { Button } from '@ui/components/Button';
import {
  blockNameToFileExtensions,
  blockNameToMimeTypes,
} from '@core/constant/allBlocks';
import {
  DEV_MODE_ENV,
  ENABLE_EMAIL,
  ENABLE_PROFILE_PICTURES,
} from '@core/constant/featureFlags';
import { usePaywallState } from '@core/constant/PaywallState';
import { fileSelector } from '@core/directive/fileSelector';
import {
  type ProfilePictureItem,
  useProfilePictureUrl,
} from '@core/signal/profilePicture';
import Logout from '@icon/regular/sign-out.svg';
import IconUpload from '@macro-icons/macro-upload.svg';
import { authServiceClient } from '@service-auth/client';
import { useEmail, useLicenseStatus, useUserId } from '@core/context/user';
import { createMemo, createResource, createSignal, Show } from 'solid-js';
import {
    useEmailLinks,
  useEmailLinksStatus,
} from '@core/email-link';
import {
  type SupportedNotificationSettings,
  useNotificationSettings,
} from '@notifications';
import { useAnalytics } from '@app/component/analytics-context';

// NOTE: solid directives
false && fileSelector;

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
    <div class="absolute inset-0 overflow-y-auto" style="scrollbar-width: none;">
        <div class="p-2">
          <div class="mb-12 text-ink">
          <Show when={ENABLE_PROFILE_PICTURES}>
          <TabContentRow
            isLoading={!userId()}
            text="Profile Picture"
            subtext={''}
          >
            <Show when={userId()}>
              <div class="flex items-center">
                <UserIcon id={userId() as string} isDeleted={false} size="lg" />
                <div
                  class="ml-2"
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
                  <DeprecatedTextButton text="Upload" icon={IconUpload} theme="accent" />
                </div>
              </div>
            </Show>
          </TabContentRow>
        </Show>
        <TabContentRow isLoading={!userId()} text="First Name" subtext={''}>
          <EditableField
              class="ph-no-capture"
            value={firstName()}
            onSave={(newValue: string) => {
              setUpdatedFirstName(newValue);
              authServiceClient.putUserName({ first_name: newValue });
            }}
            placeholder="Enter first name"
            allowEmpty={true}
          />
        </TabContentRow>
        <TabContentRow isLoading={!userId()} text="Last Name" subtext={''}>
          <EditableField
              class="ph-no-capture"
            value={lastName()}
            onSave={(newValue: string) => {
              setUpdatedLastName(newValue);
              authServiceClient.putUserName({ last_name: newValue });
            }}
            placeholder="Enter last name"
            allowEmpty={true}
          />
        </TabContentRow>
        <TabContentRow
          class="ph-no-capture"
          isLoading={!email()}
          text="Email"
          subtext={email() ?? ''}
        />

        <div class="flex gap-4 items-center">
          <TabContentRow
            isLoading={!licenseStatus()}
            text="License Status"
            subtext={capitalize(licenseStatus() ?? '')}
          />
          <Show when={!hasPaidAccess()}>
            <DeprecatedTextButton
              theme="accent"
              text="Upgrade"
              onClick={() => showPaywall()}
              class="mb-[18px]"
            />
          </Show>
        </div>
        <Show when={ENABLE_EMAIL && (!emailActive() || DEV_MODE_ENV)}>
          <Show
            when={!emailActive()}
            fallback={
              <div
                class={`flex items-center justify-between ${!showEmailModal() && 'mb-[18px]'}`}
              >
                <div class="text-sm">Email</div>
                <DeprecatedTextButton
                  theme="base"
                  text="Disable"
                  onClick={() => {
                    setShowEmailModal(true);
                  }}
                />
              </div>
            }
          >
            <Show when={!showEnableEmailModal()}>
              <div class="flex items-center justify-between mb-[18px]">
                <div class="text-sm">Email</div>
                <DeprecatedTextButton
                  theme="base"
                  text="Enable"
                  onClick={() => setShowEnableEmailModal(true)}
                />
              </div>
            </Show>
          </Show>
        </Show>
        <Show when={showEnableEmailModal()}>
          <div class="flex flex-row items-center mb-[18px]">
            <div class="text-sm">
              Email requires additional Google permissions. Select the permissions on sign-in to enable.
            </div>
            <div class="ml-auto flex flex-row">
              <DeprecatedTextButton
                theme="clear"
                text="Logout"
                onClick={() => {
                  setShowEnableEmailModal(false);
                  logout();
                }}
              />
              <DeprecatedTextButton
                theme="clear"
                text="Cancel"
                onClick={() => {
                  setShowEnableEmailModal(false);
                }}
              />
            </div>
          </div>
        </Show>
        <Show when={showEmailModal()}>
          <div class="flex flex-row items-center">
            <div class="mb-[18px] text-sm pt-4">
              Disabling will clear all email data from Macro
            </div>
            <div class="ml-auto flex flex-row">
              <DeprecatedTextButton
                theme="clear"
                text="Confirm"
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
              />
              <DeprecatedTextButton
                theme="clear"
                text="Cancel"
                onClick={() => {
                  setShowEmailModal(false);
                }}
              />
            </div>
          </div>
        </Show>
        <div class="flex items-center justify-between mb-[18px]">
          <div class="text-sm">GitHub</div>
          <Show
            when={!githubLinkExists.loading}
            fallback={<span class="text-sm text-ink-muted h-8 flex items-center">Loading...</span>}
          >
            <Show
              when={!githubLinkExists()}
              fallback={
                <DeprecatedTextButton
                  theme="base"
                  text="Disable"
                  onClick={handleGithubDisable}
                />
              }
            >
              <DeprecatedTextButton
                theme="base"
                text="Enable"
                onClick={handleGithubEnable}
              />
            </Show>
          </Show>
        </div>
        <NotificationToggle />
        <div class="flex flex-row justify-between items-center border-t border-edge pt-4">
          <div
            class="mb-4 flex flex-row justify-start items-center gap-1"
            onClick={logoutHandler}
          >
            <Logout class="w-4 h-4" />
            <div class="text-sm select-none">Logout</div>
          </div>
          </div>
        <Show when={isNativeMobilePlatform()}>
          <div class="border-t border-edge pt-4">
            <Button variant="destructive" onClick={() => setShowDeleteModal(true)}>
              Delete Account
            </Button>
            <Modal open={showDeleteModal()} onOpenChange={setShowDeleteModal}>
              <Overlay />
              <Content>
                <Header>Delete Account</Header>
                <Message>
                  Are you sure you want to delete your account? This action is
                  permanent and cannot be undone.
                </Message>
                <ButtonBar>
                  <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={() => {
                    setShowDeleteModal(false);
                    setShowDeleteConfirmModal(true);
                  }}>
                    Delete
                  </Button>
                </ButtonBar>
              </Content>
            </Modal>
            <Modal open={showDeleteConfirmModal()} onOpenChange={setShowDeleteConfirmModal}>
              <Overlay />
              <Content>
                <Header>Are you absolutely sure?</Header>
                <Message>
                  This will permanently delete your account and all associated
                  data. This cannot be undone.
                </Message>
                <ButtonBar>
                  <Button variant="secondary" onClick={() => setShowDeleteConfirmModal(false)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={deleteAccountHandler}>
                    Delete My Account
                  </Button>
                </ButtonBar>
              </Content>
            </Modal>
          </div>
        </Show>
        </div>
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

  const handleToggle = () =>  {
    analytics.track('notifications_toggled')
    props.settings.toggle(!props.settings.isEnabled())
  }


  return (
    <div class="flex items-center justify-between mb-[18px]">
      <div class="text-sm">Notifications</div>
      <DeprecatedTextButton
        theme="base"
        text={props.settings.isEnabled() ? "Disable" : "Enable"}
        onClick={handleToggle}
      />
    </div>
  );
}

function NotificationNotSupported() {
  return (
    <div class="flex items-center justify-between mb-[18px]">
      <div class="text-sm">Notifications</div>
      <span class="text-sm text-ink-muted">Not supported on this device</span>
    </div>
  );
}
