import { DocumentPreviewContent } from '@core/component/DocumentPreview';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import {
  ConnectorView,
  EllipseView,
  type ItemRenderers,
  RectangleView,
  TextView,
} from '@macro-inc/graphics/solid';
import { CanvasMediaView } from './embedded-items';
import { CanvasTextContent } from './text-content';

/** Renderers for a canvas nobody edits: shapes, text and labels, still media
 * and document previews. Each host adds its own artifact renderer. */
export const STATIC_ITEM_RENDERERS: Partial<Omit<ItemRenderers, 'artifact'>> = {
  connector: (p) => <ConnectorView {...p} contentView={CanvasTextContent} />,
  rectangle: (p) => <RectangleView {...p} contentView={CanvasTextContent} />,
  ellipse: (p) => <EllipseView {...p} contentView={CanvasTextContent} />,
  text: (p) => <TextView {...p} contentView={CanvasTextContent} />,
  image: (p) => <CanvasMediaView {...p} playing={false} onStop={() => {}} />,
  video: (p) => <CanvasMediaView {...p} playing={false} onStop={() => {}} />,
  document: (p) => (
    <DocumentPreviewContent
      documentInfo={{
        id: p.item.geometry.documentId,
        type: fileTypeToBlockName(p.item.geometry.fileType),
        params: {},
        isOpenable: true,
      }}
    />
  ),
};
