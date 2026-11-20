import { describe, expect, test } from 'bun:test';
import {
  envFileCredentials,
  parseEnvFile,
  withheldCredentials,
} from '../index.ts';

describe('parseEnvFile', () => {
  test('reads KEY=value lines, skipping blank lines and comments', () => {
    expect(
      parseEnvFile(
        [
          '# written at enrollment',
          '',
          'MACRO_API_KEY=mak_secret',
          '  ',
          'MACRO_GATEWAY=https://gateway.example.com',
          'EMPTY=',
          'WITH_EQUALS=a=b=c',
        ].join('\n')
      )
    ).toEqual({
      kind: 'parsed',
      values: {
        MACRO_API_KEY: 'mak_secret',
        MACRO_GATEWAY: 'https://gateway.example.com',
        EMPTY: '',
        WITH_EQUALS: 'a=b=c',
      },
    });
  });

  test('unquotes the systemd form enrollment writes, with its escapes', () => {
    expect(
      parseEnvFile(
        [
          'MACRO_API_KEY="mak_secret"',
          'ODD_VALUE="a \\"quoted\\" \\\\ value"',
          'WINDOWS="crlf"\r',
        ].join('\n')
      )
    ).toEqual({
      kind: 'parsed',
      values: {
        MACRO_API_KEY: 'mak_secret',
        ODD_VALUE: 'a "quoted" \\ value',
        WINDOWS: 'crlf',
      },
    });
  });

  test('refuses a malformed line by its number, never showing its value', () => {
    for (const [text, line] of [
      ['A=1\nno equals sign here', 2],
      ['A=1\n\n9STARTS_WITH_DIGIT=secret', 3],
      ['BAD-NAME=secret', 1],
      ['UNCLOSED="secret', 1],
      ['TRAILING="secret"after', 1],
      ['STRAY="sec\\ret"', 1],
      ['A=1\nA=secret', 2],
    ] as const) {
      const parsed = parseEnvFile(text);
      expect(parsed).toMatchObject({ kind: 'malformed', line });
      expect(JSON.stringify(parsed)).not.toContain('secret');
    }
  });
});

describe('envFileCredentials', () => {
  test('gets and lists what the file holds, and refuses to change it', async () => {
    const credentials = envFileCredentials({
      file: '/run/credentials/agent.env',
      values: { B: '2', A: '1', EMPTY: '' },
    });
    expect(await credentials.get('A')).toBe('1');
    expect(await credentials.has('A')).toBe(true);
    expect(await credentials.has('EMPTY')).toBe(false);
    expect(credentials.get('EMPTY')).rejects.toThrow(
      'no credential named EMPTY'
    );
    expect(credentials.get('C')).rejects.toThrow(
      'no credential named C in /run/credentials/agent.env'
    );
    expect(await credentials.names()).toEqual(['A', 'B', 'EMPTY']);
    expect(credentials.set('A', 'other')).rejects.toThrow('enrollment');
    expect(await credentials.get('A')).toBe('1');
  });
});

describe('withheldCredentials', () => {
  test('lists the names but hands out no value and stores none', async () => {
    const credentials = withheldCredentials(['MACRO_API_KEY', 'OTHER']);
    expect(await credentials.names()).toEqual(['MACRO_API_KEY', 'OTHER']);
    expect(await credentials.has('OTHER')).toBe(true);
    expect(await credentials.has('MISSING')).toBe(false);
    expect(credentials.get('MACRO_API_KEY')).rejects.toThrow(
      'credentials stay with the agent'
    );
    expect(credentials.set('OTHER', 'value')).rejects.toThrow(
      'credentials stay with the agent'
    );
  });
});
