import { type Accessor, batch, type Setter } from 'solid-js';
export function createCrmFilterSelections(input: {
  stageFilter: Accessor<string[]>;
  setStageFilter: Setter<string[]>;
  ownerFilter: Accessor<string[]>;
  setOwnerFilter: Setter<string[]>;
  defaultStages: Accessor<string[]>;
  isActive(id: string): boolean;
  toggle(id: string): void;
}) {
  const defaultIds = () => new Set(input.defaultStages());
  const set = (
    kind: 'company-stage' | 'company-owner',
    ids: string[],
    update: Setter<string[]>
  ) =>
    batch(() => {
      update(ids);
      if (ids.length > 0 !== input.isActive(kind)) input.toggle(kind);
    });
  const changeStageChip = (ids: string[]) =>
    set('company-stage', ids, input.setStageFilter);
  const changeOwner = (ids: string[]) =>
    set('company-owner', ids, input.setOwnerFilter);
  return {
    changeOwner,
    changeStageChip,
    changeStage(ids: string[]) {
      changeStageChip(
        ids.length === defaultIds().size &&
          ids.every((id) => defaultIds().has(id))
          ? []
          : ids
      );
    },
    effectiveStages: () =>
      input.stageFilter().length ? input.stageFilter() : [...defaultIds()],
  };
}
