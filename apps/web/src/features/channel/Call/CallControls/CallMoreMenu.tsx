import { t } from '@app/lib/i18n';
import CaretRight from '@icon/system/regular/caret-right.svg';
import CornersIn from '@icon/system/regular/corners-in.svg';
import DotsThree from '@icon/system/regular/dots-three.svg';
import LayoutIcon from '@icon/system/regular/sidebar-simple.svg';
import { Button, Dropdown, SingleSelectCheck, ToggleSwitch } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import { type CallLayout, normalizeCallLayout } from '../call-layout';
import {
  CALL_REACTION_EMOJIS,
  type CallReactionEmoji,
} from '../call-reactions';

const layouts = [
  {
    value: 'auto',
    label: 'calls.layoutAuto',
    description: 'calls.layoutAutoDescription',
  },
  {
    value: 'grid',
    label: 'calls.layoutGrid',
    description: 'calls.layoutGridDescription',
  },
  {
    value: 'speaker',
    label: 'calls.layoutSpeaker',
    description: 'calls.layoutSpeakerDescription',
  },
  {
    value: 'sidebar',
    label: 'calls.layoutSidebar',
    description: 'calls.layoutSidebarDescription',
  },
] as const;

function LayoutThumbnail(props: { layout: CallLayout }) {
  return (
    <div
      aria-hidden="true"
      class={`flex h-8 w-11 shrink-0 gap-0.5 rounded border border-edge-muted p-0.5 ${props.layout === 'speaker' ? 'flex-col' : ''}`}
    >
      <Show
        when={props.layout === 'grid'}
        fallback={
          <>
            <div class="flex-1 rounded-sm bg-ink-muted" />
            <div
              class={
                props.layout === 'speaker'
                  ? 'flex h-1.5 gap-0.5'
                  : 'flex w-2 flex-col gap-0.5'
              }
            >
              <For each={[0, 1, 2]}>
                {() => <div class="flex-1 rounded-sm bg-ink-extra-muted" />}
              </For>
            </div>
          </>
        }
      >
        <div class="grid w-full grid-cols-2 gap-0.5">
          <For each={[0, 1, 2, 3]}>
            {() => <div class="rounded-sm bg-ink-muted" />}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function CallMoreMenu(props: {
  compact?: boolean;
  layout: CallLayout;
  onLayoutChange: (layout: CallLayout) => void;
  hasScreenShare: boolean;
  hideParticipants: boolean;
  onHideParticipantsChange: (hidden: boolean) => void;
  onOpenChange: (open: boolean) => void;
  children?: JSX.Element;
  onReaction?: (emoji: CallReactionEmoji) => void;
}) {
  const label = () =>
    layouts.find((item) => item.value === props.layout)?.label ??
    'calls.layoutAuto';
  return (
    <Dropdown placement="top-start" onOpenChange={props.onOpenChange}>
      <Dropdown.Trigger
        as={Button}
        variant="secondary"
        size={props.compact ? 'icon-md' : 'icon-lg'}
        aria-label={t('calls.more')}
        tooltip={t('calls.more')}
      >
        <DotsThree class="size-5" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-64">
        <Show when={props.onReaction}>
          <Dropdown.Group>
            <Dropdown.GroupLabel>{t('calls.reactions')}</Dropdown.GroupLabel>
            <div class="flex items-center justify-between gap-1 px-1">
              <For each={CALL_REACTION_EMOJIS}>
                {(emoji) => (
                  <Button
                    variant="secondary"
                    size="icon-lg"
                    aria-label={emoji}
                    onClick={() => props.onReaction?.(emoji)}
                  >
                    <span class="text-xl">{emoji}</span>
                  </Button>
                )}
              </For>
            </div>
          </Dropdown.Group>
        </Show>
        <Dropdown.Group>
          <Dropdown.Sub>
            <Dropdown.SubTrigger>
              <LayoutIcon class="size-4" />
              <span class="flex-1">{t('calls.layout')}</span>
              <span class="text-ink-muted">{t(label())}</span>
              <CaretRight class="size-3" />
            </Dropdown.SubTrigger>
            <Dropdown.SubContent class="w-80">
              <Dropdown.Group>
                <Dropdown.GroupLabel>{t('calls.layout')}</Dropdown.GroupLabel>
                <Dropdown.RadioGroup
                  value={props.layout}
                  onChange={(value) =>
                    props.onLayoutChange(normalizeCallLayout(value))
                  }
                >
                  <For each={layouts}>
                    {(item) => (
                      <Dropdown.RadioItem
                        value={item.value}
                        textValue={t(item.label)}
                        class="gap-3 py-2"
                      >
                        <LayoutThumbnail layout={item.value} />
                        <span class="min-w-0 flex-1">
                          <span class="block">{t(item.label)}</span>
                          <span class="block text-xs text-ink-muted">
                            {t(item.description)}
                          </span>
                        </span>
                        <SingleSelectCheck
                          active={props.layout === item.value}
                        />
                      </Dropdown.RadioItem>
                    )}
                  </For>
                </Dropdown.RadioGroup>
              </Dropdown.Group>
              <Dropdown.Group>
                <p class="px-2 py-1 text-xs text-ink-muted">
                  {t('calls.layoutRemembered')}
                </p>
              </Dropdown.Group>
            </Dropdown.SubContent>
          </Dropdown.Sub>
          <Dropdown.CheckboxItem
            class="flex-row-reverse"
            checked={props.hideParticipants}
            disabled={!props.hasScreenShare}
            closeOnSelect={false}
            onChange={props.onHideParticipantsChange}
            indicator={
              <span inert aria-hidden="true">
                <ToggleSwitch
                  checked={props.hideParticipants}
                  disabled={!props.hasScreenShare}
                />
              </span>
            }
          >
            <span class="flex flex-1 items-center gap-1.5">
              <CornersIn class="size-4" />
              <span class="flex-1">
                <span class="block">{t('calls.hideParticipants')}</span>
                <span class="block text-xs text-ink-muted">
                  {props.hasScreenShare
                    ? t('calls.forThisCall')
                    : t('calls.whileSharing')}
                </span>
              </span>
            </span>
          </Dropdown.CheckboxItem>
        </Dropdown.Group>
        {props.children}
      </Dropdown.Content>
    </Dropdown>
  );
}
