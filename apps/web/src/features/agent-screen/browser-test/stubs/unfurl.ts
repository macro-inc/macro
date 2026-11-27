// Link previews, without the unfurl service: a plain link has none here.
export * from '../../../../lib/core/signal/unfurl';

export function useUnfurl(_url: string | undefined) {
  return [() => undefined, { refetch: () => {} }] as const;
}
