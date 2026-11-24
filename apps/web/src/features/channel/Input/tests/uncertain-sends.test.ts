import { ThrownResultError } from '@core/util/result';
import { describe, expect, it } from 'vitest';
import { createUncertainSends } from '../utils/uncertain-sends';

const unknown = new ThrownResultError([
  { code: 'DELIVERY_UNKNOWN', message: 'could not confirm' },
]);
const refused = new ThrownResultError([
  { code: 'NOT_SENT', message: 'not sent' },
]);
const message = (content: string) => ({
  content,
  mentions: [],
  attachments: [{ entity_type: 'document', entity_id: 'doc-1' }],
});

describe('createUncertainSends', () => {
  const ids = () => {
    let next = 0;
    return createUncertainSends(() => `id-${++next}`);
  };

  it('sends a message whose delivery is unknown again under its own id', () => {
    const sends = ids();
    const first = sends.idFor(message('hello'));
    sends.failed(message('hello'), first, unknown);
    expect(sends.idFor(message('hello'))).toBe(first);
  });

  it('gives a changed message a new id', () => {
    const sends = ids();
    const first = sends.idFor(message('hello'));
    sends.failed(message('hello'), first, unknown);
    expect(sends.idFor(message('hello, again'))).not.toBe(first);
  });

  it('gives the same message to another channel a new id', () => {
    const sends = ids();
    const first = sends.idFor({ channelId: 'a', message: message('hello') });
    sends.failed({ channelId: 'a', message: message('hello') }, first, unknown);
    expect(sends.idFor({ channelId: 'b', message: message('hello') })).not.toBe(
      first
    );
  });

  it('gives a new id after a send the server did not take', () => {
    const sends = ids();
    const first = sends.idFor(message('hello'));
    sends.failed(message('hello'), first, refused);
    expect(sends.idFor(message('hello'))).not.toBe(first);
  });

  it('reuses an uncertain id once', () => {
    const sends = ids();
    const first = sends.idFor(message('hello'));
    sends.failed(message('hello'), first, unknown);
    expect(sends.idFor(message('hello'))).toBe(first);
    expect(sends.idFor(message('hello'))).not.toBe(first);
  });
});
