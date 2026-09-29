import { breakpoint } from '../../utils/utilBreakpoint';
import { BaseSection } from '../base/BaseSection';
import { SceneContextWindow } from '../scenes/SceneContextWindow';

export function SectionContextWindow() {
  return (
    <BaseSection
      left={true}
      title="Modular and extensible."
      body="Email, messages, docs, tasks, files, and AI work as distinct pieces, but they share one interface and one underlying memory of the work."
      scene={
        <div style={{ transform: breakpoint() ? 'translateX(-4%)' : 'none' }}>
          <SceneContextWindow />
        </div>
      }
    />
  );
}
