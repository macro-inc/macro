import { describe, expect, it } from 'vitest';
import * as publicSdk from '../../sdk/src/macro';
import { Macro as PublicMacro } from '../../sdk/src/macro';
import * as preinstalledSdk from './index';
import { Macro } from './index';

describe('preinstalled SDK', () => {
  it('preserves every public runtime export, including documented helpers', () => {
    expect(
      Object.keys(preinstalledSdk)
        .filter((key) => key !== 'observeRequests')
        .sort()
    ).toEqual(Object.keys(publicSdk).sort());
    for (const key of Object.keys(publicSdk) as Array<keyof typeof publicSdk>) {
      // biome-ignore lint/performance/noDynamicNamespaceImportAccess: the regression verifies every public runtime export, not a tree-shaken application.
      expect(preinstalledSdk[key]).toBe(publicSdk[key]);
    }
    expect(preinstalledSdk.msg`Hello ${'world'}`).toEqual(
      publicSdk.msg`Hello ${'world'}`
    );
  });
  it('exports the actual SDK class and its nested entity handles', () => {
    expect(Macro).toBe(PublicMacro);
    const macro = new Macro({ token: 'fixture', env: 'prod' });
    const session = macro.agentSessions.byId('fixture-session');
    const execution = session.codeExecutions.byId('fixture-execution');
    expect(execution.session()).toBe(session);
    expect(typeof macro.email.search).toBe('function');
    expect(typeof macro.ai.decide).toBe('function');
  });
});
