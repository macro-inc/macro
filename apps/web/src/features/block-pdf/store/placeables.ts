import { DEFAULT_COLOR, type IColor } from '@block-pdf/model/Color';
import { PageModel } from '@block-pdf/model/Page';
import { useIsPopup } from '@block-pdf/signal/pdfViewer';
import {
  useDeleteComment,
  useDeleteMessageCommentThread,
  useDeleteNewComments,
} from '@block-pdf/store/comments/commentOperations';
import { createPdfDraftThreadId } from '@block-pdf/type/comments';
import type { Annotation, ShapeType } from '@block-pdf/type/pdfJs';
import {
  type IPlaceable,
  type IPlaceablePayload,
  type IPlaceablePosition,
  type ISignature,
  type ITextBoxPlaceable,
  type IThreadPlaceable,
  PayloadMode,
  type PayloadType,
} from '@block-pdf/type/placeables';
import { normalizeRect } from '@block-pdf/util/pdfjsUtils';
import { PDF_TO_CSS_UNITS } from '@block-pdf/util/pixelsPerInch';
import { useUserId } from '@core/context/user';
import { createCallback } from '@solid-primitives/rootless';
import type { PageViewport } from 'pdfjs-dist';
import { batch, createEffect, createMemo } from 'solid-js';
import { v7 as uuid7 } from 'uuid';
import { usePdfComments } from '../context/pdf-comments-context';
import { usePdfDocument } from '../context/pdf-document-context';
import { usePdfViewer } from '../context/pdf-viewer-context';
import {
  isThreadPlaceable,
  useCommentPlaceables,
} from './comments/freeComments';
import { useEditPdfFreeCommentAnchor } from './commentsResource';

interface AppearancePayload {
  bold: boolean;
  color: IColor;
  family: string;
  italic: boolean;
  size: number;
}

const DEFAULT_APPEARANCE_PAYLOAD: AppearancePayload = {
  bold: false,
  color: DEFAULT_COLOR,
  family: 'Times New Roman',
  italic: false,
  size: 12,
};

export function usePlaceableIdMap() {
  const modificationData = usePdfDocument().model.modificationData;
  const commentPlaceables = useCommentPlaceables();

  return createMemo(() => {
    const placeables = modificationData.placeables.concat(commentPlaceables());
    return Object.fromEntries(
      placeables.map((placeable) => [placeable.internalId, placeable])
    ) as Record<string, IPlaceable>;
  });
}

function useCurrentScale() {
  const isPopup = useIsPopup();
  const viewer = usePdfViewer();
  const currentScale = isPopup
    ? viewer.popup.currentScale
    : viewer.root.currentScale;

  return () => currentScale() ?? 1;
}

function useGetPopupContextViewer() {
  const isPopup = useIsPopup();
  const viewer = usePdfViewer();

  return (isPopup ? viewer.popup : viewer.root).instance;
}

function convertRawRGBToColor(
  r: string | number,
  g: string | number,
  b: string | number
): IColor {
  const numR = typeof r === 'number' ? r : Math.round(parseFloat(r) * 255);
  const numG = typeof g === 'number' ? g : Math.round(parseFloat(g) * 255);
  const numB = typeof b === 'number' ? b : Math.round(parseFloat(b) * 255);
  return { red: numR, green: numG, blue: numB };
}

function parseDefaultAppearance(appearance: string): AppearancePayload {
  const fontMatch = appearance.match(/\/\/([\w-]+)\s(\d+)/);
  const colorMatch = appearance.match(
    /([0-9]+\.?[0-9]*)\s([0-9]+\.?[0-9]*)\s([0-9]+\.?[0-9]*)\srg/
  );

  const mapping: Partial<
    Record<string, Pick<AppearancePayload, 'family' | 'bold' | 'italic'>>
  > = {
    Helvetica: { family: 'Helvetica', bold: false, italic: false },
    'Helvetica-Bold': { family: 'Helvetica', bold: true, italic: false },
    'Helvetica-Oblique': { family: 'Helvetica', bold: false, italic: true },
    'Helvetica-BoldOblique': { family: 'Helvetica', bold: true, italic: true },
    'Times-Roman': { family: 'Times New Roman', bold: false, italic: false },
    'Times-Bold': { family: 'Times New Roman', bold: true, italic: false },
    'Times-Italic': { family: 'Times New Roman', bold: false, italic: true },
    'Times-BoldItalic': { family: 'Times New Roman', bold: true, italic: true },
    Courier: { family: 'Courier', bold: false, italic: false },
    'Courier-Bold': { family: 'Courier', bold: true, italic: false },
    'Courier-Oblique': { family: 'Courier', bold: false, italic: true },
    'Courier-BoldOblique': { family: 'Courier', bold: true, italic: true },
  };

  let name = 'Times-Roman';
  if (fontMatch && fontMatch[1] && mapping[fontMatch[1]]) {
    name = fontMatch[1];
  }
  const mapMatch = mapping[name];
  if (!mapMatch) return DEFAULT_APPEARANCE_PAYLOAD;
  const { family, bold, italic } = mapMatch;

  let size = 12;
  if (fontMatch && fontMatch[2]) {
    size = parseInt(fontMatch[2], 10);
  }

  let color = DEFAULT_COLOR;
  if (colorMatch) {
    if (colorMatch[1] && colorMatch[2] && colorMatch[3]) {
      color = convertRawRGBToColor(colorMatch[1], colorMatch[2], colorMatch[3]);
    }
  }

  return {
    family,
    size,
    bold,
    italic,
    color,
  };
}

function internalIdToIndex(placeables: IPlaceable[], id: string) {
  return placeables.findIndex((p) => p.internalId === id);
}

function getPlaceablePosition(
  rect: any,
  pageViewport: PageViewport
): IPlaceablePosition {
  const [x1, y1, x2, y2] = normalizeRect(rect);
  const position: IPlaceablePosition = {
    xPct: x1 / pageViewport.width,
    yPct: (pageViewport.height - y1 - (y2 - y1)) / pageViewport.height,
    widthPct: (x2 - x1) / pageViewport.width,
    heightPct: (y2 - y1) / pageViewport.height,
    rotation: 0,
  };
  return position;
}

function convertFreeTextToPlaceable({
  annotation,
  annotationIndex,
  pageViewport,
  pageIndex,
}: {
  annotation: Annotation;
  annotationIndex: number;
  pageIndex: number;
  pageViewport: PageViewport;
}) {
  const da = annotation.defaultAppearance;
  const appearancePayload = da
    ? parseDefaultAppearance(da)
    : DEFAULT_APPEARANCE_PAYLOAD;
  const position = getPlaceablePosition(annotation.rect, pageViewport);
  const placeable: IPlaceable = {
    allowableEdits: {
      allowResize: true,
      allowTranslate: true,
      allowRotate: false,
      allowDelete: true,
      lockAspectRatio: false,
    },
    wasEdited: false,
    wasDeleted: false,
    pageRange: new Set<number>([pageIndex]),
    position,
    originalIndex: annotationIndex,
    shouldLockOnSave: false,
    originalPage: pageIndex,
    payload: {
      color: appearancePayload.color,
      fontSize: appearancePayload.size,
      fontFamily: appearancePayload.family,
      bold: appearancePayload.bold,
      text: annotation.contentsObj?.str || '',
      italic: appearancePayload.italic,
      underlined: false,
      textType: 'annotation',
    },
    payloadType: 'free-text-annotation',
    internalId: uuid7(),
  };
  return placeable;
}

function convertShapeAnnotationToPlaceable({
  annotation,
  annotationIndex,
  pageViewport,
  pageIndex,
}: {
  annotation: Annotation;
  annotationIndex: number;
  pageIndex: number;
  pageViewport: PageViewport;
}): IPlaceable {
  const da = annotation.defaultAppearance;
  const appearancePayload = da
    ? parseDefaultAppearance(da)
    : DEFAULT_APPEARANCE_PAYLOAD;
  const position = getPlaceablePosition(annotation.rect, pageViewport);
  const shape =
    annotation.subtype === 'Polygon' ? 'Triangle' : annotation.subtype;
  const c = annotation.rawColor;
  const borderStyle = annotation.borderStyle;
  const borderWidth = borderStyle ? borderStyle.width || 0 : 0;
  const borderColor =
    c && borderWidth ? convertRawRGBToColor(c[0], c[1], c[2]) : DEFAULT_COLOR;
  const ic = annotation.rawInteriorColor;
  const fillColor = ic
    ? convertRawRGBToColor(ic[0], ic[1], ic[2])
    : DEFAULT_COLOR;
  const placeable: IPlaceable = {
    allowableEdits: {
      allowResize: true,
      allowTranslate: true,
      allowRotate: false,
      allowDelete: true,
      lockAspectRatio: false,
    },
    wasEdited: false,
    wasDeleted: false,
    pageRange: new Set<number>([pageIndex]),
    position,
    originalIndex: annotationIndex,
    shouldLockOnSave: false,
    originalPage: pageIndex,
    payload: {
      redact: false,
      fillColor,
      borderColor,
      borderWidth: annotation.borderStyle?.width ?? 1,
      color: appearancePayload.color,
      shape: shape.toLowerCase() as ShapeType,
    },
    payloadType: 'shape-annotation',
    internalId: uuid7(),
  };
  return placeable;
}

export function annotationsToPlaceables({
  pageIndex,
  annotations,
  pageViewport,
}: {
  pageIndex: number;
  annotations: Annotation[];
  pageViewport: PageViewport;
}): IPlaceable[] {
  let placeables: IPlaceable[] = [];

  // We will increment this when we come across annotation placeables
  // The list that increments it needs to match the pdfserver as they
  // will track the same types to avoid munging others
  let validAnnotationPlaceableIndex = -1;

  let annotation: Annotation;
  for (
    let annotationIndex = 0;
    annotationIndex < annotations.length;
    annotationIndex++
  ) {
    annotation = annotations[annotationIndex];

    if (
      ['FreeText', 'Circle', 'Square', 'Polygon'].includes(annotation.subtype)
    ) {
      validAnnotationPlaceableIndex += 1;
    }

    if (annotation.subtype === 'FreeText') {
      placeables.push(
        convertFreeTextToPlaceable({
          annotation,
          annotationIndex: validAnnotationPlaceableIndex,
          pageViewport,
          pageIndex,
        })
      );
    }

    if (['Circle', 'Square', 'Polygon'].includes(annotation.subtype)) {
      placeables.push(
        convertShapeAnnotationToPlaceable({
          annotation,
          annotationIndex: validAnnotationPlaceableIndex,
          pageViewport,
          pageIndex,
        })
      );
    }
  }

  return placeables;
}

function makePosition(
  x: number,
  y: number,
  pageRef: HTMLElement,
  w: number,
  h: number,
  centerOnPosition?: boolean
) {
  const { x: pageX, y: pageY, width, height } = pageRef.getBoundingClientRect();

  return {
    xPct: (x - pageX) / width - (centerOnPosition ? w / width / 2 : 0),
    yPct: (y - pageY) / height - (centerOnPosition ? h / height / 2 : 0),
    widthPct: w / width,
    heightPct: h / height,
    rotation: 0,
  };
}

function useMakeThread() {
  const deleteNewComments = useDeleteNewComments();
  const currentScale = useCurrentScale();
  const userId = useUserId();

  return createCallback(
    (e: MouseEvent, pageRef: HTMLElement, index: number): IThreadPlaceable => {
      const userId_ = userId();
      if (!userId_) {
        throw new Error('Current user ID not found');
      }

      deleteNewComments();

      const curScale = currentScale();

      const position = makePosition(
        e.clientX,
        e.clientY,
        pageRef,
        30 * curScale,
        30 * curScale
      );

      return {
        internalId: uuid7(),
        isNew: true,
        owner: userId_,
        allowableEdits: {
          allowResize: false,
          allowTranslate: true,
          allowRotate: false,
          allowDelete: true,
          lockAspectRatio: false,
        },
        wasEdited: false,
        wasDeleted: false,
        pageRange: new Set([index]),
        position,
        payload: null,
        payloadType: 'thread',
        shouldLockOnSave: false,
        originalPage: index,
        originalIndex: -1,
      };
    }
  );
}

function useMakeSignature() {
  const getViewer = useGetPopupContextViewer();
  const currentScale = useCurrentScale();
  const defaultSignature: ISignature | undefined = undefined;

  return (e: MouseEvent, pageRef: HTMLElement, index: number): IPlaceable => {
    const curViewer = getViewer();
    const curScale = currentScale();

    let payload: ISignature | undefined = defaultSignature;
    if (!payload) {
      payload = {
        base64: null,
        dateTime: Date.now(),
        signatureType: 'image',
        opacity: 1,
        location: '',
        email: '',
        signerCert: null,
        aspectRatio: null,
      };
    }

    // At default zoom and font size, 250px can hold ~15-20 characters horizontally
    // We want to vertically position so that the center of our textbox is at the center
    // of the text cursor caret.
    const cursorOffsetY = 14;
    const cursorOffsetX = 10;

    const { x, y } = pageRef.getBoundingClientRect();
    const unscaledDimensions = curViewer?.pageDimensions(index, false) ?? {
      width: 0,
      height: 0,
    };
    const pdfViewScale =
      curViewer?.getScale({ pageNumber: 1 })?.scale ??
      (curScale ?? 1) * PDF_TO_CSS_UNITS;
    const width = unscaledDimensions.width * pdfViewScale;
    const height = unscaledDimensions.height * pdfViewScale;
    const w = 100 * curScale;
    const h = 25 * curScale;

    const position = {
      xPct: (e.clientX - x - cursorOffsetX) / width,
      yPct: (e.clientY - y - cursorOffsetY) / height - h / height / 2,
      widthPct: w / width,
      heightPct: h / height,
      rotation: 0,
    };

    return {
      internalId: uuid7(),
      allowableEdits: {
        allowResize: true,
        allowTranslate: true,
        allowRotate: true,
        allowDelete: true,
        lockAspectRatio: true,
      },
      wasEdited: false,
      wasDeleted: false,
      pageRange: new Set([index]),
      position,
      payload,
      payloadType: 'signature',
      shouldLockOnSave: true,
      originalPage: index,
      originalIndex: -1,
    };
  };
}

const textAnnotationProperties = {
  widthInPixels: 175,
  heightInPixels: 17,
  defaultFontSize: 10,
};

function useMakeTextAnnotation() {
  const getViewer = useGetPopupContextViewer();
  const currentScale = useCurrentScale();

  return (
    pageRef: HTMLElement,
    index: number,
    text = '',
    e?: MouseEvent
  ): ITextBoxPlaceable => {
    const curViewer = getViewer();
    const curScale = currentScale();
    const fontFamily = DEFAULT_APPEARANCE_PAYLOAD.family;
    let position: IPlaceablePosition;

    if (e) {
      const cursorOffsetY = 14;
      const cursorOffsetX = 14;

      const { x, y } = pageRef.getBoundingClientRect();
      const unscaledDimensions = curViewer?.pageDimensions(index, false) ?? {
        width: 0,
        height: 0,
      };
      const pdfViewScale =
        curViewer?.getScale({ pageNumber: 1 })?.scale ??
        (curScale ?? 1) * PDF_TO_CSS_UNITS;
      const width = unscaledDimensions.width * pdfViewScale;
      const height = unscaledDimensions.height * pdfViewScale;
      const w = textAnnotationProperties.widthInPixels * curScale;
      const h = textAnnotationProperties.heightInPixels * curScale;

      position = {
        xPct: (e.clientX - x - cursorOffsetX) / width,
        yPct: (e.clientY - y - cursorOffsetY) / height - h / height / 2,
        widthPct: w / width,
        heightPct: h / height,
        rotation: 0,
      };
    } else {
      const { width, height } = pageRef.getBoundingClientRect();
      position = {
        xPct: 0.01,
        yPct: 0.01,
        widthPct: textAnnotationProperties.widthInPixels / width,
        heightPct: textAnnotationProperties.heightInPixels / height,
        rotation: 0,
      };
    }

    return {
      internalId: uuid7(),
      allowableEdits: {
        allowResize: true,
        allowTranslate: true,
        allowRotate: true,
        allowDelete: true,
        lockAspectRatio: false,
      },
      wasEdited: true,
      wasDeleted: false,
      pageRange: new Set([index]),
      position,
      payload: {
        color: { red: 0, green: 0, blue: 0, alpha: 1 },
        fontSize: 10,
        bold: false,
        fontFamily,
        text,
        italic: false,
        underlined: false,
        textType: 'pdf-text',
      },
      payloadType: 'free-text-annotation',
      shouldLockOnSave: false,
      originalPage: index,
      originalIndex: -1,
    };
  };
}

/**
 * Sets active placeable when a *click outside* event occurs that sets an active comment
 * Specifically in the comment MeasureContainer area
 *
 * Invoke once inside the PDF document provider.
 */
export function useSyncActivePlaceableWithCommentThread() {
  const placeableIdMap = usePlaceableIdMap();
  const pdf = usePdfDocument();
  const comments = usePdfComments();
  const activeId = pdf.markup.activeId;
  const activeCommentThreadId = comments.activeThreadId;

  createEffect(() => {
    const activeThreadId = activeCommentThreadId();
    const activeIdValue = activeId();
    const activePlaceable = activeIdValue
      ? placeableIdMap()[activeIdValue]
      : null;

    if (
      activeThreadId == null &&
      activePlaceable &&
      isThreadPlaceable(activePlaceable)
    ) {
      pdf.markup.commands.clearActive();
    }
    if (activeThreadId == null) return;

    const matchingFreeCommentPlaceable = Object.values(placeableIdMap()).find(
      (placeable) =>
        isThreadPlaceable(placeable) &&
        placeable.payload?.threadId === activeThreadId
    );

    if (matchingFreeCommentPlaceable) {
      pdf.markup.commands.activate(matchingFreeCommentPlaceable.internalId);
    }
  });
}

export function useCreatePlaceable() {
  const makeThread = useMakeThread();
  const makeTextAnnotation = useMakeTextAnnotation();
  const makeSignature = useMakeSignature();
  const pdf = usePdfDocument();
  const comments = usePdfComments();

  return async (e: MouseEvent) => {
    let placeable: IPlaceable | null;
    const pageRef = PageModel.getPageNode(e.currentTarget as HTMLElement);
    if (pageRef == null) {
      console.error('Expected page ref!');
      return;
    }

    const index = PageModel.getPageIndex(pageRef)!;
    switch (pdf.markup.mode()) {
      case PayloadMode.Thread:
        placeable = makeThread(e, pageRef, index);
        break;
      case PayloadMode.Signature:
        placeable = makeSignature(e, pageRef, index);
        break;
      case PayloadMode.FreeTextAnnotation:
        placeable = makeTextAnnotation(pageRef, index, '', e);
        break;
      default:
        throw new Error('Placeable mode not implemented');
    }

    batch(() => {
      if (!isThreadPlaceable(placeable)) {
        pdf.model.commands.appendPlaceable(placeable);
      } else {
        comments.activateThread(
          createPdfDraftThreadId('free', placeable.internalId)
        );
      }
      pdf.markup.commands.activate(placeable.internalId);
      pdf.markup.commands.setDraft(placeable);
    });

    pdf.markup.commands.cancelPlacement();

    e.stopPropagation();
    e.preventDefault();
  };
}

export function useModifyPlaceable() {
  const model = usePdfDocument().model;

  return (index: number, updatedPlaceable: IPlaceable) => {
    return model.commands.updatePlaceable(index, updatedPlaceable);
  };
}

export function useModifyPayload() {
  const modifyPlaceable = useModifyPlaceable();
  const modificationData = usePdfDocument().model.modificationData;

  return <T extends PayloadType>(
    id: string,
    payloadType: T,
    newPartialPayload: Partial<
      Extract<IPlaceablePayload, { payloadType: T }>['payload']
    >
  ) => {
    const index = internalIdToIndex(modificationData.placeables, id);
    if (index < 0) return false;

    const existingPlaceable = modificationData.placeables.at(index);
    if (!existingPlaceable) return false;
    if (payloadType !== existingPlaceable.payloadType) return false;

    const updatedPlaceable = {
      ...existingPlaceable,
      payload: {
        ...existingPlaceable.payload,
        ...newPartialPayload,
      },
    } as IPlaceable;

    return modifyPlaceable(index, updatedPlaceable);
  };
}

export function useDeletePlaceable() {
  const pdf = usePdfDocument();
  const modificationData = pdf.model.modificationData;
  const placeableIdMap = usePlaceableIdMap();
  const deleteComment = useDeleteComment();
  const deleteMessageCommentThread = useDeleteMessageCommentThread();
  const deleteNewComments = useDeleteNewComments();

  return createCallback((uuid: string) => {
    const placeable = placeableIdMap()[uuid];
    if (!placeable) {
      console.error('Placeable not found', uuid);
      return;
    }

    if (isThreadPlaceable(placeable) && pdf.annotations.unified) {
      const threadId = placeable.payload?.threadId;
      if (threadId == null) {
        deleteNewComments();
        return;
      }
      void deleteMessageCommentThread(threadId);
      return;
    }

    if (isThreadPlaceable(placeable)) {
      let rootId = placeable.payload?.rootId;
      if (!rootId) {
        deleteComment({ commentId: -1 });
        return;
      }
      deleteComment({ commentId: rootId });
      return;
    }

    const index = internalIdToIndex(modificationData.placeables, uuid);

    const deleted = pdf.model.commands.removePlaceable(index);
    if (deleted) {
      pdf.markup.commands.clearActiveIf(uuid);
    }
    return deleted;
  });
}

export function useUpdatePlaceablePosition() {
  const modifyPlaceable = useModifyPlaceable();
  const editPdfFreeCommentAnchor = useEditPdfFreeCommentAnchor();
  const pdf = usePdfDocument();
  const modificationData = pdf.model.modificationData;
  const placeableIdMap = usePlaceableIdMap();

  return createCallback(
    (
      uuid: string,
      {
        xPct: _xPct,
        yPct: _yPct,
        widthPct: _widthPct,
        heightPct: _heightPct,
        pageNum: _pageNum,
      }: {
        xPct?: number;
        yPct?: number;
        widthPct?: number;
        heightPct?: number;
        pageNum?: number;
      }
    ) => {
      const placeable = placeableIdMap()[uuid];
      if (!placeable) {
        console.error('Placeable not found', uuid);
        return;
      }

      const pageNum = _pageNum ?? placeable.originalPage;
      const samePage = pageNum === placeable.originalPage;

      const existingPosition = placeable.position;
      const xPct = _xPct ?? existingPosition.xPct;
      const yPct = _yPct ?? existingPosition.yPct;
      const widthPct = _widthPct ?? existingPosition.widthPct;
      const heightPct = _heightPct ?? existingPosition.heightPct;

      if (
        existingPosition.xPct === xPct &&
        existingPosition.yPct === yPct &&
        existingPosition.widthPct === widthPct &&
        existingPosition.heightPct === heightPct &&
        samePage
      ) {
        return false;
      }

      const newPosition: IPlaceablePosition = {
        ...existingPosition,
        xPct,
        yPct,
        widthPct,
        heightPct,
      };
      let updatedPlaceable = {
        ...placeable,
        position: newPosition,
      };

      if (!samePage) {
        updatedPlaceable = {
          ...updatedPlaceable,
          pageRange: new Set([pageNum]),
          originalPage: pageNum,
        };
        if (isThreadPlaceable(updatedPlaceable)) {
          if ((updatedPlaceable as IThreadPlaceable).isNew) {
            pdf.markup.commands.setDraft(updatedPlaceable);
            return;
          } else {
            return editPdfFreeCommentAnchor(uuid, {
              xPct: updatedPlaceable.position.xPct,
              yPct: updatedPlaceable.position.yPct,
              widthPct: updatedPlaceable.position.widthPct,
              heightPct: updatedPlaceable.position.heightPct,
              page: pageNum,
            });
          }
        }
        switch (updatedPlaceable.payloadType) {
          case PayloadMode.FreeTextAnnotation:
          case PayloadMode.Signature:
            break;
          default:
            console.error('Unhandled payload type', updatedPlaceable.payload);
            return false;
        }
      }

      if (isThreadPlaceable(updatedPlaceable)) {
        if (updatedPlaceable.isNew) {
          pdf.markup.commands.setDraft(updatedPlaceable);
          return;
        } else {
          return editPdfFreeCommentAnchor(uuid, {
            xPct: updatedPlaceable.position.xPct,
            yPct: updatedPlaceable.position.yPct,
            widthPct: updatedPlaceable.position.widthPct,
            heightPct: updatedPlaceable.position.heightPct,
          });
        }
      }

      const index = internalIdToIndex(modificationData.placeables, uuid);
      return modifyPlaceable(index, updatedPlaceable);
    }
  );
}
