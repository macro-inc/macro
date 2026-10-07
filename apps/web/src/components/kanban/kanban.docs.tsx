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
  return (
    <div class="flex flex-col gap-6">
      <section>
        <h2 class="text-sm font-semibold">Ordered cards and columns</h2>
        <OrderedExample />
      </section>
      <section>
        <h2 class="text-sm font-semibold">
          Sorted cards, cross-column moves only
        </h2>
        <SortedCrossColumnExample />
      </section>
    </div>
  );
}

function OrderedExample() {
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
        if (drop.kind === 'card') {
          setCards((items) => {
            const card = items.find((item) => item.id === drop.id);

            if (!card) {
              return items;
            }

            const next = items.filter((item) => item.id !== drop.id);
            const before = next.findIndex((item) => item.id === drop.beforeId);
            const insertionIndex = before < 0 ? next.length : before;

            next.splice(insertionIndex, 0, { ...card, lane: drop.toLane });
            return next;
          });
          return;
        }

        setLanes((items) => {
          const next = [...items];
          next.splice(next.indexOf(drop.fromLane), 1);

          const destinationIndex = next.indexOf(drop.toLane);
          const insertionIndex =
            destinationIndex + (drop.edge === 'after' ? 1 : 0);

          next.splice(insertionIndex, 0, drop.fromLane);
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

/** A sorted board owns order and changes only the card's column on drop. */
export function SortedCrossColumnExample() {
  const columns = ['To do', 'In progress', 'Done'];
  const [cards, setCards] = createSignal([
    { id: 'one', title: 'Write tests', column: 'To do', priority: 2 },
    { id: 'two', title: 'Review changes', column: 'To do', priority: 1 },
    { id: 'three', title: 'Ship', column: 'In progress', priority: 3 },
  ]);

  let viewport: HTMLDivElement | undefined;

  const cardsInColumn = (column: string) => {
    return cards()
      .filter((card) => card.column === column)
      .sort((a, b) => a.priority - b.priority);
  };

  return (
    <Kanban
      mode="cross-column"
      getViewport={() => viewport}
      onDrop={(drop) => {
        setCards((items) => {
          return items.map((card) => {
            if (card.id !== drop.id) {
              return card;
            }

            return { ...card, column: drop.toLane };
          });
        });
      }}
    >
      <div ref={viewport} class="flex items-start gap-4 overflow-auto p-4">
        <For each={columns}>
          {(column) => (
            <KanbanLane id={column} label={`${column} column`}>
              <h3 class="px-2 py-3 text-sm font-medium">{column}</h3>
              <div class="flex flex-col gap-2">
                <For each={cardsInColumn(column)}>
                  {(card) => (
                    <KanbanCard id={card.id} laneId={column} canDrag>
                      <div class="p-3 text-sm">
                        {card.title} · Priority {card.priority}
                      </div>
                    </KanbanCard>
                  )}
                </For>
              </div>
            </KanbanLane>
          )}
        </For>
      </div>
    </Kanban>
  );
}
