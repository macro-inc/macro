import Funnel from '@phosphor/funnel-simple.svg';
import Signal from '@phosphor/wave-sine.svg';
import Noise from '@phosphor/waveform.svg';
import { Button } from '@ui';
import { createSignal, For, lazy, Show, Suspense } from 'solid-js';
import type { EmailTagId } from '../../core/demo-email';
import { EmailSharingDemo } from './EmailSharingDemo';
import { type DemoEmail, demoEmails } from './email-fixtures';
import { EmailRows } from './frozen/EmailRows';
import {
  EmailShell,
  EmailSidebar,
  type MailTab,
  mailTabs,
} from './frozen/EmailShell';
import { EmailThread } from './frozen/EmailThread';
import { SearchBar } from './frozen/SearchBar';
import './email-demos.css';

const HomepageEmailCompose = lazy(() => import('../HomepageEmailCompose'));

function Inbox(props: { signalNoise?: boolean }) {
  const [tab, setTab] = createSignal<MailTab>(
    props.signalNoise ? 'important' : 'all'
  );
  const [tag, setTag] = createSignal<EmailTagId>();
  const [account, setAccount] = createSignal('all');
  const [search, setSearch] = createSignal('');
  const [selected, setSelected] = createSignal<DemoEmail>();
  const [filter, setFilter] = createSignal(false);
  const [unreadOnly, setUnreadOnly] = createSignal(false);
  const [moved, setMoved] = createSignal(false);
  const [sharing, setSharing] = createSignal(false);
  const [compose, setCompose] = createSignal(false);
  const emails = () =>
    demoEmails.filter((email) => {
      const noise = email.noise || (email.id === 'updates' && moved());
      return (
        (tab() === 'all' ||
          (tab() === 'noise' && noise) ||
          (tab() === 'important' && !noise) ||
          (tab() === 'favorites' && email.favorite)) &&
        (!tag() || email.tags?.includes(tag()!)) &&
        (account() === 'all' || email.account === account()) &&
        (!unreadOnly() || email.unread) &&
        `${email.sender} ${email.subject} ${email.snippet}`
          .toLowerCase()
          .includes(search().toLowerCase())
      );
    });
  const title = () =>
    mailTabs.find((item) => item.id === tab())?.label ?? 'Email';
  const onTab = (next: MailTab) => {
    setTag(undefined);
    setTab(next);
    setSelected(undefined);
    setCompose(false);
  };
  return (
    <div>
      <Show
        when={!sharing()}
        fallback={<EmailSharingDemo onClose={() => setSharing(false)} />}
      >
        <EmailShell
          label={
            props.signalNoise
              ? 'Signal and Noise inbox demo'
              : 'Unified inbox demo'
          }
          sidebar={
            <EmailSidebar
              tag={tag()}
              onTag={(value) => {
                onTab('all');
                setTag(value);
              }}
              tab={tab()}
              account={account()}
              onTab={onTab}
              onAccount={setAccount}
              onCompose={() => setCompose(true)}
            />
          }
        >
          <Show
            when={!compose()}
            fallback={
              <div class="p-4">
                <Button variant="plain" onClick={() => setCompose(false)}>
                  Back to inbox
                </Button>
                <Suspense fallback={<p>Loading draft…</p>}>
                  <HomepageEmailCompose appChrome />
                </Suspense>
              </div>
            }
          >
            <Show
              when={selected()}
              fallback={
                <>
                  <div class="mail-topbar flex h-12 min-w-0 shrink-0 items-center gap-1 px-3 py-3 text-sm font-medium">
                    {title()}
                  </div>
                  <div class="mail-mobile-accounts">
                    <label>
                      Inbox
                      <select
                        aria-label="Select inbox"
                        value={account()}
                        onChange={(e) => setAccount(e.currentTarget.value)}
                      >
                        <option value="all">All inboxes</option>
                        <option value="work">jacob@macro.com</option>
                        <option value="personal">
                          jacob.beckerman@gmail.com
                        </option>
                      </select>
                    </label>
                    <div class="mail-mobile-tabs">
                      <For
                        each={mailTabs.filter((item) =>
                          ['important', 'noise', 'all'].includes(item.id)
                        )}
                      >
                        {(item) => (
                          <button
                            type="button"
                            aria-pressed={tab() === item.id}
                            onClick={() => onTab(item.id)}
                          >
                            <item.icon />
                            {item.label}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                  <header class="shrink-0 px-4 py-4 flex min-w-0 items-center justify-between gap-3">
                    <SearchBar
                      label="Search sample email"
                      placeholder="Search email"
                      value={search()}
                      onValueChange={setSearch}
                      hotkey="cmd+f"
                      class="max-w-md flex-1"
                    />
                    <div class="relative">
                      <Button
                        variant="plain"
                        size="icon-sm"
                        aria-label="Filter email"
                        aria-expanded={filter()}
                        onClick={() => setFilter(!filter())}
                      >
                        <Funnel />
                      </Button>
                      <Show when={filter()}>
                        <div class="mail-filter">
                          <label>
                            <input
                              type="checkbox"
                              checked={unreadOnly()}
                              onChange={(event) =>
                                setUnreadOnly(event.currentTarget.checked)
                              }
                            />
                            Unread only
                          </label>
                        </div>
                      </Show>
                    </div>
                  </header>
                  <EmailRows emails={emails()} onOpen={setSelected} />
                </>
              }
            >
              {(email) => (
                <EmailThread
                  email={email()}
                  onBack={() => setSelected(undefined)}
                  onShare={() => setSharing(true)}
                />
              )}
            </Show>
          </Show>
        </EmailShell>
      </Show>
      <Show when={props.signalNoise && !sharing()}>
        <div class="mail-demo-controls">
          <Button
            variant="plain"
            size="sm"
            onClick={() => {
              setMoved(!moved());
              onTab(moved() ? 'noise' : 'important');
            }}
          >
            <Show
              when={moved()}
              fallback={
                <>
                  <Noise />
                  Move Product updates to Noise
                </>
              }
            >
              <Signal />
              Move Product updates back to Signal
            </Show>
          </Button>
          <span role="status">
            {moved()
              ? 'Product updates is now in Noise.'
              : 'Switch between Signal and Noise in the sidebar.'}
          </span>
        </div>
      </Show>
    </div>
  );
}
export function EmailInboxDemo() {
  return <Inbox />;
}
export function EmailSignalNoiseDemo() {
  return <Inbox signalNoise />;
}
