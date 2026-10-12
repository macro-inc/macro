import type { EmailBodyOpenObserver } from '@app/features/email-message/context/body-open';
import type { EmailBodyShown } from '@app/features/email-message/context/email-rendering-context';
import {
  startUiOperation,
  type UiOperation,
} from '../../../observability/ui-operation';

type Source = EmailBodyShown['source'];

const SEEN_LIMIT = 5_000;
// Thread ids opened in this page load; only `email.thread.repeat` leaves the tab.
const seen = new Set<string>();

export interface ThreadOpenRollout {
  arm(): string | undefined;
  enabled(): boolean;
}

/**
 * One `email.thread.open` UI operation per opened thread: from the input that
 * opened it (when there was one) to the paint after its data arrived and every
 * HTML body that mounted for it has shown. Opening another thread first, or
 * leaving, cancels it.
 */
export function createThreadOpenTracker(rollout: ThreadOpenRollout) {
  let operation: UiOperation | undefined;
  let pending = new Set<string>();
  let ready = false;
  let started = 0;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let bodies: Record<Source, number> & { html: number; prepare: number };

  function reset() {
    clearTimeout(readyTimer);
    pending = new Set();
    ready = false;
    bodies = {
      memory: 0,
      storage: 0,
      parsed: 0,
      direct: 0,
      html: 0,
      prepare: 0,
    };
  }
  reset();

  function finishIfSettled() {
    if (!operation || !ready || pending.size) return;
    operation.setAttributes({
      'email.thread.bodies':
        bodies.memory + bodies.storage + bodies.parsed + bodies.direct,
      'email.thread.bodies_memory': bodies.memory,
      'email.thread.bodies_storage': bodies.storage,
      'email.thread.bodies_parsed': bodies.parsed,
      'email.thread.bodies_direct': bodies.direct,
      'email.thread.html_kb': Math.round(bodies.html / 1024),
      'email.thread.prepare_max_ms': Math.round(bodies.prepare * 10) / 10,
    });
    operation.mark('bodies_shown');
    operation.afterPaint();
    operation = undefined;
  }

  const observer: EmailBodyOpenObserver = {
    pending(messageId) {
      const owner = operation;
      if (!owner || pending.has(messageId)) return () => {};
      pending.add(messageId);
      return () => {
        if (operation === owner && pending.delete(messageId)) finishIfSettled();
      };
    },
    shown(shown) {
      if (!operation || !pending.has(shown.messageId)) return;
      bodies[shown.source]++;
      bodies.html += shown.htmlLength;
      bodies.prepare = Math.max(bodies.prepare, shown.prepareMs);
      pending.delete(shown.messageId);
      finishIfSettled();
    },
  };

  return {
    observer,
    start(threadId: string, event?: Event) {
      operation?.cancel();
      reset();
      const repeat = seen.has(threadId);
      if (!repeat) {
        if (seen.size >= SEEN_LIMIT) seen.clear();
        seen.add(threadId);
      }
      started = performance.now();
      operation = startUiOperation('email.thread.open', {
        event,
        attributes: {
          'email.render_cache.arm': rollout.arm() ?? 'none',
          'email.render_cache.enabled': rollout.enabled(),
          'email.thread.repeat': repeat,
        },
      });
    },
    /** The thread's data is shown; its bodies have mounted in this update. */
    ready() {
      if (!operation || ready) return;
      ready = true;
      operation.setAttributes({
        'email.thread.data_ms':
          Math.round((performance.now() - started) * 10) / 10,
      });
      operation.mark('thread_ready');
      // Bodies register while the thread renders; check once that pass ends.
      readyTimer = setTimeout(finishIfSettled, 0);
    },
    fail() {
      operation?.finish('error');
      operation = undefined;
      reset();
    },
    dispose() {
      operation?.cancel();
      operation = undefined;
      reset();
    },
  };
}
