import { capitalize } from '@block-pdf/util/StringUtils';
import { useHasPaidAccess } from '@core/auth/license';
import { useLogout } from '@core/auth/logout';
import EditableField from '@core/component/EditableField';
import { uploadProfilePicture } from '@core/component/ProfilePicture';
import { TabContent, TabContentRow } from '@core/component/TabContent';
import { TextButton } from '@core/component/TextButton';
import { UserIcon } from '@core/component/UserIcon';
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
import { useOrganizationName } from '@core/user';
import Logout from '@icon/regular/sign-out.svg';
import { Popover } from '@kobalte/core';
import IconUpload from '@macro-icons/macro-upload.svg';
import { authServiceClient } from '@service-auth/client';
import { useEmail, useLicenseStatus, useUserId } from '@service-gql/client';
import { createMemo, createResource, createSignal, Show } from 'solid-js';
import {
  connectEmail,
  disconnectEmail,
  useEmailLinksStatus,
} from '../../signal/emailLink';
import { BetaTooltip } from '../BetaTooltip';

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
  const organizationName = useOrganizationName();
  const licenseStatus = useLicenseStatus();
  const logout = useLogout();
  const { showPaywall } = usePaywallState();
  const hasPaidAccess = useHasPaidAccess();
  const [showEmailModal, setShowEmailModal] = createSignal<boolean>(false);

  const userName = useUserName();
  const [updatedFirstName, setUpdatedFirstName] = createSignal<
    string | undefined
  >(undefined);
  const [updatedLastName, setUpdatedLastName] = createSignal<
    string | undefined
  >(undefined);

  const emailActive = useEmailLinksStatus();
  const [showTooltip, setShowTooltip] = createSignal<boolean>(false);

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
    let redirectUrl = window.location.origin;
    logout(redirectUrl);
  };

  return (
    <TabContent title="Account">
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
                  <TextButton text="Upload" icon={IconUpload} theme="accent" />
                </div>
              </div>
            </Show>
          </TabContentRow>
        </Show>
        <TabContentRow isLoading={!userId()} text="First Name" subtext={''}>
          <EditableField
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
          isLoading={!email()}
          text="Email"
          subtext={email() ?? ''}
        />
        <Show when={organizationName()}>
          {(name) => <TabContentRow text="Organization" subtext={name()} />}
        </Show>

        <div class="flex gap-4 items-center">
          <TabContentRow
            isLoading={!licenseStatus()}
            text="License Status"
            subtext={capitalize(licenseStatus() ?? '')}
          />
          <Show when={!hasPaidAccess()}>
            <TextButton
              theme="accent"
              text="Upgrade"
              onClick={() => showPaywall()}
              class="mb-[18px]"
            />
          </Show>
        </div>
        <Show when={ENABLE_EMAIL && (!emailActive() || DEV_MODE_ENV)}>
          <div
            class={`flex items-center justify-between ${!showEmailModal() && 'mb-[18px]'}`}
          >
            <div class="text-sm">Email</div>
            <Show
              when={!emailActive() && DEV_MODE_ENV}
              fallback={
                <TextButton
                  theme="base"
                  text="Disable"
                  onClick={() => {
                    setShowEmailModal(true);
                  }}
                />
              }
            >
              <Popover.Root open={showTooltip()} gutter={10} placement={'left'}>
                <Popover.Anchor>
                  <div
                    class="flex flex-col items-center"
                    onPointerEnter={() => {
                      setShowTooltip(true);
                    }}
                    onPointerLeave={() => {
                      setShowTooltip(false);
                    }}
                  >
                    <TextButton
                      theme="base"
                      text="Enable"
                      onClick={connectEmail}
                    />
                  </div>
                </Popover.Anchor>
                <Popover.Portal>
                  <Popover.Content class="z-modal">
                    <BetaTooltip
                      text={
                        "Enabling an email address different from the current Macro user's will result in session termination"
                      }
                    />
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </Show>
          </div>
        </Show>
        <Show when={showEmailModal()}>
          <div class="flex flex-row items-center">
            <div class="mb-[18px] text-sm pt-4">
              Disabling will clear all email data from Macro
            </div>
            <div class="ml-auto flex flex-row">
              <TextButton
                theme="clear"
                text="Confirm"
                onClick={() => {
                  disconnectEmail();
                  setShowEmailModal(false);
                }}
              />
              <TextButton
                theme="clear"
                text="Cancel"
                onClick={() => {
                  setShowEmailModal(false);
                }}
              />
            </div>
          </div>
        </Show>
        <div class="flex flex-row justify-between items-center border-t border-edge pt-2">
          <div
            class="mb-4.5 flex flex-row justify-start items-center gap-1"
            onClick={logoutHandler}
          >
            <Logout class="w-4 h-4" />
            <div class="text-sm select-none">Logout</div>
          </div>
        </div>
      </div>
    </TabContent>
  );
}
