import { useSettingsState } from "@core/constant/SettingsState";
import { useSplitLayout } from "../split-layout/layout";
import { Show } from "solid-js";
import { Button } from "@ui/components/Button";
import { cn } from "@ui/utils/classname";
import { LabelAndHotKey } from "@core/component/Tooltip";
import { TOKENS } from "@core/hotkey/tokens";
import IconGear from '@macro-icons/macro-gear.svg';


export function SettingsButton() {
  const { settingsOpen, toggleSettings } = useSettingsState();
  const { getSplitCount } = useSplitLayout();

  // Hide settings button when there are multiple splits
  const isSingleSplit = () => getSplitCount() <= 1;

  return (
    <Show when={isSingleSplit()}>
      <Button
        suppressInteractionStyling
        class="px-0"
        tooltip={
          <LabelAndHotKey
            label={settingsOpen() ? 'Close Settings' : 'Open Settings'}
            hotkeyToken={TOKENS.global.toggleSettings}
          />
        }
        onClick={() => toggleSettings()}
      >
        <IconGear class={cn("size-4.5 box-content rounded-full hover:bg-transparent p-1", settingsOpen() && 'bg-accent/20 text-accent hover:text-ink hover:bg-hover',
        !settingsOpen() &&
          'hover:text-accent hover:bg-accent/20')} />
      </Button>
    </Show>
  );
}
