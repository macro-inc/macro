import { createSignal, onMount, onCleanup } from 'solid-js';

interface KeyRectProps {
  height: number;
  labelX: number;
  labelY: number;
  label: string;
  width: number;
  name: string;
  x: number;
  y: number;
  highlight?: string[];
  pressed?: string[];
}


function KeyRect(props: KeyRectProps) {
  const isHighlighted = () => props.highlight?.includes(props.name);
  const isPressed = () => props.pressed?.includes(props.name);

  function getSolid() {
    if (isPressed() && isHighlighted()) {return 'var(--a0)'}
    if (isPressed()) { return 'var(--c4)'};
    if (isHighlighted()) return 'oklch(from var(--a0) l c h / 0.4)';
    return 'var(--b4)';
  };

  function getTransparent() {
    if (isPressed() && isHighlighted()) {return 'oklch(from var(--a0) l c h / 0.6'}
    if (isPressed()) { return 'oklch(from var(--c4) l c h / 0.5)' };
    if (isHighlighted()) return 'oklch(from var(--a0) l c h / 0.2)';
    return 'oklch(from var(--b2) l c h / 0.2';
  };

  return (
    <>
      <rect
        style={{
          'fill': getTransparent(),
          'stroke': getSolid(),
        }}
        height={props.height}
        width={props.width}
        x={props.x}
        y={props.y}
        ry="0.2"
      />
      <text
        style={{
          'font-family': 'var(--font-mono)',
          'dominant-baseline': 'central',
          'text-anchor': 'middle',
          'fill': getSolid(),
          'font-size': '0.4',
          'stroke': 'none',
        }}
        x={props.labelX}
        y={props.labelY}
      >
        {props.label}
      </text>
    </>
  );
};

interface KeyboardProps {
  highlight?: string[];
}

export function Keyboard(props: KeyboardProps) {
  // Temp highlight array for debugging
  const highlight = () => props.highlight ?? ["u"];

  const [pressed, setPressed] = createSignal<string[]>([]);

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      setPressed((prev) => prev.includes(key) ? prev : [...prev, key]);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key;
      setPressed((prev) => prev.filter((k) => k !== key));
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    });
  });

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      style={{
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
        'stroke-width': '0.0572',
        'display': 'block',
        'width': '100%',
        'fill': 'none',
      }}
      viewBox="0 0 29 12"
    >
      {/* Row 1: Function keys */}
      <KeyRect name="Escape"     label="esc"   x={ 0.0763} y={ 0.0763} width={2.8473} height={1.8473} labelX={ 1.50} labelY={ 1.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="F1"         label="F1"    x={ 3.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={ 4.00} labelY={ 1.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="F2"         label="F2"    x={ 5.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={ 6.00} labelY={ 1.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="F3"         label="F3"    x={ 7.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={ 8.00} labelY={ 1.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="F4"         label="F4"    x={ 9.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={10.00} labelY={ 1.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="F5"         label="F5"    x={11.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={12.00} labelY={ 1.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="F6"         label="F6"    x={13.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={14.00} labelY={ 1.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="F7"         label="F7"    x={15.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={16.00} labelY={ 1.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="F8"         label="F8"    x={17.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={18.00} labelY={ 1.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="F9"         label="F9"    x={19.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={20.00} labelY={ 1.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="F10"        label="F10"   x={21.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={22.00} labelY={ 1.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="F11"        label="F11"   x={23.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={24.00} labelY={ 1.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="F12"        label="F12"   x={25.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={26.00} labelY={ 1.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="F13"        label="F13"   x={27.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={28.00} labelY={ 1.0228} highlight={highlight()} pressed={pressed()} />
      {/* Row 2: Number row */}
      <KeyRect name="`"          label="`"     x={ 0.0763} y={ 2.0763} width={1.8473} height={1.8473}  labelX={1.00} labelY={ 3.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="1"          label="1"     x={ 2.0763} y={ 2.0763} width={1.8473} height={1.8473}  labelX={3.00} labelY={ 3.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="2"          label="2"     x={ 4.0763} y={ 2.0763} width={1.8473} height={1.8473}  labelX={5.00} labelY={ 3.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="3"          label="3"     x={ 6.0763} y={ 2.0763} width={1.8473} height={1.8473}  labelX={7.00} labelY={ 3.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="4"          label="4"     x={ 8.0763} y={ 2.0763} width={1.8473} height={1.8473}  labelX={9.00} labelY={ 3.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="5"          label="5"     x={10.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={11.00} labelY={ 3.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="6"          label="6"     x={12.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={13.00} labelY={ 3.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="7"          label="7"     x={14.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={15.00} labelY={ 3.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="8"          label="8"     x={16.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={17.00} labelY={ 3.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="9"          label="9"     x={18.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={19.00} labelY={ 3.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="0"          label="0"     x={20.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={21.00} labelY={ 3.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="-"          label="-"     x={22.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={23.00} labelY={ 3.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="="          label="="     x={24.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={25.00} labelY={ 3.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="Backspace"  label="del"   x={26.0763} y={ 2.0763} width={2.8473} height={1.8473} labelX={27.50} labelY={ 3.0228} highlight={highlight()} pressed={pressed()} />
      {/* Row 3: QWERTY row */}
      <KeyRect name="Tab"        label="tab"   x={ 0.0763} y={ 4.0763} width={2.8473} height={1.8473} labelX={ 1.50} labelY={ 5.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="q"          label="Q"     x={ 3.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={ 4.00} labelY={ 5.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="w"          label="W"     x={ 5.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={ 6.00} labelY={ 5.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="e"          label="E"     x={ 7.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={ 8.00} labelY={ 5.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="r"          label="R"     x={ 9.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={10.00} labelY={ 5.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="t"          label="T"     x={11.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={12.00} labelY={ 5.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="y"          label="Y"     x={13.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={14.00} labelY={ 5.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="u"          label="U"     x={15.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={16.00} labelY={ 5.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="i"          label="I"     x={17.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={18.00} labelY={ 5.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="o"          label="O"     x={19.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={20.00} labelY={ 5.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="p"          label="P"     x={21.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={22.00} labelY={ 5.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="["          label="["     x={23.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={24.00} labelY={ 5.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="]"          label="]"     x={25.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={26.00} labelY={ 5.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="\"          label="\"     x={27.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={28.00} labelY={ 5.0228} highlight={highlight()} pressed={pressed()} />
      {/* Row 4: Home row */}
      <KeyRect name="CapsLock"   label="caps"  x={ 0.0763} y={ 6.0763} width={3.3473} height={1.8473} labelX={ 1.75} labelY={ 7.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="a"          label="A"     x={ 3.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={ 4.50} labelY={ 7.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="s"          label="S"     x={ 5.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={ 6.50} labelY={ 7.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="d"          label="D"     x={ 7.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={ 8.50} labelY={ 7.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="f"          label="F"     x={ 9.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={10.50} labelY={ 7.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="g"          label="G"     x={11.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={12.50} labelY={ 7.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="h"          label="H"     x={13.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={14.50} labelY={ 7.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="j"          label="J"     x={15.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={16.50} labelY={ 7.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="k"          label="K"     x={17.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={18.50} labelY={ 7.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="l"          label="L"     x={19.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={20.50} labelY={ 7.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name=";"          label=";"     x={21.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={22.50} labelY={ 7.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="'"          label="'"     x={23.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={24.50} labelY={ 7.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="Enter"      label="enter" x={25.5763} y={ 6.0763} width={3.3473} height={1.8473} labelX={27.25} labelY={ 7.0228} highlight={highlight()} pressed={pressed()} />
      {/* Row 5: Bottom letter row */}
      <KeyRect name="Shift"      label="shift" x={ 0.0763} y={ 8.0763} width={4.3473} height={1.8473} labelX={ 2.25} labelY={ 9.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="z"          label="Z"     x={ 4.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={ 5.50} labelY={ 9.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="x"          label="X"     x={ 6.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={ 7.50} labelY={ 9.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="c"          label="C"     x={ 8.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={ 9.50} labelY={ 9.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="v"          label="V"     x={10.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={11.50} labelY={ 9.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="b"          label="B"     x={12.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={13.50} labelY={ 9.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="n"          label="N"     x={14.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={15.50} labelY={ 9.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="m"          label="M"     x={16.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={17.50} labelY={ 9.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name=","          label=","     x={18.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={19.50} labelY={ 9.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="."          label="."     x={20.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={21.50} labelY={ 9.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="/"          label="/"     x={22.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={23.50} labelY={ 9.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="Shift"      label="shift" x={24.5763} y={ 8.0763} width={4.3473} height={1.8473} labelX={26.75} labelY={ 9.0228} highlight={highlight()} pressed={pressed()} />
      {/* Row 6: Bottom row */}
      <KeyRect name="Fn"         label="fn"    x={ 0.0763} y={10.0763} width={1.8473} height={1.8473} labelX={ 1.00} labelY={11.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="Control"    label="ctrl"  x={ 2.0763} y={10.0763} width={1.8473} height={1.8473} labelX={ 3.00} labelY={11.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="Alt"        label="opt"   x={ 4.0763} y={10.0763} width={1.8473} height={1.8473} labelX={ 5.00} labelY={11.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="Meta"       label="cmd"   x={ 6.0763} y={10.0763} width={2.3473} height={1.8473} labelX={ 7.25} labelY={11.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name=" "          label="space" x={ 8.5763} y={10.0763} width={9.8473} height={1.8473} labelX={13.50} labelY={11.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="Meta"       label="cmd"   x={18.5763} y={10.0763} width={2.3473} height={1.8473} labelX={19.75} labelY={11.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="Alt"        label="opt"   x={21.0763} y={10.0763} width={1.8473} height={1.8473} labelX={22.00} labelY={11.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="ArrowLeft"  label="◂"     x={23.0763} y={10.0763} width={1.8473} height={1.8473} labelX={24.00} labelY={11.0228} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="ArrowUp"    label="▴"     x={25.0763} y={10.0763} width={1.8473} height={0.8473} labelX={26.00} labelY={10.5000} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="ArrowDown"  label="▾"     x={25.0763} y={11.0763} width={1.8473} height={0.8473} labelX={26.00} labelY={11.5000} highlight={highlight()} pressed={pressed()} />
      <KeyRect name="ArrowRight" label="▸"     x={27.0763} y={10.0763} width={1.8473} height={1.8473} labelX={28.00} labelY={11.0228} highlight={highlight()} pressed={pressed()} />
    </svg>
  );
}
