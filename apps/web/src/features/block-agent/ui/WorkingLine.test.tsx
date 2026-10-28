/** @vitest-environment jsdom */

import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkingLine } from './WorkingLine';

afterEach(cleanup);

describe('WorkingLine', () => {
  it('reads "Working" when the caller has nothing more specific to say', () => {
    const { container } = render(() => <WorkingLine />);

    expect(container.textContent).toContain('Working');
  });

  it('shows the label the caller derives from state', () => {
    const { container } = render(() => <WorkingLine label="Running tools" />);

    expect(container.textContent).toContain('Running tools');
    expect(container.textContent).not.toContain('Working');
  });

  it('offers one accessible label, matching the visible one', () => {
    const { getAllByLabelText } = render(() => (
      <WorkingLine label="Stopping" />
    ));

    expect(getAllByLabelText('Stopping')).toHaveLength(1);
  });

  it('has nothing to expand, so it is not a control', () => {
    const { queryByRole } = render(() => <WorkingLine />);

    expect(queryByRole('button')).toBeNull();
  });
});
