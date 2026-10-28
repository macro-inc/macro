import Reply from '@phosphor/arrow-bend-up-left.svg';
import Envelope from '@phosphor/envelope.svg';
import File from '@phosphor/file.svg';
import Hash from '@phosphor/hash.svg';
import ListChecks from '@phosphor/list-checks.svg';
import Table from '@phosphor/table.svg';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { WorkspaceView } from '../../core/dummy-workspace';
import { homepagePeople } from '../../core/homepage-demo-people';
import {
  type HomeFeedItem,
  sampleHomeFeed,
} from '../../core/workspace-home-feed';
import { sampleAgentSessions } from '../../core/workspace-parity-fixtures';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { ViewSidebar } from '../DemoViewSidebar';
import { ModelIcon } from './frozen/model-picker/ProviderIcon';

export function WorkspaceHomeFeed(props: {
  workspace: DummyWorkspace;
  navigate: (view: WorkspaceView, id?: string) => void;
}) {
  const w = props.workspace;
  const title = (item: HomeFeedItem) =>
    item.title ??
    (item.view === 'tasks'
      ? w.data.tasks.find((task) => task.id === item.id)?.title
      : item.view === 'email'
        ? w.data.emails.find((email) => email.id === item.id)?.subject
        : w.data.documents.find((doc) => doc.id === item.id)?.title);
  const icon = (item: HomeFeedItem) =>
    item.thread
      ? Reply
      : item.view === 'messages'
        ? Hash
        : item.view === 'email'
          ? Envelope
          : item.view === 'tasks'
            ? ListChecks
            : item.view === 'spreadsheet'
              ? Table
              : File;
  const active = (item: HomeFeedItem) =>
    w.contentView() === item.view &&
    (item.view === 'messages'
      ? w.channel() === item.id && w.channelThread() === item.thread
      : w.selected() === item.id);
  return (
    <For each={sampleHomeFeed}>
      {(group) => (
        <section>
          <p class="px-2 text-xs text-ink-muted mb-3">{group.title}</p>
          <ViewSidebar.Nav>
            <For each={group.items}>
              {(item) => (
                <ViewSidebar.Item
                  active={active(item)}
                  title={title(item)}
                  onClick={() => {
                    props.navigate(item.view, item.id);
                    if (item.view === 'messages') {
                      w.setChannel(item.id);
                      w.setChannelThread(item.thread);
                    }
                  }}
                >
                  <Show
                    when={item.person}
                    fallback={
                      <ViewSidebar.Icon>
                        <Show
                          when={item.view === 'agents'}
                          fallback={<Dynamic component={icon(item)} />}
                        >
                          <ModelIcon
                            provider={
                              sampleAgentSessions.find(
                                (session) => session.id === item.id
                              )?.provider
                            }
                            class="size-5 text-ink-muted"
                          />
                        </Show>
                      </ViewSidebar.Icon>
                    }
                  >
                    {(person) => (
                      <img
                        class="size-5 shrink-0 rounded-full"
                        src={homepagePeople[person()].photo}
                        alt=""
                      />
                    )}
                  </Show>
                  <span class="truncate">{title(item)}</span>
                </ViewSidebar.Item>
              )}
            </For>
          </ViewSidebar.Nav>
        </section>
      )}
    </For>
  );
}
