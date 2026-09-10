/** @vitest-environment jsdom */

import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkingLine } from './WorkingLine';
import { WORKING_LABEL } from './working-verbs';

afterEach(cleanup);

describe('WorkingLine', () => {
  it('opens on the base word, so short turns never show a verb', () => {
    const { container } = render(() => <WorkingLine />);

    expect(container.textContent).toContain(WORKING_LABEL);
  });

  it('offers one stable label rather than a rotating one', () => {
    const { getAllByLabelText } = render(() => <WorkingLine />);

    expect(getAllByLabelText(WORKING_LABEL)).toHaveLength(1);
  });

  it('has nothing to expand, so it is not a control', () => {
    const { queryByRole } = render(() => <WorkingLine />);

    expect(queryByRole('button')).toBeNull();
  });
});
