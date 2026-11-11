import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type {
  SavedTaskTemplate,
  SelectableTaskTemplate,
  TemplatePickerItem,
} from '../../task-composer/core/template-selection';
import type { TaskComposerController } from '../../task-composer/primitives/task-composer';

export type TemplateDialogScope = {
  viewerId: Accessor<string | undefined>;
  isCurrent(): boolean;
};

type TemplateControlsOptions = {
  composer: Pick<
    TaskComposerController,
    | 'templatesEnabled'
    | 'draftOwner'
    | 'isCreating'
    | 'team'
    | 'templateSelection'
    | 'isTemplateDirty'
    | 'selectTemplate'
    | 'editTemplate'
    | 'selectNoTemplate'
    | 'startNewTemplate'
    | 'resetTemplateFields'
    | 'updateTemplateFields'
    | 'cancelTemplateEdit'
    | 'detachTemplate'
  >;
  viewerId: Accessor<string | undefined>;
  templates: Accessor<readonly SelectableTaskTemplate[]>;
  confirmReplace(scope: TemplateDialogScope, replace: () => void): void;
  confirmDelete(
    scope: TemplateDialogScope,
    template: SavedTaskTemplate,
    onDeleted: () => void
  ): void;
  notifyUnavailable(): void;
};

/** Close imperative dialogs when their captured account, scope, or editor retires. */
export function createTemplateDialogLifetime(
  scope: TemplateDialogScope,
  close: () => void
) {
  const viewer = scope.viewerId();
  let alive = true;
  const current = () =>
    alive &&
    Boolean(viewer) &&
    viewer === scope.viewerId() &&
    scope.isCurrent();
  createEffect(
    on(current, (active) => {
      if (!active) close();
    })
  );
  onCleanup(() => {
    alive = false;
  });
  return { viewer, current };
}
export function createTemplateDeletion(options: {
  scope: TemplateDialogScope;
  pending: Accessor<boolean>;
  deleteTemplate(viewerId: string): Promise<unknown>;
  onDeleted(): void;
  close(): void;
}) {
  const lifetime = createTemplateDialogLifetime(options.scope, options.close);
  const [failure, setFailure] = createSignal<unknown>();
  const remove = async () => {
    if (!lifetime.current() || !lifetime.viewer || options.pending()) return;
    setFailure(undefined);
    try {
      await options.deleteTemplate(lifetime.viewer);
      if (!lifetime.current()) return;
      options.onDeleted();
      options.close();
    } catch (error) {
      if (lifetime.current()) setFailure(error);
    }
  };
  return { failure, remove };
}

/** Template management stays scoped to the picker that admitted the interaction. */
export function createTemplateControls(options: TemplateControlsOptions) {
  const { composer } = options;
  const viewer = options.viewerId();
  const teamId = composer.team()?.id;
  let alive = true;
  onCleanup(() => {
    alive = false;
  });
  const canUse = () =>
    composer.templatesEnabled() &&
    options.viewerId() === composer.draftOwner &&
    !composer.isCreating();
  const isCurrent = () =>
    alive &&
    canUse() &&
    options.viewerId() === viewer &&
    composer.team()?.id === teamId;
  const scope = { viewerId: options.viewerId, isCurrent };
  const selectedKey = () => {
    const selection = composer.templateSelection();
    if (selection.kind === 'saved' || selection.kind === 'editing')
      return selection.template.id;
    return selection.kind;
  };
  const selectedLabel = () => {
    const selection = composer.templateSelection();
    if (selection.kind === 'none') return t('create.taskTemplateNone');
    if (selection.kind === 'new' || selection.kind === 'editing')
      return selection.name || t('create.taskTemplates');
    return selection.template.name;
  };
  const selectedCanManage = () => {
    const selection = composer.templateSelection();
    if (selection.kind !== 'saved' && selection.kind !== 'editing')
      return false;
    if (!isCurrent()) return false;
    const target = selection.template;
    if (target.teamId && target.teamId !== composer.team()?.id) return false;
    return options
      .templates()
      .some(
        (template) =>
          template.id === target.id &&
          template.teamId === target.teamId &&
          template.canManage
      );
  };
  const switchTemplate = (replace: () => void) => {
    if (!isCurrent()) return;
    if (composer.isTemplateDirty()) options.confirmReplace(scope, replace);
    else replace();
  };
  const select = (template: SelectableTaskTemplate) => {
    const selection = composer.templateSelection();
    const alreadySelected =
      selection.kind === 'saved' &&
      selection.template.id === template.id &&
      selection.template.revision === template.revision;
    if (alreadySelected) return;
    switchTemplate(() => {
      if (!isCurrent()) return;
      const {
        canManage: _canManage,
        hasUnavailableProperties: _unavailable,
        ...saved
      } = template;
      composer.selectTemplate(saved);
      if (template.hasUnavailableProperties) options.notifyUnavailable();
    });
  };
  const edit = (template: SelectableTaskTemplate) => {
    if (!isCurrent() || !template.canManage) return;
    const {
      canManage: _canManage,
      hasUnavailableProperties: _unavailable,
      ...saved
    } = template;
    composer.editTemplate(saved);
  };
  const items = (): TemplatePickerItem[] =>
    options.templates().map((template) => ({
      key: template.id,
      label: template.name,
      shared: Boolean(template.teamId),
      select: () => select(template),
      edit: template.canManage ? () => edit(template) : undefined,
    }));
  const selectNone = () => {
    if (composer.templateSelection().kind === 'none') return;
    switchTemplate(() => {
      if (isCurrent()) composer.selectNoTemplate();
    });
  };
  const startNew = () => {
    if (isCurrent()) composer.startNewTemplate();
  };
  const reset = () => {
    if (isCurrent() && selectedCanManage()) composer.resetTemplateFields();
  };
  const update = () => {
    if (isCurrent() && selectedCanManage())
      fireAndForget(composer.updateTemplateFields(), 'task-templates');
  };
  const remove = () => {
    const selection = composer.templateSelection();
    if (!isCurrent() || !selectedCanManage() || selection.kind !== 'editing')
      return;
    const template = selection.template;
    // The delete result applies only to the editor that opened the confirmation.
    options.confirmDelete(
      {
        viewerId: options.viewerId,
        isCurrent: () =>
          isCurrent() && composer.templateSelection() === selection,
      },
      template,
      () => {
        composer.cancelTemplateEdit();
        const restored = composer.templateSelection();
        if (restored.kind === 'saved' && restored.template.id === template.id)
          composer.detachTemplate();
      }
    );
  };
  return {
    canUse,
    isCurrent,
    scope,
    items,
    selectedKey,
    selectedLabel,
    selectedCanManage,
    selectNone,
    startNew,
    reset,
    update,
    remove,
  };
}
