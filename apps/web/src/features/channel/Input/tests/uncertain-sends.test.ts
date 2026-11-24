import {
  clearComposerStorage,
  endComposerStorageClear,
} from '@core/auth/clear-composer-storage';
import { ThrownResultError } from '@core/util/result';
import { describe, expect, it } from 'vitest';
import { createUncertainSends } from '../utils/uncertain-sends';

const unknown = new ThrownResultError([
  { code: 'DELIVERY_UNKNOWN', message: 'could not confirm' },
]);
const refused = new ThrownResultError([
  { code: 'NOT_SENT', message: 'not sent' },
]);
type Mention = { entity_type: string; entity_id: string };
const send = (
  content: string,
  to = 'a',
  from = 'ada',
  mentions: Mention[] = []
) => ({
  senderId: from,
  channelId: to,
  message: {
    content,
    mentions,
    attachments: [{ entity_type: 'document', entity_id: 'doc-1' }],
  },
});

describe('createUncertainSends', () => {
  const ids = () => {
    let next = 0;
    return createUncertainSends(() => `id-${++next}`);
  };

  it('sends a restored message whose delivery is unknown again under its own id', () => {
    const sends = ids();
    const first = sends.idFor(send('hello'));
    sends.restored(send('hello'), first, unknown);
    expect(sends.idFor(send('hello'))).toBe(first);
  });

  it('gives a changed message a new id', () => {
    const sends = ids();
    const first = sends.idFor(send('hello'));
    sends.restored(send('hello'), first, unknown);
    expect(sends.idFor(send('hello, again'))).not.toBe(first);
  });

  it('gives the same message to another channel, or from another person, a new id', () => {
    const sends = ids();
    const first = sends.idFor(send('hello'));
    sends.restored(send('hello'), first, unknown);
    expect(sends.idFor(send('hello', 'b'))).not.toBe(first);
    expect(sends.idFor(send('hello', 'a', 'ben'))).not.toBe(first);
  });

  it('gives a new id after a send the server did not take', () => {
    const sends = ids();
    const first = sends.idFor(send('hello'));
    sends.restored(send('hello'), first, refused);
    expect(sends.idFor(send('hello'))).not.toBe(first);
  });

  it('gives the same words a new id once another message went to that place', () => {
    const sends = ids();
    const first = sends.idFor(send('Thanks'));
    sends.restored(send('Thanks'), first, unknown);
    sends.idFor(send('Something else'));
    expect(sends.idFor(send('Thanks'))).not.toBe(first);
  });

  it('keeps the id of whichever restored draft is sent first, and only that one', () => {
    const sends = ids();
    const a = sends.idFor(send('first'));
    const b = sends.idFor(send('second'));
    sends.restored(send('first'), a, unknown);
    sends.restored(send('second'), b, unknown);
    expect(sends.idFor(send('second'))).toBe(b);
    expect(sends.idFor(send('first'))).not.toBe(a);
  });

  it('keeps a restored draft’s id while messages go to other places', () => {
    const sends = ids();
    const first = sends.idFor(send('Thanks'));
    sends.restored(send('Thanks'), first, unknown);
    sends.idFor(send('something else', 'b'));
    sends.idFor(send('something else', 'a', 'ben'));
    expect(sends.idFor(send('Thanks'))).toBe(first);
  });

  it('keeps the id of a draft whose mentions came back in another order', () => {
    const sends = ids();
    const ada = { entity_type: 'user', entity_id: 'ada' };
    const ben = { entity_type: 'user', entity_id: 'ben' };
    const first = sends.idFor(send('@ada @ben', 'a', 'ada', [ada, ben]));
    sends.restored(send('@ada @ben', 'a', 'ada', [ada, ben]), first, unknown);
    expect(sends.idFor(send('@ada @ben', 'a', 'ada', [ben, ada]))).toBe(first);
  });

  it('forgets every uncertain send when the session ends', () => {
    const sends = ids();
    const first = sends.idFor(send('hello'));
    sends.restored(send('hello'), first, unknown);
    clearComposerStorage();
    endComposerStorageClear();
    // The same person signed in again: the draft is gone, so this is new.
    expect(sends.idFor(send('hello'))).not.toBe(first);
  });

  it('remembers no send that failed after its session ended', () => {
    const sends = ids();
    const first = sends.idFor(send('hello'));
    clearComposerStorage();
    sends.restored(send('hello'), first, unknown);
    endComposerStorageClear();
    expect(sends.idFor(send('hello'))).not.toBe(first);
  });

  it('reuses an uncertain id once', () => {
    const sends = ids();
    const first = sends.idFor(send('hello'));
    sends.restored(send('hello'), first, unknown);
    expect(sends.idFor(send('hello'))).toBe(first);
    expect(sends.idFor(send('hello'))).not.toBe(first);
  });

  it('keeps the id of every restored message, however many places have one', () => {
    const sends = ids();
    const first = sends.idFor(send('hello'));
    sends.restored(send('hello'), first, unknown);
    for (let place = 1; place <= 40; place += 1) {
      const other = send('hello', `channel-${place}`);
      sends.restored(other, sends.idFor(other), unknown);
    }
    expect(sends.idFor(send('hello'))).toBe(first);
  });
});
