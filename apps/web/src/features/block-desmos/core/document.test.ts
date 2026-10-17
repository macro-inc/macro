import { describe, expect, it } from 'vitest';
import {
  emptyDesmosDocument,
  parseDesmosDocument,
  serializeDesmosDocument,
} from './document';

describe('desmos document format', () => {
  it('round-trips a blank graph', () => {
    const document = emptyDesmosDocument();
    expect(parseDesmosDocument(serializeDesmosDocument(document))).toEqual(
      document
    );
  });

  it('treats empty source as a blank graph', () => {
    expect(parseDesmosDocument('')?.expressions).toHaveLength(1);
  });

  it('rejects the wrong version', () => {
    expect(parseDesmosDocument('{"version":2,"expressions":[]}')).toBeNull();
  });

  it('rejects documents missing a viewport', () => {
    expect(parseDesmosDocument('{"version":1,"expressions":[]}')).toBeNull();
  });
});
