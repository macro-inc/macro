import { t } from '@app/lib/i18n';
import { Key } from '@solid-primitives/keyed';
import { createMemo, For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { BoardCanvas } from '../components/board-canvas';
import { BoardNode } from '../components/board-node';
import { PersonCard } from '../components/person-card';
import { ZoneFrame } from '../components/zone-frame';
import { ZoomToolbar } from '../components/zoom-toolbar';
import { useBoard } from '../context/board-context';
import type { Bounds } from '../core/camera';
import type { BoardZone } from '../core/item';
import { isFaded, isOnBoard, itemFreshness } from '../core/lifecycle';
import {
  type BoardPerson,
  gatherPeople,
  layoutPeople,
  PEOPLE_METRICS,
  type PeopleGroup,
  personAsItem,
} from '../core/people';
import { createBoardStage } from '../primitives/board-stage';
import { BoardStatus, nodeBindings, type VariantProps } from './variant-shared';

function groupZone(group: PeopleGroup): BoardZone {
  return match(group)
    .returnType<BoardZone>()
    .with('person', () => 'dms')
    .with('contact', () => 'email')
    .with('agent', () => 'agents')
    .exhaustive();
}

function groupName(group: PeopleGroup): string {
  return match(group)
    .with('person', () => t('board.groupTeammates'))
    .with('contact', () => t('board.groupContacts'))
    .with('agent', () => t('board.groupAgents'))
    .exhaustive();
}

function personRole(person: BoardPerson): string {
  return match(person.author.kind)
    .with('person', () => t('board.roleTeammate'))
    .with('contact', () => person.author.id)
    .with('agent', () => t('board.roleAgent'))
    .exhaustive();
}

/** V1E: who is saying what, one card per person, across every conversation. */
export function PeopleBoard(props: VariantProps) {
  const board = useBoard();
  // People come and go with their conversations, and can be closed on
  // their own until they say something new.
  const people = createMemo(() =>
    gatherPeople(props.scene.items()).filter((person) =>
      isOnBoard(
        itemFreshness(
          personAsItem(person),
          props.memory.recall(person.key),
          board.now()
        ),
        props.memory.showSettled()
      )
    )
  );
  const stage = createBoardStage({
    variant: 'v1e',
    memory: props.memory,
    nodes: people,
    layoutBounds: (): Bounds | undefined => layout().bounds,
    fallbackSize: { width: PEOPLE_METRICS.columnWidth, height: 200 },
  });
  const layout = createMemo(() =>
    layoutPeople(stage.flowing(), stage.sizes.size)
  );

  return (
    <BoardCanvas
      ref={stage.camera.bind}
      camera={stage.camera.camera()}
      panning={stage.camera.panning()}
      label={t('board.v1eName')}
      overlay={
        <>
          <BoardStatus
            scene={props.scene}
            memory={props.memory}
            onRetry={props.onRetry}
          />
          <ZoomToolbar
            scale={stage.camera.camera().scale}
            fitted={stage.camera.isFitted()}
            onZoomIn={stage.camera.zoomIn}
            onZoomOut={stage.camera.zoomOut}
            onFit={stage.camera.fit}
          />
        </>
      }
    >
      <For each={layout().groups}>
        {(group) => (
          <ZoneFrame
            zone={groupZone(group.group)}
            bounds={group.bounds}
            count={group.count}
            detail={stage.detail()}
            title={
              <span class="flex items-center gap-[0.55em]">
                <span class="font-semibold text-ink">
                  {groupName(group.group)}
                </span>
                <span class="tabular-nums text-ink-extra-muted">
                  {group.count}
                </span>
              </span>
            }
          />
        )}
      </For>
      <Key each={people()} by="key">
        {(person) => {
          const key = () => person().key;
          const laidOut = () => layout().cards.get(key());
          const point = () => stage.place(key(), laidOut());
          const latestItem = () => person().lines[0]?.itemKey;
          const bind = nodeBindings(stage, person, point, {
            onOpen: () => {
              const itemKey = latestItem();
              if (itemKey) props.onOpen(itemKey);
            },
            onDismiss: props.onDismiss,
          });
          return (
            <Show when={point()}>
              {(at) => (
                <BoardNode
                  ref={(element) => stage.sizes.measure(element, key())}
                  container="group"
                  x={at().x}
                  y={at().y}
                  width={laidOut()?.width ?? PEOPLE_METRICS.columnWidth}
                  label={person().author.name}
                  dismissLabel={t('board.removeItem', {
                    title: person().author.name,
                  })}
                  dragging={bind.dragging()}
                  faded={person().lines.every((line) =>
                    isFaded(props.scene.freshness(line.itemKey))
                  )}
                  onPointerDown={bind.onPointerDown}
                  onOpen={bind.onOpen}
                  onKeyDown={bind.onKeyDown}
                  onDismiss={bind.onDismiss}
                  shapeClass="rounded-2xl"
                >
                  <PersonCard
                    person={person()}
                    now={board.now()}
                    detail={stage.detail()}
                    role={personRole(person())}
                    Avatar={board.Avatar}
                    onOpenLine={(itemKey) => {
                      if (!stage.drag.consumeClick()) props.onOpen(itemKey);
                    }}
                  />
                </BoardNode>
              )}
            </Show>
          );
        }}
      </Key>
    </BoardCanvas>
  );
}
