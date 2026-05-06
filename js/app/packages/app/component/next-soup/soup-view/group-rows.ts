import type {
  GroupConfig,
  GroupMeta,
  SoupEntity,
  SoupRow,
  SoupState,
} from '@app/component/next-soup/create-soup-state';

interface GroupRowsOptions<T extends string> {
  entities: SoupEntity[];
  soup: SoupState;
  activeGroupId: string | undefined;
  groupConfigs: Record<T, GroupConfig<SoupEntity>>;
}

export function buildGroupedRows<T extends string>(
  options: GroupRowsOptions<T>
): SoupRow[] {
  const { entities, soup, activeGroupId, groupConfigs } = options;

  if (!activeGroupId || !(activeGroupId in groupConfigs)) {
    return entities.map((e) => soup.buildRow(e));
  }

  const config = groupConfigs[activeGroupId as T];
  const groupMap = new Map<unknown, SoupEntity[]>();
  const groupOrder: unknown[] = [];

  for (const entity of entities) {
    const value = config.getValue(entity);
    if (!groupMap.has(value)) {
      groupMap.set(value, []);
      groupOrder.push(value);
    }
    groupMap.get(value)!.push(entity);
  }

  const result: SoupRow[] = [];

  for (const groupValue of groupOrder) {
    const groupEntities = groupMap.get(groupValue)!;
    const groupIdStr = `group-${config.id}-${String(groupValue)}`;
    const label = config.getLabel
      ? config.getLabel(groupValue)
      : String(groupValue);

    const groupMeta: GroupMeta = {
      id: groupIdStr,
      value: groupValue,
      label,
      count: groupEntities.length,
      isExpanded: () => soup.grouping.isExpanded(groupIdStr),
      toggle: () => soup.grouping.toggle(groupIdStr),
      renderHeader: config.renderHeader,
    };

    const firstEntity = groupEntities[0];
    result.push(
      soup.buildRow(firstEntity, {
        group: groupMeta,
        parentGroupId: groupIdStr,
      })
    );

    if (soup.grouping.isExpanded(groupIdStr)) {
      for (let i = 1; i < groupEntities.length; i++) {
        result.push(
          soup.buildRow(groupEntities[i], {
            parentGroupId: groupIdStr,
          })
        );
      }
    }
  }

  return result;
}
