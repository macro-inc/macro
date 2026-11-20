import { describe, expect, it } from 'vitest';
import { installFailureLine } from './teammate-install-failure';

describe('installFailureLine', () => {
  it('says why a failed agent stopped, naming the machine', () => {
    expect(
      installFailureLine('imageUnavailable', 'failed', 'demo-laptop')
    ).toBe(
      "demo-laptop couldn't download the agent's runtime. Check its internet connection."
    );
    expect(installFailureLine('imageMismatch', 'failed', 'demo-laptop')).toBe(
      "The runtime demo-laptop downloaded didn't match the one Macro sent."
    );
    expect(installFailureLine('engineRefused', 'failed', 'demo-laptop')).toBe(
      "demo-laptop's container engine wouldn't start it. Check that it's running."
    );
    expect(
      installFailureLine('badConfiguration', 'unhealthy', 'demo-laptop')
    ).toBe("Its settings didn't apply on demo-laptop.");
    expect(
      installFailureLine('incompatibleRuntime', 'failed', 'demo-laptop')
    ).toBe('It needs a newer runtime image than demo-laptop has.');
    expect(installFailureLine('crashLoop', 'failed', 'demo-laptop')).toBe(
      'It kept crashing on demo-laptop.'
    );
    expect(installFailureLine('hostUnsupported', 'failed', 'demo-laptop')).toBe(
      "demo-laptop can't run agents. Move it to another computer."
    );
  });

  it('says a running agent went back to the previous version, and why', () => {
    expect(installFailureLine('crashLoop', 'running', 'demo-laptop')).toBe(
      'Running the previous version: the update kept crashing.'
    );
    expect(
      installFailureLine('imageUnavailable', 'starting', 'demo-laptop')
    ).toBe("Running the previous version: the update couldn't be downloaded.");
    expect(
      installFailureLine('incompatibleRuntime', 'running', 'demo-laptop')
    ).toBe("Running the previous version: the update didn't start.");
  });

  it('says nothing without a failure', () => {
    expect(
      installFailureLine(undefined, 'failed', 'demo-laptop')
    ).toBeUndefined();
    expect(
      installFailureLine(undefined, 'running', 'demo-laptop')
    ).toBeUndefined();
  });
});
