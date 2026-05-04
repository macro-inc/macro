interface KeyRectProps {
  height: number;
  labelX: number;
  labelY: number;
  label: string;
  width: number;
  key: string;
  x: number;
  y: number;
}

function KeyRect(props: KeyRectProps) {
  return (
    <>
      <rect
        fill="oklch(from var(--b2) l c h / 0.5)"
        height={props.height}
        width={props.width}
        stroke="var(--b4)"
        x={props.x}
        y={props.y}
        ry="0.2"
      />
      <text
        x={props.labelX}
        y={props.labelY}
        text-anchor="middle"
        dominant-baseline="central"
        style={{
          'font-family': 'var(--font-mono)',
          'fill': 'var(--b4)',
          'font-size': '0.4',
          'stroke': 'none',
        }}
      >
        {props.label}
      </text>
    </>
  );
};

export function Keyboard() {
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
      <KeyRect key="Escape"     label="esc"   x={ 0.0763} y={ 0.0763} width={2.8473} height={1.8473} labelX={ 1.50} labelY={ 1.0228} />
      <KeyRect key="F1"         label="F1"    x={ 3.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={ 4.00} labelY={ 1.0228} />
      <KeyRect key="F2"         label="F2"    x={ 5.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={ 6.00} labelY={ 1.0228} />
      <KeyRect key="F3"         label="F3"    x={ 7.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={ 8.00} labelY={ 1.0228} />
      <KeyRect key="F4"         label="F4"    x={ 9.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={10.00} labelY={ 1.0228} />
      <KeyRect key="F5"         label="F5"    x={11.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={12.00} labelY={ 1.0228} />
      <KeyRect key="F6"         label="F6"    x={13.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={14.00} labelY={ 1.0228} />
      <KeyRect key="F7"         label="F7"    x={15.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={16.00} labelY={ 1.0228} />
      <KeyRect key="F8"         label="F8"    x={17.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={18.00} labelY={ 1.0228} />
      <KeyRect key="F9"         label="F9"    x={19.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={20.00} labelY={ 1.0228} />
      <KeyRect key="F10"        label="F10"   x={21.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={22.00} labelY={ 1.0228} />
      <KeyRect key="F11"        label="F11"   x={23.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={24.00} labelY={ 1.0228} />
      <KeyRect key="F12"        label="F12"   x={25.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={26.00} labelY={ 1.0228} />
      <KeyRect key="F13"        label="F13"   x={27.0763} y={ 0.0763} width={1.8473} height={1.8473} labelX={28.00} labelY={ 1.0228} />
      {/* Row 2: Number row */}
      <KeyRect key="`"          label="`"     x={ 0.0763} y={ 2.0763} width={1.8473} height={1.8473}  labelX={1.00} labelY={ 3.0228} />
      <KeyRect key="1"          label="1"     x={ 2.0763} y={ 2.0763} width={1.8473} height={1.8473}  labelX={3.00} labelY={ 3.0228} />
      <KeyRect key="2"          label="2"     x={ 4.0763} y={ 2.0763} width={1.8473} height={1.8473}  labelX={5.00} labelY={ 3.0228} />
      <KeyRect key="3"          label="3"     x={ 6.0763} y={ 2.0763} width={1.8473} height={1.8473}  labelX={7.00} labelY={ 3.0228} />
      <KeyRect key="4"          label="4"     x={ 8.0763} y={ 2.0763} width={1.8473} height={1.8473}  labelX={9.00} labelY={ 3.0228} />
      <KeyRect key="5"          label="5"     x={10.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={11.00} labelY={ 3.0228} />
      <KeyRect key="6"          label="6"     x={12.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={13.00} labelY={ 3.0228} />
      <KeyRect key="7"          label="7"     x={14.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={15.00} labelY={ 3.0228} />
      <KeyRect key="8"          label="8"     x={16.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={17.00} labelY={ 3.0228} />
      <KeyRect key="9"          label="9"     x={18.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={19.00} labelY={ 3.0228} />
      <KeyRect key="0"          label="0"     x={20.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={21.00} labelY={ 3.0228} />
      <KeyRect key="-"          label="-"     x={22.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={23.00} labelY={ 3.0228} />
      <KeyRect key="="          label="="     x={24.0763} y={ 2.0763} width={1.8473} height={1.8473} labelX={25.00} labelY={ 3.0228} />
      <KeyRect key="Backspace"  label="del"   x={26.0763} y={ 2.0763} width={2.8473} height={1.8473} labelX={27.50} labelY={ 3.0228} />
      {/* Row 3: QWERTY row */}
      <KeyRect key="Tab"        label="tab"   x={ 0.0763} y={ 4.0763} width={2.8473} height={1.8473} labelX={ 1.50} labelY={ 5.0228} />
      <KeyRect key="q"          label="Q"     x={ 3.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={ 4.00} labelY={ 5.0228} />
      <KeyRect key="w"          label="W"     x={ 5.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={ 6.00} labelY={ 5.0228} />
      <KeyRect key="e"          label="E"     x={ 7.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={ 8.00} labelY={ 5.0228} />
      <KeyRect key="r"          label="R"     x={ 9.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={10.00} labelY={ 5.0228} />
      <KeyRect key="t"          label="T"     x={11.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={12.00} labelY={ 5.0228} />
      <KeyRect key="y"          label="Y"     x={13.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={14.00} labelY={ 5.0228} />
      <KeyRect key="u"          label="U"     x={15.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={16.00} labelY={ 5.0228} />
      <KeyRect key="i"          label="I"     x={17.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={18.00} labelY={ 5.0228} />
      <KeyRect key="o"          label="O"     x={19.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={20.00} labelY={ 5.0228} />
      <KeyRect key="p"          label="P"     x={21.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={22.00} labelY={ 5.0228} />
      <KeyRect key="["          label="["     x={23.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={24.00} labelY={ 5.0228} />
      <KeyRect key="]"          label="]"     x={25.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={26.00} labelY={ 5.0228} />
      <KeyRect key="\"          label="\"     x={27.0763} y={ 4.0763} width={1.8473} height={1.8473} labelX={28.00} labelY={ 5.0228} />
      {/* Row 4: Home row */}
      <KeyRect key="CapsLock"   label="caps"  x={ 0.0763} y={ 6.0763} width={3.3473} height={1.8473} labelX={ 1.75} labelY={ 7.0228} />
      <KeyRect key="a"          label="A"     x={ 3.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={ 4.50} labelY={ 7.0228} />
      <KeyRect key="s"          label="S"     x={ 5.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={ 6.50} labelY={ 7.0228} />
      <KeyRect key="d"          label="D"     x={ 7.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={ 8.50} labelY={ 7.0228} />
      <KeyRect key="f"          label="F"     x={ 9.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={10.50} labelY={ 7.0228} />
      <KeyRect key="g"          label="G"     x={11.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={12.50} labelY={ 7.0228} />
      <KeyRect key="h"          label="H"     x={13.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={14.50} labelY={ 7.0228} />
      <KeyRect key="j"          label="J"     x={15.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={16.50} labelY={ 7.0228} />
      <KeyRect key="k"          label="K"     x={17.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={18.50} labelY={ 7.0228} />
      <KeyRect key="l"          label="L"     x={19.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={20.50} labelY={ 7.0228} />
      <KeyRect key=";"          label=";"     x={21.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={22.50} labelY={ 7.0228} />
      <KeyRect key="'"          label="'"     x={23.5763} y={ 6.0763} width={1.8473} height={1.8473} labelX={24.50} labelY={ 7.0228} />
      <KeyRect key="Enter"      label="enter" x={25.5763} y={ 6.0763} width={3.3473} height={1.8473} labelX={27.25} labelY={ 7.0228} />
      {/* Row 5: Bottom letter row */}
      <KeyRect key="Shift"      label="shift" x={ 0.0763} y={ 8.0763} width={4.3473} height={1.8473} labelX={ 2.25} labelY={ 9.0228} />
      <KeyRect key="z"          label="Z"     x={ 4.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={ 5.50} labelY={ 9.0228} />
      <KeyRect key="x"          label="X"     x={ 6.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={ 7.50} labelY={ 9.0228} />
      <KeyRect key="c"          label="C"     x={ 8.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={ 9.50} labelY={ 9.0228} />
      <KeyRect key="v"          label="V"     x={10.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={11.50} labelY={ 9.0228} />
      <KeyRect key="b"          label="B"     x={12.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={13.50} labelY={ 9.0228} />
      <KeyRect key="n"          label="N"     x={14.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={15.50} labelY={ 9.0228} />
      <KeyRect key="m"          label="M"     x={16.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={17.50} labelY={ 9.0228} />
      <KeyRect key=","          label=","     x={18.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={19.50} labelY={ 9.0228} />
      <KeyRect key="."          label="."     x={20.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={21.50} labelY={ 9.0228} />
      <KeyRect key="/"          label="/"     x={22.5763} y={ 8.0763} width={1.8473} height={1.8473} labelX={23.50} labelY={ 9.0228} />
      <KeyRect key="Shift"      label="shift" x={24.5763} y={ 8.0763} width={4.3473} height={1.8473} labelX={26.75} labelY={ 9.0228} />
      {/* Row 6: Bottom row */}
      <KeyRect key="Fn"         label="fn"    x={ 0.0763} y={10.0763} width={1.8473} height={1.8473} labelX={ 1.00} labelY={11.0228} />
      <KeyRect key="Control"    label="ctrl"  x={ 2.0763} y={10.0763} width={1.8473} height={1.8473} labelX={ 3.00} labelY={11.0228} />
      <KeyRect key="Alt"        label="opt"   x={ 4.0763} y={10.0763} width={1.8473} height={1.8473} labelX={ 5.00} labelY={11.0228} />
      <KeyRect key="Meta"       label="cmd"   x={ 6.0763} y={10.0763} width={2.3473} height={1.8473} labelX={ 7.25} labelY={11.0228} />
      <KeyRect key=" "          label="space" x={ 8.5763} y={10.0763} width={9.8473} height={1.8473} labelX={13.50} labelY={11.0228} />
      <KeyRect key="Meta"       label="cmd"   x={18.5763} y={10.0763} width={2.3473} height={1.8473} labelX={19.75} labelY={11.0228} />
      <KeyRect key="Alt"        label="opt"   x={21.0763} y={10.0763} width={1.8473} height={1.8473} labelX={22.00} labelY={11.0228} />
      <KeyRect key="ArrowLeft"  label="◂"     x={23.0763} y={10.0763} width={1.8473} height={1.8473} labelX={24.00} labelY={11.0228} />
      <KeyRect key="ArrowUp"    label="▴"     x={25.0763} y={10.0763} width={1.8473} height={0.8473} labelX={26.00} labelY={10.5000} />
      <KeyRect key="ArrowDown"  label="▾"     x={25.0763} y={11.0763} width={1.8473} height={0.8473} labelX={26.00} labelY={11.5000} />
      <KeyRect key="ArrowRight" label="▸"     x={27.0763} y={10.0763} width={1.8473} height={1.8473} labelX={28.00} labelY={11.0228} />
    </svg>
  );
}
