import type {
  EntityActionListState,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import { ProjectAssignmentDialog } from '@app/features/projects/projects';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { triggerFocusInput } from '@core/directive/focusInput';
import type { EntityData } from '@entity';
import { Button } from '@ui';
import { type ComponentProps, createSignal, type JSX, Show } from 'solid-js';
import {
  createSoupEntityActions,
  viewedProjectIdFromContent,
} from './createSoupEntityActions';
import {
  SoupEntityActionDrawer,
  type SoupEntityDrawerAction,
} from './SoupEntityActionDrawer';

type SoupEntityActionsSheetProps = {
  entity: EntityData;
  list: EntityActionListState;
  viewContext: EntityActionViewContext;
  /** Host-specific actions, in their own group after the entity actions. */
  extraActions?: readonly SoupEntityDrawerAction[];
  /** Host content above the actions, such as a detail's view choices. */
  leading?: (close: () => void) => JSX.Element;
  triggerProps?: ComponentProps<typeof Button>;
  /** Trigger content. */
  children: JSX.Element;
};

/**
 * The touch counterpart of {@link SoupEntityActionsDropdown}: a detail
 * header's title menu that opens the entity's actions in a sheet, as a
 * document's title menu does on touch.
 */
export function SoupEntityActionsSheet(props: SoupEntityActionsSheetProps) {
  const panel = useSplitPanelOrThrow();
  const [open, setOpen] = createSignal(false);
  const [projectTasks, setProjectTasks] = createSignal<string[]>();
  const { buildActionGroups } = createSoupEntityActions({
    selectedEntities: () => [props.entity],
  });

  const groups = () => {
    const entityGroups = buildActionGroups(props.list, [props.entity], {
      viewContext: props.viewContext,
      viewedProjectId: viewedProjectIdFromContent(panel.handle.content()),
      splitHandle: panel.handle,
      openProjectPicker: () => {
        setOpen(false);
        setProjectTasks([props.entity.id]);
      },
    });
    const extra = props.extraActions ?? [];
    return extra.length > 0
      ? [...entityGroups, { items: extra }]
      : entityGroups;
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open()}
        {...props.triggerProps}
        onClick={() => setOpen(true)}
      >
        {props.children}
      </Button>
      <SoupEntityActionDrawer
        entity={props.entity}
        groups={groups()}
        open={open()}
        onOpenChange={setOpen}
        leading={props.leading?.(() => setOpen(false))}
        beforeAction={(action, trigger) => {
          if (action.id !== 'share') return;
          triggerFocusInput(getShareDrawerRecipientInput, trigger);
        }}
      />
      <Show when={projectTasks()}>
        {(ids) => (
          <ProjectAssignmentDialog
            taskIds={ids()}
            onClose={() => setProjectTasks(undefined)}
          />
        )}
      </Show>
    </>
  );
}
