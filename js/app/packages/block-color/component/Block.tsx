import type { ColorBlock, ColorDocument } from '@block-color/type/ColorBlock';
import { generateRandomThemeBlock } from '@block-color/util/generateRandomThemeBlock';
import { getRandomOklch } from '@block-color/util/getRandomOklch';
import {
  applyConstraints,
  formatOklch,
  parseOklch,
} from '@block-color/util/oklch';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { IconButton } from '@core/component/IconButton';
import { TextButton } from '@core/component/TextButton';
import XIcon from '@icon/regular/x.svg?component-solid';
import { makePersisted } from '@solid-primitives/storage';
import { useSearchParams } from '@solidjs/router';
import { createEffect, createMemo, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { colorBlockDataSignal } from '../colorBlockData';
import TopBar from './TopBar';

function serialize(data: ColorBlock): string {
  return encodeURIComponent(JSON.stringify(data));
}

export default function Block() {
  const blockData = colorBlockDataSignal.get;
  const [, setParams] = useSearchParams();

  const [colorStore, setColorStore] = makePersisted(
    createStore<Record<string, ColorDocument>>({}),
    { name: 'block-color.store' }
  );

  // Initialize local store with a ColorDocument and sync URL state
  createEffect(() => {
    const data = blockData();
    if (!data) return;
    const id = data.id as string;
    const existing = colorStore[id];
    const doc: ColorDocument =
      existing ??
      (() => {
        const now = Date.now();
        return {
          id,
          data: data.colorBlock as ColorBlock,
          createdAt: now,
          updatedAt: now,
          type: 'color',
        };
      })();
    setColorStore(id, doc);
    setParams({ state: serialize(doc.data) }, { replace: true });
  });

  const id = createMemo(() => {
    return blockData()?.id ?? '';
  });

  const currentBlock = createMemo<ColorBlock | undefined>(() => {
    const currentId = id();
    return colorStore[currentId]?.data;
  });

  const onGenerateRandom = () => {
    const currentId = id();
    if (!currentId) return;

    // Generate a valid theme layout first
    const baseBlock = generateRandomThemeBlock();

    // Apply constraints per column and normalize rows to respect row 1
    const adjustedColumns = baseBlock.columns.map((col, ci) => {
      const base = parseOklch(col.colors[0]?.color);
      const constraints =
        ci === 0
          ? { lockL: true, lockC: true, lockH: false }
          : { lockL: false, lockC: true, lockH: true };

      if (!base) {
        return { ...col, constraints } as typeof col;
      }

      const colors = col.colors.map((sw, idx) => {
        if (idx === 0) return sw;
        const parsed = parseOklch(sw.color);
        if (!parsed) return sw;
        const constrained = applyConstraints(base, parsed, constraints);
        return { ...sw, color: formatOklch(constrained) };
      });

      return { ...col, colors, constraints } as typeof col;
    });

    const randomBlock: ColorBlock = {
      ...baseBlock,
      columns: adjustedColumns,
    };

    const now = Date.now();
    setColorStore(currentId, (prev) => ({
      id: currentId,
      data: randomBlock,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      fileType: 'color',
    }));
    setParams({ state: serialize(randomBlock) }, { replace: true });
  };

  const insertColumnAt = (insertIndex: number) => {
    const currentId = id();
    if (!currentId) return;
    const baseData = currentBlock();
    if (!baseData) return;

    const newColumn = {
      colors: [{ color: getRandomOklch() }],
      constraints: { lockL: false, lockC: false, lockH: false },
    } as ColorBlock['columns'][number];

    const newColumns = [
      ...baseData.columns.slice(0, insertIndex),
      newColumn,
      ...baseData.columns.slice(insertIndex),
    ];

    const updatedAt = Date.now();
    setColorStore(currentId, 'data', 'columns', newColumns);
    setColorStore(currentId, 'updatedAt', updatedAt);
    setParams(
      { state: serialize({ ...baseData, columns: newColumns }) },
      { replace: true }
    );
  };

  const insertRowAt = (columnIndex: number, insertIndex: number) => {
    const currentId = id();
    if (!currentId) return console.log('no id');
    const baseData = currentBlock();
    if (!baseData) return console.log('no base data');

    const targetColumn = baseData.columns[columnIndex];
    if (!targetColumn) return console.log('no target column');

    const baseOklch = parseOklch(targetColumn.colors[0]?.color);
    const candidate = parseOklch(getRandomOklch());
    if (!baseOklch || !candidate) return console.log('no base or candidate');

    const constrained = applyConstraints(
      baseOklch,
      candidate,
      targetColumn.constraints
    );
    const newSwatch = { color: formatOklch(constrained) };
    const newColors = [
      ...targetColumn.colors.slice(0, insertIndex),
      newSwatch,
      ...targetColumn.colors.slice(insertIndex),
    ];

    const updatedAt = Date.now();
    setColorStore(
      currentId,
      'data',
      'columns',
      columnIndex,
      'colors',
      newColors
    );
    setColorStore(currentId, 'updatedAt', updatedAt);
    setParams(
      {
        state: serialize({
          ...baseData,
          columns: baseData.columns.map((c, i) =>
            i === columnIndex ? { ...c, colors: newColors } : c
          ),
        }),
      },
      { replace: true }
    );
  };

  const toggleConstraint = (
    columnIndex: number,
    key: 'lockL' | 'lockC' | 'lockH'
  ) => {
    const currentId = id();
    if (!currentId) return;
    const baseData = currentBlock();
    if (!baseData) return;

    const col = baseData.columns[columnIndex];
    const constraints = {
      lockL: col.constraints?.lockL ?? false,
      lockC: col.constraints?.lockC ?? false,
      lockH: col.constraints?.lockH ?? false,
      [key]: !(col.constraints?.[key] ?? false),
    } as NonNullable<ColorBlock['columns'][number]['constraints']>;

    const baseOklch = parseOklch(col.colors[0]?.color);
    if (!baseOklch) return;

    const updatedColors = col.colors.map((sw, i) => {
      if (i === 0) return sw; // keep base as-is
      const parsed = parseOklch(sw.color);
      if (!parsed) return sw;
      const constrained = applyConstraints(baseOklch, parsed, constraints);
      return { ...sw, color: formatOklch(constrained) };
    });

    const updatedAt = Date.now();
    setColorStore(
      currentId,
      'data',
      'columns',
      columnIndex,
      'constraints',
      constraints
    );
    setColorStore(
      currentId,
      'data',
      'columns',
      columnIndex,
      'colors',
      updatedColors
    );
    setColorStore(currentId, 'updatedAt', updatedAt);

    setParams(
      {
        state: serialize({
          ...baseData,
          columns: baseData.columns.map((c, i) =>
            i === columnIndex ? { ...c, colors: updatedColors, constraints } : c
          ),
        }),
      },
      { replace: true }
    );
  };

  const deleteRowAt = (columnIndex: number, rowIndex: number) => {
    const currentId = id();
    if (!currentId) return;
    const baseData = currentBlock();
    if (!baseData) return;

    const targetColumn = baseData.columns[columnIndex];
    if (!targetColumn) return;

    // Prevent deleting the last remaining swatch in the last column
    if (baseData.columns.length <= 1 && targetColumn.colors.length <= 1) return;

    const newColors = targetColumn.colors.filter((_, i) => i !== rowIndex);

    const updatedAt = Date.now();
    if (newColors.length === 0) {
      // Remove the entire column if no swatches remain
      const filteredColumns = baseData.columns.filter(
        (_, i) => i !== columnIndex
      );
      setColorStore(currentId, 'data', 'columns', filteredColumns);
      setColorStore(currentId, 'updatedAt', updatedAt);
      setParams(
        { state: serialize({ ...baseData, columns: filteredColumns }) },
        { replace: true }
      );
      return;
    }

    // Otherwise just update the colors in the target column
    setColorStore(
      currentId,
      'data',
      'columns',
      columnIndex,
      'colors',
      newColors
    );
    setColorStore(currentId, 'updatedAt', updatedAt);
    setParams(
      {
        state: serialize({
          ...baseData,
          columns: baseData.columns.map((c, i) =>
            i === columnIndex ? { ...c, colors: newColors } : c
          ),
        }),
      },
      { replace: true }
    );
  };

  return (
    <DocumentBlockContainer title={currentBlock()?.name ?? 'Color Block'}>
      <div class="w-full h-full bg-panel flex flex-col relative">
        <TopBar
          colorBlock={currentBlock}
          id={id()}
          onGenerateRandom={onGenerateRandom}
        />
        <div class="flex w-full h-full overflow-auto">
          <For each={currentBlock()?.columns ?? []}>
            {(col, index) => (
              <div class="relative group flex flex-col flex-1">
                {/* Floating column constraint controls (show on hover) */}
                <div class="absolute top-0 left-0 right-0 z-10 flex justify-center items-center gap-1 p-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  Constrain
                  <TextButton
                    theme={col.constraints?.lockL ? 'accent' : 'clear'}
                    text="L"
                    class="pointer-events-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleConstraint(index(), 'lockL');
                    }}
                  />
                  <TextButton
                    theme={col.constraints?.lockC ? 'accent' : 'clear'}
                    text="C"
                    class="pointer-events-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleConstraint(index(), 'lockC');
                    }}
                  />
                  <TextButton
                    theme={col.constraints?.lockH ? 'accent' : 'clear'}
                    text="H"
                    class="pointer-events-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleConstraint(index(), 'lockH');
                    }}
                  />
                </div>

                {/* Left insert hotspot */}
                <div
                  class="absolute inset-y-0 left-0 w-2 cursor-pointer opacity-0 hover:opacity-100 hover:bg-accent hover-transition-bg"
                  onClick={(e) => {
                    e.stopPropagation();
                    insertColumnAt(index());
                  }}
                />

                {/* Column contents */}
                <For each={col.colors}>
                  {(swatch, rowIndex) => (
                    <div class="relative group flex-1">
                      {/* Top insert hotspot for rows */}
                      <div
                        class="absolute inset-x-0 top-0 h-2 cursor-pointer opacity-0 hover:opacity-100 hover:bg-accent hover-transition-bg"
                        onClick={(e) => {
                          e.stopPropagation();
                          insertRowAt(index(), rowIndex());
                        }}
                      />

                      {/* The swatch fill */}
                      <div
                        class="w-full h-full"
                        style={{ 'background-color': swatch.color }}
                      />

                      {/* Delete swatch (X) */}
                      <Show
                        when={
                          (currentBlock()?.columns.length ?? 0) > 1 ||
                          (col.colors.length ?? 0) > 1
                        }
                      >
                        <div class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <IconButton
                            icon={XIcon}
                            theme="clear"
                            iconSize={14}
                            class="p-0.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteRowAt(index(), rowIndex());
                            }}
                            aria-label="Delete swatch"
                            tooltip={{ label: 'Delete swatch' }}
                          />
                        </div>
                      </Show>

                      {/* Bottom insert hotspot for rows */}
                      <div
                        class="absolute inset-x-0 bottom-0 h-2 cursor-pointer opacity-0 hover:opacity-100 hover:bg-accent hover-transition-bg"
                        onClick={(e) => {
                          e.stopPropagation();
                          insertRowAt(index(), rowIndex() + 1);
                        }}
                      />
                    </div>
                  )}
                </For>

                {/* Right insert hotspot */}
                <div
                  class="absolute inset-y-0 right-0 w-2 cursor-pointer opacity-0 hover:opacity-100 hover:bg-accent hover-transition-bg"
                  onClick={(e) => {
                    e.stopPropagation();
                    insertColumnAt(index() + 1);
                  }}
                />
              </div>
            )}
          </For>
        </div>
      </div>
    </DocumentBlockContainer>
  );
}
