import { createSignal, For } from 'solid-js';
import { Kanban, KanbanCard, KanbanHandle, KanbanLane } from './kanban';

/** Query-free card and lane drag primitives, reusable by task or database boards. */
export default function KanbanExample() {
  const [lanes, setLanes] = createSignal(['Ideas', 'In progress', 'Done']);
  const [cards, setCards] = createSignal([
    { id: 'one', title: 'Plan the next release', lane: 'Ideas' },
  ]);
  return (
    <Kanban
      onDrop={(drop) => {
        if (drop.kind === 'card')
          setCards((items) =>
            items.map((item) =>
              item.id === drop.id ? { ...item, lane: drop.toLane } : item
            )
          );
        else
          setLanes((items) => {
            const next = [...items];
            next.splice(next.indexOf(drop.fromLane), 1);
            next.splice(items.indexOf(drop.toLane), 0, drop.fromLane);
            return next;
          });
      }}
    >
      <div class="flex items-start gap-4 overflow-auto p-4">
        <For each={lanes()}>
          {(lane) => (
            <KanbanLane id={lane} label={`${lane} lane`} canReorder>
              <KanbanHandle
                label={`Reorder ${lane}`}
                class="px-2 py-3 text-sm font-medium"
              >
                {lane}
              </KanbanHandle>
              <For each={cards().filter((card) => card.lane === lane)}>
                {(card) => (
                  <KanbanCard id={card.id} laneId={lane} canDrag>
                    <div class="p-3 text-sm">{card.title}</div>
                  </KanbanCard>
                )}
              </For>
            </KanbanLane>
          )}
        </For>
      </div>
    </Kanban>
  );
}
