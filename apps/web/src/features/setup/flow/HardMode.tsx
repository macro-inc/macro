import { ToggleSwitch } from '@ui';
import {
  type Accessor,
  createContext,
  createSignal,
  type JSX,
  useContext,
} from 'solid-js';

export type OnboardingHardMode = {
  hardMode: Accessor<boolean>;
  setHardMode: (on: boolean) => void;
  skipLayer: Accessor<HTMLDivElement | undefined>;
};

const HardModeContext = createContext<OnboardingHardMode>();

export function useOnboardingHardMode(): OnboardingHardMode {
  return (
    useContext(HardModeContext) ?? {
      hardMode: () => false,
      setHardMode: () => undefined,
      skipLayer: () => undefined,
    }
  );
}

/** Always-visible Hard mode switch plus a layer skip buttons portal into. */
export function OnboardingHardModeProvider(props: {
  children: JSX.Element;
}): JSX.Element {
  const [hardMode, setHardMode] = createSignal(false);
  const [skipLayer, setSkipLayer] = createSignal<HTMLDivElement>();

  return (
    <HardModeContext.Provider value={{ hardMode, setHardMode, skipLayer }}>
      {props.children}
      <div
        ref={setSkipLayer}
        class="pointer-events-none absolute inset-0 z-20"
      />
      <div class="absolute bottom-6 left-6 z-30">
        <ToggleSwitch
          size="md"
          checked={hardMode()}
          onChange={setHardMode}
          class="origin-bottom-left scale-150 gap-3 rounded-full border border-edge bg-surface/90 px-4 py-3 shadow-lg backdrop-blur-sm"
          label="Hard mode"
          labelClass="text-base font-semibold tracking-tight text-ink"
        />
      </div>
    </HardModeContext.Provider>
  );
}
