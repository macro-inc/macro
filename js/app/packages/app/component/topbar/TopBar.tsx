import { ClippedPanel } from '@core/component/ClippedPanel';

export function TopBar() {
  return (
    <>
      <style>{`
        .dock-button-hover{
          transition: var(--transition);
          background-color: #0000;
        }
        @media(hover){
          .dock-button-hover:hover{
            background-color: var(--color-hover);
            transition: none;
          }
        }
      `}</style>

      <div
        style={{
          'padding': 'var(--gutter-size) var(--gutter-size) 0 var(--gutter-size)',
          'height': 'calc(40px + var(--gutter-size))',
          'box-sizing': 'border-box',
          'width': '100vw'
        }}
      >
        <ClippedPanel tl tr/>
      </div>
    </>
  );
}
