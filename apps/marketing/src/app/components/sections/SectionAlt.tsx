import { SceneContextWindow } from '../scenes/SceneContextWindow';
import { SceneKeyboard } from '../scenes/SceneKeyboard';
import { SceneSignal } from '../scenes/SceneSignal';

export function SectionAlt() {
  return (
    <>
      {/*<SceneDesktop/>*/}
      <div
        style={{
          'grid-template-columns': '1fr 1fr',
          'align-items': 'center',
          display: 'grid',
          gap: '60px',
        }}
      >
        <div>
          <div>Signal / Noise</div>
          Macro is an elegant set of cohesive tools to build better software. It
          is not a second brain to waste time maintaining. It has no methodology
          to feign productivity. It is a lightweight collaborative office suite,
          built for speed & focus.
        </div>
        <SceneSignal />
      </div>

      <SceneKeyboard />

      <div
        style={{
          'grid-template-columns': '1fr 1fr',
          'align-items': 'center',
          display: 'grid',
          gap: '60px',
        }}
      >
        <SceneContextWindow />
        <div>
          <div>Signal / Noise</div>
          Macro is an elegant set of cohesive tools to build better software. It
          is not a second brain to waste time maintaining. It has no methodology
          to feign productivity. It is a lightweight collaborative office suite,
          built for speed & focus.
        </div>
      </div>
    </>
  );
}
