import ArrowLeft from '@phosphor/arrow-left.svg';
import Check from '@phosphor/check.svg';
import Plus from '@phosphor/plus.svg';
import Tray from '@phosphor/tray.svg';
import { Button, Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  type DemoEmail,
  demoMailAccounts,
  type EmailTagId,
  emailTags,
} from '../../core/demo-email';
import { emailPageInbox } from '../../core/email-demo-story';
import { createDemoPointer } from '../../primitives/createDemoPointer';
import { createEmailWalkthrough } from '../../primitives/createEmailWalkthrough';
import { DemoCursor } from '../DemoCursor';
import HomepageEmailCompose from '../HomepageEmailCompose';
import { EmailRows } from './frozen/EmailRows';
import {
  EmailShell,
  EmailSidebar,
  type MailTab,
  mailTabs,
} from './frozen/EmailShell';
import { EmailThread } from './frozen/EmailThread';
import { SearchBar } from './frozen/SearchBar';
import './email-feature-demos.css';
import './email-accounts-demo.css';

/** EmailInboxList/EmailInboxMenu presentation with local sample accounts only. */
export function EmailAccountsDemo() {
  let root!: HTMLDivElement;
  const [target, setTarget] = createSignal<string>();
  const [clicking, setClicking] = createSignal(false);
  const approach = (selector: string) => {
    setClicking(false);
    setTarget(selector);
  };
  const click = (run: () => void) => {
    setClicking(true);
    run();
  };

  const [accountCount, setAccountCount] = createSignal(1);
  const [account, setAccount] = createSignal('work');
  const [tab, setTab] = createSignal<MailTab>('important');
  const [tag, setTag] = createSignal<EmailTagId>();
  const [query, setQuery] = createSignal('');
  const [selected, setSelected] = createSignal<DemoEmail>();
  const [compose, setCompose] = createSignal(false);
  const [step, setStep] = createSignal(0);
  const accounts = () => demoMailAccounts.slice(0, accountCount());
  const accountLabel = () =>
    demoMailAccounts.find((a) => a.id === account())?.label ?? 'All inboxes';
  const title = () =>
    emailTags.find((t) => t.id === tag())?.label ??
    mailTabs.find((t) => t.id === tab())?.label;
  const emails = () =>
    emailPageInbox.filter(
      (email) =>
        accounts().some((account) => account.id === email.account) &&
        (account() === 'all' || email.account === account()) &&
        (!tag() || email.tags?.includes(tag()!)) &&
        (tab() === 'all' ||
          (tab() === 'important' && !email.noise) ||
          (tab() === 'noise' && email.noise) ||
          (tab() === 'favorites' && email.favorite)) &&
        `${email.sender} ${email.subject} ${email.snippet}`
          .toLowerCase()
          .includes(query().toLowerCase())
    );
  const finish = () => {
    setMenuOpen(false);
    setTarget(undefined);
    setClicking(false);
    setAccountCount(3);
    setAccount('all');
    setTab('important');
    setStep(7);
  };
  const [menuOpen, setMenuOpen] = createSignal(false);
  const mobile = () =>
    (root
      .querySelector<HTMLElement>('.email-accounts-mobile')
      ?.getBoundingClientRect().width ?? 0) > 0;
  const applyAccount = (id: string) => {
    setAccount(id);
    setSelected(undefined);
    setCompose(false);
  };
  const connectAccount = () => {
    setAccountCount((count) => Math.min(count + 1, 3));
    applyAccount('all');
  };
  const selectControl = (selector: string, run: () => void, hold = 1400) => [
    {
      delay: hold,
      run: () => approach(mobile() ? '[data-email-inbox-menu]' : selector),
    },
    {
      delay: 650,
      run: () => {
        if (mobile()) click(() => setMenuOpen(true));
      },
    },
    { delay: 300, run: () => approach(selector) },
    {
      delay: 650,
      run: () =>
        click(() => {
          run();
          setMenuOpen(false);
        }),
    },
  ];
  const actions = [
    ...selectControl('[data-email-connect]', () => setStep(1)),
    {
      delay: 900,
      run: () => {
        connectAccount();
        setStep(2);
      },
    },
    ...selectControl('[data-email-connect]', () => setStep(3)),
    {
      delay: 900,
      run: () => {
        connectAccount();
        setStep(4);
      },
    },
    ...selectControl(
      '[data-email-account="personal"]',
      () => {
        applyAccount('personal');
        setStep(6);
      },
      2200
    ),
    ...selectControl(
      '[data-email-account="all"]',
      () => {
        applyAccount('all');
        setStep(7);
      },
      2200
    ),
    { delay: 400, run: () => setClicking(false) },
  ];
  const playback = createEmailWalkthrough({
    root: () => root,
    steps: actions.length,
    visibilityThreshold: 0.45,
    delay: (step) => actions[step - 1].delay,
    loop: { hold: 8000 },
    reset: () => {
      setTarget(undefined);
      setClicking(false);
      setMenuOpen(false);
      setAccountCount(1);
      setAccount('work');
      setTab('important');
      setStep(0);
    },
    reduced: finish,
    advance: (next) => actions[next - 1].run(),
  });
  const chooseAccount = (id: string) => {
    playback.pause();
    applyAccount(id);
  };
  const chooseTab = (id: MailTab) => {
    playback.pause();
    setTab(id);
    setTag(undefined);
    setSelected(undefined);
    setCompose(false);
  };
  const connect = () => {
    playback.pause();
    connectAccount();
    setStep(7);
  };
  const pointer = createDemoPointer({
    frame: () => root,
    target,
    active: () => playback.playing() && !playback.reducedMotion(),
  });
  return (
    <div
      ref={root}
      class="email-feature-demo email-accounts-demo"
      data-step={step()}
      onPointerDown={playback.pause}
      onFocusIn={playback.pause}
    >
      <EmailShell
        showRail={false}
        label="Try multiple email accounts"
        sidebar={
          <EmailSidebar
            account={account()}
            accounts={accounts()}
            onAccount={chooseAccount}
            onConnect={accountCount() < 3 ? connect : undefined}
            connecting={step() === 1 || step() === 3}
            tab={tab()}
            onTab={chooseTab}
            tag={tag()}
            onTag={(id) => {
              chooseTab('all');
              setAccount('all');
              setTag(id);
            }}
            onCompose={() => {
              playback.pause();
              setCompose(true);
            }}
          />
        }
      >
        <header class="email-feature-toolbar email-accounts-toolbar">
          <Show when={selected() || compose()}>
            <Button
              variant="plain"
              size="icon-sm"
              aria-label="Back to inbox"
              onClick={() => {
                setSelected(undefined);
                setCompose(false);
              }}
            >
              <ArrowLeft />
            </Button>
          </Show>
          <span>
            {compose() ? 'New email' : (selected()?.subject ?? title())}
          </span>
          <Show when={account() !== 'all' && !selected() && !compose()}>
            <span class="email-account-scope">from {accountLabel()}</span>
          </Show>
          <div class="email-accounts-mobile">
            <Dropdown
              placement="bottom-end"
              modal={false}
              open={menuOpen()}
              onOpenChange={setMenuOpen}
            >
              <Dropdown.Trigger
                variant="ghost"
                size="icon-sm"
                aria-label={`Inbox: ${accountLabel()}`}
                data-email-inbox-menu
              >
                <Tray />
              </Dropdown.Trigger>
              <Dropdown.Content
                class="min-w-56"
                mount={root?.querySelector<HTMLElement>('.mail-app') ?? root}
                onOpenAutoFocus={(event) => {
                  if (playback.playing()) event.preventDefault();
                }}
                onCloseAutoFocus={(event) => {
                  if (playback.playing()) event.preventDefault();
                }}
              >
                <Dropdown.RadioGroup value={account()} onChange={chooseAccount}>
                  <Dropdown.RadioItem
                    value="all"
                    data-email-account="all"
                    closeOnSelect
                  >
                    All inboxes
                  </Dropdown.RadioItem>
                  <For each={accounts()}>
                    {(a) => (
                      <Dropdown.RadioItem
                        value={a.id}
                        data-email-account={a.id}
                        closeOnSelect
                      >
                        {a.label}
                      </Dropdown.RadioItem>
                    )}
                  </For>
                </Dropdown.RadioGroup>
                <Show when={accountCount() < 3}>
                  <Dropdown.Item
                    onSelect={connect}
                    data-email-connect
                    closeOnSelect
                  >
                    <Plus class="size-4 shrink-0" />
                    Connect another account
                  </Dropdown.Item>
                </Show>
              </Dropdown.Content>
            </Dropdown>
          </div>
        </header>
        <Show
          when={!compose()}
          fallback={
            <div class="email-account-compose">
              <HomepageEmailCompose
                appChrome
                draft={{ subject: '', to: '', cc: '', body: '' }}
              />
            </div>
          }
        >
          <Show
            when={selected()}
            fallback={
              <>
                <nav
                  class="email-account-mobile-tabs"
                  aria-label="Mobile email tabs"
                >
                  <For
                    each={mailTabs.filter((t) =>
                      ['important', 'noise', 'all'].includes(t.id)
                    )}
                  >
                    {(t) => (
                      <button
                        type="button"
                        aria-pressed={tab() === t.id}
                        onClick={() => chooseTab(t.id)}
                      >
                        <t.icon />
                        {t.label}
                      </button>
                    )}
                  </For>
                </nav>
                <div class="email-account-search">
                  <SearchBar
                    label="Search across inboxes"
                    placeholder="Search email"
                    hotkey="cmd+f"
                    value={query()}
                    onValueChange={(value) => {
                      playback.pause();
                      setQuery(value);
                    }}
                  />
                </div>
                <div class="email-account-list">
                  <EmailRows
                    emails={emails()}
                    onOpen={(email) => {
                      playback.pause();
                      setSelected(email);
                    }}
                  />
                </div>
              </>
            }
          >
            {(email) => (
              <div class="email-account-thread">
                <EmailThread email={email()} hideHeader hideReply />
              </div>
            )}
          </Show>
        </Show>
        <Show when={(step() === 2 || step() === 4) && playback.playing()}>
          <div class="email-account-connected" role="status">
            <Check />
            Account connected
          </div>
        </Show>
      </EmailShell>
      <Show when={pointer()}>
        {(point) => (
          <DemoCursor
            class="email-demo-pointer"
            clicking={clicking()}
            style={{ transform: `translate(${point().x}px, ${point().y}px)` }}
          />
        )}
      </Show>
    </div>
  );
}
