import { SceneWave } from '../scenes/SceneWave';

export function SectionHeroAlt() {
  return (
    <>
      <div
        style={{
          border: '1.5px solid var(--b4)',
          'box-sizing': 'border-box',
          position: 'relative',
          'margin-top': '60px',
        }}
      >
        <SceneWave />
        <div
          style={{
            'border-right': '1.5px solid var(--b4)',
            'border-top': '1.5px solid var(--b4)',
            'background-color': 'var(--b0)',
            padding: '60px 80px 0px 60px',
            'letter-spacing': '0.3rem',
            'font-family': 'display',
            position: 'absolute',
            'line-height': '90px',
            'font-size': '120px',
            bottom: '-1.5px',
            left: '-1.5px',
          }}
        >
          MACRO
        </div>
      </div>

      <div
        style={{
          'grid-template-columns': '450px 1fr 1fr',
          'align-items': 'center',
          'text-align': 'justify',
          display: 'grid',
          gap: '80px',
        }}
      >
        <div>
          Macro is an elegant set of cohesive tools to build better software. It
          is not a second brain to waste time maintaining. It has no methodology
          to feign productivity. It is a lightweight collaborative office suite,
          built for speed & focus.
        </div>

        <div
          style={{
            'grid-template-columns': 'min-content 1fr min-content',
            gap: '10px 20px',
            display: 'grid',
          }}
        >
          <div>I</div>
          <hr
            style={{
              'border-top': '1.5px dashed var(--b4)',
              'border-bottom': 'none',
              'border-right': 'none',
              'border-left': 'none',
              width: '100%',
              height: '0%',
            }}
          />
          <div>Email</div>

          <div>II</div>
          <hr
            style={{
              'border-top': '1.5px dashed var(--b4)',
              'border-bottom': 'none',
              'border-right': 'none',
              'border-left': 'none',
              width: '100%',
              height: '0%',
            }}
          />
          <div>Chat</div>

          <div>III</div>
          <hr
            style={{
              'border-top': '1.5px dashed var(--b4)',
              'border-bottom': 'none',
              'border-right': 'none',
              'border-left': 'none',
              width: '100%',
              height: '0%',
            }}
          />
          <div>Email</div>
        </div>

        <div
          style={{
            'grid-template-columns': 'min-content 1fr min-content',
            gap: '10px 20px',
            display: 'grid',
          }}
        >
          <div>IV</div>
          <hr
            style={{
              'border-top': '1.5px dashed var(--b4)',
              'border-bottom': 'none',
              'border-right': 'none',
              'border-left': 'none',
              width: '100%',
              height: '0%',
            }}
          />
          <div>Email</div>

          <div>V</div>
          <hr
            style={{
              'border-top': '1.5px dashed var(--b4)',
              'border-bottom': 'none',
              'border-right': 'none',
              'border-left': 'none',
              width: '100%',
              height: '0%',
            }}
          />
          <div>Chat</div>

          <div>VI</div>
          <hr
            style={{
              'border-top': '1.5px dashed var(--b4)',
              'border-bottom': 'none',
              'border-right': 'none',
              'border-left': 'none',
              width: '100%',
              height: '0%',
            }}
          />
          <div>Chat</div>
        </div>
      </div>
    </>
  );
}
