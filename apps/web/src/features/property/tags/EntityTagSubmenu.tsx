import { t } from '@app/lib/i18n';
import { ContextMenuContent, SubTrigger } from '@core/component/ContextMenu';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity/types/entity';
import TagIcon from '@icon/system/regular/tag-simple.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { useCurrentTeamQuery } from '@queries/team/teams';
import {
  type ManagedDialogProps,
  openDialog,
} from '@ui/components/ImperativeDialog';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { tagEntityType } from './entityTagging';
import { TagEditorDialog, type TagEditorDialogMode } from './TagEditorDialog';
import { TagPickerList } from './TagPicker';
import { createTagPickerSession, type DocTags } from './tag-picker-session';
import { useDocTags } from './useDocTags';

/** Desktop tag picker embedded in an entity context menu. */
export function EntityTagSubmenu(props: {
  entity: EntityData;
  onActionComplete?: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  let saveAndClose: (() => Promise<void>) | undefined;

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setOpen(true);
    } else if (open() && saveAndClose) {
      fireAndForget(saveAndClose(), 'tag-picker');
    } else {
      setOpen(false);
    }
  };

  return (
    <ContextMenu.Sub open={open()} onOpenChange={handleOpenChange}>
      <SubTrigger
        text={t('entityActions.addTag')}
        icon={TagIcon}
        disabled={!tagEntityType(props.entity)}
      />
      <Show when={open() || saving()}>
        <EntityTagSubmenuOwner
          entity={props.entity}
          open={open}
          setSaving={setSaving}
          registerSave={(handler) => (saveAndClose = handler)}
          onClose={() => setOpen(false)}
          onActionComplete={props.onActionComplete}
        />
      </Show>
    </ContextMenu.Sub>
  );
}

function EntityTagSubmenuOwner(props: {
  entity: EntityData;
  open: () => boolean;
  setSaving: (saving: boolean) => void;
  registerSave: (handler: (() => Promise<void>) | undefined) => void;
  onClose: () => void;
  onActionComplete?: () => void;
}) {
  const entityType = tagEntityType(props.entity);
  if (!entityType) return null;

  const docTags = useDocTags(props.entity.id, entityType);
  let pendingSave: Promise<void> | undefined;

  // A picker closes synchronously after starting its save. Keep the mutation
  // owner mounted until that write settles, including a failed write.
  const trackedDocTags: DocTags = {
    ...docTags,
    setTagSelection: async (selection) => {
      props.setSaving(true);
      try {
        pendingSave = docTags.setTagSelection(selection);
        await pendingSave;
      } finally {
        props.setSaving(false);
      }
    },
  };

  const finish = async () => {
    props.onClose();
    try {
      await pendingSave;
    } catch {
      // The picker logs failures and allows a fresh session on reopening.
      return;
    }
    props.onActionComplete?.();
  };

  const session = createTagPickerSession({
    docTags: trackedDocTags,
    onClose: () => fireAndForget(finish(), 'tag-picker'),
    onOpenEditEditor: (mode) => {
      props.onClose();
      props.onActionComplete?.();
      openDialog(ManagedTagEditorDialog, { mode });
    },
    confirmsWithDone: false,
    keyboardTarget: 'local',
  });
  onMount(() => props.registerSave(session.saveAndClose));
  onCleanup(() => {
    // The parent menu can disappear without closing its open submenu first.
    if (props.open()) fireAndForget(session.saveAndClose(), 'tag-picker');
    props.registerSave(undefined);
  });

  return (
    <ContextMenuContent
      submenu
      class="w-96 max-w-[min(24rem,calc(100vw-1.5rem))] p-0"
    >
      <Show when={props.open()}>
        <div
          class="w-full"
          onKeyDown={(event) => {
            session.handleKeyDown(event);
            event.stopPropagation();
          }}
        >
          <TagPickerList session={session} />
        </div>
      </Show>
    </ContextMenuContent>
  );
}

function ManagedTagEditorDialog(
  props: ManagedDialogProps & {
    mode: TagEditorDialogMode;
  }
) {
  const currentTeamQuery = useCurrentTeamQuery();
  return (
    <TagEditorDialog
      open={props.open}
      mode={props.mode}
      teamAvailable={Boolean(currentTeamQuery.data?.team)}
      onClose={() => {
        props.onOpenChange(false);
      }}
    />
  );
}
