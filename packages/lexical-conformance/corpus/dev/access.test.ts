import { expect, test } from 'bun:test';
import jwt from 'jsonwebtoken';
import { documentToken } from './access';

test('dev grants expire quickly and authorize exactly the requested document', () => {
  const token = documentToken('opaque-document', 'synthetic-test-key', 1000);
  const claims = jwt.verify(token, 'synthetic-test-key', {
    algorithms: ['HS256'],
    clockTimestamp: 1001,
  });
  expect(claims).toEqual({
    user_id: 'lexical-corpus-dev',
    document_id: 'opaque-document',
    access_level: 'admin',
    exp: 1060,
    iss: 'document_storage_service',
  });
  expect(() =>
    jwt.verify(token, 'synthetic-test-key', { clockTimestamp: 1061 })
  ).toThrow();
  expect(() =>
    jwt.verify(token, 'different-test-key', { clockTimestamp: 1001 })
  ).toThrow();
});
