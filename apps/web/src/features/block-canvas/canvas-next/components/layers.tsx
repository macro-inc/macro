import { children, type GraphicsDocument } from '@macro-inc/graphics';
import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import BoundingBox from '@phosphor/bounding-box.svg';
import Circle from '@phosphor/circle.svg';
import File from '@phosphor/file.svg';
import Image from '@phosphor/image.svg';
import Pencil from '@phosphor/pencil-simple.svg';
import Rectangle from '@phosphor/rectangle.svg';
import Text from '@phosphor/text-t.svg';
import Video from '@phosphor/video.svg';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';

const icons = {
  surface: BoundingBox,
  group: BoundingBox,
  ellipse: Circle,
  text: Text,
  pencil: Pencil,
  connector: ArrowUpRight,
  rectangle: Rectangle,
  image: Image,
  video: Video,
  document: File,
};

export function CanvasLayers(props: {
  document: GraphicsDocument;
  selected: readonly string[];
  onSelect: (id: string, additive: boolean) => void;
}) {
  const entries = () => {
    const result: { id: string; depth: number }[] = [];
    const visit = (parent: string, depth: number) => {
      for (const id of [...children(props.document, parent)].reverse()) {
        result.push({ id, depth });
        visit(id, depth + 1);
      }
    };
    visit(props.document.rootId, 0);
    return result;
  };
  return (
    <section class="min-h-0 flex-1 overflow-auto p-3" aria-label="Layers">
      <h2 class="mb-2 px-1 text-xs font-medium">
        Layers <span class="font-normal text-ink-muted">· front to back</span>
      </h2>
      <For each={entries()}>
        {(entry) => (
          <button
            type="button"
            onClick={(event) => props.onSelect(entry.id, event.shiftKey)}
            aria-pressed={props.selected.includes(entry.id)}
            title={`${props.document.items[entry.id]?.type} · ${entry.id}`}
            class="flex w-full items-center gap-2 rounded py-2 pr-2 text-left text-xs hover:bg-hover data-[selected=true]:bg-accent-bg data-[selected=true]:text-accent"
            data-selected={props.selected.includes(entry.id)}
            style={{ 'padding-left': `${8 + entry.depth * 12}px` }}
          >
            <Dynamic
              component={
                icons[props.document.items[entry.id]?.type ?? 'rectangle']
              }
              class="size-4 shrink-0"
              aria-hidden="true"
            />
            <span class="capitalize">
              {props.document.items[entry.id]?.type}
            </span>
          </button>
        )}
      </For>
    </section>
  );
}
