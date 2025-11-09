import { ENABLE_ORG_SETTING_DEFAULT_SHARE } from '@core/constant/featureFlags';
import ArrowDown from '@icon/regular/arrow-down.svg';
import Close from '@icon/regular/x-circle.svg';
import { type JSX, Show } from 'solid-js';
import useOrganizationSettings from './useOrganizationSettings';

const Row = ({
  text,
  subtext,
  isLoading = false,
  component,
}: {
  text: string;
  subtext: string;
  isLoading?: boolean;
  component: JSX.Element;
}) => {
  return (
    <div class="mb-[18px] flex justify-between">
      <div>
        <div class="text-sm">{text}</div>
        <div class="text-ink-extra-muted text-xs max-w-96 leading-[1.5]">
          {subtext}
        </div>
      </div>
      {isLoading ? (
        <div class="animate-pulse bg-edge rounded max-w-[100px] min-h-[20px] leading-5"></div>
      ) : (
        <div class="text-xs font-semibold">{component}</div>
      )}
    </div>
  );
};

const OrganizationSettings = () => {
  const {
    orgSettings,
    loading,
    changeSharePermissions,
    // changePublicAccessLevel,
    changeRetentionDays,
    updateRetentionDays,
    removeRetentionDays,
  } = useOrganizationSettings();

  return (
    <div class="relative mb-8">
      <Row
        text="Organization Name"
        subtext="This field displays the name of your field organization."
        component={
          <Show when={!loading()}>
            <div class="text-xs font-semibold">{orgSettings.name}</div>
          </Show>
        }
      />
      <Show when={ENABLE_ORG_SETTING_DEFAULT_SHARE}>
        <Row
          text="Default Share Permissions"
          subtext="This setting determines the default sharing permissions applied to new documents created within the system."
          component={
            <Show when={!loading()}>
              <div class="flex items-center relative min-w-20 hover:bg-hover hover-transition-bg rounded-lg transition">
                <select
                  class="cursor-default min-w-28 w-auto bg-transparent appearance-none text-xs border-none text-ink pl-2 pr-4 py-1"
                  onChange={changeSharePermissions}
                  value={orgSettings.default_share_permission.toLowerCase()}
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                  <option value="organization">Organization</option>
                </select>
                <ArrowDown class="w-5 h-5 pr-2 pointer-events-none absolute right-0" />
              </div>
            </Show>
          }
        />
      </Show>

      <Row
        text="Document Retention"
        subtext="This setting determines the number of days documents are retained in the system."
        component={
          <Show when={!loading()}>
            <div class="flex items-center relative min-w-24">
              <Show when={orgSettings.retention_days}>
                <select
                  class="cursor-default min-w-24 w-auto bg-transparent appearance-none text-xs border-none text-ink pl-2 pr-4 py-1 hover:bg-hover hover-transition-bg rounded-lg"
                  value={orgSettings.retention_days?.toString()}
                  onChange={changeRetentionDays}
                >
                  <option value="30">30 days</option>
                  <option value="60">60 days</option>
                  <option value="90">90 days</option>
                  <option value="120">120 days</option>
                </select>
                <ArrowDown class="w-5 h-5 pr-2 pointer-events-none absolute right-0" />
                <button
                  class="absolute right-0 translate-x-full pl-1 cursor-default"
                  onClick={removeRetentionDays}
                >
                  <Close stroke="rgb(239 68 68 / 10)" width="14" />
                </button>
              </Show>

              <Show when={orgSettings.retention_days === undefined}>
                <button
                  type="button"
                  class="absolute right-0 top-0 py-1 px-2 text-xs text-accent-ink ring-1 ring-accent/50 bg-accent/10 hover:bg-accent/20 hover-transition-bg rounded-md"
                  onClick={() => updateRetentionDays(30)}
                >
                  Add
                </button>
              </Show>
            </div>
          </Show>
        }
      />
    </div>
  );
};

export default OrganizationSettings;
