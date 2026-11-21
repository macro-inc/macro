import { describe, expect, it } from 'vitest';
import { validateRoutineApps } from './routine-draft';

const linear = { app_slug: 'linear', server_name: 'Linear' };
const notion = { app_slug: 'notion', server_name: 'Notion' };
const github = { app_slug: 'github', server_name: 'GitHub' };

describe('validateRoutineApps', () => {
  it('names each required app the viewer has not connected', () => {
    expect(
      validateRoutineApps([linear, notion, github], new Set(['linear']))
    ).toBe('Connect Notion and GitHub, which this routine requires.');
  });

  it('passes once every app is connected, or before connections load', () => {
    expect(validateRoutineApps([linear], new Set(['linear']))).toBeNull();
    expect(validateRoutineApps([linear], undefined)).toBeNull();
  });
});
