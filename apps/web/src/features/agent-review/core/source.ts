/** Feature-owned live data and actions; adapters retain transport/cache mechanics. */
type Accessor<T> = () => T;

import type { Chapter, CodeLocation, FileGroup, ReviewFile } from './model';

export type ReviewEntry = Pick<
  ReviewFile,
  | 'path'
  | 'oldPath'
  | 'status'
  | 'language'
  | 'added'
  | 'removed'
  | 'collapsed'
  | 'labels'
  | 'omitted'
> & { content: string };
export type ReviewState = {
  id: string;
  title: string;
  summary: string;
  repository: string;
  source: 'workspace' | 'pullRequest';
  revisions: {
    number: number;
    comparison: {
      base?: string | null;
      head?: string | null;
      worktree?: boolean;
    };
    files: ReviewEntry[];
    symbols: {
      name: string;
      kind: string;
      file: number;
      side: 'old' | 'new';
      line: number;
    }[];
  }[];
  tour: Omit<Chapter, 'note'>[];
  annotations: { key: string; body: string; location: CodeLocation }[];
  fileGroups?: FileGroup[];
  anchors: {
    id: string;
    revision: number;
    status: 'current' | 'moved' | 'outdated';
    original: CodeLocation;
    current: CodeLocation;
    excerpt: string[];
  }[];
  threads: {
    id: string;
    anchor: string;
    resolved: boolean;
    messages: {
      id: string;
      author: { kind: 'agent' } | { kind: 'user'; id: string };
      body: string;
      delivery?: 'pending' | 'queued' | 'failed' | null;
    }[];
  }[];
};
export type NewComment = {
  id: string;
  thread: string | null;
  revision: number;
  location: CodeLocation | null;
  body: string;
};
export type ReviewLink = { reviewId: string; revision: number; url: string };
export type ReviewData<T> = {
  value: Accessor<T | undefined>;
  phase: Accessor<'loading' | 'ready' | 'error'>;
  error: Accessor<unknown>;
  refresh: () => Promise<T | undefined>;
};
export type ReviewSource = {
  manifest: ReviewData<ReviewState>;
  /** Revision of the loaded manifest, including retained data during a switch. */
  loadedRevision: Accessor<number | undefined>;
  capturing: Accessor<boolean>;
  commenting: Accessor<boolean>;
  capture: () => Promise<ReviewLink>;
  comment: (input: NewComment) => Promise<ReviewLink>;
  resolve: (input: { thread: string; resolved: boolean }) => Promise<unknown>;
};
