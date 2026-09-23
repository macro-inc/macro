import {
  CanvasDetail,
  type CanvasDetailContext,
} from '@app/features/drive-view/views/CanvasDetail';
import {
  CodeDetail,
  type CodeDetailContext,
} from '@app/features/drive-view/views/CodeDetail';
import {
  ImageDetail,
  type ImageDetailContext,
} from '@app/features/drive-view/views/ImageDetail';
import {
  MarkdownDetail,
  type MarkdownDetailContext,
} from '@app/features/drive-view/views/MarkdownDetail';
import {
  PdfDetail,
  type PdfDetailContext,
} from '@app/features/drive-view/views/PdfDetail';
import {
  UnknownDetail,
  type UnknownDetailContext,
} from '@app/features/drive-view/views/UnknownDetail';
import {
  VideoDetail,
  type VideoDetailContext,
} from '@app/features/drive-view/views/VideoDetail';
import type { MarkdownDocumentKind } from '@block-md/types';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import type { BlockAlias, BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { type JSX, Match, Switch } from 'solid-js';
import type { EntityDetailTarget } from './EntityDetailNavigationStack';

export type EntityDetailContext =
  | MarkdownDetailContext
  | CodeDetailContext
  | CanvasDetailContext
  | ImageDetailContext
  | VideoDetailContext
  | PdfDetailContext
  | UnknownDetailContext;

export type EntityDetailProps = {
  target: EntityDetailTarget;
  shareOpen?: boolean;
  onShareOpenChange?: (open: boolean) => void;
  previewHeaderLeading?: JSX.Element;
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
      headerLeading={props.previewHeaderLeading}
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
    blockType === 'canvas' ||
    blockType === 'spreadsheet' ||
    blockType === 'code' ||
    blockType === 'csv' ||
    blockType === 'image' ||
    blockType === 'pdf' ||
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
  const renderChildren = (context: EntityDetailContext) =>
    props.children?.(context);

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
            {(context) => <>{renderChildren(context)}</>}
          </MarkdownDetail>
        )}
      </Match>
      <Match when={blockType() === 'code' || blockType() === 'csv'}>
        <CodeDetail
          documentId={props.target.id}
          shareOpen={props.shareOpen}
          onShareOpenChange={props.onShareOpenChange}
        >
          {(context) => <>{renderChildren(context)}</>}
        </CodeDetail>
      </Match>
      <Match when={blockType() === 'canvas'}>
        <CanvasDetail
          documentId={props.target.id}
          shareOpen={props.shareOpen}
          onShareOpenChange={props.onShareOpenChange}
        >
          {(context) => <>{renderChildren(context)}</>}
        </CanvasDetail>
      </Match>
      <Match when={blockType() === 'image'}>
        <ImageDetail
          documentId={props.target.id}
          shareOpen={props.shareOpen}
          onShareOpenChange={props.onShareOpenChange}
        >
          {(context) => <>{renderChildren(context)}</>}
        </ImageDetail>
      </Match>
      <Match when={blockType() === 'video'}>
        <VideoDetail
          documentId={props.target.id}
          shareOpen={props.shareOpen}
          onShareOpenChange={props.onShareOpenChange}
        >
          {(context) => <>{renderChildren(context)}</>}
        </VideoDetail>
      </Match>
      <Match when={blockType() === 'pdf'}>
        <PdfDetail
          documentId={props.target.id}
          shareOpen={props.shareOpen}
          onShareOpenChange={props.onShareOpenChange}
        >
          {(context) => <>{renderChildren(context)}</>}
        </PdfDetail>
      </Match>
      <Match when={blockType() === 'unknown'}>
        <UnknownDetail
          documentId={props.target.id}
          shareOpen={props.shareOpen}
          onShareOpenChange={props.onShareOpenChange}
        >
          {(context) => <>{renderChildren(context)}</>}
        </UnknownDetail>
      </Match>
      <Match when={true}>
        <PreviewPanelEntityDetail
          target={props.target}
          previewHeaderLeading={props.previewHeaderLeading}
        />
      </Match>
    </Switch>
  );
}
