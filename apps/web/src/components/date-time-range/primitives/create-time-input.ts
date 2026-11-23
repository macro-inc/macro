import type { Accessor } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  completedTypedTime,
  matchTypedTime,
  type TimeOption,
  typedTimeCandidates,
  typedTimeOption,
} from '../time-options';
import type { ClockFormat } from './clock-format';

interface TimeInputState {
  mode: 'closed' | 'list' | 'typing';
  typed: string | undefined;
  shown: string | undefined;
  highlightedId: string | undefined;
  navigated: boolean;
  meridiem: 'am' | 'pm' | undefined;
}

/** Shared clock selection and typing; each presentation owns focus and scrolling. */
export function createTimeInput(options: {
  options: Accessor<TimeOption[]>;
  selectedId: Accessor<string>;
  disabled: Accessor<boolean>;
  onChange: (option: TimeOption) => void;
  timeFormat?: Accessor<ClockFormat | undefined>;
}) {
  const [state, setState] = createStore<TimeInputState>({
    mode: 'closed',
    typed: undefined,
    shown: undefined,
    highlightedId: undefined,
    navigated: false,
    meridiem: undefined,
  });
  const highlighted = () =>
    options.options().find((option) => option.id === state.highlightedId);
  const isOpen = () => state.mode !== 'closed' && !options.disabled();
  const openList = () => {
    if (options.disabled() || isOpen()) return;
    setState({ mode: 'list', highlightedId: options.selectedId() });
  };
  const beginTyping = () => {
    if (options.disabled()) return;
    if (!isOpen()) openList();
    setState('mode', 'typing');
  };
  const reset = () =>
    setState({
      mode: 'closed',
      typed: undefined,
      shown: undefined,
      navigated: false,
      meridiem: undefined,
    });
  const choose = (option: TimeOption | undefined) => {
    if (!options.disabled() && option && option.id !== options.selectedId())
      options.onChange(option);
    reset();
  };
  const commit = () => {
    if (state.typed !== undefined) {
      choose(
        highlighted() ??
          typedTimeOption(
            options.options(),
            state.typed,
            options.timeFormat?.()
          )
      );
      return;
    }
    choose(state.navigated ? highlighted() : undefined);
  };
  const input = (text: string, complete: boolean) => {
    if (options.disabled()) return;
    const explicit = /^\d[\d: h]*(am?|pm?)$/i.exec(text.trim())?.[1];
    let meridiem = state.meridiem;
    if (explicit)
      meridiem = explicit.toLowerCase().startsWith('p') ? 'pm' : 'am';
    const ambiguous = typedTimeCandidates(text).length > 1;
    const effective =
      !explicit && meridiem && ambiguous ? `${text}${meridiem}` : text;
    const match = matchTypedTime(options.options(), effective);
    const filled = complete ? completedTypedTime(text, match) : undefined;
    setState({
      mode: 'typing',
      typed: effective,
      shown: filled ?? text,
      highlightedId: match?.id,
      navigated: false,
      meridiem,
    });
    return filled;
  };
  const moveHighlight = (step: 1 | -1) => {
    if (options.disabled()) return;
    const all = options.options();
    const index = all.findIndex((option) => option.id === state.highlightedId);
    let next: number;
    if (index === -1) next = step === 1 ? 0 : all.length - 1;
    else next = (index + step + all.length) % all.length;
    const option = all[next];
    if (!option) return;
    setState({
      highlightedId: option.id,
      navigated: true,
      typed: undefined,
      shown: undefined,
    });
  };
  return {
    state,
    isOpen,
    highlighted,
    openList,
    beginTyping,
    choose,
    commit,
    input,
    moveHighlight,
    reset,
  };
}
