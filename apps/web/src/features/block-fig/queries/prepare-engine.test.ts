import { FigEngine } from '@core/fig-engine/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileFingerprint } from '../core/collab-entries';
import { prepareFigEngine } from './prepare-engine';

vi.mock('@core/fig-engine/client', () => ({ FigEngine: { open: vi.fn() } }));
vi.mock('../core/collab-entries', () => ({ fileFingerprint: vi.fn() }));

afterEach(() => vi.resetAllMocks());

function setup() {
  const engine = { close: vi.fn() } as unknown as FigEngine;
  vi.mocked(FigEngine.open).mockResolvedValue(engine);
  vi.mocked(fileFingerprint).mockResolvedValue('fingerprint');
  return engine;
}

describe('preparing a design while sync connects', () => {
  it('opens immediately and transfers ownership only once', async () => {
    const engine = setup();
    const opening = prepareFigEngine(new ArrayBuffer(0));
    expect(FigEngine.open).toHaveBeenCalledTimes(1);
    expect(fileFingerprint).toHaveBeenCalledTimes(1);
    expect((await opening.take(vi.fn())).engine).toBe(engine);
    await opening.dispose();
    expect(engine.close).not.toHaveBeenCalled();
  });

  it('releases an abandoned open after it finishes', async () => {
    const engine = setup();
    let finish!: (engine: FigEngine) => void;
    vi.mocked(FigEngine.open).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const opening = prepareFigEngine(new ArrayBuffer(0));
    const disposed = opening.dispose();
    finish(engine);
    await disposed;
    expect(engine.close).toHaveBeenCalledTimes(1);
    await expect(opening.take(vi.fn())).rejects.toThrow('closed');
  });

  it('opens a fresh engine when a replacement shared document mounts', async () => {
    setup();
    const opening = prepareFigEngine(new ArrayBuffer(0));
    await opening.take(vi.fn());
    await opening.take(vi.fn());
    expect(FigEngine.open).toHaveBeenCalledTimes(2);
    await opening.dispose();
  });

  it('closes the engine if fingerprinting fails', async () => {
    const engine = setup();
    vi.mocked(fileFingerprint).mockRejectedValue(new Error('hash failed'));
    const opening = prepareFigEngine(new ArrayBuffer(0));
    await expect(opening.take(vi.fn())).rejects.toThrow('hash failed');
    expect(engine.close).toHaveBeenCalledTimes(1);
    await opening.dispose();
  });
});
