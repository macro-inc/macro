export function ColorSwatch(props: { width: string; color: string }) {
  // async function copyColor(){
  //    await navigator.clipboard.writeText(props.color);
  // }

  return (
    <>
      <style>{`
        .swatch-border{
          transition: border-color var(--transition);
          border: 1px solid var(--b4);
          padding: 3px;
          /* cursor: copy; */
        }
        @media(hover){
          .swatch-border:hover{
            /* border: 1px solid var(--a0); */
            transition: none;
          }
        }
      `}</style>

      <div
        // onPointerDown={copyColor}
        class="swatch-border"
      >
        <div
          class="advanced-theme-swatch"
          style={{
            'background-color': props.color,
            width: props.width,
            height: '10px',
          }}
        />
      </div>
    </>
  );
}
