import { createSignal } from 'solid-js';

interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  class?: string;
}

export function DebugSlider(props: SliderProps) {
  const min = () => props.min ?? 0;
  const max = () => props.max ?? 100;
  const step = () => props.step ?? 1;
  const decimals = () => props.decimals ?? (step() < 1 ? 3 : 0);

  let sliderRef!: HTMLDivElement;
  const [isDragging, setIsDragging] = createSignal(false);

  const percentage = () => {
    const range = max() - min();
    return range === 0 ? 0 : ((props.value - min()) / range) * 100;
  };

  const formatValue = (value: number) => {
    return decimals() > 0 ? value.toFixed(decimals()) : value.toString();
  };

  const clampValue = (value: number) => {
    const clamped = Math.max(min(), Math.min(max(), value));
    if (step() > 0) {
      return Math.round(clamped / step()) * step();
    }
    return clamped;
  };

  const handleInputChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = parseFloat(target.value);
    if (!isNaN(value)) {
      props.onChange(clampValue(value));
    }
  };

  const handleSliderMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    updateValueFromMouse(e);
    sliderRef.focus();

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging()) {
        updateValueFromMouse(e);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const updateValueFromMouse = (e: MouseEvent) => {
    const rect = sliderRef.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    const range = max() - min();
    const newValue = min() + percent * range;
    props.onChange(clampValue(newValue));
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const stepSize = e.shiftKey ? step() * 10 : step();
    let newValue = props.value;

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault();
        newValue = props.value - stepSize;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault();
        newValue = props.value + stepSize;
        break;
      case 'Home':
        e.preventDefault();
        newValue = min();
        break;
      case 'End':
        e.preventDefault();
        newValue = max();
        break;
      default:
        return;
    }

    props.onChange(clampValue(newValue));
  };

  return (
    <div class="flex flex-row items-center w-full justify-between gap-1">
      <label class="text-xs font-mono text-ink-muted min-w-18 max-w-54 w-[30%] shrink-0 truncate pr-2">
        {props.label}
      </label>

      <div class="w-full shrink-1">
        <div
          ref={sliderRef}
          class="relative h-6 bg-message cursor-pointer select-none w-full focus:ring focus:ring-edge"
          onMouseDown={handleSliderMouseDown}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="slider"
          aria-label={props.label}
          aria-valuemin={min()}
          aria-valuemax={max()}
          aria-valuenow={props.value}
        >
          {/* Fill */}
          <div
            class="absolute inset-y-0 left-0 bg-accent pointer-events-none"
            style={`width: ${percentage()}%`}
          />
        </div>

        {/* Range indicators */}
        {/*<div class="flex flex-row justify-between text-xs text-ink-muted/60 mt-1 h-3">
            <span>{formatValue(min())}</span>
            <span>{formatValue(max())}</span>
          </div>*/}
      </div>
      <input
        type="number"
        value={formatValue(props.value)}
        onInput={handleInputChange}
        min={min()}
        max={max()}
        step={step()}
        class="px-2 h-6 text-xs bg-message text-ink text-right rounded-xs font-mono w-18 shrink-0 focus:ring focus:ring-edge"
      />
    </div>
  );
}
