import { CodeDetail } from '@app/features/drive-view/views/CodeDetail';
import { ImageDetail } from '@app/features/drive-view/views/ImageDetail';
import { MarkdownDetail } from '@app/features/drive-view/views/MarkdownDetail';
import { UnknownDetail } from '@app/features/drive-view/views/UnknownDetail';
import { VideoDetail } from '@app/features/drive-view/views/VideoDetail';
import type { MarkdownDocumentKind } from '@block-md/types';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import type { BlockAlias, BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { type JSX, Match, Switch } from 'solid-js';
import type { EntityDetailTarget } from './EntityDetailNavigationStack';

export type EntityDetailContext = {
  documentMetadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
  blockType: BlockName | BlockAlias;
};

export type EntityDetailProps = {
  target: EntityDetailTarget;
  shareOpen?: boolean;
  onShareOpenChange?: (open: boolean) => void;
  children?: (context: EntityDetailContext) => JSX.Element;
};

function PreviewPanelEntityDetail(props: EntityDetailProps) {
  const orchestrator = useGlobalBlockOrchestrator();
  const panel = useSplitPanelOrThrow();

  return (
    <PreviewPanel
      selectedEntity={props.target}
      orchestrator={orchestrator}
      splitPanelContext={panel}
    />
  );
}

function markdownKind(kind: BlockName | BlockAlias): MarkdownDocumentKind {
  if (kind === 'task' || kind === 'snippet' || kind === 'skill') return kind;
  return 'document';
}

export function entityDetailBlockType(
  target: EntityDetailTarget
): BlockName | BlockAlias | undefined {
  if (target.type !== 'document') return;

  const subType = target.subType?.type;
  const blockType = fileTypeToBlockName(
    subType === 'task' || subType === 'snippet' || subType === 'skill'
      ? subType
      : target.fileType
  );
  if (
    blockType === 'md' ||
    blockType === 'task' ||
    blockType === 'snippet' ||
    blockType === 'skill' ||
    blockType === 'code' ||
    blockType === 'csv' ||
    blockType === 'image' ||
    blockType === 'video' ||
    blockType === 'unknown'
  ) {
    return blockType;
  }
}

export function EntityDetail(props: EntityDetailProps) {
  const documentTarget = () =>
    props.target.type === 'document' ? props.target : undefined;
  const blockType = () => entityDetailBlockType(props.target);
  const renderChildren = (
    documentMetadata: DocumentMetadata,
    userAccessLevel: AccessLevel
  ) =>
    props.children?.({
      documentMetadata,
      userAccessLevel,
      blockType: blockType()!,
    });

  return (
    <Switch>
      <Match
        when={
          blockType() === 'md' ||
          blockType() === 'task' ||
          blockType() === 'snippet' ||
          blockType() === 'skill'
            ? documentTarget()
            : undefined
        }
      >
        {(target) => (
          <MarkdownDetail
            documentId={target().id}
            kind={markdownKind(blockType()!)}
            fallbackName={target().fallbackName}
            shareOpen={props.shareOpen}
            onShareOpenChange={props.onShareOpenChange}
          >
            {(context) =>
              renderChildren(
                context.data.metadata,
                context.data.userAccessLevel
              )
            }
          </MarkdownDetail>
        )}
      </Match>
      <Match when={blockType() === 'code' || blockType() === 'csv'}>
        <CodeDetail
          documentId={props.target.id}
          shareOpen={props.shareOpen}
          onShareOpenChange={props.onShareOpenChange}
        >
          {(context) =>
            renderChildren(
              context.data.documentMetadata,
              context.data.userAccessLevel
            )
          }
        </CodeDetail>
      </Match>
      <Match when={blockType() === 'image'}>
        <ImageDetail
          documentId={props.target.id}
          shareOpen={props.shareOpen}
          onShareOpenChange={props.onShareOpenChange}
        >
          {(context) =>
            renderChildren(
              context.data.documentMetadata,
              context.data.userAccessLevel
            )
          }
        </ImageDetail>
      </Match>
      <Match when={blockType() === 'video'}>
        <VideoDetail
          documentId={props.target.id}
          shareOpen={props.shareOpen}
          onShareOpenChange={props.onShareOpenChange}
        >
          {(context) =>
            renderChildren(
              context.data.documentMetadata,
              context.data.userAccessLevel
            )
          }
        </VideoDetail>
      </Match>
      <Match when={blockType() === 'unknown'}>
        <UnknownDetail
          documentId={props.target.id}
          shareOpen={props.shareOpen}
          onShareOpenChange={props.onShareOpenChange}
        >
          {(context) =>
            renderChildren(
              context.data.documentMetadata,
              context.data.userAccessLevel
            )
          }
        </UnknownDetail>
      </Match>
      <Match when={true}>
        <PreviewPanelEntityDetail target={props.target} />
      </Match>
    </Switch>
  );
}
