import { DEFAULT_COLOR, type IColor } from '@block-pdf/model/Color';
import { PageModel } from '@block-pdf/model/Page';
import { pdfModificationDataStore } from '@block-pdf/signal/document';
import {
  useCurrentScale,
  useGetPopupContextViewer,
} from '@block-pdf/signal/pdfViewer';
import {
  activePlaceableIdSignal,
  newPlaceableSignal,
  placeableModeSignal,
} from '@block-pdf/signal/placeables';
import { useDoEdit } from '@block-pdf/signal/save';
import {
  useDeleteComment,
  useDeleteNewComments,
} from '@block-pdf/store/comments/commentOperations';
import type {
  Annotation,
  // AnnotationFlag,
  ShapeType,
} from '@block-pdf/type/pdfJs';
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
// import { reformatPdfjsDate } from '@block-pdf/util/DateUtils';
import { normalizeRect } from '@block-pdf/util/pdfjsUtils';
import { PDF_TO_CSS_UNITS } from '@block-pdf/util/pixelsPerInch';
import {
  createBlockEffect,
  createBlockMemo,
  createBlockSignal,
} from '@core/block';
import { useUserId } from '@service-gql/client';
import { createCallback } from '@solid-primitives/rootless';
import type { PageViewport } from 'pdfjs-dist';
import { batch } from 'solid-js';
import { v7 as uuid7 } from 'uuid';
import { activeCommentThreadSignal } from './comments/commentStore';
import { commentPlaceables, isThreadPlaceable } from './comments/freeComments';
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

export const placeableIdMap = createBlockMemo(() => {
  const placeables = pdfModificationDataStore.get.placeables.concat(
    commentPlaceables() ?? []
  );
  return Object.fromEntries(placeables.map((p) => [p.internalId, p])) as Record<
    string,
    IPlaceable
  >;
});

// function convertTextAnnotationToThread(
//   annotation: Annotation,
//   pageIndex: number
// ): IThread {
//   let editDate: Date = reformatPdfjsDate(
//     annotation.modificationDate,
//     annotation.creationDate
//   );
//   const comment: IComment = {
//     content: annotation.contentsObj!.str,
//     sender: annotation.titleObj?.str ?? '',
//     editDate: editDate,
//     id: annotation.id,
//   };
//   const newThread: IThread = {
//     headID: annotation.id,
//     page: pageIndex,
//     comments: [comment],
//     isResolved: annotation.annotationFlags === AnnotationFlag.HIDDEN,
//   };
//   return newThread;
// }

// function convertTextAnnotationToComment(annotation: Annotation) {
//   let editDate: Date = reformatPdfjsDate(
//     annotation.modificationDate,
//     annotation.creationDate
//   );
//   const comment: IComment = {
//     content: annotation.contentsObj!.str,
//     sender: annotation.titleObj?.str ?? '',
//     editDate: editDate,
//     id: annotation.id,
//   };
//   return comment;
// }

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

// helper function to convert internal id (uuid) to array index
function internalIdToIndex(id: string) {
  const placeables = pdfModificationDataStore.get.placeables;
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
  // If interior color wasn't set, make sure alpha gets set to 0
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
  // let threads = new Array<IThread>();

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

    // TODO: fully deprecate
    // Handle plain text annotations for comments & threads
    // if (annotation.subtype === 'Text' && !!annotation.contentsObj?.str) {
    //   if (annotation.inReplyTo == null) {
    //     threads.push(convertTextAnnotationToThread(annotation, pageIndex));
    //   }
    //   if (annotation.inReplyTo != null) {
    //     // eslint-disable-next-line no-loop-func
    //     const replyTo = threads.find((t) => t.headID === annotation.inReplyTo);
    //     if (replyTo) {
    //       const comment = convertTextAnnotationToComment(annotation);
    //       replyTo.comments.push(comment);
    //     }
    //   }
    // }

    // Handle free text annotations that convert to activateable placeables
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

    // Handle shape annotations that convert to activateable placeables
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

  // Zip threads and replies back together
  // const finalThreads = threads.map((thread) => {
  //   const payload: IThread = thread;
  //   let headAnnot = annotations.find((a) => a.id === thread.headID);
  //   const position = getPlaceablePosition(headAnnot?.rect, pageViewport);
  //   const threadPlaceable: IPlaceable = {
  //     allowableEdits: {
  //       allowResize: false,
  //       allowTranslate: true,
  //       allowRotate: false,
  //       allowDelete: true,
  //       lockAspectRatio: true,
  //     },
  //     pageRange: new Set<number>([pageIndex]),
  //     position,
  //     shouldLockOnSave: false,
  //     originalPage: pageIndex,
  //     originalIndex: -1,
  //     payload,
  //     payloadType: 'thread',
  //     wasEdited: false,
  //     wasDeleted: false,
  //   };
  //   return threadPlaceable;
  // });

  // Return all placeables together
  // return [finalThreads, placeables].flat(1);
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
  // previously created signatures
  // const selectedSavedSignature = useSignatureValue();
  const defaultSignature: ISignature | undefined = undefined;
  // const defaultSignature = useMemo(
  //   () => selectedSavedSignature.options.at(0),
  //   [selectedSavedSignature.options]
  // );

  // const prompt = usePrompt();

  return (e: MouseEvent, pageRef: HTMLElement, index: number): IPlaceable => {
    const curViewer = getViewer();
    const curScale = currentScale();

    let payload: ISignature | undefined = defaultSignature;
    if (!payload) {
      // // prompt the user for their initial signature
      // const res = await prompt<typeof EditSignatureDialog>((args) => (
      //   <EditSignatureDialog {...args} />
      // ));
      // // short circuit if user declined, we wont create a signature
      // if (res.isErr()) return null;
      // payload = res.value;
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

const fontOptions = ['Times New Roman', 'Courier', 'Helvetica'] as const;
export const fontPreferenceSignal = createBlockSignal<
  (typeof fontOptions)[number]
>(fontOptions[0]);

const textAnnotationProperties = {
  widthInPixels: 175,
  heightInPixels: 17,
  defaultFontSize: 10,
};

function useMakeTextAnnotation() {
  const getViewer = useGetPopupContextViewer();
  const fontPreference = fontPreferenceSignal.get;
  const currentScale = useCurrentScale();

  return (
    pageRef: HTMLElement,
    index: number,
    text = '',
    e?: MouseEvent
  ): ITextBoxPlaceable => {
    const curViewer = getViewer();
    const curScale = currentScale();
    const fontFamily = fontPreference();
    let position: IPlaceablePosition;

    if (e) {
      // At default zoom and font size, 250px can hold ~15-20 characters horizontally
      // We want to vertically position so that the center of our textbox is at the center
      // of the text cursor caret.
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
      // Create a new text box at the top left of the page (e.g. on copy/paste with no MouseEvent)
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
 */
createBlockEffect(() => {
  const setActivePlaceableId = activePlaceableIdSignal.set;
  const activeThreadId = activeCommentThreadSignal.get();

  const activePlaceableId = activePlaceableIdSignal();

  const activePlaceable = activePlaceableId
    ? placeableIdMap()?.[activePlaceableId]
    : null;

  if (
    activeThreadId == null &&
    activePlaceable &&
    isThreadPlaceable(activePlaceable)
  ) {
    setActivePlaceableId(undefined);
  }
  if (activeThreadId == null) return;

  const matchingFreeCommentPlaceable = commentPlaceables()?.find(
    (p) => p.payload?.threadId === activeThreadId
  );

  if (matchingFreeCommentPlaceable) {
    setActivePlaceableId(matchingFreeCommentPlaceable.internalId);
  }
});

export function useCreatePlaceable() {
  const makeThread = useMakeThread();
  const makeTextAnnotation = useMakeTextAnnotation();
  const makeSignature = useMakeSignature();
  const [mode, setMode] = placeableModeSignal;
  const [_pdfModificationDataValue, setPdfModificationData] =
    pdfModificationDataStore;
  const setActivePlaceableId = activePlaceableIdSignal.set;
  const setNewPlaceable = newPlaceableSignal.set;
  const setActiveCommentThread = activeCommentThreadSignal.set;

  return async (e: MouseEvent) => {
    let placeable: IPlaceable | null;
    const pageRef = PageModel.getPageNode(e.currentTarget as HTMLElement);
    if (pageRef == null) {
      console.error('Expected page ref!');
      return;
    }

    const index = PageModel.getPageIndex(pageRef)!;
    switch (mode()) {
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
        setPdfModificationData('placeables', (prev) => [...prev, placeable]);
      } else {
        setActiveCommentThread(-1);
      }
      setActivePlaceableId(placeable.internalId);
      setNewPlaceable(placeable);
    });

    setMode(PayloadMode.NoMode);

    e.stopPropagation();
    e.preventDefault();
  };
}

export function useModifyPlaceable() {
  const [pdfModificationDataValue, setPdfModificationData] =
    pdfModificationDataStore;
  const doEdit = useDoEdit();

  return (index: number, newPlaceable: IPlaceable) => {
    if (index < 0) return false;

    const placeables = pdfModificationDataValue.placeables;

    const currPlaceable = placeables.at(index);
    if (!currPlaceable) return false;

    if (newPlaceable.payloadType !== currPlaceable.payloadType) return false;

    setPdfModificationData('placeables', index, {
      ...newPlaceable,
      wasEdited: true,
    });

    doEdit();

    return true;
  };
}

export function useModifyPayload() {
  const modifyPlaceable = useModifyPlaceable();

  return <T extends PayloadType>(
    id: string,
    payloadType: T,
    newPartialPayload: Partial<
      Extract<IPlaceablePayload, { payloadType: T }>['payload']
    >
  ) => {
    const index = internalIdToIndex(id);
    if (index < 0) return false;

    const existingPlaceable = pdfModificationDataStore.get.placeables.at(index);
    if (!existingPlaceable) return false;
    if (payloadType !== existingPlaceable.payloadType) return false;

    const newPlaceable = {
      ...existingPlaceable,
      payload: {
        ...existingPlaceable.payload,
        ...newPartialPayload,
      },
    } as IPlaceable;

    return modifyPlaceable(index, newPlaceable);
  };
}

export function useDeletePlaceable() {
  const [pdfModificationDataValue, setPdfModificationData] =
    pdfModificationDataStore;
  const setActivePlaceable = activePlaceableIdSignal.set;
  const doEdit = useDoEdit();
  const deleteComment = useDeleteComment();

  const arrayDelete = (index: number) => {
    if (index < 0 || index >= pdfModificationDataValue.placeables.length)
      return false;

    setPdfModificationData('placeables', (prev) => [
      ...prev.slice(0, index),
      ...prev.slice(index + 1),
    ]);

    doEdit();

    return true;
  };

  return createCallback((uuid: string) => {
    const placeable = placeableIdMap()?.[uuid];
    if (!placeable) {
      console.error('Placeable not found', uuid);
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

    const index = internalIdToIndex(uuid);

    let deleted = arrayDelete(index);
    if (deleted) {
      setActivePlaceable((prev) => (prev === uuid ? undefined : prev));
    }
    return deleted;
  });
}

export function useUpdatePlaceablePosition() {
  const modifyPlaceable = useModifyPlaceable();
  const editPdfFreeCommentAnchor = useEditPdfFreeCommentAnchor();
  const setNewPlaceable = newPlaceableSignal.set;

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
      const placeable = placeableIdMap()?.[uuid];
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
      let newPlaceable = {
        ...placeable,
        position: newPosition,
      };

      if (!samePage) {
        newPlaceable = {
          ...newPlaceable,
          pageRange: new Set([pageNum]),
          originalPage: pageNum,
        };
        if (isThreadPlaceable(newPlaceable)) {
          if ((newPlaceable as IThreadPlaceable).isNew) {
            setNewPlaceable(newPlaceable);
            return;
          } else {
            return editPdfFreeCommentAnchor(uuid, {
              xPct: newPlaceable.position.xPct,
              yPct: newPlaceable.position.yPct,
              widthPct: newPlaceable.position.widthPct,
              heightPct: newPlaceable.position.heightPct,
              page: pageNum,
            });
          }
        }
        switch (newPlaceable.payloadType) {
          case PayloadMode.FreeTextAnnotation:
          case PayloadMode.Signature:
            break;
          default:
            console.error('Unhandled payload type', newPlaceable.payload);
            return false;
        }
      }

      if (isThreadPlaceable(newPlaceable)) {
        if (newPlaceable.isNew) {
          setNewPlaceable(newPlaceable);
          return;
        } else {
          return editPdfFreeCommentAnchor(uuid, {
            xPct: newPlaceable.position.xPct,
            yPct: newPlaceable.position.yPct,
            widthPct: newPlaceable.position.widthPct,
            heightPct: newPlaceable.position.heightPct,
          });
        }
      }

      const index = internalIdToIndex(uuid);
      return modifyPlaceable(index, newPlaceable);
    }
  );
}
