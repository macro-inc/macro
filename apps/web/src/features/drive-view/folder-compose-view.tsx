import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { toast } from '@core/component/Toast/Toast';
import { onMount, Suspense } from 'solid-js';
import type { FolderDraft, FolderSubmission } from './core/folder-composer';
import { createFolderCommands } from './queries/folder-creation';
import { CreateFolder } from './views/create-folder';

type FolderComposeProps = {
  parentId?: string;
  destination?: string;
  source?: string;
  initialDraft?: FolderDraft;
};

async function settleFolderSubmission(
  submission: FolderSubmission,
  options: FolderComposeProps,
  layout: Pick<
    ReturnType<typeof useSplitLayout>,
    'popoverSplit' | 'openWithSplit'
  >
) {
  const outcome = await submission.result;
  if (outcome.type === 'failed') {
    toast.failure(
      outcome.draft.error ?? 'Could not finish creating the folder.',
      {
        actions: [
          {
            label: 'Retry',
            onClick: () => {
              layout.popoverSplit({
                type: 'component',
                id: 'folder-compose',
                params: { ...options, initialDraft: outcome.draft },
              });
            },
          },
        ],
      }
    );
    return;
  }
  toast.success(`Created “${outcome.name}”`, {
    actions: [
      {
        label: 'Open',
        onClick: () => {
          layout.openWithSplit({ type: 'project', id: outcome.id });
        },
      },
    ],
  });
}

export function FolderComposeView(props: FolderComposeProps) {
  const layout = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  const commands = createFolderCommands({
    parentId: props.parentId,
    source: props.source,
  });
  onMount(() => panel.handle.setDisplayName('New folder'));
  const close = () => panel.handle.close();
  return (
    <SplitPanel.Root class="bg-transparent">
      <SplitPanel.Body>
        <Suspense>
          <CreateFolder
            commands={commands}
            destination={
              props.destination ??
              (props.parentId ? 'Selected folder' : 'Drive')
            }
            initialDraft={props.initialDraft}
            onClose={close}
            onExpand={
              panel.handle.isPopover()
                ? (initialDraft) => {
                    layout.openWithSplit(
                      {
                        type: 'component',
                        id: 'folder-compose',
                        params: { ...props, initialDraft },
                      },
                      { preferNewSplit: true }
                    );
                    close();
                  }
                : undefined
            }
            onSubmit={(submission) => {
              const options = {
                parentId: props.parentId,
                destination: props.destination,
                source: props.source,
              };
              close();
              void settleFolderSubmission(submission, options, layout);
            }}
          />
        </Suspense>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
