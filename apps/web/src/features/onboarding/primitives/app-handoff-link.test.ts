import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppHandoff } from '../core/app-handoff';
import {
  createAppHandoffLink,
  REMINT_AFTER_MS,
  REMINT_AFTER_OPEN_MS,
} from './app-handoff-link';

const HANDOFF: AppHandoff = {
  challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  handoffId: '01938f2e-7c4a-7b3e-9a51-2f6d8c0e4b17',
  savedAt: 0,
  signedOut: true,
};

const hrefFor = (code: string) =>
  `macro:///login?token=${code}&app_handoff=${HANDOFF.handoffId}`;

function setup(codes: (string | undefined)[]) {
  const mint = vi.fn(async () => codes.shift());
  let dispose!: () => void;
  const handoff = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return createAppHandoffLink({ mintAppSessionCode: mint }, HANDOFF);
  });
  return { handoff, mint, dispose };
}

describe('createAppHandoffLink', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mints a link at once and a new one before the code lapses', async () => {
    const { handoff, mint, dispose } = setup(['one', 'two']);
    expect(handoff.link()).toEqual({ t: 'minting' });
    await vi.advanceTimersByTimeAsync(0);
    expect(handoff.link()).toEqual({ t: 'ready', href: hrefFor('one') });
    expect(mint).toHaveBeenCalledWith(HANDOFF);

    await vi.advanceTimersByTimeAsync(REMINT_AFTER_MS);
    expect(handoff.link()).toEqual({ t: 'ready', href: hrefFor('two') });
    dispose();
  });

  it("counts the code's life from the request, not the answer", async () => {
    const mint = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 90_000));
      return mint.mock.calls.length === 1 ? 'slow' : 'next';
    });
    let dispose!: () => void;
    const handoff = createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return createAppHandoffLink({ mintAppSessionCode: mint }, HANDOFF);
    });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(handoff.link()).toEqual({ t: 'ready', href: hrefFor('slow') });
    // The renewal starts once the code is four minutes past its request.
    await vi.advanceTimersByTimeAsync(REMINT_AFTER_MS - 90_000);
    expect(mint).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('mints again shortly after the link is opened', async () => {
    const { handoff, mint, dispose } = setup(['one', 'two']);
    await vi.advanceTimersByTimeAsync(0);
    handoff.opened();
    // The browser follows the link it was given before it changes.
    expect(handoff.link()).toEqual({ t: 'ready', href: hrefFor('one') });
    await vi.advanceTimersByTimeAsync(REMINT_AFTER_OPEN_MS);
    expect(handoff.link()).toEqual({ t: 'ready', href: hrefFor('two') });
    expect(mint).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('reports a failed mint and recovers on retry', async () => {
    const { handoff, dispose } = setup([undefined, 'two']);
    await vi.advanceTimersByTimeAsync(0);
    expect(handoff.link()).toEqual({ t: 'failed' });
    handoff.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(handoff.link()).toEqual({ t: 'ready', href: hrefFor('two') });
    dispose();
  });

  it('stops minting once disposed', async () => {
    const { mint, dispose } = setup(['one', 'two']);
    await vi.advanceTimersByTimeAsync(0);
    dispose();
    await vi.advanceTimersByTimeAsync(REMINT_AFTER_MS * 2);
    expect(mint).toHaveBeenCalledTimes(1);
  });
});

describe('createAppHandoffLink in a hidden page', () => {
  let visibility: DocumentVisibilityState = 'visible';
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
      () => visibility
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const show = (state: DocumentVisibilityState) => {
    visibility = state;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('mints nothing while hidden, and a fresh code on return', async () => {
    const { handoff, mint, dispose } = setup(['one', 'two', 'three']);
    await vi.advanceTimersByTimeAsync(0);
    // The app opened: the browser went to the background.
    handoff.opened();
    show('hidden');
    await vi.advanceTimersByTimeAsync(REMINT_AFTER_MS * 3);
    expect(mint).toHaveBeenCalledTimes(1);

    show('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(handoff.link()).toEqual({ t: 'ready', href: hrefFor('two') });
    expect(mint).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('keeps a code that is still fresh when the page comes back', async () => {
    const { mint, dispose } = setup(['one', 'two']);
    await vi.advanceTimersByTimeAsync(0);
    show('hidden');
    show('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(mint).toHaveBeenCalledTimes(1);
    dispose();
  });
});
