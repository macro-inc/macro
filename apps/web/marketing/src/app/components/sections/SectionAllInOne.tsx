import { BaseSection } from '../base/BaseSection';
import { SceneAllInOne } from '../scenes/SceneAllInOne';

export function SectionAllInOne() {
  return (
    <BaseSection
      left={false}
      title="All In One"
      body={
        <>
          Tasks. Docs. Message. Video chat. AI. One app with all your work
          tools, built from the ground up. Plug in your existing email & docs,
          or start fresh with our built-in tools.
        </>
      }
      scene={<SceneAllInOne />}
    />
  );
}
