import type { EmailFocus, EntityData } from '@entity';
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailFocusScore } from './EmailFocusBadges';

vi.mock('@ui', async () => ({
  Badge: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  TagDot: () => <span />,
  Tooltip: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  cn: (await import('@app/components/ui/utils/classname')).cn,
}));

afterEach(cleanup);

function row(importanceTrend: EmailFocus['importanceTrend']): EntityData {
  return {
    type: 'email',
    id: 'thread',
    name: 'Subject',
    ownerId: 'owner',
    isRead: false,
    isDraft: false,
    isImportant: false,
    done: false,
    focus: {
      category: 'OTHER',
      importance: 72,
      needsReply: false,
      needsFollowUp: false,
      importanceTrend,
    },
  };
}

const meterFor = (importanceTrend: EmailFocus['importanceTrend']) => {
  render(() => <EmailFocusScore entity={row(importanceTrend)} />);
  return screen.getByRole('img');
};

describe('EmailFocusScore', () => {
  it('says a rising thread is rising, with no icon', () => {
    const meter = meterFor('UP');
    expect(meter.getAttribute('aria-label')).toBe(
      'Importance 72 of 100, rising'
    );
    expect(meter.querySelector('svg')).toBeNull();
  });

  it('says a falling thread is falling, with no icon', () => {
    const meter = meterFor('DOWN');
    expect(meter.getAttribute('aria-label')).toBe(
      'Importance 72 of 100, falling'
    );
    expect(meter.querySelector('svg')).toBeNull();
  });

  it('gives no direction on a flat thread', () => {
    const meter = meterFor('FLAT');
    expect(meter.getAttribute('aria-label')).toBe('Importance 72 of 100');
  });

  it('reads a trend this build does not know as flat', () => {
    const meter = meterFor(JSON.parse('"NEWLY_ADDED"'));
    expect(meter.getAttribute('aria-label')).toBe('Importance 72 of 100');
  });
});
