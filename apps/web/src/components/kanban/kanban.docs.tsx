import { createSignal, For } from 'solid-js';
import {
  Kanban,
  KanbanCard,
  KanbanCardInsertion,
  KanbanHandle,
  KanbanLane,
} from './kanban';

/** Query-free card and lane drag primitives, reusable by task or database boards. */
export default function KanbanExample() {
  const [lanes, setLanes] = createSignal(['Ideas', 'In progress', 'Done']);
  const [cards, setCards] = createSignal([
    { id: 'one', title: 'Plan the next release', lane: 'Ideas' },
    { id: 'two', title: 'Review the design', lane: 'Ideas' },
    { id: 'three', title: 'Share the prototype', lane: 'In progress' },
  ]);
  let viewport: HTMLDivElement | undefined;
  return (
    <Kanban
      getViewport={() => viewport}
      onDrop={(drop) => {
        if (drop.kind === 'card')
          setCards((items) => {
            const card = items.find((item) => item.id === drop.id);
            if (!card) return items;
            const next = items.filter((item) => item.id !== drop.id);
            const before = next.findIndex((item) => item.id === drop.beforeId);
            next.splice(before < 0 ? next.length : before, 0, {
              ...card,
              lane: drop.toLane,
            });
            return next;
          });
        else
          setLanes((items) => {
            const next = [...items];
            next.splice(next.indexOf(drop.fromLane), 1);
            next.splice(
              next.indexOf(drop.toLane) + (drop.edge === 'after' ? 1 : 0),
              0,
              drop.fromLane
            );
            return next;
          });
      }}
    >
      <div ref={viewport} class="flex items-start gap-4 overflow-auto p-4">
        <For each={lanes()}>
          {(lane) => (
            <KanbanLane id={lane} label={`${lane} lane`} canReorder>
              <KanbanHandle
                label={`Reorder ${lane}`}
                class="px-2 py-3 text-sm font-medium"
              >
                {lane}
              </KanbanHandle>
              <div class="relative flex flex-col gap-2">
                <For each={cards().filter((card) => card.lane === lane)}>
                  {(card) => (
                    <KanbanCard id={card.id} laneId={lane} canDrag>
                      <div class="p-3 text-sm">{card.title}</div>
                    </KanbanCard>
                  )}
                </For>
                <KanbanCardInsertion laneId={lane} />
              </div>
            </KanbanLane>
          )}
        </For>
      </div>
    </Kanban>
  );
}
