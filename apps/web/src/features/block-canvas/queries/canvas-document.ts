import { storageServiceClient } from '@service-storage/client';

export type CanvasViewLocation = {
  x?: number;
  y?: number;
  scale?: number;
};

export async function fetchCanvasViewLocation(
  documentId: string
): Promise<CanvasViewLocation | null> {
  const result = await storageServiceClient.getDocumentMetadata({
    documentId,
    init: {
      signal: AbortSignal.timeout(3000),
    },
  });
  if (result.isErr()) return null;

  const { viewLocation } = result.value;
  if (!viewLocation) return null;

  const params = new URLSearchParams(viewLocation.replace('#', ''));
  return {
    x: numberOrUndefined(params.get('x')),
    y: numberOrUndefined(params.get('y')),
    scale: numberOrUndefined(params.get('s')),
  };
}

export async function saveCanvasViewLocation(
  documentId: string,
  state: { x: number; y: number; scale: number }
) {
  if (
    Number.isNaN(state.x) ||
    Number.isNaN(state.y) ||
    Number.isNaN(state.scale)
  ) {
    return;
  }

  await storageServiceClient.upsertDocumentViewLocation({
    documentId,
    location:
      (state.x !== 0 ? `#x=${Math.round(state.x)}` : '') +
      (state.y !== 0 ? `&y=${Math.round(state.y)}` : '') +
      (state.scale !== 1 ? `&s=${Math.round(state.scale * 100)}` : ''),
  });
}

function numberOrUndefined(
  value: string | undefined | null
): number | undefined {
  const number = Number(value);
  return value == null || Number.isNaN(number) ? undefined : number;
}
