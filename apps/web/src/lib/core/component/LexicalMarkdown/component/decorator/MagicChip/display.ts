import { markdownToPlainText } from '@macro-inc/lexical-core/utils/parsers';
import { match } from 'ts-pattern';
import {
  MAGIC_CHIP_LOADING_ACTIVITY,
  type MagicChipActivityIcon,
  type MagicChipPresentation,
} from './presentation';

export type { MagicChipActivityIcon };

/**
 * Characters of answer markdown fed to {@link summarize}.
 *
 * Answers stream unboundedly and the pill shows one truncated line. Flattening the
 * whole answer on every chunk would be O(answer) work per chunk for O(1)
 * visible output.
 */
const SUMMARY_SOURCE_CHARS = 400;

export type MagicChipLead = {
  icon: MagicChipActivityIcon;
  /** Spoken name. The pill draws {@link MagicChipLead.icon}, not this string. */
  label: string;
  busy: boolean;
};

/** The session's agent, drawn in place of an activity icon on a message pill. */
export type MagicChipAgent = {
  name: string;
  avatarUrl?: string | null;
};

/**
 * Everything the fixed-height pill draws. No markdown field: a heading or
 * list lays out at its own size and would break the height contract.
 */
export type MagicChipPill = {
  lead?: MagicChipLead;
  body: string;
  /** Set on answering and settled when the fold has named the agent. */
  agent?: MagicChipAgent;
};

/**
 * The frame the chip renders in. Two modes, no booleans.
 *
 * `pill` carries no presentation and `opened` carries no pill, so the preview
 * cost and the full markdown render are mutually exclusive.
 */
export type MagicChipDisplay =
  | { mode: 'pill'; pill: MagicChipPill }
  | { mode: 'opened'; presentation: MagicChipPresentation };

export type MagicChipDisplayInput = {
  presentation: MagicChipPresentation;
  /** The reader clicked this pill open. */
  openedByReader: boolean;
  /** Session bot. The pill shows this instead of an activity icon on a message. */
  agent?: MagicChipAgent;
};

function stripMarkdownMarkers(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, 'code')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`]+/g, '');
}

function summarize(markdown: string): string {
  return stripMarkdownMarkers(
    markdownToPlainText(markdown.slice(0, SUMMARY_SOURCE_CHARS))
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function toLead(activity: {
  icon: MagicChipActivityIcon;
  label: string;
  busy: boolean;
}): MagicChipLead {
  return {
    icon: activity.icon,
    label: activity.label,
    busy: activity.busy,
  };
}

function toPill(
  presentation: MagicChipPresentation,
  agent?: MagicChipAgent
): MagicChipPill {
  return match(presentation)
    .with({ kind: 'loading' }, () => ({
      lead: toLead(MAGIC_CHIP_LOADING_ACTIVITY),
      body: '',
    }))
    .with({ kind: 'working' }, ({ activity }) => ({
      lead: toLead(activity),
      body: activity.detail ?? '',
    }))
    .with({ kind: 'answering' }, ({ activity, markdown }) => ({
      lead: toLead(activity),
      body: summarize(markdown),
      ...(agent ? { agent } : {}),
    }))
    .with({ kind: 'settled' }, ({ markdown }) => ({
      body: summarize(markdown),
      ...(agent ? { agent } : {}),
    }))
    .exhaustive();
}

/**
 * Pill until the reader expands this instance. `openedByReader` is per-chip
 * and unpersisted; collapsing puts the same instance back on the pill.
 */
export function deriveMagicChipDisplay(
  input: MagicChipDisplayInput
): MagicChipDisplay {
  if (input.openedByReader) {
    return { mode: 'opened', presentation: input.presentation };
  }
  return {
    mode: 'pill',
    pill: toPill(input.presentation, input.agent),
  };
}
