import '@fontsource-variable/inter';
import '../../../index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { ImperativeDialogHost } from '@ui';
import type { Client } from '@urql/core';
import { ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import type { EntryPerson } from '../components/entry-list';
import { TimeTrackingContextProvider } from '../context/time-tracking-context';
import type { RunningTimerState } from '../primitives/running-timer';
import { TaskTimeSheet } from '../views/mobile/task-time-sheet';

const light = new URLSearchParams(location.search).get('theme') !== 'dark';
const theme = light ? macroLightTheme : macroDarkTheme;
for (const [token, value] of Object.entries(theme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
document.documentElement.dataset.themeLight = String(light);
document.documentElement.dataset.touchDevice = String(isTouchDevice());

const VIEWER = 'macro|viewer@example.com';

const PERSON: EntryPerson = {
  avatar: () => <span class="block size-4 rounded-full bg-ink-muted" />,
  name: (userId) => (userId === VIEWER ? 'Ada Example' : 'Ben Example'),
};

const committed = () =>
  Promise.resolve(ok({ kind: 'committed' as const, data: undefined }));

const TIMER: RunningTimerState = {
  timer: () => undefined,
  seconds: () => 0,
  now: () => Date.now(),
  pending: () => false,
  busy: () => false,
  offline: () => false,
  start: committed,
  stop: committed,
  discard: committed,
  exclusive: (run) =>
    run({ start: committed, stop: committed, discard: committed }),
};

const root = document.getElementById('root');
if (root) {
  render(
    () => (
      <TimeTrackingContextProvider
        value={{
          client: () => ({}) as Client,
          cacheHost: () => undefined,
          viewerId: () => VIEWER,
          runningTimer: TIMER,
        }}
      >
        <TaskTimeSheet
          taskId="task-1"
          minutes={70}
          canEdit
          person={PERSON}
          open
          onOpenChange={() => {}}
        />
        <ImperativeDialogHost />
      </TimeTrackingContextProvider>
    ),
    root
  );
}
