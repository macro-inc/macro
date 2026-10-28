import type { CardPosition } from '@service-storage/generated/schemas/cardPosition';
import type { ViewLayout } from '@service-storage/generated/schemas/viewLayout';
import type { ViewQuery } from '@service-storage/generated/schemas/viewQuery';

/** What the records UI needs to draw a view, whether the host saves it or not. */
export type DatabaseViewState = {
  query: ViewQuery;
  layout: ViewLayout;
};

/** A view change for its host to apply locally or persist. */
export type ViewChange = Partial<DatabaseViewState> & { name?: string };

/** The places a card move wrote and the table version it left. */
export type CardMoved = { positions: CardPosition[]; tableVersion: number };
