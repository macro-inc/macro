import type { AdoptedSignature } from './packet';

/** A labelled value, already worded for the reader. */
export type SheetFact = { label: string; value: string };

/**
 * The Certificate of Completion as words: every label and value it prints,
 * already translated and formatted, so it can be drawn onto a page without
 * knowing the reader's language.
 */
export type CertificateSheet = {
  title: string;
  subtitle: string;
  /** Printed beside the title once every party has signed. */
  completed?: string;
  facts: SheetFact[];
  /** Facts too long for a column, each on a full row. */
  wideFacts: SheetFact[];
  signersHeading: string;
  signers: {
    name: string;
    position: string;
    signature?: AdoptedSignature;
    facts: SheetFact[];
  }[];
  hashesHeading: string;
  hashes: SheetFact[];
  eventsHeading: string;
  events: { at: string; type: string; text: string }[];
  footer: string;
};
