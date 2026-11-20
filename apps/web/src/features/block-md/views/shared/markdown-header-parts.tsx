import { EntityAppearanceTrigger } from '@app/features/entity-appearance/entity-appearance';
import { useDocumentAppearance } from '@app/features/entity-appearance/queries/document-appearance';
import { useUserId } from '@core/context/user';
import type { DocumentEntity } from '@entity';
import { type Accessor, Show } from 'solid-js';
import { useMarkdownName } from '../../component/MarkdownNameProvider';
import { useMarkdownDocument } from '../../context/markdown-document-context';

/** Marks a skill beside its title. */
export function SkillBadge() {
  const { kind } = useMarkdownDocument();

  return (
    <Show when={kind() === 'skill'}>
      <span class="ml-1.5 inline-flex shrink-0 items-center self-center rounded-sm bg-hover px-1.5 py-0.5 text-[10px] font-medium leading-none text-ink-muted">
        Skill
      </span>
    </Show>
  );
}

/**
 * The document with its current icon and color, for the header's icon and
 * title menu. Undefined for kinds without an appearance, such as tasks.
 */
export function useMarkdownHeaderEntity(): Accessor<
  DocumentEntity | undefined
> {
  const { entity } = useMarkdownDocument();
  const { displayName } = useMarkdownName();
  const userId = useUserId();
  const appearance = useDocumentAppearance(
    () => entity?.(),
    () => Boolean(userId())
  );

  return () => {
    const current = entity?.();
    return (
      current && {
        ...current,
        name: displayName() ?? current.name,
        appearance: appearance(),
      }
    );
  };
}

/** The document's icon, which an editor can open to change it. */
export function MarkdownAppearanceIcon(props: { entity: DocumentEntity }) {
  const { permissions } = useMarkdownDocument();

  return (
    <EntityAppearanceTrigger
      entity={props.entity}
      editable={permissions.canEdit()}
    />
  );
}
