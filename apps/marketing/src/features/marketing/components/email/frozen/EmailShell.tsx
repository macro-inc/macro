import Calendar from '@phosphor/calendar-blank.svg';
import Chats from '@phosphor/chats.svg';
import Check from '@phosphor/check.svg';
import CheckSquare from '@phosphor/check-square.svg';
import Clock from '@phosphor/clock.svg';
import Envelope from '@phosphor/envelope.svg';
import File from '@phosphor/file.svg';
import Folder from '@phosphor/folder.svg';
import House from '@phosphor/house.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import PaperPlane from '@phosphor/paper-plane-tilt.svg';
import Plus from '@phosphor/plus.svg';
import Sidebar from '@phosphor/sidebar-simple.svg';
import Sparkle from '@phosphor/sparkle.svg';
import Star from '@phosphor/star.svg';
import Users from '@phosphor/users-three.svg';
import Signal from '@phosphor/wave-sine.svg';
import Noise from '@phosphor/waveform.svg';
import { For, type JSX, Show } from 'solid-js';
import { type EmailTagId, emailTags } from '../../../core/demo-email';
import { homepagePeople } from '../../../core/homepage-demo-people';
import { ViewSidebar } from '../../DemoViewSidebar';

export type MailTab =
  | 'important'
  | 'noise'
  | 'favorites'
  | 'sent'
  | 'scheduled'
  | 'calendar'
  | 'drafts'
  | 'shared'
  | 'all';
// Frozen from email-view/constants.ts and EmailSidebar.tsx, including order/icons.
export const mailTabs = [
  { id: 'important', label: 'Signal', icon: Signal },
  { id: 'noise', label: 'Noise', icon: Noise },
  { id: 'favorites', label: 'Favorites', icon: Star },
  { id: 'sent', label: 'Sent', icon: PaperPlane },
  { id: 'scheduled', label: 'Scheduled', icon: Clock },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'drafts', label: 'Drafts', icon: File },
  { id: 'shared', label: 'Shared', icon: Users },
  { id: 'all', label: 'All', icon: Envelope },
] as const;

export function MailAppRail(props: { channel?: boolean }) {
  return (
    <div class="mail-app-rail" aria-hidden="true">
      <Plus />
      <MagnifyingGlass />
      <span class="mail-rail-spacer" />
      <For
        each={[House, Folder, Envelope, Chats, CheckSquare, Calendar, Sparkle]}
      >
        {(Icon, index) => (
          <span
            class="mail-rail-item"
            data-active={index() === (props.channel ? 3 : 2)}
          >
            <Icon />
          </span>
        )}
      </For>
      <img class="mail-rail-person" src={homepagePeople.jacob.photo} alt="" />
    </div>
  );
}

// Uses the existing verbatim website copy of ViewSidebar. App adapters and
// queries are replaced by controlled props; the sidebar presentation is kept.
export function EmailSidebar(props: {
  tab: MailTab;
  account: string;
  onTab: (tab: MailTab) => void;
  onAccount: (account: string) => void;
  onCompose: () => void;
  onToggleNavigation?: () => void;
  tag?: EmailTagId;
  onTag?: (tag: EmailTagId) => void;
}) {
  return (
    <ViewSidebar.Root aria-label="Email navigation" class="mail-sidebar">
      <header class="flex shrink-0 flex-col">
        <ViewSidebar.Header>
          <h3 class="text-sm font-semibold tracking-[-0.03em] text-ink">
            Email
          </h3>
          <ViewSidebar.Control
            label="Collapse email navigation"
            onClick={props.onToggleNavigation}
          >
            <Sidebar class="size-4 text-ink-muted" />
          </ViewSidebar.Control>
        </ViewSidebar.Header>
      </header>
      <ViewSidebar.Content class="overflow-visible">
        <ViewSidebar.Nav aria-label="Inboxes">
          <ViewSidebar.Item
            active={props.account === 'all'}
            onClick={() => props.onAccount('all')}
          >
            <ViewSidebar.Icon>
              <Check class="text-accent" />
            </ViewSidebar.Icon>
            <span class="truncate">All inboxes</span>
          </ViewSidebar.Item>
          <For
            each={[
              { id: 'personal', label: 'jacob.beckerman@gmail.com' },
              { id: 'work', label: 'jacob@macro.com' },
            ]}
          >
            {(account) => (
              <ViewSidebar.Item
                active={props.account === account.id}
                onClick={() => props.onAccount(account.id)}
                title={account.label}
              >
                <ViewSidebar.Icon>
                  <img
                    class="size-5 rounded-full"
                    src={homepagePeople.jacob.photo}
                    alt=""
                  />
                </ViewSidebar.Icon>
                <span class="truncate">{account.label}</span>
              </ViewSidebar.Item>
            )}
          </For>
        </ViewSidebar.Nav>
        <div>
          <ViewSidebar.Action onClick={props.onCompose}>
            <ViewSidebar.Icon>
              <Plus />
            </ViewSidebar.Icon>
            <span class="truncate">New email</span>
          </ViewSidebar.Action>
        </div>
        <ViewSidebar.Nav aria-label="Email tabs">
          <For each={mailTabs}>
            {(tab) => (
              <ViewSidebar.Item
                active={!props.tag && props.tab === tab.id}
                onClick={() => props.onTab(tab.id)}
              >
                <ViewSidebar.Icon>
                  <tab.icon />
                </ViewSidebar.Icon>
                <span class="truncate">{tab.label}</span>
              </ViewSidebar.Item>
            )}
          </For>
        </ViewSidebar.Nav>
        <ViewSidebar.Nav aria-label="Email tags">
          <div class="text-xs text-ink-muted px-2 mb-3">Tags</div>
          <For each={emailTags}>
            {(tag) => (
              <ViewSidebar.Item
                active={props.tag === tag.id}
                onClick={() => props.onTag?.(tag.id)}
              >
                <ViewSidebar.Icon>
                  <span
                    class="size-2.5 rounded-full"
                    style={{ background: tag.color }}
                  />
                </ViewSidebar.Icon>
                <span>{tag.label}</span>
              </ViewSidebar.Item>
            )}
          </For>
        </ViewSidebar.Nav>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}

export function EmailShell(props: {
  children: JSX.Element;
  sidebar?: JSX.Element;
  channel?: boolean;
  label: string;
  class?: string;
}) {
  return (
    <div
      class={`mail-app workspace-demo ${props.class ?? ''}`}
      data-theme="dark"
      role="group"
      aria-label={props.label}
    >
      <MailAppRail channel={props.channel} />
      <Show when={props.sidebar}>{props.sidebar}</Show>
      <div class="mail-main">{props.children}</div>
    </div>
  );
}
