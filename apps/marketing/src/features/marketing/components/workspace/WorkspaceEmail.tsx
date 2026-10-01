import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import CaretUp from '@phosphor/caret-up.svg';
import Check from '@phosphor/check.svg';
import Envelope from '@phosphor/envelope.svg';
import EnvelopeOpen from '@phosphor/envelope-open.svg';
import Funnel from '@phosphor/funnel-simple.svg';
import Link from '@phosphor/link.svg';
import Sidebar from '@phosphor/sidebar-simple.svg';
import Upload from '@phosphor/upload-simple.svg';
import { Button, Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { type EmailTagId, emailTags } from '../../core/demo-email';
import { homepagePeople } from '../../core/homepage-demo-people';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { ViewShell } from '../DemoWorkspaceChrome';
import { EmailAvatar } from '../email/frozen/EmailAvatar';
import { EmailRows } from '../email/frozen/EmailRows';
import { type MailTab, mailTabs } from '../email/frozen/EmailShell';
import { EmailThread } from '../email/frozen/EmailThread';
import { MessageCard } from '../email/frozen/MessageCard';
import { SearchBar } from '../email/frozen/SearchBar';
import HomepageEmailCompose from '../HomepageEmailCompose';
import { DemoTags } from './frozen/DemoTags';
import { DetailLayout, PanelSection } from './frozen/DetailPanel';
import { EmailReply } from './frozen/EmailReply';

export function WorkspaceEmail(props: {
  workspace: DummyWorkspace;
  tab: MailTab;
  account: string;
  tag?: EmailTagId;
  onClearTag?: () => void;
  navigationOpen?: boolean;
  onToggleNavigation?: () => void;
}) {
  const w = props.workspace;
  const [reply, setReply] = createSignal<string>();
  const [panel, setPanel] = createSignal(false);
  const [unreadOnly, setUnreadOnly] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const selected = () =>
    w.data.emails.find((email) => email.id === w.selected());
  const title = () =>
    w.view() === 'home'
      ? 'Home'
      : (emailTags.find((tag) => tag.id === props.tag)?.label ??
        mailTabs.find((tab) => tab.id === props.tab)?.label ??
        'Email');
  const emails = () =>
    w.data.emails.filter(
      (email) =>
        !email.archived &&
        (!props.tag || email.tags?.includes(props.tag)) &&
        (!unreadOnly() || email.unread) &&
        (props.account === 'all' || email.account === props.account) &&
        `${email.sender} ${email.subject} ${email.body}`
          .toLowerCase()
          .includes(w.query().toLowerCase()) &&
        (props.tab === 'all' ||
          (props.tab === 'favorites' && email.favorite) ||
          (props.tab === 'important' &&
            email.folder === 'inbox' &&
            !email.noise) ||
          (props.tab === 'noise' && email.folder === 'inbox' && email.noise) ||
          props.tab === email.folder ||
          (props.tab === 'shared' && !!email.shared))
    );
  const adjacent = (offset: number) => {
    const list = emails();
    const index = list.findIndex((e) => e.id === w.selected());
    const next = list[index + offset];
    if (next) w.openItem('email', next.id);
  };
  const openReply = () => setReply(w.selected());
  const footer = () => (
    <Show
      when={reply() === w.selected()}
      fallback={
        <button
          type="button"
          class="sample-email-reply-placeholder"
          onClick={openReply}
        >
          <img
            src={homepagePeople.jacob.photo}
            class="size-6 rounded-full"
            alt=""
          />
          Reply...
        </button>
      }
    >
      <EmailReply
        to={selected()?.sender ?? ''}
        onDiscard={() => setReply(undefined)}
        onSend={(body, to, schedule, recipients) => {
          const email = selected();
          if (!email) return;
          w.sendEmail(
            `Re: ${email.subject}`,
            body,
            to,
            email.id,
            schedule,
            recipients
          );
          setReply(undefined);
        }}
      />
    </Show>
  );
  return (
    <>
      <ViewShell.TopBar>
        <Show when={!props.navigationOpen}>
          <Button
            size="icon-sm"
            variant="plain"
            label="Toggle email navigation"
            onClick={props.onToggleNavigation}
          >
            <Sidebar />
          </Button>
        </Show>
        <nav
          class="flex items-center gap-2 min-w-0 text-sm"
          aria-label="Email location"
        >
          <button
            type="button"
            class="text-ink-muted"
            onClick={() => w.backToCollection('email')}
          >
            {title()}
          </button>
          <Show when={selected() || w.selected() === 'new'}>
            <CaretRight class="size-3 shrink-0 text-ink-muted" />
            <Envelope class="size-3.5 shrink-0" />
            <span class="truncate font-medium">
              {selected()?.subject ?? 'New email'}
            </span>
          </Show>
        </nav>
        <Show when={selected()}>
          {(email) => (
            <div class="ml-auto shrink-0 flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="plain"
                label="Mark as unread"
                onClick={() => {
                  w.setData(
                    'emails',
                    (e) => e.id === email().id,
                    'unread',
                    true
                  );
                  w.backToCollection('email');
                }}
              >
                <EnvelopeOpen />
              </Button>
              <Button
                size="icon-sm"
                variant="plain"
                label="Mark done"
                onClick={() => {
                  w.setData(
                    'emails',
                    (e) => e.id === email().id,
                    'archived',
                    true
                  );
                  w.backToCollection('email');
                }}
              >
                <Check />
              </Button>
              <Button
                size="icon-sm"
                variant="plain"
                label="Previous email"
                disabled={emails().findIndex((e) => e.id === email().id) <= 0}
                onClick={() => adjacent(-1)}
              >
                <CaretUp />
              </Button>
              <Button
                size="icon-sm"
                variant="plain"
                label="Next email"
                disabled={
                  emails().findIndex((e) => e.id === email().id) >=
                  emails().length - 1
                }
                onClick={() => adjacent(1)}
              >
                <CaretDown />
              </Button>
              <Dropdown modal={false}>
                <Dropdown.Trigger
                  size="sm"
                  variant="plain"
                  aria-label="Share email"
                >
                  <Upload class="size-3" />
                  Share
                </Dropdown.Trigger>
                <Dropdown.Content portalScope="local">
                  <Dropdown.Group>
                    <Dropdown.GroupLabel>Share to channel</Dropdown.GroupLabel>
                    <For each={w.data.channels.filter((c) => !c.person)}>
                      {(channel) => (
                        <Dropdown.Item
                          onSelect={() => {
                            w.setChannel(channel.id);
                            w.shareEmail(email().id);
                          }}
                        >
                          #{channel.id}
                        </Dropdown.Item>
                      )}
                    </For>
                  </Dropdown.Group>
                </Dropdown.Content>
              </Dropdown>
              <Button
                size="icon-sm"
                variant="plain"
                label={copied() ? 'Link copied' : 'Copy email link'}
                onClick={async () => {
                  await navigator.clipboard.writeText(
                    `${location.origin}/demo#email-${email().id}`
                  );
                  setCopied(true);
                }}
              >
                <Link />
              </Button>
              <Button
                size="icon-sm"
                variant="plain"
                label="Toggle email details"
                aria-expanded={panel()}
                onClick={() => setPanel(!panel())}
              >
                <Sidebar />
              </Button>
            </div>
          )}
        </Show>
      </ViewShell.TopBar>
      <Show
        when={w.selected() === 'new'}
        fallback={
          <Show
            when={selected()}
            fallback={
              <>
                <div class="px-4 py-4 flex items-center justify-between gap-3">
                  <SearchBar
                    label="Search email"
                    placeholder="Search email"
                    value={w.query()}
                    onValueChange={w.setQuery}
                    class="max-w-md flex-1"
                    hotkey="cmd+f"
                  />
                  <div class="flex items-center gap-2">
                    <Show when={props.tag}>
                      <Button
                        size="sm"
                        variant="plain"
                        onClick={props.onClearTag}
                      >
                        Clear tag
                      </Button>
                    </Show>
                    <Dropdown modal={false}>
                      <Dropdown.Trigger
                        size="icon-sm"
                        variant="plain"
                        aria-label="Filter email"
                      >
                        <Funnel class={unreadOnly() ? 'text-accent' : ''} />
                      </Dropdown.Trigger>
                      <Dropdown.Content portalScope="local">
                        <Dropdown.Item
                          onSelect={() => setUnreadOnly(!unreadOnly())}
                        >
                          <span class="w-4">
                            {unreadOnly() && <Check class="size-4" />}
                          </span>
                          Unread only
                        </Dropdown.Item>
                      </Dropdown.Content>
                    </Dropdown>
                  </div>
                </div>
                <div class="dummy-scroll mail-main">
                  <EmailRows
                    emails={emails()}
                    onOpen={(email) => {
                      w.setData(
                        'emails',
                        (e) => e.id === email.id,
                        'unread',
                        false
                      );
                      w.openItem('email', email.id);
                    }}
                  />
                </div>
              </>
            }
          >
            {(email) => (
              <DetailLayout
                open={panel()}
                panel={
                  <>
                    <PanelSection title="Details" open>
                      <p class="mb-2">From {email().sender}</p>
                      <p class="text-ink-muted text-xs">To Jacob Beckerman</p>
                      <Button
                        size="sm"
                        class="mt-4"
                        onClick={() =>
                          w.setData(
                            'emails',
                            (e) => e.id === email().id,
                            'noise',
                            (v) => !v
                          )
                        }
                      >
                        Move to {email().noise ? 'Signal' : 'Noise'}
                      </Button>
                    </PanelSection>
                    <PanelSection title="Tags" open>
                      <DemoTags
                        options={emailTags}
                        tags={emailTags
                          .filter((tag) => email().tags?.includes(tag.id))
                          .map((tag) => tag.label)}
                        onChange={(labels) =>
                          w.setData(
                            'emails',
                            (e) => e.id === email().id,
                            'tags',
                            emailTags
                              .filter((tag) => labels.includes(tag.label))
                              .map((tag) => tag.id)
                          )
                        }
                      />
                    </PanelSection>
                  </>
                }
              >
                <div class="dummy-scroll sample-email-thread">
                  <EmailThread
                    hideHeader
                    email={email()}
                    onReply={openReply}
                    hideReply={email().replies.length > 0}
                    replyContent={footer()}
                    participants={
                      <div class="flex gap-2 mb-5 -mt-3 text-xs text-ink-muted">
                        <For
                          each={[
                            ...email()
                              .sender.split(',')
                              .map((name) => name.trim()),
                            'Jacob',
                          ]}
                        >
                          {(name) => (
                            <span class="inline-flex items-center gap-1.5 border border-edge-muted rounded-full px-2 py-1">
                              <EmailAvatar name={name} class="size-4" />
                              {name}
                            </span>
                          )}
                        </For>
                      </div>
                    }
                  >
                    <For each={email().replies}>
                      {(message, index) => (
                        <div class="mt-2">
                          <MessageCard
                            messageId={message.id}
                            isSelected={false}
                            allowHover={false}
                            isTouch={false}
                          >
                            <div class="flex items-center gap-2 text-sm">
                              <img
                                class="size-6 rounded-full"
                                src={homepagePeople.jacob.photo}
                                alt=""
                              />
                              <span>Jacob</span>
                              <span class="text-ink-extra-muted">
                                to {message.to ?? email().sender}
                              </span>
                              <span class="ml-auto text-xs text-ink-extra-muted">
                                {message.time}
                              </span>
                            </div>
                            <Show when={message.cc || message.bcc}>
                              <p class="pt-2 text-xs text-ink-muted">
                                {message.cc && `Cc: ${message.cc}`}
                                {message.bcc && ` Bcc: ${message.bcc}`}
                              </p>
                            </Show>
                            <p class="py-6 text-[15px] whitespace-pre-wrap">
                              {message.body}
                            </p>
                            <Show when={index() === email().replies.length - 1}>
                              <div class="-mx-4 border-t border-ink/20 px-4">
                                {footer()}
                              </div>
                            </Show>
                          </MessageCard>
                        </div>
                      )}
                    </For>
                  </EmailThread>
                </div>
              </DetailLayout>
            )}
          </Show>
        }
      >
        <div class="dummy-scroll p-4">
          <HomepageEmailCompose
            appChrome
            draft={{ subject: '', to: '', body: '' }}
            onSend={(draft) => w.sendEmail(draft.subject, draft.body, draft.to)}
          />
        </div>
      </Show>
    </>
  );
}
