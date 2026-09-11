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
    expect(container.querySelector('[data-agent-working-line]')).toBeTruthy();
  });

  it('offers one stable label rather than a rotating one', () => {
    const { getAllByLabelText } = render(() => <WorkingLine />);

    expect(getAllByLabelText(WORKING_LABEL)).toHaveLength(1);
  });

  it('has nothing to expand, so it is not a control', () => {
    const { queryByRole } = render(() => <WorkingLine />);

    expect(queryByRole('button')).toBeNull();
  });

  it('keeps a caret-width slot in the transcript so the label does not jump', () => {
    const { container } = render(() => <WorkingLine />);
    const line = container.querySelector('[data-agent-working-line]');
    expect(line?.getAttribute('data-agent-working-lead')).toBe('caret');
    expect(line?.querySelector('.size-4')).toBeTruthy();
  });

  it('sits the dot on the verbs when there is no caret to match', () => {
    const { container } = render(() => <WorkingLine lead="dot" />);
    const line = container.querySelector('[data-agent-working-line]');
    expect(line?.getAttribute('data-agent-working-lead')).toBe('dot');
    expect(line?.querySelector('.size-4')).toBeNull();
    expect(line?.querySelector('.agent-working-dot')).toBeTruthy();
  });
});
