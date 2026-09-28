export const URL_PARAMS = {
  transcriptId: 'call_transcript_id',
};

export type CallBlockProps = {
  [URL_PARAMS.transcriptId]?: string;
};

export type CallTranscriptTarget = {
  transcriptId: string;
  gen: number;
  /** Route token changes when the same transcript is selected again. */
  seek?: string;
};
