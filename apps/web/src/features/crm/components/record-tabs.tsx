import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { getIconConfig } from '@core/component/EntityIcon';
import { enableDatabases } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import SquaresFourIcon from '@icon/system/regular/squares-four.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { Button, Tabs } from '@ui';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { CrmRecordSection } from '../core/record';

const SECTION_ICONS: Record<
  CrmRecordSection,
  Component<JSX.SvgSVGAttributes<SVGSVGElement>>
> = {
  overview: SquaresFourIcon,
  team: UsersIcon,
  emails: getIconConfig('email').icon,
  files: getIconConfig('files').icon,
  tasks: getIconConfig('task').icon,
  calls: getIconConfig('call').icon,
  databases: getIconConfig('database').icon,
};

/** Desktop section tabs and a touch header island with a section drawer. */
export function RecordTabs<S extends CrmRecordSection>(props: {
  sections: readonly S[];
  value: S;
  onChange: (section: S) => void;
  compact?: boolean;
}) {
  const databasesFlag = useFeatureFlag(enableDatabases);
  const [open, setOpen] = createSignal(false);
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  const sections = () =>
    props.sections.filter(
      (section) => section !== 'databases' || databasesFlag().enabled
    );
  const label = (section: CrmRecordSection) => t(`tabs.record-${section}`);
  const icon = (section: CrmRecordSection) => SECTION_ICONS[section];

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Tabs
          aria-label={t('tabs.recordSections')}
          class="shrink-0"
          options={sections().map((section) => ({
            value: section,
            label: label(section),
            icon: props.compact ? SECTION_ICONS[section] : undefined,
          }))}
          iconOnly={props.compact}
          value={props.value}
          onChange={props.onChange}
        />
      }
    >
      <HeaderIsland class="shrink px-1">
        <MobileDrawer
          side="bottom"
          open={open()}
          onOpenChange={setOpen}
          restoreFocus
          finalFocusEl={trigger()}
        >
          <MobileDrawer.Trigger
            as={Button}
            ref={setTrigger}
            variant="ghost"
            size="sm"
            class="min-w-0"
            aria-label={t('tabs.recordSection', {
              section: label(props.value),
            })}
          >
            <Dynamic component={icon(props.value)} class="size-5 shrink-0" />
            <Show when={!props.compact}>
              <span class="truncate">{label(props.value)}</span>
            </Show>
            <CaretDownIcon
              class="size-4 shrink-0 transition-transform"
              classList={{ 'rotate-180': open() }}
            />
          </MobileDrawer.Trigger>
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay />
            <MobileDrawer.Content>
              <MobileDrawer.Handle />
              <MobileDrawer.Title class="px-6 pb-3 text-base font-semibold">
                {t('tabs.recordSections')}
              </MobileDrawer.Title>
              <MobileDrawer.ScrollBody>
                <MobileDrawer.Section
                  role="radiogroup"
                  aria-label={t('tabs.recordSections')}
                  class="flex flex-col"
                >
                  <For each={sections()}>
                    {(section) => (
                      <MobileDrawer.Close
                        as={MobileDrawer.Item}
                        role="radio"
                        aria-label={label(section)}
                        class={
                          props.value === section
                            ? 'text-ink'
                            : 'text-ink-extra-muted'
                        }
                        aria-checked={props.value === section}
                        onClick={() => props.onChange(section)}
                      >
                        <Dynamic
                          component={icon(section)}
                          class="size-5 shrink-0"
                        />
                        <span class="min-w-0 flex-1 break-words">
                          {label(section)}
                        </span>
                        <Show when={props.value === section}>
                          <CheckIcon class="size-4 shrink-0 text-ink" />
                        </Show>
                      </MobileDrawer.Close>
                    )}
                  </For>
                </MobileDrawer.Section>
              </MobileDrawer.ScrollBody>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      </HeaderIsland>
    </Show>
  );
}
