import { MACRO_AGENT_PRINCIPAL_ID } from '@core/constant/macroAgent';
import { MACRO_SYSTEM_PRINCIPAL_ID } from '@core/constant/macroSystem';
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  createMockActivityContext,
  MOCK_VIEWER_ID,
} from '../tests/mock-context';
import { createActorName } from './actor-name';

function nameOf(
  context: ReturnType<typeof createMockActivityContext>,
  actorId: string
): string {
  return createRoot((dispose) => {
    const name = createActorName(context, () => actorId)();
    dispose();
    return name;
  });
}

describe('createActorName', () => {
  const context = createMockActivityContext();

  it('names the viewer "You"', () => {
    expect(nameOf(context, MOCK_VIEWER_ID)).toBe('You');
  });

  it('resolves other users through displayName', () => {
    expect(nameOf(context, 'macro|sarah@example.com')).toBe('sarah');
  });

  it('names the system principal "System"', () => {
    expect(nameOf(context, MACRO_SYSTEM_PRINCIPAL_ID)).toBe('System');
  });

  it('names first-party bots from their constants', () => {
    expect(nameOf(context, MACRO_AGENT_PRINCIPAL_ID)).toBe('Macro');
  });

  it('resolves team bots through botName', () => {
    expect(nameOf(context, 'bot|deadbeef-0000-0000-0000-000000000001')).toBe(
      'Bot deadbeef'
    );
  });

  it('reads empty while a team bot name is still loading', () => {
    const loading = createMockActivityContext({
      botName: () => () => undefined,
    });
    expect(nameOf(loading, 'bot|deadbeef-0000-0000-0000-000000000001')).toBe(
      ''
    );
  });

  it('never says "Automation" for ids it cannot parse', () => {
    expect(nameOf(context, 'system:nightly')).toBe('Unknown');
  });
});
