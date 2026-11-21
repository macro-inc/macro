import type { InstallFailure } from '@service-auth/generated/schemas/installFailure';
import { describe, expect, it } from 'vitest';
import { installProblemLine } from './teammate-install-problem';

describe('installProblemLine', () => {
  it('says why a failed agent stopped, naming the machine', () => {
    const line = (reason: InstallFailure) =>
      installProblemLine({ kind: 'failed', reason }, 'demo-laptop');
    expect(line('imageUnavailable')).toBe(
      "Couldn't download the agent's runtime on demo-laptop. Check its internet connection."
    );
    expect(line('imageMismatch')).toBe(
      "The runtime downloaded on demo-laptop didn't match the one Macro sent."
    );
    expect(line('engineRefused')).toBe(
      "The container engine on demo-laptop wouldn't start it. Check that it's running."
    );
    expect(line('badConfiguration')).toBe(
      "Its settings didn't apply on demo-laptop. Macro sends them once more."
    );
    expect(line('incompatibleRuntime')).toBe(
      'It needs a newer runtime image than demo-laptop has.'
    );
    expect(line('crashLoop')).toBe('It kept crashing on demo-laptop.');
    expect(line('networkIsolationUnavailable')).toBe(
      "Couldn't lock down its network on demo-laptop, so it isn't running."
    );
    expect(line('egressBlocked')).toBe(
      "demo-laptop has no route to the internet, so it isn't running. It starts once demo-laptop is back online."
    );
    expect(line('hostUnsupported')).toBe(
      "Agents can't run on demo-laptop. Move it to another computer."
    );
  });

  it('says a parked agent was stopped because its machine may no longer host it', () => {
    expect(installProblemLine({ kind: 'hostRemoved' }, 'demo-laptop')).toBe(
      "Stopped: demo-laptop's owner can no longer host it for this team. Its chats and memory are kept; its inviter or the team's owner can move it to one of their computers."
    );
  });

  it('says a rolled-back agent runs the previous version, and why', () => {
    const line = (reason: InstallFailure) =>
      installProblemLine({ kind: 'rolledBack', reason }, 'demo-laptop');
    expect(line('crashLoop')).toBe(
      'Running the previous version: the update kept crashing.'
    );
    expect(line('imageUnavailable')).toBe(
      "Running the previous version: the update couldn't be downloaded."
    );
    expect(line('incompatibleRuntime')).toBe(
      "Running the previous version: the update didn't start."
    );
  });

  it('says nothing without a problem', () => {
    expect(installProblemLine(undefined, 'demo-laptop')).toBeUndefined();
    expect(installProblemLine(null, 'demo-laptop')).toBeUndefined();
  });
});
