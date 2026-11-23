import Email from '@icon/system/regular/envelope.svg';
import File from '@icon/system/regular/file.svg';
import Home from '@icon/system/regular/house.svg';
import Task from '@icon/system/regular/list-checks.svg';
import Search from '@icon/system/regular/magnifying-glass.svg';
import Agent from '@icon/system/regular/sparkle.svg';
import Chat from '@phosphor/chats-circle.svg';
import { For, Show } from 'solid-js';
import { DocMention } from '../../marketing/components/documents/DocMention';

/** Fictional work, composed with the feature pages' icons and live mention pills. */
export default function GuideWorkspaceGraphic(props: {
  kind: 'inbox' | 'search' | 'tags';
  label: string;
}) {
  const isInbox = () => props.kind === 'inbox';
  const isTags = () => props.kind === 'tags';
  const rows = () =>
    isInbox()
      ? [
          {
            icon: Email,
            title: 'Thursday demo',
            detail: 'Austin Barron · Can you send the rollout plan?',
            time: '9:41 AM',
          },
          {
            icon: Chat,
            title: 'Launch',
            detail: 'Julia mentioned you in a thread',
            time: '9:32 AM',
          },
          {
            icon: Task,
            title: 'Update the pricing page',
            detail: 'Assigned to you · In progress',
            time: '9:18 AM',
          },
          {
            icon: File,
            title: 'Rollout plan',
            detail: 'You edited this document',
            time: '9:05 AM',
          },
          {
            icon: Agent,
            title: 'Prepare for Thursday',
            detail: 'Your meeting brief is ready',
            time: '8:52 AM',
          },
        ]
      : [
          {
            icon: File,
            title: 'Rollout plan',
            detail: 'Document · Updated today',
            time: '',
          },
          {
            icon: Email,
            title: 'Thursday demo',
            detail: 'Email · Austin Barron',
            time: '',
          },
          {
            icon: Task,
            title: 'Confirm launch date',
            detail: 'Task · Julia',
            time: '',
          },
          {
            icon: Chat,
            title: 'Launch',
            detail: 'Channel · 5 members',
            time: '',
          },
        ];
  return (
    <div class="guide-workspace" role="img" aria-label={props.label}>
      <div class="guide-workspace-back">
        <div class="guide-workspace-heading">
          <Show when={isInbox()} fallback={<Search />}>
            <Home />
          </Show>
          <span>{isInbox() ? 'Home' : 'Search'}</span>
        </div>
        <Show
          when={!isInbox()}
          fallback={
            <div class="guide-workspace-tabs">
              <span>All</span>
              <span>Unread</span>
            </div>
          }
        >
          <div class="guide-workspace-query">
            <Search />
            {isTags() ? 'Search your workspace' : 'rollout'}
          </div>
          <div class="guide-workspace-tabs">
            <span>{isTags() ? 'Tags: Launch' : 'All types'}</span>
            <span>{isTags() ? 'Any' : 'People'}</span>
          </div>
        </Show>
        <div class="guide-workspace-date">
          {isInbox() ? 'Today' : 'Results'}
        </div>
        <For each={rows()}>
          {(row, index) => (
            <div class="guide-workspace-row" data-selected={index() === 0}>
              <row.icon />
              <div>
                <b>{row.title}</b>
                <small>{row.detail}</small>
              </div>
              <Show when={isTags()} fallback={<time>{row.time}</time>}>
                <span class="guide-workspace-tag">Launch</span>
              </Show>
            </div>
          )}
        </For>
      </div>
      <div class="guide-workspace-front">
        <Show
          when={isInbox()}
          fallback={
            <>
              <div class="guide-workspace-heading">
                <File />
                <span>Rollout plan</span>
              </div>
              <div class="guide-workspace-copy">
                Confirm the launch date with Austin Barron, then send the plan
                to the team.
              </div>
              <div class="guide-workspace-reference">
                <DocMention item={{ kind: 'email', label: 'Thursday demo' }} />
                <span class="guide-workspace-tag">Launch</span>
              </div>
            </>
          }
        >
          <div class="guide-workspace-heading">
            <Email />
            <span>Thursday demo</span>
          </div>
          <div class="guide-workspace-copy">
            Hi Jacob, can you send the rollout plan before Thursday?
          </div>
          <div class="guide-workspace-reference">
            <DocMention item={{ kind: 'document', label: 'Rollout plan' }} />
            <span>Austin Barron</span>
          </div>
        </Show>
      </div>
    </div>
  );
}
