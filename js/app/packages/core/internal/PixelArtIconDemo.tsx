import { ToggleSwitch } from '@core/component/FormControls/ToggleSwitch';
import { IconButton } from '@core/component/IconButton';
import { DebugSlider } from '@core/component/Slider';
import { TextButton } from '@core/component/TextButton';
import { Bar } from '@core/component/TopBar/Bar';
import clickOutside from '@core/directive/clickOutside';
import Rotate from '@icon/regular/arrow-counter-clockwise.svg';
import Upload from '@icon/regular/arrow-square-in.svg';
import Copy from '@icon/regular/copy.svg';
import Download from '@icon/regular/download.svg';
import Erase from '@icon/regular/eraser.svg';
import MirrorX from '@icon/regular/flip-horizontal.svg';
import MirrorY from '@icon/regular/flip-vertical.svg';
import Fill from '@icon/regular/paint-bucket.svg';
import Pencil from '@icon/regular/pencil.svg';
import Plus from '@icon/regular/plus.svg';
import Trash from '@icon/regular/trash.svg';
import X from '@icon/regular/x.svg';
import { createElementSize } from '@solid-primitives/resize-observer';

import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { render } from 'solid-js/web';

false && clickOutside;

const BASE_PX_SIZE = 10;

/** Mirror a grid horizontally (flip left-right) */
function mirrorX(grid: boolean[][]): boolean[][] {
  return grid.map((row) => [...row].reverse());
}

/** Mirror a grid vertically (flip top-bottom) */
function mirrorY(grid: boolean[][]): boolean[][] {
  return [...grid].reverse();
}

/** Rotate a grid 90 degrees counter-clockwise */
function rotate90CC(grid: boolean[][]): boolean[][] {
  const rows = grid.length;
  const cols = grid[0]?.length || 0;

  if (rows === 0 || cols === 0) return grid;

  // For counter-clockwise: new[cols-1-j][i] = old[i][j]
  const rotated: boolean[][] = Array(cols)
    .fill(null)
    .map(() => Array(rows).fill(false));

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      rotated[cols - 1 - j][i] = grid[i][j];
    }
  }

  return rotated;
}

/** Uint8Array -> base64 string */
function toBase64(u8: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64'); // Node
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); // Browser
  return btoa(s);
}

/** base64 string -> Uint8Array */
function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined')
    return new Uint8Array(Buffer.from(b64, 'base64')); // Node
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** bool grid to string */
function encodeGrid(grid: boolean[][]): string {
  if (!Array.isArray(grid)) {
    throw new Error('Encode Grid: grid must be an array');
  }

  const rows = grid.length;
  const cols = rows ? grid[0].length : 0;

  if (rows === 0 || cols === 0) {
    throw new Error('Encode Grid: grid cannot be empty');
  }

  for (let r = 1; r < rows; r++) {
    if (!Array.isArray(grid[r]) || grid[r].length !== cols)
      throw new Error('Encode Grid: Non-rectangular grid');
  }
  if (rows > 255 || cols > 255)
    throw new Error('Encode Grid: rows/cols must be ≤ 255');

  const bits: boolean[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      bits.push(!!grid[r][c]);
    }
  }

  const bytes = new Uint8Array(2 + Math.ceil(bits.length / 8));
  bytes[0] = rows;
  bytes[1] = cols;

  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) {
      const byteIndex = 2 + (i >> 3);
      const bitPos = 7 - (i & 7);
      bytes[byteIndex] |= 1 << bitPos;
    }
  }

  return toBase64(bytes);
}

/** get bool grid from string */
function decodeGrid(data: string): boolean[][] {
  if (!data || typeof data !== 'string') {
    throw new Error('Decode Grid: data must be a non-empty string');
  }

  let bytes: Uint8Array;
  try {
    bytes = fromBase64(data);
  } catch {
    throw new Error('Decode Grid: invalid base64 data');
  }

  if (bytes.length < 2) throw new Error('Decode Grid: not enough byte data');
  const rows = bytes[0];
  const cols = bytes[1];

  if (rows === 0 || cols === 0) {
    throw new Error('Decode Grid: invalid grid dimensions');
  }

  const totalBits = rows * cols;

  const bits: boolean[] = new Array(totalBits);
  let k = 0;
  for (let i = 2; i < bytes.length && k < totalBits; i++) {
    const b = bytes[i];
    for (let bit = 7; bit >= 0 && k < totalBits; bit--) {
      bits[k++] = !!(b & (1 << bit));
    }
  }
  if (k !== totalBits) throw new Error('Decode Grid: truncated data');

  const grid: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < cols; c++) row.push(bits[r * cols + c]);
    grid.push(row);
  }
  return grid;
}

/** render svg to a string */
export async function svgToString<T extends Record<string, any>>(
  Component: (p: T) => JSX.Element,
  props: T
): Promise<string> {
  const host = document.createElement('div');
  const dispose = render(() => <Component {...props} />, host);

  await Promise.resolve();

  const svgEl = host.querySelector('svg');
  if (!svgEl) {
    dispose();
    throw new Error('Component did not render an <svg> element.');
  }

  const xml = new XMLSerializer().serializeToString(svgEl);

  dispose();
  host.remove();
  return xml;
}

interface PixelIconProps {
  gridSize: number;
  iconSize: number;
  pixelSize: number;
  cornerRadius: number;
  pixels: boolean[][];
  title: string;
}

function PixelIcon(props: PixelIconProps) {
  const cellSize = createMemo(() => props.iconSize / props.gridSize);
  const offset = createMemo(() => (cellSize() - props.pixelSize) / 2);
  const activePixels = createMemo(() => {
    const activePixels: Array<{ x: number; y: number }> = [];
    for (let row = 0; row < props.gridSize; row++) {
      for (let col = 0; col < props.gridSize; col++) {
        if (props.pixels[row] && props.pixels[row][col]) {
          const x = col * cellSize() + offset();
          const y = row * cellSize() + offset();
          activePixels.push({
            x: Math.round(x * 100) / 100,
            y: Math.round(y * 100) / 100,
          });
        }
      }
    }
    return activePixels;
  });

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="100%"
      height="100%"
      viewBox={`0 0 ${props.iconSize} ${props.iconSize}`}
      id={props.title}
    >
      <style>{'.pixel { fill: currentColor}'}</style>
      <For each={activePixels()}>
        {(pixel) => (
          <rect
            class="pixel"
            x={pixel.x}
            y={pixel.y}
            width={props.pixelSize}
            height={props.pixelSize}
            rx={props.cornerRadius}
            ry={props.cornerRadius}
          />
        )}
      </For>
    </svg>
  );
}

interface Glyph {
  name: string;
  data: string;
}

interface EditableLabelProps {
  value: string;
  onSave: (newValue: string) => void;
  class?: string;
  style?: string | JSX.CSSProperties;
}

function EditableLabel(props: EditableLabelProps) {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal('');

  const handleStartEdit = () => {
    setIsEditing(true);
    setEditValue(props.value);
  };

  const handleSave = () => {
    const newValue = editValue().trim();
    if (newValue && newValue !== props.value) {
      props.onSave(newValue);
    }
    setIsEditing(false);
    setEditValue('');
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
  };

  return (
    <div class={`relative ${props.class || ''}`} style={props.style}>
      <Show
        when={isEditing()}
        fallback={
          <div
            onClick={handleStartEdit}
            class="cursor-pointer hover:bg-edge/30 px-1 py-0.5 w-full h-full flex items-center"
            style="min-height: 20px;"
          >
            {props.value}
          </div>
        }
      >
        <input
          type="text"
          value={editValue()}
          onInput={(e) => setEditValue(e.currentTarget.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              handleSave();
            } else if (e.key === 'Escape') {
              handleCancel();
            }
          }}
          class="w-full bg-transparent border-none outline-none px-1 py-0.5"
          style="min-height: 20px;"
          ref={(el) => {
            setTimeout(() => {
              el.focus();
              el.select();
            }, 0);
          }}
        />
      </Show>
    </div>
  );
}

interface GlyphGridProps {
  glyphs: Glyph[];
  onGlyphSelect: (glyph: Glyph) => void;
  onNewGlyph: () => void;
  onEditGlyph: (glyph: Glyph) => void;
  onDeleteGlyph: (glyph: Glyph) => void;
  onGlyphRename: (glyph: Glyph, newName: string) => void;
  pixelSize: number;
  ignoreKeys: () => boolean;
  cornerRadius: number;
  sortAlphabetically: () => void;
}

function GlyphGrid(props: GlyphGridProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.ignoreKeys()) return;
    const len = props.glyphs.length;
    if (len === 0) return;

    const activeElement = document.activeElement;
    if (
      activeElement &&
      (activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        (activeElement as HTMLElement).isContentEditable ||
        document.querySelector('[role="dialog"]'))
    ) {
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const newIndex = prev <= 0 ? len - 1 : prev - 1;
        props.onGlyphSelect(props.glyphs[newIndex]);
        return newIndex;
      });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const newIndex = prev >= len - 1 ? 0 : prev + 1;
        props.onGlyphSelect(props.glyphs[newIndex]);
        return newIndex;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const newIndex = prev - columns();
        if (newIndex < 0) {
          const rows = Math.ceil(len / columns());
          const total = rows * columns();
          const wrapped = (newIndex + total) % total;
          if (wrapped >= len) return wrapped - columns();
          return wrapped;
        }
        return newIndex;
      });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const newIndex = prev + columns();
        const rows = Math.ceil(len / columns());
        const row = Math.floor(newIndex / columns());
        if (row > rows - 1) return newIndex % (columns() * rows);
        if (newIndex >= len) return (newIndex + columns()) % (rows * columns());
        return newIndex;
      });
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      props.onDeleteGlyph(props.glyphs[selectedIndex()]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const ndx = selectedIndex();
      setTimeout(() => {
        props.onEditGlyph(props.glyphs[ndx]);
      });
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  const [gridRef, setGridRef] = createSignal<HTMLDivElement>();
  const gridSize = createElementSize(gridRef);
  const width = () => gridSize.width ?? 0;

  const [columns, setColumns] = createSignal(Math.floor(width() / (32 * 4)));
  createEffect(() => {
    setColumns(Math.floor(width() / (32 * 4)));
  });

  return (
    <div class="grow-1">
      <div class="flex items-center justify-between mb-6 p-2">
        <div class="flex item-center gap-4">
          <h2 class="font-mono text-xs">Icons [ {props.glyphs.length} ]</h2>
          <button
            class="font-mono text-xs underline"
            onClick={props.sortAlphabetically}
          >
            Sort Alhpa
          </button>
        </div>
        <TextButton
          onClick={() => {
            props.onNewGlyph();
          }}
          text="New Icon"
          theme="base"
          icon={Plus}
        />
      </div>

      <Show
        when={props.glyphs.length > 0}
        fallback={
          <div class="flex flex-col items-center justify-center h-64 text-ink-muted">
            <div class="text-sm mb-2">No icons yet</div>
            <div class="text-sm">Click "New Icon" to create your first one</div>
          </div>
        }
      >
        <div
          class="grid gap-2 px-2 h-full overflow-y-auto pb-64"
          ref={setGridRef}
          style={{
            'grid-template-columns': `repeat(${columns()}, minmax(0, 1fr))`,
            'grid-auto-rows': 'minmax(min-content, max-content)',
          }}
        >
          <For each={props.glyphs}>
            {(glyph, index) => {
              const pixels = createMemo(() => {
                try {
                  if (!glyph.data) {
                    console.warn('Glyph has no data:', glyph.name);
                    return [];
                  }
                  return decodeGrid(glyph.data);
                } catch (error) {
                  console.warn(
                    'Failed to decode glyph data for:',
                    glyph.name,
                    error
                  );
                  return [];
                }
              });

              const gridSize = createMemo(() => pixels().length);
              const isSelected = createMemo(() => selectedIndex() === index());

              return (
                <div
                  onClick={() => {
                    setSelectedIndex(index());
                    props.onGlyphSelect(glyph);
                  }}
                  tabIndex={0}
                  onDblClick={() => props.onEditGlyph(glyph)}
                  class="items-center border relative group transition-colors justify-self-stretch"
                  classList={{
                    'border-edge bg-edge/20 bracket-offset-2': isSelected(),
                    'border-edge/50 bg-background hover:bg-edge/50':
                      !isSelected(),
                  }}
                >
                  <div class="w-20 h-20 flex items-center justify-center mx-auto m-2">
                    <Show when={pixels().length > 0}>
                      <PixelIcon
                        pixels={pixels()}
                        iconSize={gridSize() * BASE_PX_SIZE}
                        pixelSize={props.pixelSize}
                        cornerRadius={props.cornerRadius}
                        gridSize={gridSize()}
                        title={glyph.name}
                      />
                    </Show>
                  </div>
                  <div class="text-xs text-ink-muted w-full border-t-1 border-edge/50 p-1">
                    <EditableLabel
                      value={glyph.name}
                      onSave={(newName) => props.onGlyphRename(glyph, newName)}
                      class="text-xs"
                    />
                  </div>

                  <div class="absolute top-1 right-1 flex gap-0 opacity-0 bg-panel group-hover:opacity-100">
                    <IconButton
                      icon={Pencil}
                      tooltip={{ label: 'Edit' }}
                      onClick={(e) => {
                        e.preventDefault();
                        props.onEditGlyph(glyph);
                      }}
                      theme="base"
                    />
                    <IconButton
                      icon={Trash}
                      tooltip={{ label: 'Delete' }}
                      onClick={(e) => {
                        e.preventDefault();
                        props.onDeleteGlyph(glyph);
                      }}
                      theme="red"
                    />
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

interface GlyphEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, data: string) => void;
  initialGlyph?: Glyph;
}

function GlyphEditor(props: GlyphEditorProps) {
  const [gridSize, setGridSize] = createSignal(13);
  const [pixelSize, _] = createSignal(BASE_PX_SIZE);
  const [cornerRadius, __] = createSignal(0);
  const [glyphName, setGlyphName] = createSignal('');
  const [symmetryX, setSymmetryX] = createSignal(false);
  const [symmetryY, setSymmetryY] = createSignal(false);
  const [pixels, setPixels] = createSignal<boolean[][]>(
    Array(gridSize())
      .fill(null)
      .map(() => Array(gridSize()).fill(false))
  );

  const [isDragging, setIsDragging] = createSignal(false);
  const [dragMode, setDragMode] = createSignal<'fill' | 'erase'>('fill');

  let inputRef: HTMLInputElement | undefined;
  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!props.isOpen) return;

      // If input is focused, only handle Enter and Escape
      if (inputRef && document.activeElement === inputRef) {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          handleSave();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
        }
        return;
      }

      // Handle keys only when editor is open and no input is focused
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      } else if (event.key === 'x' || event.key === 'X') {
        event.preventDefault();
        event.stopPropagation();
        setSymmetryX((prev) => !prev);
      } else if (event.key === 'y' || event.key === 'Y') {
        event.preventDefault();
        event.stopPropagation();
        setSymmetryY((prev) => !prev);
      } else if (event.key === 'Delete') {
        event.preventDefault();
        event.stopPropagation();
        clearAll();
      } else if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        event.stopPropagation();
        fillAll();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        handleSave();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  // Initialize with existing glyph if provided - use createEffect to react to prop changes
  createEffect(() => {
    if (props.isOpen) {
      if (props.initialGlyph) {
        try {
          const decodedPixels = decodeGrid(props.initialGlyph.data);
          setPixels(decodedPixels);
          setGridSize(decodedPixels.length);
          setGlyphName(props.initialGlyph.name);
          setSymmetryX(false);
          setSymmetryY(false);
        } catch (error) {
          console.warn('Failed to decode glyph:', error);
          // Fallback to default state if decode fails
          const defaultGridSize = 13;
          setGridSize(defaultGridSize);
          setGlyphName('');
          setPixels(
            Array(defaultGridSize)
              .fill(null)
              .map(() => Array(defaultGridSize).fill(false))
          );
          setSymmetryX(false);
          setSymmetryY(false);
        }
      } else {
        // Reset to default state for new glyph
        const defaultGridSize = 13;
        setGridSize(defaultGridSize);
        setGlyphName('');
        setPixels(
          Array(defaultGridSize)
            .fill(null)
            .map(() => Array(defaultGridSize).fill(false))
        );
        setSymmetryX(false);
        setSymmetryY(false);
      }
    }
  });

  // Reactive effect to resize pixels array when grid size changes
  createEffect(() => {
    if (props.isOpen) {
      const currentSize = gridSize();
      setPixels((prev) => {
        // Create new array with current grid size
        const newPixels = Array(currentSize)
          .fill(null)
          .map(() => Array(currentSize).fill(false));

        // Copy existing pixels if they fit
        for (let row = 0; row < Math.min(prev.length, currentSize); row++) {
          for (
            let col = 0;
            col < Math.min(prev[row]?.length || 0, currentSize);
            col++
          ) {
            if (prev[row] && prev[row][col] !== undefined) {
              newPixels[row][col] = prev[row][col];
            }
          }
        }

        return newPixels;
      });
    }
  });

  const iconSize = () => gridSize() * BASE_PX_SIZE;
  const cellSize = 280 / gridSize();

  const setPixel = (row: number, col: number, value: boolean) => {
    setPixels((prev) => {
      const newPixels = prev.map((r) => [...r]);
      newPixels[row][col] = value;

      if (symmetryX()) {
        const mirrorCol = gridSize() - 1 - col;
        newPixels[row][mirrorCol] = value;
      }

      if (symmetryY()) {
        const mirrorRow = gridSize() - 1 - row;
        newPixels[mirrorRow][col] = value;

        if (symmetryX()) {
          const mirrorCol = gridSize() - 1 - col;
          newPixels[mirrorRow][mirrorCol] = value;
        }
      }

      return newPixels;
    });
  };

  const handleMouseDown = (row: number, col: number) => {
    setIsDragging(true);
    const currentValue = pixels()[row][col];
    setDragMode(currentValue ? 'erase' : 'fill');
    setPixel(row, col, !currentValue);
  };

  const handleMouseEnter = (row: number, col: number) => {
    if (isDragging()) {
      setPixel(row, col, dragMode() === 'fill');
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleSave = () => {
    const name = glyphName().trim();
    if (!name) {
      alert('Please enter a glyph name');
      return;
    }

    try {
      const data = encodeGrid(pixels());
      props.onSave(name, data);
      props.onClose();
    } catch (error) {
      console.error('Failed to encode glyph data:', error);
      alert('Failed to save glyph. Please try again.');
    }
  };

  const clearAll = () => {
    setPixels(
      Array(gridSize())
        .fill(null)
        .map(() => Array(gridSize()).fill(false))
    );
  };

  const fillAll = () => {
    setPixels(
      Array(gridSize())
        .fill(null)
        .map(() => Array(gridSize()).fill(true))
    );
  };

  const handleMirrorX = () => {
    setPixels((prev) => mirrorX(prev));
  };

  const handleMirrorY = () => {
    setPixels((prev) => mirrorY(prev));
  };

  const handleRotate90CC = () => {
    setPixels((prev) => {
      const rotated = rotate90CC(prev);
      const newSize = rotated.length;
      if (newSize !== gridSize()) {
        setGridSize(newSize);
      }
      return rotated;
    });
  };

  return (
    <Show when={props.isOpen}>
      <div class="absolute inset-0 bg-modal-overlay flex items-center justify-center z-action-menu">
        <div
          class="bg-menu border-1 border-edge max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
          use:clickOutside={() => props.onClose()}
        >
          <div class="p-2 border-b border-edge flex items-center justify-between">
            <h2 class="font-mono text-xs">Editor</h2>
            <IconButton icon={X} onClick={props.onClose} theme="clear" />
          </div>

          <div class="flex flex-1 overflow-hidden">
            <div class="flex-1 p-1 overflow-y-auto">
              <input
                type="text"
                placeholder="Icon name..."
                value={glyphName()}
                onInput={(e) => setGlyphName(e.currentTarget.value)}
                class="p-2 w-full text-sm border-b-1 border-edge/50 mb-4"
                ref={inputRef}
              />
              <div class="flex flex-col items-center gap-6">
                <div
                  class="relative border border-edge"
                  style={`width: 280px; height: 280px;`}
                >
                  <svg
                    viewBox={`0 0 280 280`}
                    class="absolute inset-0 w-full h-full cursor-crosshair"
                    style="user-select: none;"
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                  >
                    {/* Grid lines */}
                    <defs>
                      <pattern
                        id="grid"
                        width={cellSize}
                        height={cellSize}
                        patternUnits="userSpaceOnUse"
                      >
                        <path
                          d={`M ${cellSize} 0 L 0 0 0 ${cellSize}`}
                          fill="none"
                          stroke="currentColor"
                          stroke-width="0.5"
                          opacity="0.2"
                        />
                      </pattern>
                    </defs>
                    <rect width="280" height="280" fill="url(#grid)" />

                    <For each={Array(gridSize()).fill(null)}>
                      {(_, row) => (
                        <For each={Array(gridSize()).fill(null)}>
                          {(_, col) => (
                            <rect
                              x={col() * cellSize}
                              y={row() * cellSize}
                              width={cellSize}
                              height={cellSize}
                              fill={
                                pixels()[row()][col()]
                                  ? 'currentColor'
                                  : 'transparent'
                              }
                              stroke="transparent"
                              class="cursor-pointer hover:stroke-current hover:stroke-1 hover:opacity-50"
                              onMouseDown={() => handleMouseDown(row(), col())}
                              onMouseEnter={() =>
                                handleMouseEnter(row(), col())
                              }
                            />
                          )}
                        </For>
                      )}
                    </For>
                  </svg>
                </div>

                <div class="flex flex-col items-center gap-2 mb-4">
                  <h3 class="font-mono text-ink-extra-muted text-xs">
                    [ PREVIEW ]
                  </h3>
                  <div class="w-24 h-24 flex items-center justify-center border border-edge bg-background">
                    <PixelIcon
                      pixels={pixels()}
                      iconSize={iconSize()}
                      pixelSize={pixelSize()}
                      cornerRadius={cornerRadius()}
                      gridSize={gridSize()}
                      title={glyphName()}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div class="w-80 border-l border-edge border-dashed p-2 flex flex-col">
              <div class="flex-1 overflow-y-auto">
                <div>
                  <div class="flex flex-row items-center w-full justify-start gap-6 mb-4">
                    <div class="flex gap-2 flex-col text-ink-muted">
                      <span class="flex items-center gap-2 text-xs">
                        Symmetry X
                      </span>
                      <ToggleSwitch
                        checked={symmetryX()}
                        size="SM"
                        onChange={() => setSymmetryX((prev) => !prev)}
                      />
                    </div>
                    <div class="flex gap-2 flex-col text-ink-muted">
                      <span class="flex items-center gap-2 text-xs">
                        Symmetry Y
                      </span>
                      <ToggleSwitch
                        checked={symmetryY()}
                        size="SM"
                        onChange={() => setSymmetryY((prev) => !prev)}
                      />
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2 mb-4">
                  <TextButton
                    text="Clear Grid"
                    onClick={clearAll}
                    theme="base"
                    icon={Erase}
                  />
                  <TextButton
                    text="Fill Grid"
                    onClick={fillAll}
                    theme="base"
                    icon={Fill}
                  />
                </div>

                <div class="space-y-2 mb-4">
                  <h4 class="font-mono text-xs text-ink-muted">Transforms</h4>
                  <div class="flex gap-2">
                    <IconButton
                      tooltip={{ label: 'Mirror X' }}
                      onClick={handleMirrorX}
                      theme="base"
                      icon={MirrorX}
                    />
                    <IconButton
                      tooltip={{ label: 'Mirror Y' }}
                      onClick={handleMirrorY}
                      theme="base"
                      icon={MirrorY}
                    />
                    <IconButton
                      tooltip={{ label: 'Rotate 90 CCW' }}
                      onClick={handleRotate90CC}
                      theme="base"
                      icon={Rotate}
                    />
                  </div>
                </div>
              </div>

              <div class="pt-4 border-t border-edge">
                <div class="grid grid-cols-2 gap-2">
                  <TextButton
                    text="Cancel"
                    onClick={props.onClose}
                    theme="muted"
                  />
                  <TextButton text="Save" onClick={handleSave} theme="accent" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

interface GlyphSidebarProps {
  selectedGlyph: Glyph | null;
  pixelSize: number;
  cornerRadius: number;
  onPixelSizeChange: (value: number) => void;
  onCornerRadiusChange: (value: number) => void;
  onGlyphRename: (glyph: Glyph, newName: string) => void;
  onExportAll: () => void;
  onImportAll: () => void;
  onCopyAllSVGs: () => void;
  onDownloadAllSVGs: () => void;
}

function GlyphSidebar(props: GlyphSidebarProps) {
  const selectedPixels = createMemo(() => {
    if (!props.selectedGlyph) return null;
    try {
      if (!props.selectedGlyph.data) {
        console.warn('Selected glyph has no data:', props.selectedGlyph.name);
        return null;
      }
      return decodeGrid(props.selectedGlyph.data);
    } catch (error) {
      console.warn(
        'Failed to decode selected glyph data:',
        props.selectedGlyph.name,
        error
      );
      return null;
    }
  });

  const selectedGridSize = createMemo(() => {
    const pixels = selectedPixels();
    return pixels ? pixels.length : 0;
  });

  const iconSize = createMemo(() => selectedGridSize() * BASE_PX_SIZE);

  const memoizedProps = createMemo(() => {
    const pixels = selectedPixels();
    if (!pixels || !props.selectedGlyph) return null;

    return {
      pixels,
      iconSize: iconSize(),
      gridSize: selectedGridSize(),
      cornerRadius: props.cornerRadius,
      title: props.selectedGlyph.name,
      pixelSize: props.pixelSize,
    };
  });

  const [svgString] = createResource(memoizedProps, async (props) => {
    if (!props) return '';
    return await svgToString<PixelIconProps>(PixelIcon, props);
  });

  return (
    <div class="w-[400px] bg-panel p-4 overflow-y-auto border-l border-edge border-dashed shrink-0">
      <div class="space-y-4">
        <h3 class="font-mono text-sm text-ink">[ Global Settings ]</h3>

        <DebugSlider
          label="Pixel Size"
          value={props.pixelSize}
          onChange={props.onPixelSizeChange}
          min={1}
          max={15}
          step={0.5}
          decimals={1}
        />

        <DebugSlider
          label="Corner Radius"
          value={props.cornerRadius}
          onChange={props.onCornerRadiusChange}
          min={0}
          max={8}
          step={0.5}
          decimals={1}
        />

        <div class="mt-6 space-y-2">
          <h4 class="font-mono text-xs text-ink-muted">Batch Operations</h4>
          <div class="grid grid-cols-1 gap-2">
            <TextButton
              text="Export to Clipboard"
              onClick={props.onExportAll}
              theme="base"
              icon={Copy}
            />
            <TextButton
              text="Import from Clipboard"
              onClick={props.onImportAll}
              theme="base"
              icon={Upload}
            />
            <TextButton
              text="Copy SVGs"
              onClick={props.onCopyAllSVGs}
              theme="base"
              icon={Copy}
            />
            <TextButton
              text="Download SVGs"
              onClick={props.onDownloadAllSVGs}
              theme="base"
              icon={Download}
            />
          </div>
        </div>
      </div>

      <hr class="border-b-1 border-dashed border-edge/50 my-4" />

      <Show
        when={props.selectedGlyph}
        fallback={
          <div class="text-ink-muted text-sm">
            Select a glyph from the grid to view details
          </div>
        }
      >
        <h3 class="font-mono text-sm text-ink mb-2">[ Inspector ]</h3>
        <div class="space-y-6">
          <div class="flex flex-col items-start gap-4 justify-start">
            <EditableLabel
              value={props.selectedGlyph?.name || ''}
              onSave={(newName) => {
                if (props.selectedGlyph) {
                  props.onGlyphRename(props.selectedGlyph, newName);
                }
              }}
              class="font-mono text-ink-muted text-sm text-left w-full ring-1 ring-edge/50"
            />
            <div class="w-32 h-32 flex items-center justify-center border border-edge bg-background">
              <Show when={selectedPixels()}>
                <PixelIcon
                  pixels={selectedPixels()!}
                  iconSize={iconSize()}
                  pixelSize={props.pixelSize}
                  cornerRadius={props.cornerRadius}
                  gridSize={selectedGridSize()}
                  title={props.selectedGlyph?.name || ''}
                />
              </Show>
            </div>
          </div>

          {/* Global Controls */}

          {/* SVG Output */}
          <Show when={svgString()}>
            <div class="space-y-2">
              <h3 class="font-mono text-ink-muted text-sm">Generated SVG</h3>
              <div class="p-4 rounded-xs bg-message overflow-x-auto max-h-96">
                <pre class="text-xs font-mono whitespace-pre-wrap text-ink-muted">
                  {svgString()}
                </pre>
              </div>

              <div class="flex gap-2">
                <TextButton
                  text="Copy Svg"
                  icon={Copy}
                  onClick={() =>
                    navigator.clipboard.writeText(svgString() || '')
                  }
                  theme="clear"
                />
                <TextButton
                  text="Download Svg"
                  icon={Download}
                  onClick={() => {
                    const svg = svgString();
                    if (!svg) return;
                    const blob = new Blob([svg], { type: 'image/svg+xml' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${props.selectedGlyph?.name || 'glyph'}.svg`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}
                  theme="clear"
                />
              </div>
            </div>
          </Show>

          {/* Base64 Data */}
          <Show when={props.selectedGlyph}>
            <div class="space-y-2">
              <h3 class="font-mono text-ink-muted text-sm">Base64 Data</h3>
              <div class="p-3 bg-message rounded-xs overflow-x-auto max-h-32">
                <pre class="text-xs font-mono whitespace-pre-wrap text-ink-muted">
                  {props.selectedGlyph?.data}
                </pre>
              </div>

              <div class="flex gap-2">
                <TextButton
                  text="Copy Base64"
                  icon={Copy}
                  onClick={() =>
                    navigator.clipboard.writeText(
                      props.selectedGlyph?.data || ''
                    )
                  }
                  theme="clear"
                />
              </div>
            </div>
          </Show>

          {/* Info */}
          <Show when={selectedPixels()}>
            <div class="p-3 bg-message rounded-xs">
              <p class="text-xs text-ink-muted">
                <strong>Grid:</strong> {selectedGridSize()}×{selectedGridSize()}{' '}
                pixels
                <br />
                <strong>Active Pixels:</strong>{' '}
                {selectedPixels()!.flat().filter(Boolean).length}/
                {selectedGridSize() ** 2}
                <br />
                <strong>Data Size:</strong> {props.selectedGlyph?.data.length}{' '}
                characters
              </p>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export default function PixelArtIconDemo() {
  const [glyphs, setGlyphs] = createSignal<Glyph[]>([]);
  const [selectedGlyph, setSelectedGlyph] = createSignal<Glyph | null>(null);
  const [isEditorOpen, setIsEditorOpen] = createSignal(false);
  const [editingGlyph, setEditingGlyph] = createSignal<Glyph | undefined>();

  // Global display settings
  const [pixelSize, setPixelSize] = createSignal(BASE_PX_SIZE);
  const [cornerRadius, setCornerRadius] = createSignal(0);

  // Load saved glyphs on mount
  try {
    const saved = localStorage.getItem('pixel-art-glyphs');
    if (saved) {
      const parsedGlyphs = JSON.parse(saved);
      // Handle migration from old format if needed
      const migratedGlyphs = parsedGlyphs.map((item: any) => {
        if (item.pixels && item.name) {
          // Old format: {name, pixels, timestamp}
          return {
            name: item.name,
            data: encodeGrid(item.pixels),
          };
        }
        // New format: {name, data}
        return item;
      });
      setGlyphs(migratedGlyphs);
    }
  } catch (error) {
    console.warn('Failed to load saved glyphs:', error);
  }

  const saveGlyphs = (newGlyphs: Glyph[]) => {
    setGlyphs(newGlyphs);
    try {
      localStorage.setItem('pixel-art-glyphs', JSON.stringify(newGlyphs));
    } catch (error) {
      console.error('Failed to save glyphs:', error);
    }
  };

  const handleGlyphSelect = (glyph: Glyph) => {
    setSelectedGlyph(glyph);
  };

  const handleEditGlyph = (glyph: Glyph) => {
    console.log('handle edit', glyph);
    setEditingGlyph(glyph);
    setIsEditorOpen(true);
  };

  const handleDeleteGlyph = (glyph: Glyph) => {
    const updated = glyphs().filter((g) => g !== glyph);
    saveGlyphs(updated);
    if (selectedGlyph() === glyph) {
      setSelectedGlyph(null);
    }
  };

  const handleNewGlyph = () => {
    setEditingGlyph(undefined);
    setIsEditorOpen(true);
  };

  const handleSaveGlyph = (name: string, data: string) => {
    const existingIndex = glyphs().findIndex((g) => g.name === name);

    if (existingIndex >= 0) {
      const updated = [...glyphs()];
      updated[existingIndex] = { name, data };
      saveGlyphs(updated);
      setSelectedGlyph(updated[existingIndex]);
    } else {
      const newGlyph = { name, data };
      const updated = [...glyphs(), newGlyph];
      saveGlyphs(updated);
      setSelectedGlyph(newGlyph);
    }

    setEditingGlyph(undefined);
  };

  const handleExportAll = async () => {
    const exportData: Record<string, string> = {};
    glyphs().forEach((glyph) => {
      exportData[glyph.name] = glyph.data;
    });
    await navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
  };

  const sortAlphabetically = () => {
    const sorted = [...glyphs()].sort((a, b) => a.name.localeCompare(b.name));
    saveGlyphs(sorted);
    setSelectedGlyph(sorted[0]);
  };

  const handleImportAll = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      const importData = JSON.parse(clipboardText);

      if (typeof importData === 'object' && importData !== null) {
        const newGlyphs: Glyph[] = Object.entries(importData).map(
          ([name, data]) => ({
            name,
            data: String(data),
          })
        );
        saveGlyphs(newGlyphs);
        setSelectedGlyph(null);
      } else {
        alert(
          'Invalid JSON format. Expected an object with icon names as keys and base64 data as values.'
        );
      }
    } catch (_error) {
      alert('Failed to parse clipboard content as JSON.');
    }
  };

  const handleCopyAllSVGs = async () => {
    const svgPromises = glyphs().map(async (glyph) => {
      try {
        const pixels = decodeGrid(glyph.data);
        const gridSize = pixels.length;
        const iconSize = gridSize * BASE_PX_SIZE;

        return await svgToString<PixelIconProps>(PixelIcon, {
          pixels,
          iconSize,
          pixelSize: pixelSize(),
          cornerRadius: cornerRadius(),
          gridSize,
          title: glyph.name,
        });
      } catch (error) {
        console.warn('Failed to generate SVG for:', glyph.name, error);
        return `<!-- Error generating SVG for ${glyph.name} -->`;
      }
    });

    try {
      const svgStrings = await Promise.all(svgPromises);
      console.log(svgStrings);
      const concatenatedSVGs = svgStrings.join('\n\n');
      await navigator.clipboard.writeText(concatenatedSVGs);
    } catch (_error) {
      alert('Failed to generate or copy SVGs.');
    }
  };

  const handleDownloadAllSVGs = async () => {
    for (const glyph of glyphs()) {
      try {
        const pixels = decodeGrid(glyph.data);
        const gridSize = pixels.length;
        const iconSize = gridSize * BASE_PX_SIZE;

        const svg = await svgToString<PixelIconProps>(PixelIcon, {
          pixels,
          iconSize,
          pixelSize: pixelSize(),
          cornerRadius: cornerRadius(),
          gridSize,
          title: glyph.name,
        });

        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${glyph.name}.svg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Small delay between downloads to avoid overwhelming the browser
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.warn('Failed to download SVG for:', glyph.name, error);
      }
    }
  };

  return (
    <div class="flex flex-col h-full w-full overflow-hidden">
      <Bar
        left={<div class="p-2 text-sm w-2xl truncate">Icon Editor</div>}
        center={<div></div>}
      />

      <div class="flex h-full w-full">
        <GlyphGrid
          glyphs={glyphs()}
          onGlyphSelect={handleGlyphSelect}
          onNewGlyph={handleNewGlyph}
          onEditGlyph={handleEditGlyph}
          onDeleteGlyph={handleDeleteGlyph}
          onGlyphRename={(glyph, newName) => {
            const updated = glyphs().map((g) =>
              g === glyph ? { ...g, name: newName } : g
            );
            saveGlyphs(updated);
            if (selectedGlyph() === glyph) {
              setSelectedGlyph({ ...glyph, name: newName });
            }
          }}
          pixelSize={pixelSize()}
          cornerRadius={cornerRadius()}
          ignoreKeys={() => !!editingGlyph()}
          sortAlphabetically={sortAlphabetically}
        />

        <GlyphSidebar
          selectedGlyph={selectedGlyph()}
          pixelSize={pixelSize()}
          cornerRadius={cornerRadius()}
          onPixelSizeChange={setPixelSize}
          onCornerRadiusChange={setCornerRadius}
          onGlyphRename={(glyph, newName) => {
            const updated = glyphs().map((g) =>
              g === glyph ? { ...g, name: newName } : g
            );
            saveGlyphs(updated);
            if (selectedGlyph() === glyph) {
              setSelectedGlyph({ ...glyph, name: newName });
            }
          }}
          onExportAll={handleExportAll}
          onImportAll={handleImportAll}
          onCopyAllSVGs={handleCopyAllSVGs}
          onDownloadAllSVGs={handleDownloadAllSVGs}
        />
      </div>

      <GlyphEditor
        isOpen={isEditorOpen()}
        onClose={() => {
          console.log('GlyphEditor closed');
          setIsEditorOpen(false);
          setEditingGlyph(undefined);
        }}
        onSave={handleSaveGlyph}
        initialGlyph={editingGlyph()}
      />
    </div>
  );
}
