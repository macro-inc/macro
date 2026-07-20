/**
 * @vitest-environment jsdom
 */

import type { Link } from '@service-email/generated/schemas';
import { render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailLinksContextProvider, useEmailLinksContext } from './emailLinks';

const mocks = vi.hoisted(() => ({
  useEmailLinksQuery: vi.fn(),
  useIsAuthenticated: vi.fn(),
}));

vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: mocks.useEmailLinksQuery,
}));

vi.mock('./user', () => ({
  useIsAuthenticated: mocks.useIsAuthenticated,
}));

function Consumer(props: { label: string }) {
  const { links, isConnectedSecondaryInbox } = useEmailLinksContext();
  return (
    <span>
      {props.label}:{links().length}:
      {String(isConnectedSecondaryInbox('macro|secondary@example.com'))}
    </span>
  );
}

beforeEach(() => {
  mocks.useEmailLinksQuery.mockReset();
  mocks.useIsAuthenticated.mockReset();
});

describe('EmailLinksContext', () => {
  it('shares reactive identity metadata across consumers', () => {
    const [authenticated, setAuthenticated] = createSignal(true);
    const [data] = createSignal({
      links: [
        {
          id: 'secondary-inbox',
          email_address: 'secondary@example.com',
          is_primary: false,
        } as Link,
      ],
    });
    let queryEnabled: (() => boolean) | undefined;

    mocks.useIsAuthenticated.mockReturnValue(authenticated);
    mocks.useEmailLinksQuery.mockImplementation((enabled) => {
      queryEnabled = enabled;
      return {
        get data() {
          return data();
        },
      };
    });

    render(() => (
      <EmailLinksContextProvider>
        <Consumer label="first" />
        <Consumer label="second" />
      </EmailLinksContextProvider>
    ));

    expect(screen.getByText('first:1:true')).toBeTruthy();
    expect(screen.getByText('second:1:true')).toBeTruthy();
    expect(mocks.useEmailLinksQuery).toHaveBeenCalledOnce();
    expect(queryEnabled?.()).toBe(true);

    setAuthenticated(false);

    expect(screen.getByText('first:0:false')).toBeTruthy();
    expect(screen.getByText('second:0:false')).toBeTruthy();
    expect(queryEnabled?.()).toBe(false);
  });
});
