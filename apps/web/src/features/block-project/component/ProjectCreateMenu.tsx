import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { createAiDocument } from '@app/features/block-ai/queries/create-ai';
import { createFigDocument } from '@app/features/block-fig/queries/create-fig';
import { createPsdDocument } from '@app/features/block-psd/queries/create-psd';
import { useSpreadsheetAccess } from '@app/features/block-spreadsheet/primitives/use-spreadsheet-access';
import { createSpreadsheetDocument } from '@app/features/block-spreadsheet/queries/create-spreadsheet';
import { openChatWithAgent } from '@app/features/chat/ChatWithAgentButton';
import { t } from '@app/lib/i18n';
import type { BlockTool } from '@components/app/ResponsiveBlockToolbar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { BlockAlias, BlockName } from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { toast } from '@core/component/Toast/Toast';
import {
  enableAiEditor,
  enableFigViewer,
  enablePsdEditor,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { pressedKeys } from '@core/hotkey/state';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import {
  createCanvasFile,
  createMarkdownFile,
  createTask,
} from '@core/util/create';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ObjectLike } from '@core/util/result';
import PlusIcon from '@icon/system/regular/plus.svg';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { createProject } from '@queries/storage/projects';
import { Dialog, Dropdown, Surface } from '@ui';
import { type Component, createSignal, For } from 'solid-js';

type MenuItemProps = {
  label: string;
  Icon: Component;
  action: () => void | Promise<void>;
};

type CreateSpecBase = {
  label: string;
  blockName: BlockName | BlockAlias;
  hotkeyToken: HotkeyToken;
  icon: Component;
};

type CreateBlockSpec = CreateSpecBase & {
  loading?: boolean;
  createFn: (projectId: string) => Promise<string>;
  params?: ObjectLike;
};

/** Opens a new agent conversation that mentions the folder. */
type AgentCreateSpec = CreateSpecBase;

type CreateSpec = CreateBlockSpec | AgentCreateSpec;

const BLOCK_CREATE_SPECS: CreateSpec[] = [
  {
    get label() {
      return t('create.spreadsheetLabel');
    },
    blockName: 'spreadsheet',
    hotkeyToken: TOKENS.create.spreadsheet,
    icon: () => (
      <div class="size-4 shrink-0">
        <EntityIcon
          targetType="spreadsheet"
          size="shrinkFill"
          theme="monochrome"
        />
      </div>
    ),
    loading: true,
    createFn: async (projectId) => {
      const documentId = await createSpreadsheetDocument({ projectId });
      if (!documentId) throw new Error(t('create.failedToCreateSpreadsheet'));
      return documentId;
    },
  },
  {
    get label() {
      return t('create.noteLabel');
    },
    blockName: 'md' as BlockName,
    hotkeyToken: TOKENS.create.note,
    icon: () => (
      <div class="size-4 shrink-0">
        <EntityIcon targetType="md" size="shrinkFill" theme="monochrome" />
      </div>
    ),
    loading: true,
    createFn: async (projectId) => {
      const result = await createMarkdownFile({
        title: '',
        content: '',
        projectId,
      });
      if (!result) throw new Error(t('create.failedToCreateMarkdownFile'));
      return result;
    },
    params: { fromScratch: true },
  },
  {
    get label() {
      return t('create.taskLabel');
    },
    blockName: 'task' as BlockAlias,
    hotkeyToken: TOKENS.create.task,
    icon: () => (
      <div class="size-4 shrink-0">
        <EntityIcon targetType="task" size="shrinkFill" theme="monochrome" />
      </div>
    ),
    loading: true,
    createFn: async (projectId) => {
      const result = await createTask({
        title: '',
        content: '',
        projectId,
        propertyValues: [
          {
            propertyId: SYSTEM_PROPERTY_IDS.STATUS,
            value: {
              type: 'select_option',
              option_id: PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
            },
          },
        ],
      });
      if (!result) throw new Error(t('create.failedToCreateTask'));
      return result;
    },
  },
  {
    get label() {
      return t('create.aiChatLabel');
    },
    blockName: 'chat' as BlockName,
    hotkeyToken: TOKENS.create.chat,
    icon: () => (
      <div class="size-4 shrink-0">
        <EntityIcon targetType="chat" size="shrinkFill" theme="monochrome" />
      </div>
    ),
  },
  {
    get label() {
      return t('create.canvasLabel');
    },
    blockName: 'canvas' as BlockName,
    hotkeyToken: TOKENS.create.canvas,
    icon: () => (
      <div class="size-4 shrink-0">
        <EntityIcon targetType="canvas" size="shrinkFill" theme="monochrome" />
      </div>
    ),
    loading: true,
    createFn: async (projectId) => {
      const result = await createCanvasFile({
        title: 'New Canvas',
        projectId,
      });
      if ('error' in result) {
        console.error(result.error);
        throw new Error(t('create.failedToCreateCanvas'));
      }
      return result.documentId;
    },
  },
  {
    get label() {
      return t('create.photoshopLabel');
    },
    blockName: 'psd' as BlockName,
    hotkeyToken: TOKENS.create.photoshop,
    icon: () => (
      <div class="size-4 shrink-0">
        <EntityIcon targetType="psd" size="shrinkFill" theme="monochrome" />
      </div>
    ),
    loading: true,
    createFn: async (projectId) => {
      const id = await createPsdDocument({ projectId, source: 'project' });
      if (!id) throw new Error(t('create.failedToCreatePhotoshopFile'));
      return id;
    },
  },
  {
    get label() {
      return t('create.designLabel');
    },
    blockName: 'fig' as BlockName,
    hotkeyToken: TOKENS.create.design,
    icon: () => (
      <div class="size-4 shrink-0">
        <EntityIcon targetType="fig" size="shrinkFill" theme="monochrome" />
      </div>
    ),
    loading: true,
    createFn: async (projectId) => {
      const id = await createFigDocument({ projectId, source: 'project' });
      if (!id) throw new Error(t('create.failedToCreateDesign'));
      return id;
    },
  },
  {
    get label() {
      return t('create.illustratorLabel');
    },
    blockName: 'ai' as BlockName,
    hotkeyToken: TOKENS.create.illustration,
    icon: () => (
      <div class="size-4 shrink-0">
        <EntityIcon targetType="ai" size="shrinkFill" theme="monochrome" />
      </div>
    ),
    loading: true,
    createFn: async (projectId) => {
      const id = await createAiDocument({ projectId, source: 'project' });
      if (!id) throw new Error(t('create.failedToCreateIllustratorFile'));
      return id;
    },
  },
  {
    get label() {
      return t('create.folderLabel');
    },
    blockName: 'project' as BlockName,
    hotkeyToken: TOKENS.create.project,
    icon: () => (
      <div class="size-4 shrink-0">
        <EntityIcon targetType="project" size="shrinkFill" theme="monochrome" />
      </div>
    ),
    createFn: async (projectId) => {
      const result = await createProject({
        name: 'New Project',
        parentId: projectId,
      });
      if (!result) throw new Error(t('create.failedToCreateFolder'));
      return result;
    },
  },
];

function makeCreateBlock({
  replaceSplit,
  insertSplit,
}: Pick<ReturnType<typeof useSplitLayout>, 'replaceSplit' | 'insertSplit'>) {
  return async (spec: {
    blockName: BlockName | BlockAlias;
    createFn: () => Promise<string>;
    loading?: boolean;
    params?: Record<string, unknown>;
  }) => {
    const { blockName, createFn, loading, params } = spec;

    const shouldInsert = pressedKeys().has('shift');

    const tryCreate = async () => {
      try {
        const id = await createFn();
        return id;
      } catch (cause) {
        toast.failure(cause instanceof Error ? cause.message : String(cause));
        return null;
      }
    };

    if (!loading) {
      const id = await tryCreate();
      if (!id) return;

      const block = { type: blockName, id, params };

      shouldInsert
        ? insertSplit(block, 'entity-actions-menu')
        : replaceSplit({ content: block, referredFrom: 'entity-actions-menu' });
    } else {
      const split = shouldInsert
        ? insertSplit(
            { type: 'component', id: 'loading' },
            'entity-actions-menu'
          )
        : replaceSplit({
            content: { type: 'component', id: 'loading' },
            referredFrom: 'entity-actions-menu',
          });

      const id = await tryCreate();
      if (!id) {
        split?.goBack();
        return;
      }

      if (split)
        split.replace({
          next: { type: blockName, id, params },
          mergeHistory: true,
          referredFrom: 'entity-actions-menu',
        });
    }
  };
}

function runCreateSpec(
  spec: CreateSpec,
  project: { id: string; name: string },
  createBlock: ReturnType<typeof makeCreateBlock>
) {
  if (!('createFn' in spec)) {
    fireAndForget(
      openChatWithAgent({
        type: 'project',
        id: project.id,
        name: project.name,
      }),
      'project-create'
    );
    return;
  }
  fireAndForget(
    createBlock({
      blockName: spec.blockName,
      loading: spec.loading,
      createFn: () => spec.createFn(project.id),
      params: spec.params,
    }),
    'project-create'
  );
}

function ProjectCreateDialog(props: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  name: string;
}) {
  const { replaceSplit, insertSplit } = useSplitLayout();
  const createBlock = makeCreateBlock({ replaceSplit, insertSplit });
  const spreadsheetAccess = useSpreadsheetAccess();
  const offered = (spec: CreateSpec) => {
    if (spec.blockName === 'spreadsheet') return spreadsheetAccess();
    if (spec.blockName === 'psd') return isFeatureEnabled(enablePsdEditor);
    if (spec.blockName === 'fig') return isFeatureEnabled(enableFigViewer);
    if (spec.blockName === 'ai') return isFeatureEnabled(enableAiEditor);
    return true;
  };

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <Surface depth={2} class="rounded-xl">
        <div class="*:max-h-[75vh]">
          <div class="p-2">
            <Dialog.Title class="text-base font-semibold text-ink pb-3">
              {t('create.createInName', { name: props.name })}
            </Dialog.Title>
            <For each={BLOCK_CREATE_SPECS.filter(offered)}>
              {(spec) => (
                <button
                  class="flex items-center gap-2 py-1 text-sm hover:bg-hover w-full text-left min-h-11"
                  onClick={() => {
                    props.onClose();
                    runCreateSpec(
                      spec,
                      { id: props.projectId, name: props.name },
                      createBlock
                    );
                  }}
                >
                  <div class="size-4 shrink-0">
                    <spec.icon />
                  </div>
                  {spec.label}
                </button>
              )}
            </For>
          </div>
        </div>
      </Surface>
    </Dialog>
  );
}

function MenuItem(props: MenuItemProps) {
  return (
    <Dropdown.Item onSelect={props.action}>
      <div class="size-4 shrink-0">
        <props.Icon />
      </div>
      <span>{props.label}</span>
    </Dropdown.Item>
  );
}

function MenuContent(props: { projectId: string; name: string }) {
  const { replaceSplit, insertSplit } = useSplitLayout();
  const createBlock = makeCreateBlock({ replaceSplit, insertSplit });
  const spreadsheetAccess = useSpreadsheetAccess();
  const offered = (spec: CreateSpec) => {
    if (spec.blockName === 'spreadsheet') return spreadsheetAccess();
    if (spec.blockName === 'psd') return isFeatureEnabled(enablePsdEditor);
    if (spec.blockName === 'fig') return isFeatureEnabled(enableFigViewer);
    if (spec.blockName === 'ai') return isFeatureEnabled(enableAiEditor);
    return true;
  };

  const items = (): MenuItemProps[] =>
    BLOCK_CREATE_SPECS.filter(offered).map((spec) => ({
      label: spec.label,
      Icon: spec.icon,
      action: () =>
        runCreateSpec(
          spec,
          { id: props.projectId, name: props.name },
          createBlock
        ),
    }));

  return (
    <Dropdown.Content class="min-w-max">
      <Dropdown.Group>
        <For each={items()}>{(item) => <MenuItem {...item} />}</For>
      </Dropdown.Group>
    </Dropdown.Content>
  );
}

export function useProjectCreateTools(
  projectId: string,
  name: () => string,
  condition?: () => boolean
): { tools: BlockTool[]; CreateDialog: Component } {
  const [open, setOpen] = createSignal(false);

  const tools: BlockTool[] = [
    {
      label: () => t('create.create'),
      icon: PlusIcon,
      // Using a setTimeout here so that the synthetic click event after the touch doesn't instantly select an item
      action: () => setTimeout(() => setOpen(true), 0),
      condition,
    },
  ];

  const CreateDialog: Component = () => (
    <ProjectCreateDialog
      open={open()}
      onClose={() => setOpen(false)}
      projectId={projectId}
      name={name()}
    />
  );

  return { tools, CreateDialog };
}

export function ProjectCreateMenu(props: { id: string; name: string }) {
  const [open, setOpen] = createSignal(false);
  return (
    <Dropdown open={open()} onOpenChange={setOpen}>
      <Dropdown.Trigger
        as={ViewCreateButton}
        presentation="toolbar"
        menu
        aria-label={t('create.createInFolder')}
      />
      <MenuContent projectId={props.id} name={props.name} />
    </Dropdown>
  );
}
