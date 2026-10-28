import { BaseSection } from '../base/BaseSection';
import { SceneSignal } from '../scenes/SceneSignal';

export function SectionSignalNoise() {
  return (
    <BaseSection
      left={true}
      title="Signal/Noise split."
      body="Separate important stuff from random things. A dedicated priority view surfaces your most urgent messages, meetings, and tasks."
      scene={<SceneSignal />}
    />
  );
}
