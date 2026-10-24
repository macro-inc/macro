import { match, P } from 'ts-pattern';

/** Someone WhatsApp named; `userId` when they are a verified Macro user. */
export type Person = { name: string; userId?: string };

/** `@<token>` in a body stands for this person. */
export type Mention = Person & { token: string };

export type SystemAction =
  | 'group_created'
  | 'participants_added'
  | 'participants_removed'
  | 'participants_left'
  | 'participants_joined'
  | 'participants_promoted'
  | 'participants_demoted'
  | 'subject_changed'
  | 'icon_changed'
  | 'description_changed'
  | 'disappearing_changed'
  | 'message_pinned'
  | 'message_unpinned'
  | 'call';

export type CallSummary = {
  video: boolean;
  outcome: 'answered' | 'missed' | 'rejected' | 'other';
  durationSeconds?: number;
};

/** A group event WhatsApp shows as a centered line, not a message. */
export type SystemLine = {
  type: 'system';
  action: SystemAction;
  actor?: Person;
  participants: Person[];
  value?: string;
  call?: CallSummary;
};

export type Poll = {
  type: 'poll';
  question: string;
  options: { name: string; votes: number; mine: boolean; voters: Person[] }[];
  /** 0: any number of options; 1: a single choice. */
  selectableCount: number;
  /** People who voted at all. */
  voters: number;
};

export type Location = {
  type: 'location';
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  /** A link the sender attached. */
  url?: string;
  /** Live location: where it started. */
  live: boolean;
  comment?: string;
};

export type Contacts = {
  type: 'contacts';
  contacts: { name: string; phones: string[] }[];
};

export type WhatsAppEvent = {
  type: 'event';
  name: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  location?: string;
  joinLink?: string;
  canceled: boolean;
};

export type RichContent =
  | SystemLine
  | Poll
  | Location
  | Contacts
  | WhatsAppEvent;

/** A short label for a quoted or replied-to rich message. */
export function richPreview(rich: RichContent): string {
  return match(rich)
    .with({ type: 'system' }, () => 'WhatsApp update')
    .with({ type: 'poll' }, ({ question }) => `Poll: ${question}`)
    .with(
      { type: 'location' },
      ({ name, live }) => name ?? (live ? 'Live location' : 'Location')
    )
    .with({ type: 'contacts' }, ({ contacts }) =>
      contacts.length === 1
        ? `Contact: ${contacts[0]?.name ?? ''}`
        : `${contacts.length} contacts`
    )
    .with({ type: 'event' }, ({ name }) => `Event: ${name}`)
    .exhaustive();
}

/** A maps link built from coordinates; nothing is fetched to render it. */
export function mapsUrl(location: Location): string {
  const query = `${location.latitude},${location.longitude}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Coordinates as people read them: `40.7128° N, 74.0060° W`. */
export function formatCoordinates(location: Location): string {
  const latitude = `${Math.abs(location.latitude).toFixed(4)}° ${location.latitude < 0 ? 'S' : 'N'}`;
  const longitude = `${Math.abs(location.longitude).toFixed(4)}° ${location.longitude < 0 ? 'W' : 'E'}`;
  return `${latitude}, ${longitude}`;
}

/** `0:42`, `12:05`, `1:02:03`. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
}

/** WhatsApp's own disappearing-message timer names: "24 hours", "7 days". */
export function disappearingLabel(
  value: string | undefined
): string | undefined {
  const seconds = Number(value ?? '0');
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const days = seconds / 86400;
  if (Number.isInteger(days)) return days === 1 ? '24 hours' : `${days} days`;
  const hours = seconds / 3600;
  if (Number.isInteger(hours)) return hours === 1 ? '1 hour' : `${hours} hours`;
  return `${Math.round(seconds / 60)} minutes`;
}

/** "Ben", "Ben and Cy", "Ben, Cy and 2 others". */
export function namesList(people: Person[]): string {
  const names = people.map((person) => person.name);
  if (names.length === 0) return 'someone';
  if (names.length === 1) return names[0] ?? '';
  if (names.length <= 3)
    return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`;
}

/**
 * A system line in words, split like Chat's activity rows: who did it
 * (bold), what they did, and what it was done to (bold).
 */
export type SystemLineText = {
  actor?: string;
  verb: string;
  subject?: string;
  icon: 'added' | 'removed' | 'edit' | 'picture' | 'pin' | 'call' | 'timer';
};

export function describeSystemLine(line: SystemLine): SystemLineText {
  const text = systemLineParts(line);
  // WhatsApp didn't say who: the verb starts the sentence.
  return text.actor
    ? text
    : {
        ...text,
        verb: `${text.verb.charAt(0).toUpperCase()}${text.verb.slice(1)}`,
      };
}

function systemLineParts(line: SystemLine): SystemLineText {
  const actor = line.actor?.name;
  const people = namesList(line.participants);
  return match(line)
    .returnType<SystemLineText>()
    .with({ action: 'group_created' }, ({ value }) =>
      value
        ? {
            actor,
            verb: 'created the group',
            subject: `“${value}”`,
            icon: 'added',
          }
        : { actor, verb: 'created the group', icon: 'added' }
    )
    .with({ action: 'participants_added' }, () => ({
      actor,
      verb: 'added',
      subject: people,
      icon: 'added',
    }))
    .with({ action: 'participants_removed' }, () => ({
      actor,
      verb: 'removed',
      subject: people,
      icon: 'removed',
    }))
    .with({ action: 'participants_left' }, () => ({
      actor: people,
      verb: 'left',
      icon: 'removed',
    }))
    .with({ action: 'participants_joined' }, () => ({
      actor: people,
      verb: "joined using this group's invite link",
      icon: 'added',
    }))
    .with({ action: 'participants_promoted' }, () => ({
      actor,
      verb: 'made',
      subject: `${people} ${line.participants.length === 1 ? 'an admin' : 'admins'}`,
      icon: 'edit',
    }))
    .with({ action: 'participants_demoted' }, () => ({
      actor,
      verb: 'dismissed',
      subject: `${people} as ${line.participants.length === 1 ? 'admin' : 'admins'}`,
      icon: 'edit',
    }))
    .with({ action: 'subject_changed' }, ({ value }) =>
      value
        ? {
            actor,
            verb: 'changed the subject to',
            subject: `“${value}”`,
            icon: 'edit',
          }
        : { actor, verb: 'changed the subject', icon: 'edit' }
    )
    .with({ action: 'icon_changed' }, () => ({
      actor,
      verb: 'changed the group icon',
      icon: 'picture',
    }))
    .with({ action: 'description_changed' }, ({ value }) => ({
      actor,
      verb: value
        ? 'changed the group description'
        : 'removed the group description',
      icon: 'edit',
    }))
    .with({ action: 'disappearing_changed' }, ({ value }) => {
      const timer = disappearingLabel(value);
      return timer
        ? {
            actor,
            verb: 'turned on disappearing messages',
            subject: `(${timer})`,
            icon: 'timer',
          }
        : { actor, verb: 'turned off disappearing messages', icon: 'timer' };
    })
    .with({ action: 'message_pinned' }, () => ({
      actor,
      verb: 'pinned a message',
      icon: 'pin',
    }))
    .with({ action: 'message_unpinned' }, () => ({
      actor,
      verb: 'unpinned a message',
      icon: 'pin',
    }))
    .with({ action: 'call' }, ({ call }) => ({
      verb: callLine(call),
      icon: 'call',
    }))
    .exhaustive();
}

function callLine(call: CallSummary | undefined): string {
  const kind = call?.video ? 'video call' : 'voice call';
  return match(call?.outcome)
    .with('missed', () => `Missed group ${kind}`)
    .with('rejected', () => `Declined group ${kind}`)
    .with('answered', () =>
      call?.durationSeconds
        ? `Group ${kind} · ${formatDuration(call.durationSeconds)}`
        : `Group ${kind}`
    )
    .with(P.union('other', undefined), () => `Group ${kind}`)
    .exhaustive();
}

/** The line as one sentence, for tooltips and screen readers. */
export function systemLineSentence(text: SystemLineText): string {
  return [text.actor, text.verb, text.subject].filter(Boolean).join(' ');
}

const DAY = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const TIME = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

/** "Fri, Oct 24, 2026 · 6:00 PM – 8:00 PM"; undefined without a start. */
export function eventWhen(event: WhatsAppEvent): string | undefined {
  if (!event.startAt) return undefined;
  const start = new Date(event.startAt);
  if (Number.isNaN(start.getTime())) return undefined;
  const from = `${DAY.format(start)} · ${TIME.format(start)}`;
  const end = event.endAt ? new Date(event.endAt) : undefined;
  if (!end || Number.isNaN(end.getTime())) return from;
  return DAY.format(end) === DAY.format(start)
    ? `${from} – ${TIME.format(end)}`
    : `${from} – ${DAY.format(end)} · ${TIME.format(end)}`;
}
