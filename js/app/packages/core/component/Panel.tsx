import { cornerClip } from "@core/util/clipPath";

export function Panel(){
  return(
    <div style={{
      'clip-path': cornerClip(0, 0, 0, 0),
      'background-color': 'var(--color-edge-muted)',
      'box-sizing': 'border-box',
      'padding': '1px',
      'height': '100%',
      'width': '100%',
    }}>
      <div style={{
        'clip-path': cornerClip(0, 0, 0, 0),
        'background-color': 'var(--color-panel)',
        'height': '100%',
        'width': '100%',
      }}>
        props.children
      </div>
    </div>
  )
}
