import { createSignal, Match, Show, Switch } from 'solid-js';
import type { WorkspaceComment } from '../../core/dummy-workspace';
import { ProductDemo } from '../product/ProductPage';
import { WorkspaceDesktopDemo } from '../WorkspaceDesktopDemo';
import {
  ChannelCallsList,
  ChannelMessages,
  ChannelParticipants,
  type ChannelTab,
  ChannelTopBar,
} from './CallChannel';
import {
  CallRecordBody,
  CallRecordTopBar,
  createCallPlayback,
} from './CallRecord';
import { createCallSession } from './CallSession';
import { rolloutCheckIn, rolloutPlanning } from './call-fixtures';

/** One call, live and saved. Scene controls belong to the tour, outside the app. */
export function CallHeroDemo() {
  const [ended, setEnded] = createSignal(false);
  const [channelTab, setChannelTab] = createSignal<ChannelTab>('call');
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [messages, setMessages] = createSignal<WorkspaceComment[]>([
    {
      id: 'training',
      person: 'teo',
      body: 'Anyone free for a quick call?',
      time: '9:20 AM',
    },
    {
      id: 'owner',
      person: 'julia',
      body: 'Yep, I’m here.',
      time: '9:24 AM',
    },
  ]);
  const session = createCallSession(
    [{ person: 'julia' }, { person: 'teo' }],
    rolloutCheckIn.chat
  );
  const historyPlayer = createCallPlayback(rolloutPlanning.duration);
  const player = createCallPlayback(rolloutCheckIn.duration);
  const showAgent = () =>
    document
      .getElementById('call-followup')
      ?.scrollIntoView({ block: 'start' });
  const choose = (value: boolean) => {
    player.pause();
    historyPlayer.pause();
    setHistoryOpen(false);
    setChannelTab('call');
    setEnded(value);
  };
  return (
    <div class="calls-hero-story">
      <div
        class="calls-scene-picker"
        role="group"
        aria-label="Explore the sample call"
      >
        <button
          type="button"
          aria-pressed={!ended()}
          onClick={() => choose(false)}
        >
          In the call
        </button>
        <button
          type="button"
          aria-pressed={ended()}
          onClick={() => choose(true)}
        >
          After the call
        </button>
      </div>
      <WorkspaceDesktopDemo
        heroFrame
        view="messages"
        label="Explore Macro Calls"
      >
        <ProductDemo label="Training call">
          <Show
            when={ended() || historyOpen()}
            fallback={
              <>
                <ChannelTopBar
                  tab={channelTab()}
                  onTab={(value) => {
                    setChannelTab(value);
                  }}
                  live
                  onAsk={showAgent}
                />
                <Switch>
                  <Match when={channelTab() === 'call'}>
                    {session.view({
                      time: '9:37 AM',
                      onLeave: () => choose(true),
                    })}
                  </Match>
                  <Match when={channelTab() === 'messages'}>
                    <ChannelMessages
                      messages={messages()}
                      onSend={(body) =>
                        setMessages((items) => [
                          ...items,
                          {
                            id: `sent-${items.length}`,
                            person: 'jacob',
                            body,
                            time: '9:37 AM',
                          },
                        ])
                      }
                    />
                  </Match>
                  <Match when={channelTab() === 'participants'}>
                    <ChannelParticipants people={['jacob', 'teo', 'julia']} />
                  </Match>
                  <Match when={channelTab() === 'attachments'}>
                    <p class="call-empty">No attachments yet.</p>
                  </Match>
                  <Match when={channelTab() === 'calls'}>
                    <ChannelCallsList
                      rows={[
                        {
                          id: 'planning',
                          title: rolloutPlanning.title,
                          transcript: rolloutPlanning.segments
                            .map((segment) => segment.text)
                            .join(' '),
                          summary: 'Training is Thursday at 10.',
                          status: 'attended',
                          duration: '14m 10s',
                          people: ['jacob', 'teo', 'julia'],
                          time: 'Yesterday',
                        },
                      ]}
                      search={search()}
                      onSearch={setSearch}
                      onOpen={() => setHistoryOpen(true)}
                    />
                  </Match>
                </Switch>
              </>
            }
          >
            <CallRecordTopBar
              onCallAgain={() => choose(false)}
              onAsk={showAgent}
              title={
                historyOpen() ? rolloutPlanning.title : rolloutCheckIn.title
              }
              onBack={() => {
                player.pause();
                historyPlayer.pause();
                if (historyOpen()) setHistoryOpen(false);
                else choose(false);
              }}
            />
            <CallRecordBody
              call={
                historyOpen()
                  ? rolloutPlanning
                  : { ...rolloutCheckIn, chat: session.chat() }
              }
              playback={historyOpen() ? historyPlayer : player}
              transcriptHeight={300}
              class="call-record-compact"
            />
          </Show>
        </ProductDemo>
      </WorkspaceDesktopDemo>
    </div>
  );
}
