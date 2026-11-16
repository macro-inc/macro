import FilterIcon from '@icon/system/regular/funnel.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SplitIcon from '@icon/system/regular/square-split-horizontal.svg';
import { For } from 'solid-js';
import { homepagePeople } from '../../../core/homepage-demo-people';
import './email-view-bar.css';

export type InboxTab = 'signal' | 'noise';

const tabs: { id: InboxTab; label: string }[] = [
  { id: 'signal', label: 'Signal' },
  { id: 'noise', label: 'Noise' },
];

/**
 * The email view's header: the Signal and Noise tabs, then the inbox, filter,
 * split, New, and search controls. Only the tabs act, and only when `onTab`
 * is given; the rest is presentation.
 */
export function EmailViewBar(props: {
  tab: InboxTab;
  onTab?: (tab: InboxTab) => void;
}) {
  return (
    <header class="mail-view-bar">
      <div class="mail-view-tabs" role="group" aria-label="Inbox tab">
        <For each={tabs}>
          {(item) => (
            <button
              type="button"
              aria-pressed={props.tab === item.id}
              tabIndex={props.onTab ? undefined : -1}
              onClick={() => props.onTab?.(item.id)}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>
      <div class="mail-view-controls" aria-hidden="true">
        <span class="mail-view-inboxes">
          <img src={homepagePeople.jacob.photo} alt="" />
          <i>S</i>
        </span>
        <span>
          <FilterIcon />
        </span>
        <span class="mail-view-split">
          <SplitIcon />
        </span>
        <span class="mail-view-new">
          <PlusIcon />
          New
        </span>
        <span>
          <SearchIcon />
        </span>
      </div>
    </header>
  );
}
