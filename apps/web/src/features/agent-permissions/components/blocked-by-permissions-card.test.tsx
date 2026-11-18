/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DELETE_LABEL } from '../tests/gated-fixtures';
import { BlockedByPermissionsCard } from './blocked-by-permissions-card';

afterEach(cleanup);

describe('BlockedByPermissionsCard', () => {
  it('says what was blocked and links to the permissions', () => {
    const onReview = vi.fn();
    render(() => (
      <BlockedByPermissionsCard
        agentName="Scout"
        operations={[DELETE_LABEL]}
        canEdit
        onReview={onReview}
      />
    ));
    expect(
      screen.getByRole('region', { name: 'Blocked by permissions' })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Nothing ran. This program could delete email, and Scout is never allowed to.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Delete label')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review permissions' }));
    expect(onReview).toHaveBeenCalledOnce();
  });

  it('tells someone who can’t edit the agent who can', () => {
    render(() => (
      <BlockedByPermissionsCard
        agentName="Scout"
        operations={[DELETE_LABEL]}
        canEdit={false}
      />
    ));
    expect(
      screen.getByText('Only people who can edit Scout can change this.')
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('folds a long list behind Show more', () => {
    const operations = Array.from({ length: 8 }, (_, index) => ({
      ...DELETE_LABEL,
      operation: `op_${index}`,
      label: `Operation ${index}`,
    }));
    render(() => (
      <BlockedByPermissionsCard
        agentName="Scout"
        operations={operations}
        canEdit={false}
      />
    ));
    expect(screen.queryByText('Operation 7')).toBeNull();
    const more = screen.getByRole('button', { name: 'Show 2 more' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(screen.getByText('Operation 7')).toBeTruthy();
  });
});
