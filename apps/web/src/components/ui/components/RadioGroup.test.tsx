import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, For } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RadioGroup } from './RadioGroup';

const OPTIONS = [
  { value: 'this_event', label: 'This event' },
  { value: 'all', label: 'All events' },
];

function Fixture(props: { onChange?: (value: string) => void }) {
  const [value, setValue] = createSignal('this_event');
  return (
    <RadioGroup
      value={value()}
      onChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
      aria-label="Apply changes to"
    >
      <For each={OPTIONS}>
        {(option) => (
          <RadioGroup.Item value={option.value}>
            <RadioGroup.ItemControl />
            <RadioGroup.ItemLabel>{option.label}</RadioGroup.ItemLabel>
          </RadioGroup.Item>
        )}
      </For>
    </RadioGroup>
  );
}

afterEach(cleanup);

describe('RadioGroup', () => {
  it('renders a native radio per item and checks the controlled value', () => {
    render(() => <Fixture />);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(radios[0].checked).toBe(true);
    expect(radios[1].checked).toBe(false);
  });

  it('emits the new value and moves the selection on change', () => {
    const onChange = vi.fn();
    render(() => <Fixture onChange={onChange} />);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];

    fireEvent.click(radios[1]);

    expect(onChange).toHaveBeenCalledWith('all');
    expect(radios[1].checked).toBe(true);
    expect(radios[0].checked).toBe(false);
  });

  it('associates each label with its control', () => {
    render(() => <Fixture />);
    const radio = screen.getByRole('radio', { name: 'All events' });
    expect(radio).toBeInstanceOf(HTMLInputElement);
  });

  it('keeps label and description wiring in the cards variant', () => {
    const onChange = vi.fn();
    render(() => (
      <RadioGroup
        variant="cards"
        defaultValue="team"
        onChange={onChange}
        aria-label="Who can join"
      >
        <RadioGroup.Item value="team">
          <RadioGroup.ItemLabel>Team</RadioGroup.ItemLabel>
          <RadioGroup.ItemDescription>
            Anyone on the team can join
          </RadioGroup.ItemDescription>
          <RadioGroup.ItemControl />
        </RadioGroup.Item>
        <RadioGroup.Item value="invite">
          <RadioGroup.ItemLabel>Invite only</RadioGroup.ItemLabel>
          <RadioGroup.ItemDescription>
            Only invited people can join
          </RadioGroup.ItemDescription>
          <RadioGroup.ItemControl />
        </RadioGroup.Item>
      </RadioGroup>
    ));

    fireEvent.click(screen.getByText('Invite only'));

    const invite = screen.getByRole('radio', { name: 'Invite only' });
    expect(onChange).toHaveBeenCalledWith('invite');
    expect((invite as HTMLInputElement).checked).toBe(true);
    const describedBy = invite.getAttribute('aria-describedby') ?? '';
    const description = describedBy
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
      .join(' ');
    expect(description).toBe('Only invited people can join');
  });
});
