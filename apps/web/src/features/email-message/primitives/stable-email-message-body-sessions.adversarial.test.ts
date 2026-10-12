/**
 * Round-2 adversarial tests for the stable email body primitive's fixes:
 * keeping the accepted body when the cache goes away, bounded re-acquisition
 * after AbortError, and skipping identical re-renders.
 */
import { directExecutor } from '@app/lib/email-render-cache/executor';
import { EmailRenderCache } from '@app/lib/email-render-cache/service';
import {
  type PreparedEmailBody,
  prepareEmailBody,
} from '@macro-inc/email-renderer';
import type { ThemeColorParams } from '@macro-inc/email-renderer/browser';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EmailPreparation,
  PreparedEmailLease,
} from '../context/email-preparation';
import type { EmailMessage } from '../core/email-message';
import { message } from '../tests/messages';
import { createStableEmailMessageBody } from './stable-email-message-body';

const theme: ThemeColorParams = {
  inkL: 0.2,
  inkC: 0,
  inkH: 0,
  panelL: 1,
  accentL: 0.6,
  accentC: 0.1,
  accentH: 50,
};

interface Job {
  service: string;
  request: Parameters<EmailPreparation['acquire']>[0];
  resolve(body?: PreparedEmailBody): void;
  reject(error: unknown): void;
  releases: number;
}

/** A session cache whose preparations complete only when the test says so. */
function controllable(name: string, jobs: Job[]): EmailPreparation {
  return {
    acquire(request) {
      const { promise, resolve, reject } =
        Promise.withResolvers<PreparedEmailBody>();
      void promise.catch(() => {});
      const job: Job = {
        service: name,
        request,
        resolve: (body) =>
          resolve(body ?? prepareEmailBody(request.input, request.options)),
        reject,
        releases: 0,
      };
      jobs.push(job);
      return {
        ready: undefined,
        promise,
        promote() {},
        release() {
          job.releases++;
        },
      } satisfies PreparedEmailLease;
    },
  };
}

function mountBody(
  msg: () => EmailMessage,
  preparation: () => EmailPreparation | undefined,
  canRender: () => boolean = () => true
) {
  return createRoot((dispose) => ({
    dispose,
    ...createStableEmailMessageBody(
      {
        get message() {
          return msg();
        },
        isPersonal: true,
        isBodyExpanded: () => true,
        setExpandedMessageBody() {},
        setFocusedMessageId() {},
        isFocused: false,
      },
      {
        canRender,
        theme: () => theme,
        resolveImages: async () => {},
        get preparation() {
          return preparation();
        },
      }
    ),
  }));
}

const flush = async (rounds = 6) => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

const QUOTED =
  '<p>Hello</p><div class="macro_quote"><p>Quoted thread</p></div>';

describe('keeping the accepted body when the cache goes away', () => {
  it('holds (failed before the concurrent setPending(false) fix): a re-acquire in flight when the cache disappears must not leave the body pending forever ("..." disabled)', async () => {
    const jobs: Job[] = [];
    const sessionA = controllable('A', jobs);
    const sessionB = controllable('B', jobs);
    const [preparation, setPreparation] = createSignal<
      EmailPreparation | undefined
    >(sessionA);
    const msg = message('one', { body_html_sanitized: QUOTED });
    const app = mountBody(() => msg, preparation);
    try {
      jobs[0].resolve();
      await flush();
      const host = app.host();
      expect(host).toBeDefined();
      expect(app.isPending()).toBe(false);
      expect(app.hasHiddenReplyStructure()).toBe(true);

      // A 'local' invalidation (websocket delete) rebinds the session: the
      // body re-acquires the same request from the new, empty cache.
      setPreparation(sessionB);
      expect(jobs).toHaveLength(2);
      expect(app.isPending()).toBe(true);

      // Before it resolves, the cache goes away: another tab signed out (the
      // pinned identity), the new session's connect check reports the
      // sign-out, or the flag turns off.
      setPreparation(undefined);
      await flush();

      // The displayed body is correctly kept...
      expect(app.host()).toBe(host);
      // ...but it still reports pending, so the view keeps aria-busy and the
      // "..." quote button (disabled={isPending()}) can never be used.
      expect(app.isPending(), 'pending never clears').toBe(false);
    } finally {
      app.dispose();
    }
  });

  it('holds: an abandoned re-acquire that resolves later does not reinstate pending', async () => {
    const jobs: Job[] = [];
    const sessionA = controllable('A', jobs);
    const sessionB = controllable('B', jobs);
    const [preparation, setPreparation] = createSignal<
      EmailPreparation | undefined
    >(sessionA);
    const msg = message('one', { body_html_sanitized: QUOTED });
    const app = mountBody(() => msg, preparation);
    try {
      jobs[0].resolve();
      await flush();
      setPreparation(sessionB);
      setPreparation(undefined);
      await flush();
      // Let any straggler for the abandoned lease settle too.
      jobs[1].resolve();
      await flush();
      expect(app.isPending()).toBe(false);
    } finally {
      app.dispose();
    }
  });
});

describe('AbortError re-acquisition', () => {
  it('two mounted consumers of one message with different sources both show their own body, as main did', async () => {
    // e.g. the same thread open in two splits while one split's thread query
    // has already refetched an edited body and the other has not.
    const cache = new EmailRenderCache({ executor: directExecutor });
    const older = message('one', { body_html_sanitized: '<p>Older copy</p>' });
    const newer = message('one', { body_html_sanitized: '<p>Newer copy</p>' });
    const left = mountBody(
      () => older,
      () => cache
    );
    const right = mountBody(
      () => newer,
      () => cache
    );
    const acquire = vi.spyOn(cache, 'acquire');
    try {
      await vi.waitFor(
        () => {
          expect(left.isPending()).toBe(false);
          expect(right.isPending()).toBe(false);
        },
        { timeout: 2000 }
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const shown = (body: typeof left) =>
        body.host()?.shadowRoot?.textContent ??
        (body.isError() ? '<<Retry>>' : '<<Loading…>>');
      const outcome = {
        left: shown(left),
        right: shown(right),
        reacquisitions: acquire.mock.calls.length,
      };
      // At least each body must show its own content (main prepared both
      // synchronously); neither may be stranded behind "Retry".
      expect(outcome).toEqual({
        left: expect.stringContaining('Older copy'),
        right: expect.stringContaining('Newer copy'),
        reacquisitions: expect.any(Number),
      });
    } finally {
      left.dispose();
      right.dispose();
      cache.dispose();
    }
  });
});

describe('stale body after the request changes', () => {
  it('an edited body that exhausts its abort budget is prepared directly and shown', async () => {
    const jobs: Job[] = [];
    const cache = controllable('A', jobs);
    const [msg, setMsg] = createSignal(
      message('one', { body_html_sanitized: '<p>Version 1</p>' })
    );
    const app = mountBody(msg, () => cache);
    const abort = () =>
      new DOMException('Email preparation cancelled', 'AbortError');
    try {
      jobs[0].resolve();
      await flush();
      expect(app.host()?.shadowRoot?.textContent).toContain('Version 1');
      // The thread refetches an edited body (or a sync upsert lands).
      setMsg({ ...msg(), body_html_sanitized: '<p>Version 2</p>' });
      // Each attempt is cancelled (another consumer keeps rebinding the
      // source, or sessions keep turning over): 1 + 3 retries.
      for (let attempt = 1; attempt <= 4; attempt++) {
        await vi.waitFor(() => expect(jobs.length).toBeGreaterThan(attempt));
        jobs[attempt].reject(abort());
        await flush();
      }
      // After the abort budget the body prepares directly, as without the
      // cache, so the current version is shown rather than a stale one.
      await vi.waitFor(() =>
        expect(app.host()?.shadowRoot?.textContent).toContain('Version 2')
      );
      expect(app.isError()).toBe(false);
    } finally {
      app.dispose();
    }
  });
});

describe('epoch storms (bulk delete -> many local invalidations)', () => {
  it('holds: 25 session swaps while mounted keep the same host, never blank, release every lease, and settle', async () => {
    const jobs: Job[] = [];
    const sessions = Array.from({ length: 26 }, (_, index) =>
      controllable(`S${index}`, jobs)
    );
    const [preparation, setPreparation] = createSignal<
      EmailPreparation | undefined
    >(sessions[0]);
    const msg = message('one', { body_html_sanitized: QUOTED });
    const app = mountBody(() => msg, preparation);
    try {
      jobs[0].resolve();
      await flush();
      const host = app.host();
      expect(host).toBeDefined();
      let blanks = 0;
      for (let index = 1; index < sessions.length; index++) {
        setPreparation(sessions[index]);
        // The previous session was disposed: its pending lease is cancelled.
        jobs[index - 1]?.reject(
          new DOMException('Email preparation cancelled', 'AbortError')
        );
        await flush(2);
        if (app.host() !== host) blanks++;
      }
      jobs.at(-1)!.resolve();
      await flush();
      expect(blanks).toBe(0);
      expect(app.host()).toBe(host);
      expect(app.isPending()).toBe(false);
      expect(app.isError()).toBe(false);
      // One acquisition per session, no abort-driven extras.
      expect(jobs).toHaveLength(sessions.length);
      // Only the displayed lease remains held.
      expect(jobs.filter((job) => job.releases === 0)).toHaveLength(1);
    } finally {
      app.dispose();
    }
    expect(jobs.filter((job) => job.releases === 0)).toHaveLength(0);
  });
});
