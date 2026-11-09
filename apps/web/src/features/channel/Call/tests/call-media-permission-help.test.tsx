/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { expect, it, vi } from 'vitest';
import {
  CallMediaPermissionHelp,
  createCallMediaPermissionHelp,
} from '../CallMediaPermissionHelp';

const opened = vi.hoisted(() => vi.fn());
vi.mock('@core/util/platform', () => ({ isDesktopPlatform: () => true }));
vi.mock('@core/constant/isMac', () => ({ IS_MAC: true }));
vi.mock('@core/util/url', () => ({ openExternalUrl: opened }));

it.each(['camera', 'microphone'] as const)(
  'opens the correct macOS privacy pane for %s',
  async (device) => {
    const toggle = vi.fn(async () => {
      throw new DOMException('Denied', 'NotAllowedError');
    });
    let request!: ReturnType<typeof createCallMediaPermissionHelp>['request'];
    render(() => {
      const controller = createCallMediaPermissionHelp({
        microphonePermission: () => 'denied',
        cameraPermission: () => 'denied',
        toggleAudio: toggle,
        toggleVideo: toggle,
      });
      request = controller.request;
      return <CallMediaPermissionHelp controller={controller} />;
    });
    await request(device);
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Try again' })
          .hasAttribute('disabled')
      ).toBe(false)
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Open System Settings' })
    );
    expect(opened).toHaveBeenLastCalledWith(
      `x-apple.systempreferences:com.apple.preference.security?Privacy_${device === 'camera' ? 'Camera' : 'Microphone'}`
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(toggle).toHaveBeenCalledTimes(2));
    expect(toggle).toHaveBeenLastCalledWith(true);
  }
);

it('keeps camera actions available during an unanswered microphone prompt', async () => {
  let release!: () => void;
  const camera = vi.fn(async () => {});
  let controller!: ReturnType<typeof createCallMediaPermissionHelp>;
  render(() => {
    controller = createCallMediaPermissionHelp({
      toggleAudio: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      toggleVideo: camera,
    });
    return null;
  });
  const microphone = controller.request('microphone');
  await controller.request('camera');
  expect(camera).toHaveBeenCalledOnce();
  release();
  await microphone;
});

it('anchors each device to its own trigger and retains that target across retries', async () => {
  const toggle = vi.fn(async () => {
    throw new DOMException('Denied', 'NotAllowedError');
  });
  let controller!: ReturnType<typeof createCallMediaPermissionHelp>;
  const view = render(() => {
    controller = createCallMediaPermissionHelp({
      microphonePermission: () => 'denied',
      cameraPermission: () => 'denied',
      toggleAudio: toggle,
      toggleVideo: toggle,
    });
    return (
      <>
        <button>Microphone</button>
        <button>Camera</button>
        <CallMediaPermissionHelp controller={controller} />
      </>
    );
  });
  const mic = screen.getByRole('button', { name: 'Microphone' });
  const camera = screen.getByRole('button', { name: 'Camera' });
  await controller.request('microphone', false, mic);
  expect(controller.help()?.anchor).toBe(mic);
  await controller.request('camera', false, camera);
  expect(controller.help()?.anchor).toBe(camera);
  await controller.request('camera', true);
  expect(controller.help()?.anchor).toBe(camera);
  controller.close();
  expect(controller.help()).toBeUndefined();
  view.unmount();
});
