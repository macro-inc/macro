import { Telemetry } from '@macro-inc/observability';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeMediaAccess } from '../tests/fake-media';
import { createMeetingMedia } from './meeting-media';

afterEach(() => vi.restoreAllMocks());

describe('waiting-room media telemetry', () => {
  it('distinguishes blocked microphone access from an allowed camera left off', async () => {
    const microphoneSpan = Telemetry.span('microphone');
    const cameraSpan = Telemetry.span('camera');
    const attributes = vi.spyOn(microphoneSpan, 'setAttr');
    const errors = vi.spyOn(microphoneSpan, 'error');
    const ended = vi.spyOn(microphoneSpan, 'end');
    const cameraAttributes = vi.spyOn(cameraSpan, 'setAttr');
    const cameraEnded = vi.spyOn(cameraSpan, 'end');
    vi.spyOn(Telemetry, 'span')
      .mockReturnValueOnce(microphoneSpan)
      .mockReturnValueOnce(cameraSpan);
    const { request } = fakeMediaAccess();
    request.mockRejectedValueOnce(
      new DOMException('private device info', 'NotAllowedError')
    );
    const { media, dispose } = createRoot((dispose) => ({
      media: createMeetingMedia({ request }),
      dispose,
    }));
    try {
      await media.prepare();
      expect(media.diagnostics()).toEqual({
        setupId: expect.any(String),
        microphone: 'blocked',
        camera: 'granted',
      });
      expect(attributes).toHaveBeenCalledWith(
        'meeting.setup.id',
        media.diagnostics().setupId
      );
      expect(attributes).toHaveBeenCalledWith('error.type', 'NotAllowedError');
      expect(errors).toHaveBeenCalledExactlyOnceWith(
        'Call media operation failed: NotAllowedError'
      );
      expect(cameraAttributes).toHaveBeenCalledWith(
        'call.media.retained',
        false
      );
      expect(ended).toHaveBeenCalledOnce();
      expect(cameraEnded).toHaveBeenCalledOnce();
      expect(media.microphoneEnabled()).toBe(false);
      expect(media.cameraEnabled()).toBe(false);
      expect(JSON.stringify(attributes.mock.calls)).not.toContain(
        'private device info'
      );
    } finally {
      dispose();
    }
  });

  it('ends pending spans on navigation and ignores late denials', async () => {
    const span = Telemetry.span('capture');
    const attributes = vi.spyOn(span, 'setAttr');
    const errors = vi.spyOn(span, 'error');
    const ended = vi.spyOn(span, 'end');
    vi.spyOn(Telemetry, 'span').mockReturnValue(span);
    let reject!: (reason: unknown) => void;
    let started!: () => void;
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    const request = vi.fn(
      () =>
        new Promise<MediaStream>((_resolve, fail) => {
          reject = fail;
          started();
        })
    );
    const { media, dispose } = createRoot((dispose) => ({
      media: createMeetingMedia({ request }),
      dispose,
    }));
    const preparing = media.prepare();
    await requested;
    dispose();
    expect(ended).toHaveBeenCalledOnce();
    expect(attributes).toHaveBeenCalledWith('call.media.outcome', 'cancelled');
    reject(new DOMException('Late denial', 'NotAllowedError'));
    await preparing;
    expect(media.diagnostics().microphone).toBe('cancelled');
    expect(errors).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
  });

  it('records granted access after retrying a denied device', async () => {
    const { request } = fakeMediaAccess();
    request.mockRejectedValueOnce(
      new DOMException('Denied', 'NotAllowedError')
    );
    const { media, dispose } = createRoot((dispose) => ({
      media: createMeetingMedia({ request }),
      dispose,
    }));
    try {
      await media.prepare();
      const setupId = media.diagnostics().setupId;
      expect(media.diagnostics().microphone).toBe('blocked');
      // Retry via prepare to await the same serialized capture path as controls.
      await media.prepare();
      expect(media.diagnostics()).toEqual({
        setupId,
        microphone: 'granted',
        camera: 'granted',
      });
      expect(media.microphoneEnabled()).toBe(false);
    } finally {
      dispose();
    }
  });
});
