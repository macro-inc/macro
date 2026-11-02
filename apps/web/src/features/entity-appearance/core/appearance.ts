import { COLOR_PALETTE } from '@core/constant/color-palette';
import type { AppearanceColor } from '@service-storage/generated/schemas/appearanceColor';
import type { EntityAppearance } from '@service-storage/generated/schemas/entityAppearance';

export type { AppearanceColor, EntityAppearance };

const APPEARANCE_ENTITY_TYPES = [
  'document',
  'initiative',
  'routine',
  'form',
  'database',
] as const;
export type AppearanceEntityType = (typeof APPEARANCE_ENTITY_TYPES)[number];

export const APPEARANCE_COLORS = COLOR_PALETTE.map(
  ({ key }) => key
) satisfies AppearanceColor[];

export function appearanceColor(
  color: AppearanceColor | null | undefined
): string | undefined {
  return COLOR_PALETTE.find(({ key }) => key === color)?.color;
}

export function supportsEntityAppearance<
  T extends {
    type: string;
    fileType?: string | null;
    subType?: { type: string } | null;
  },
>(entity: T): entity is T & { type: AppearanceEntityType } {
  if (entity.type === 'document') {
    return (
      entity.fileType === 'md' &&
      (!entity.subType || entity.subType.type === 'snippet')
    );
  }
  return APPEARANCE_ENTITY_TYPES.some((type) => type === entity.type);
}

export function defaultAppearance(): EntityAppearance {
  return { icon: null, color: null };
}

export function sameAppearance(
  a: EntityAppearance | null | undefined,
  b: EntityAppearance | null | undefined
): boolean {
  return (
    JSON.stringify(a?.icon ?? null) === JSON.stringify(b?.icon ?? null) &&
    (a?.color ?? null) === (b?.color ?? null)
  );
}

/** Decode the shared value when a GraphQL JSON scalar crosses the transport boundary. */
export function readEntityAppearance(value: unknown): EntityAppearance | null {
  if (typeof value !== 'object' || value === null) return null;
  const rawColor = 'color' in value ? value.color : undefined;
  const color = APPEARANCE_COLORS.find((entry) => entry === rawColor) ?? null;
  if (rawColor != null && color === null) return null;
  const rawIcon = 'icon' in value ? value.icon : undefined;
  if (rawIcon == null) return { icon: null, color };
  if (typeof rawIcon !== 'object' || !('kind' in rawIcon)) return null;
  if (
    rawIcon.kind === 'macro' &&
    'name' in rawIcon &&
    typeof rawIcon.name === 'string'
  ) {
    return { icon: { kind: 'macro', name: rawIcon.name }, color };
  }
  if (
    rawIcon.kind === 'emoji' &&
    'value' in rawIcon &&
    typeof rawIcon.value === 'string'
  ) {
    return { icon: { kind: 'emoji', value: rawIcon.value }, color };
  }
  return null;
}
