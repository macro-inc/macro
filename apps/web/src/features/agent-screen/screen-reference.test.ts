import { describe, expect, it } from 'vitest';
import { parseScreenReference, screenPath } from './screen-reference';

const harnessId = '01a1ff9c-c73e-7c62-8c23-20a668f2f355';
const here = window.location.origin;

describe('parseScreenReference', () => {
  it('reads a screen link on this origin as its harness', () => {
    expect(parseScreenReference(`${here}/app/screen/${harnessId}`)).toEqual({
      harnessId,
    });
  });

  it('reads the app path alone, as this origin', () => {
    expect(parseScreenReference(`/app/screen/${harnessId}`)).toEqual({
      harnessId,
    });
  });

  it('drops the query, so a reference never asks to drive', () => {
    expect(
      parseScreenReference(`${here}/app/screen/${harnessId}?mode=drive`)
    ).toEqual({ harnessId });
  });

  it('leaves a Macro host this app doesn’t serve a plain link', () => {
    // As every app link here: only this origin (and the platform's own
    // aliases) open in the app.
    expect(
      parseScreenReference(`https://macro.com/app/screen/${harnessId}`)
    ).toBeUndefined();
  });

  it('leaves a link on any other site alone', () => {
    expect(
      parseScreenReference(`https://example.com/app/screen/${harnessId}`)
    ).toBeUndefined();
  });

  it('leaves a malformed or unknown screen segment alone', () => {
    for (const url of [
      `${here}/app/screen/not-a-harness`,
      `${here}/app/screen/${harnessId}/extra`,
      `${here}/app/screen/`,
      `${here}/app/screen/%E0%A4%A`,
      `${here}/app/screen/javascript:alert(1)`,
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(parseScreenReference(url), url).toBeUndefined();
    }
  });

  it('leaves lookalike hosts and non-web schemes alone', () => {
    for (const url of [
      `https://macro.com.evil.com/app/screen/${harnessId}`,
      `https://evilmacro.com/app/screen/${harnessId}`,
      `data:text/html,<a href="/app/screen/${harnessId}">x</a>`,
    ]) {
      expect(parseScreenReference(url), url).toBeUndefined();
    }
  });

  it('leaves an escaped slash or a path that climbs out of the screen route alone', () => {
    expect(
      parseScreenReference(
        `${here}/app/screen/${harnessId.slice(0, 8)}%2F${harnessId.slice(9)}`
      )
    ).toBeUndefined();
    expect(
      parseScreenReference(`${here}/app/screen/../md/${harnessId}`)
    ).toBeUndefined();
  });

  it('reads an uppercase id as the harness it names', () => {
    expect(
      parseScreenReference(`${here}/app/screen/${harnessId.toUpperCase()}`)
    ).toEqual({ harnessId });
  });

  it('leaves other app links alone', () => {
    expect(parseScreenReference(`${here}/app/md/${harnessId}`)).toBeUndefined();
  });
});

describe('screenPath', () => {
  it('is the app path on this origin, never another host', () => {
    expect(screenPath({ harnessId })).toBe(`/app/screen/${harnessId}`);
  });
});
