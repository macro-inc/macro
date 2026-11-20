import { ViewShell } from '@app/components/view-shell';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import TimerIcon from '@phosphor/timer.svg';
import { Tooltip } from '@ui';
import { type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { ChatProvider } from '../providers';
import { ProviderPicture } from './provider-picture';

/** Conversation chrome: floating split islands on touch, an in-flow desktop bar. */
export function ExternalChatHeader(props: {
  title: string;
  provider?: Pick<ChatProvider, 'label' | 'icon' | 'badgeClass'>;
  /** The group's or person's picture; the provider badge shows without one. */
  pictureUrl?: string;
  leading?: JSX.Element;
  share: JSX.Element;
  details: JSX.Element;
  disappearing?: string;
  importing?: string;
}) {
  const badge = () => (
    <Show when={props.provider}>
      {(provider) => (
        <span
          aria-hidden="true"
          class={`flex size-5 shrink-0 items-center justify-center rounded-full touch:size-4 ${provider().badgeClass}`}
        >
          <Dynamic component={provider().icon} class="size-3" />
        </span>
      )}
    </Show>
  );
  const icon = () => (
    <Show when={props.pictureUrl} fallback={badge()}>
      {(url) => (
        <ProviderPicture
          url={url()}
          size="md"
          class="size-5 shrink-0 touch:size-4"
        >
          {badge()}
        </ProviderPicture>
      )}
    </Show>
  );
  const timer = () => (
    <Show when={props.disappearing}>
      {(note) => (
        <Tooltip label={note()} as="span" class="flex shrink-0 self-center">
          <TimerIcon
            class="size-3.5 text-ink-extra-muted"
            aria-label={note()}
            data-whatsapp-disappearing
          />
        </Tooltip>
      )}
    </Show>
  );

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <ViewShell.TopBar>
          {props.leading}
          {icon()}
          <div class="flex min-w-0 flex-1 items-baseline gap-2">
            <h1 class="ph-no-capture min-w-0 truncate text-sm font-semibold">
              {props.title}
            </h1>
            {timer()}
            <span class="shrink-0 truncate text-xs text-ink-extra-muted">
              {props.provider?.label}
              <Show when={props.importing}>
                {(status) => <> · {status()}</>}
              </Show>
            </span>
          </div>
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <HeaderActionGroup label="Sharing">{props.share}</HeaderActionGroup>
            {props.details}
          </div>
        </ViewShell.TopBar>
      }
    >
      <SplitHeaderLeft>
        <Show when={props.leading}>
          <HeaderIsland class="gap-0 px-1">{props.leading}</HeaderIsland>
        </Show>
        <StaticSplitLabel
          label={props.title}
          icon={icon()}
          badges={timer()}
          class="ph-no-capture"
        />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <HeaderIsland class="px-1">{props.share}</HeaderIsland>
        <HeaderIsland class="size-10 justify-center !px-0">
          {props.details}
        </HeaderIsland>
      </SplitHeaderRight>
    </Show>
  );
}
