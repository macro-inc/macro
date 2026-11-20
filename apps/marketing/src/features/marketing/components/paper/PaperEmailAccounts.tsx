import AtIcon from '@icon/system/regular/at.svg';
import ChevronIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import MailIcon from '@icon/system/regular/envelope.svg';
import FilterIcon from '@icon/system/regular/funnel.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import InboxIcon from '@icon/system/regular/tray.svg';
import { For } from 'solid-js';
import { demoEmails } from '../../core/demo-email';
import './paper-email-accounts.css';

/** An unframed inbox and its open account menu, using the database art's scale. */
export function PaperEmailAccounts() {
  return (
    <div class="paper-email-accounts">
      <div class="email-accounts-art-bar">
        <strong>Mail</strong>
        <span class="email-accounts-art-tab">Inbox</span>
        <span class="email-accounts-art-tools">
          <FilterIcon />
          <SearchIcon />
        </span>
        <span class="email-accounts-art-scope">
          <InboxIcon />
          All inboxes
          <ChevronIcon />
        </span>
      </div>
      <div class="email-accounts-art-menu">
        <div class="email-accounts-art-selected">
          <InboxIcon />
          <span>All inboxes</span>
          <CheckIcon />
        </div>
        <div>
          <span class="email-accounts-art-avatar">A</span>
          <span>alex@example.com</span>
        </div>
        <div>
          <span class="email-accounts-art-avatar">A</span>
          <span>alex@example.org</span>
        </div>
        <div>
          <AtIcon />
          <span>billing@example.com</span>
          <small>alias</small>
        </div>
        <div class="email-accounts-art-connect">
          <PlusIcon />
          <span>Connect another account</span>
        </div>
      </div>
      <div class="email-accounts-art-messages">
        <For each={demoEmails.slice(0, 6)}>
          {(email) => (
            <div class="email-accounts-art-row">
              <MailIcon />
              <div class="email-accounts-art-message">
                <div class="email-accounts-art-sender">
                  <span>{email.sender}</span>
                  <time>{email.time}</time>
                </div>
                <div class="email-accounts-art-subject">{email.subject}</div>
                <div class="email-accounts-art-preview">{email.snippet}</div>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
