import { ThrownResultError } from '@core/util/result';
import { describe, expect, it } from 'vitest';
import { createUncertainSends } from '../utils/uncertain-sends';

const unknown = new ThrownResultError([
  { code: 'DELIVERY_UNKNOWN', message: 'could not confirm' },
]);
const refused = new ThrownResultError([
  { code: 'NOT_SENT', message: 'not sent' },
]);
const send = (content: string, to = 'a', from = 'ada') => ({
  senderId: from,
  channelId: to,
  message: {
    content,
    mentions: [],
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

  it('keeps each restored draft’s id when another uncertain send follows', () => {
    const sends = ids();
    const a = sends.idFor(send('first'));
    const b = sends.idFor(send('second'));
    sends.restored(send('first'), a, unknown);
    sends.restored(send('second'), b, unknown);
    expect(sends.idFor(send('first'))).toBe(a);
    expect(sends.idFor(send('second'))).toBe(b);
  });

  it('gives a new id once the restored draft was edited, even back to the same words', () => {
    const sends = ids();
    const first = sends.idFor(send('Thanks'));
    sends.restored(send('Thanks'), first, unknown);
    sends.drafted(send('Thanks'));
    sends.drafted(send('T'));
    sends.drafted(send('Thanks'));
    expect(sends.idFor(send('Thanks'))).not.toBe(first);
  });

  it('keeps a restored draft’s id while another place’s composer changes', () => {
    const sends = ids();
    const first = sends.idFor(send('Thanks'));
    sends.restored(send('Thanks'), first, unknown);
    sends.drafted(send('something else', 'b'));
    sends.drafted(send('something else', 'a', 'ben'));
    expect(sends.idFor(send('Thanks'))).toBe(first);
  });

  it('reuses an uncertain id once', () => {
    const sends = ids();
    const first = sends.idFor(send('hello'));
    sends.restored(send('hello'), first, unknown);
    expect(sends.idFor(send('hello'))).toBe(first);
    expect(sends.idFor(send('hello'))).not.toBe(first);
  });
});
