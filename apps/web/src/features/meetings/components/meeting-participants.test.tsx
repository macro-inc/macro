import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import {
  MeetingParticipants,
  type MeetingParticipantsState,
} from './meeting-participants';

afterEach(cleanup);

it('updates connected names and distinguishes an empty room from a failed lookup', () => {
  const [state, setState] = createSignal<MeetingParticipantsState>({
    kind: 'loading',
  });
  render(() => <MeetingParticipants state={state()} />);
  expect(screen.getByText('Checking who’s here…')).toBeTruthy();
  expect(screen.queryByText('No one else is here yet')).toBeNull();
  setState({
    kind: 'ready',
    participants: [
      { displayName: 'Alex Rivera', avatarUrl: null },
      { displayName: 'Sam Chen', avatarUrl: null },
    ],
  });
  expect(screen.getByText('2 people in this call')).toBeTruthy();
  expect(screen.getByText('Alex Rivera, Sam Chen')).toBeTruthy();
  setState({
    kind: 'ready',
    participants: [{ displayName: 'Sam Chen', avatarUrl: null }],
  });
  expect(screen.getByText('1 person in this call')).toBeTruthy();
  expect(screen.queryByText('Alex Rivera, Sam Chen')).toBeNull();
  setState({ kind: 'ready', participants: [] });
  expect(screen.getByText('No one else is here yet')).toBeTruthy();
  setState({ kind: 'unavailable' });
  expect(screen.queryByText('No one else is here yet')).toBeNull();
  expect(
    screen.getByText('Couldn’t load participants. You can still join.')
  ).toBeTruthy();
});
