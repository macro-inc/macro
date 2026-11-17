import type { FirstPartyBotMark } from '@core/component/firstPartyBotMark';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { BotIcon } from '../BotIcon';

afterEach(cleanup);

const mark: FirstPartyBotMark = {
  Icon: (props) => <svg data-testid="mark" class={props.class} />,
  tone: 'ink',
};

describe('BotIcon', () => {
  it('draws a product mark in place of the initial', () => {
    const { getByTestId, container } = render(() => (
      <BotIcon name="Claude Code" mark={mark} />
    ));
    expect(getByTestId('mark')).toBeTruthy();
    expect(container.textContent).not.toContain('C');
  });

  it('draws the initial without a mark or avatar', () => {
    const { container, queryByTestId } = render(() => (
      <BotIcon name="Hermes Agent" />
    ));
    expect(queryByTestId('mark')).toBeNull();
    expect(container.textContent).toBe('H');
  });
});
