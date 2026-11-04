export type CanvasReferenceSource = {
  create: (targetId: string) => Promise<string>;
  remove: (mentionId: string) => Promise<void>;
};
