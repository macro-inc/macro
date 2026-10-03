import { For, type JSX, Show } from 'solid-js';

// A faithful, static implementation of the "Aidan Sketches" Figma list redesign
// (file IOH8EtjS7V8rmxnbJzFZ2A) — a compact, denser take on the email list:
// 24px rows, 10px type, no orange text (just the unread dot), and an optional
// "Powered by Macro" footer. Parameterized so the same shell renders both the
// "Signal" card (node 2:2) and the "Noise" card (node 6:335) for the
// signal-vs-noise hero composition.

const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const INK = {
  bg: '#060709',
  outerBorder: '#2f2c2c',
  hairline: '#1f1f1f',
  chip: '#16191f',
  chipBorder: '#353535',
  textBright: '#ffffff',
  textDim: '#bfbfbf',
  textMuted: '#8b8b8b',
  textFaint: '#353535',
  rowHover: 'rgba(139, 139, 139, 0.1)',
  unreadDot: '#ff8f00',
};

function MacroLogoIcon(props: { size?: number; color?: string }) {
  const s = props.size ?? 18;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M0 7.5105V12.6113C0.0044464 12.7565 0.0649188 12.8944 0.16875 12.996L2.22525 14.979L3.72675 14.379V9.05475L1.49925 6.9105L0 7.5105Z"
        fill={props.color ?? INK.textDim}
      />
      <path
        d="M3.0585 3.6V7.9395L4.0785 8.92125V9.906L9.36075 15L10.8622 14.4L10.8615 9.075L4.5585 3L3.0585 3.6Z"
        fill={props.color ?? INK.textDim}
      />
      <path
        d="M10.1955 3.6V7.9395L11.2155 8.92275L11.2057 9.89775L16.5 15L18 14.4V9.315C17.9997 9.24051 17.9847 9.16682 17.9557 9.0982C17.9268 9.02958 17.8844 8.96739 17.8312 8.91525L11.6962 3L10.1955 3.6Z"
        fill={props.color ?? INK.textDim}
      />
    </svg>
  );
}

export function MagnifyingGlassIcon(props: { size?: number }) {
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M10.7653 10.2347L8.41828 7.88813C9.09855 7.07143 9.43776 6.0239 9.36536 4.96347C9.29296 3.90304 8.81452 2.91134 8.02957 2.19467C7.24461 1.47801 6.21358 1.09156 5.15096 1.11571C4.08833 1.13986 3.07592 1.57275 2.32434 2.32434C1.57275 3.07592 1.13986 4.08833 1.11571 5.15096C1.09156 6.21358 1.47801 7.24461 2.19467 8.02957C2.91134 8.81452 3.90304 9.29296 4.96347 9.36536C6.0239 9.43776 7.07143 9.09855 7.88813 8.41828L10.2347 10.7653C10.2695 10.8002 10.3109 10.8278 10.3564 10.8466C10.4019 10.8655 10.4507 10.8752 10.5 10.8752C10.5493 10.8752 10.5981 10.8655 10.6436 10.8466C10.6891 10.8278 10.7305 10.8002 10.7653 10.7653C10.8002 10.7305 10.8278 10.6891 10.8466 10.6436C10.8655 10.5981 10.8752 10.5493 10.8752 10.5C10.8752 10.4507 10.8655 10.4019 10.8466 10.3564C10.8278 10.3109 10.8002 10.2695 10.7653 10.2347ZM1.875 5.25C1.875 4.58249 2.07294 3.92997 2.44379 3.37495C2.81464 2.81993 3.34174 2.38735 3.95844 2.13191C4.57514 1.87646 5.25374 1.80962 5.90843 1.93985C6.56312 2.07007 7.16448 2.39151 7.63649 2.86351C8.10849 3.33552 8.42993 3.93688 8.56015 4.59157C8.69038 5.24626 8.62354 5.92486 8.36809 6.54156C8.11265 7.15826 7.68007 7.68536 7.12505 8.05621C6.57003 8.42706 5.91751 8.625 5.25 8.625C4.3552 8.62401 3.49733 8.26811 2.86461 7.63539C2.23189 7.00267 1.87599 6.1448 1.875 5.25Z"
        fill={INK.textMuted}
      />
    </svg>
  );
}

export function CommandIcon(props: { size?: number }) {
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M8.4375 6.75H7.5V5.25H8.4375C8.77126 5.25 9.09752 5.15103 9.37503 4.96561C9.65253 4.78018 9.86882 4.51663 9.99655 4.20828C10.1243 3.89993 10.1577 3.56063 10.0926 3.23329C10.0275 2.90594 9.86674 2.60526 9.63074 2.36926C9.39474 2.13326 9.09406 1.97254 8.76672 1.90742C8.43937 1.84231 8.10007 1.87573 7.79172 2.00345C7.48337 2.13118 7.21982 2.34747 7.0344 2.62498C6.84897 2.90248 6.75 3.22874 6.75 3.5625V4.5H5.25V3.5625C5.25 3.22874 5.15103 2.90248 4.96561 2.62498C4.78018 2.34747 4.51663 2.13118 4.20828 2.00345C3.89993 1.87573 3.56063 1.84231 3.23329 1.90742C2.90594 1.97254 2.60526 2.13326 2.36926 2.36926C2.13326 2.60526 1.97254 2.90594 1.90742 3.23329C1.84231 3.56063 1.87573 3.89993 2.00345 4.20828C2.13118 4.51663 2.34747 4.78018 2.62498 4.96561C2.90248 5.15103 3.22874 5.25 3.5625 5.25H4.5V6.75H3.5625C3.22874 6.75 2.90248 6.84897 2.62498 7.0344C2.34747 7.21982 2.13118 7.48337 2.00345 7.79172C1.87573 8.10007 1.84231 8.43937 1.90742 8.76672C1.97254 9.09406 2.13326 9.39474 2.36926 9.63074C2.60526 9.86674 2.90594 10.0275 3.23329 10.0926C3.56063 10.1577 3.89993 10.1243 4.20828 9.99655C4.51663 9.86882 4.78018 9.65253 4.96561 9.37503C5.15103 9.09752 5.25 8.77126 5.25 8.4375V7.5H6.75V8.4375C6.75 8.77126 6.84897 9.09752 7.0344 9.37503C7.21982 9.65253 7.48337 9.86882 7.79172 9.99655C8.10007 10.1243 8.43937 10.1577 8.76672 10.0926C9.09406 10.0275 9.39474 9.86674 9.63074 9.63074C9.86674 9.39474 10.0275 9.09406 10.0926 8.76672C10.1577 8.43937 10.1243 8.10007 9.99655 7.79172C9.86882 7.48337 9.65253 7.21982 9.37503 7.0344C9.09752 6.84897 8.77126 6.75 8.4375 6.75ZM7.5 3.5625C7.5 3.37708 7.55498 3.19582 7.658 3.04165C7.76101 2.88748 7.90743 2.76732 8.07873 2.69636C8.25004 2.62541 8.43854 2.60684 8.6204 2.64301C8.80226 2.67919 8.9693 2.76848 9.10041 2.89959C9.23152 3.0307 9.32081 3.19775 9.35699 3.3796C9.39316 3.56146 9.37459 3.74996 9.30364 3.92127C9.23268 4.09257 9.11252 4.23899 8.95835 4.342C8.80418 4.44502 8.62292 4.5 8.4375 4.5H7.5V3.5625ZM2.625 3.5625C2.625 3.31386 2.72377 3.0754 2.89959 2.89959C3.0754 2.72377 3.31386 2.625 3.5625 2.625C3.81114 2.625 4.0496 2.72377 4.22541 2.89959C4.40123 3.0754 4.5 3.31386 4.5 3.5625V4.5H3.5625C3.31386 4.5 3.0754 4.40123 2.89959 4.22541C2.72377 4.0496 2.625 3.81114 2.625 3.5625ZM4.5 8.4375C4.5 8.62292 4.44502 8.80418 4.342 8.95835C4.23899 9.11252 4.09257 9.23268 3.92127 9.30364C3.74996 9.37459 3.56146 9.39316 3.3796 9.35699C3.19775 9.32081 3.0307 9.23152 2.89959 9.10041C2.76848 8.9693 2.67919 8.80226 2.64301 8.6204C2.60684 8.43854 2.62541 8.25004 2.69636 8.07873C2.76732 7.90743 2.88748 7.76101 3.04165 7.658C3.19582 7.55498 3.37708 7.5 3.5625 7.5H4.5V8.4375ZM8.4375 9.375C8.18886 9.375 7.9504 9.27623 7.77459 9.10041C7.59877 8.9246 7.5 8.68614 7.5 8.4375V7.5H8.4375C8.68614 7.5 8.9246 7.59877 9.10041 7.77459C9.27623 7.9504 9.375 8.18886 9.375 8.4375C9.375 8.68614 9.27623 8.9246 9.10041 9.10041C8.9246 9.27623 8.68614 9.375 8.4375 9.375Z"
        fill={INK.textFaint}
      />
    </svg>
  );
}

export function PlusIcon(props: { size?: number }) {
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M10.5 6C10.5 6.09946 10.4605 6.19484 10.3902 6.26517C10.3198 6.33549 10.2245 6.375 10.125 6.375H6.375V10.125C6.375 10.2245 6.33549 10.3198 6.26517 10.3902C6.19484 10.4605 6.09946 10.5 6 10.5C5.90054 10.5 5.80516 10.4605 5.73484 10.3902C5.66451 10.3198 5.625 10.2245 5.625 10.125V6.375H1.875C1.77554 6.375 1.68016 6.33549 1.60984 6.26517C1.53951 6.19484 1.5 6.09946 1.5 6C1.5 5.90054 1.53951 5.80516 1.60984 5.73484C1.68016 5.66451 1.77554 5.625 1.875 5.625H5.625V1.875C5.625 1.77554 5.66451 1.68016 5.73484 1.60984C5.80516 1.53951 5.90054 1.5 6 1.5C6.09946 1.5 6.19484 1.53951 6.26517 1.60984C6.33549 1.68016 6.375 1.77554 6.375 1.875V5.625H10.125C10.2245 5.625 10.3198 5.66451 10.3902 5.73484C10.4605 5.80516 10.5 5.90054 10.5 6Z"
        fill={INK.textDim}
      />
    </svg>
  );
}

export function CaretDownIcon(props: { size?: number }) {
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M10.0153 4.76531L6.26531 8.51531C6.23049 8.55018 6.18913 8.57784 6.1436 8.59671C6.09808 8.61558 6.04928 8.62529 6 8.62529C5.95072 8.62529 5.90192 8.61558 5.8564 8.59671C5.81087 8.57784 5.76951 8.55018 5.73469 8.51531L1.98469 4.76531C1.91432 4.69495 1.87479 4.59951 1.87479 4.5C1.87479 4.40049 1.91432 4.30505 1.98469 4.23469C2.05505 4.16432 2.15049 4.12479 2.25 4.12479C2.34951 4.12479 2.44495 4.16432 2.51531 4.23469L6 7.71984L9.48469 4.23469C9.51953 4.19985 9.56089 4.17221 9.60641 4.15335C9.65194 4.1345 9.70073 4.12479 9.75 4.12479C9.79927 4.12479 9.84806 4.1345 9.89359 4.15335C9.93911 4.17221 9.98047 4.19985 10.0153 4.23469C10.0502 4.26953 10.0778 4.31089 10.0966 4.35641C10.1155 4.40194 10.1252 4.45073 10.1252 4.5C10.1252 4.54927 10.1155 4.59806 10.0966 4.64359C10.0778 4.68911 10.0502 4.73047 10.0153 4.76531Z"
        fill={INK.textMuted}
      />
    </svg>
  );
}

export function EnvelopeIcon(props: {
  bold?: boolean;
  size?: number;
  color?: string;
}) {
  const color = props.color ?? (props.bold ? INK.textBright : INK.textDim);
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M10.5 2.3125H1.5C0.947715 2.3125 0.5 2.76022 0.5 3.3125V8.64585C0.5 9.19813 0.947715 9.64585 1.5 9.64585H10.5C11.0523 9.64585 11.5 9.19813 11.5 8.64585V3.3125C11.5 2.76022 11.0523 2.3125 10.5 2.3125Z"
        stroke={color}
        stroke-width={props.bold ? undefined : '0.75'}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M0.8055 2.8055L6 6.5L11.1945 2.8055"
        stroke={color}
        stroke-width={props.bold ? undefined : '0.75'}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// Calendar invites get a calendar glyph drawn in the same 12-grid, thin-stroke
// style as EnvelopeIcon.
export function CalendarIcon(props: { bold?: boolean; size?: number }) {
  const color = props.bold ? INK.textBright : INK.textDim;
  const s = props.size ?? 12;
  const w = props.bold ? undefined : '0.75';
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <rect
        x="0.5"
        y="1.8125"
        width="11"
        height="9.1875"
        rx="1"
        stroke={color}
        stroke-width={w}
        stroke-linejoin="round"
      />
      <path
        d="M0.5 4.5H11.5"
        stroke={color}
        stroke-width={w}
        stroke-linecap="round"
      />
      <path
        d="M3.75 0.5V2.5M8.25 0.5V2.5"
        stroke={color}
        stroke-width={w}
        stroke-linecap="round"
      />
    </svg>
  );
}

// --- Header sub-pieces -------------------------------------------------------

const TABS = ['Signal', 'Noise', 'All'] as const;
export type TabName = (typeof TABS)[number];

function TabSwitcher(props: { selected: TabName }) {
  return (
    <div
      style={{
        'align-items': 'flex-start',
        'background-color': '#000',
        border: `0.5px solid ${INK.hairline}`,
        'border-radius': '7px',
        display: 'flex',
        gap: '8px',
        padding: '2.5px',
      }}
    >
      <For each={TABS}>
        {(label) => {
          const active = () => label === props.selected;
          return (
            <span
              style={{
                'align-items': 'baseline',
                'background-color': active() ? INK.chip : 'transparent',
                border: active()
                  ? `0.5px solid ${INK.chipBorder}`
                  : '0.5px solid transparent',
                'border-radius': '5px',
                color: active() ? INK.textBright : INK.textMuted,
                display: 'flex',
                'font-family': appFont,
                'font-size': '10px',
                'font-weight': 500,
                padding: '3px 6px 4px',
                'white-space': 'nowrap',
              }}
            >
              {label}
            </span>
          );
        }}
      </For>
    </div>
  );
}

function SearchField() {
  return (
    <div
      style={{
        'align-items': 'center',
        'background-color': '#000',
        'box-sizing': 'border-box',
        border: `0.5px solid ${INK.hairline}`,
        'border-radius': '7px',
        display: 'flex',
        height: '24px',
        'justify-content': 'space-between',
        padding: '3px 8.5px',
        width: '164px',
      }}
    >
      <span style={{ 'align-items': 'center', display: 'flex', gap: '6px' }}>
        <MagnifyingGlassIcon />
        <span
          style={{
            color: INK.textMuted,
            'font-family': appFont,
            'font-size': '10px',
            'font-weight': 500,
          }}
        >
          Search
        </span>
      </span>
      <span style={{ 'align-items': 'center', display: 'flex', gap: '2px' }}>
        <CommandIcon />
        <span
          style={{
            color: INK.textFaint,
            'font-family': appFont,
            'font-size': '10px',
            'font-weight': 500,
          }}
        >
          F
        </span>
      </span>
    </div>
  );
}

// --- List data ---------------------------------------------------------------

export type Row = {
  who: string;
  subject: string;
  preview: string;
  time: string;
  unread?: boolean;
  selected?: boolean;
  calendar?: boolean;
};

export type Group = { label: string; rows: Row[] };

// Node 2:2 "Frame 1" — the Signal card: 6 rows, 3 groups, footer.
export const SIGNAL_GROUPS: Group[] = [
  {
    label: 'TODAY',
    rows: [
      {
        who: 'Lena Hartwell',
        subject: 'Revised SOW before Thursday?',
        preview:
          'Legal signed off on the new terms this morning — the only change from last round is the net-45 payment window',
        time: '10:33 AM',
      },
      {
        who: 'Nina Castellano',
        subject: 'Design review for the new onboarding',
        preview:
          'Went through the whole flow this morning and left comments in Onboarding notes mostly around the empty states, where the copy feels dense for first-time users.',
        time: '9:14 AM',
        unread: true,
        selected: true,
      },
    ],
  },
  {
    label: 'THIS WEEK',
    rows: [
      {
        who: 'Marco Delgado',
        subject: 'Invitation: Macro intro @ 11 AM',
        preview:
          'You have been invited to an event on Thu Jun 19 from 11:00–11:30am. Agenda attached mostly want to cover the team, ro45 payment window',
        time: 'Jun 16',
        calendar: true,
      },
      {
        who: 'Ben Aldridge',
        subject: 'Re: Q3 Roadmap Draft',
        preview:
          'Thanks for putting the roadmap together — the sequencing mostly reads right. One thing on the timeline: can we pull the billing work for',
        time: 'Jun 16',
      },
      {
        who: 'Mom',
        subject: 'dinner sunday?',
        preview:
          'your sister is coming into town this weekend, thought we could all get together sunday evening if you are free. nothing fancy, maybe just past',
        time: 'Jun 14',
        unread: true,
      },
    ],
  },
  {
    label: 'EARLIER',
    rows: [
      {
        who: 'Claire Donovan',
        subject: 'Contract countersigned',
        preview:
          'Attaching the fully executed copy for your records. Both signature blocks are complete and the effective date is today. Thanks for the',
        time: 'Jun 16',
      },
    ],
  },
];

// Node 6:335 "Frame 2" — the Noise card: 17 rows, 3 groups, no footer.
export const NOISE_GROUPS: Group[] = [
  {
    label: 'TODAY',
    rows: [
      {
        who: 'Spotify',
        subject: 'Your Discover Weekly is ready 🎧',
        preview:
          "We've curated 30 new songs based on what you've been listening to lately. Includes fresh tracks from artists you love and a few surprises.",
        time: '9:01 AM',
      },
      {
        who: 'Amazon',
        subject: 'Flash sale ends tonight — up to 40% off',
        preview:
          'Today only: massive savings on electronics, home essentials, and more. Deals are going fast — shop before midnight to lock in your price.',
        time: '8:44 AM',
        unread: true,
      },
      {
        who: 'Netflix',
        subject: 'New this week on Netflix 🍿',
        preview:
          "Stranger Things season 5 is now streaming. Plus: new releases this week and a documentary you'll want to watch.",
        time: '7:52 AM',
        unread: true,
      },
    ],
  },
  {
    label: 'THIS WEEK',
    rows: [
      {
        who: 'Airbnb',
        subject: '15% off your next getaway ✈️',
        preview:
          'Book before July 31 and save on stays near you. We found some cozy spots just a short drive away — perfect for a summer weekend.',
        time: 'Jun 30',
      },
      {
        who: 'LinkedIn',
        subject: 'You appeared in 24 searches this week',
        preview:
          "Recruiters are looking at your profile. See who's searching for you and explore 5 new job recommendations that match your experience and skills.",
        time: 'Jun 28',
      },
      {
        who: 'Duolingo',
        subject: "Don't break your streak! 🔥 3 days and counting",
        preview:
          "You're so close to a new milestone. Just 5 minutes of practice today keeps your streak alive. Your owl is waiting — don't let him down.",
        time: 'Jun 25',
        unread: true,
      },
      {
        who: 'Notion',
        subject: 'Your workspace had a busy week',
        preview:
          '3 new pages were created and 2 docs updated. Stay in sync with what your team is building in your shared workspace.',
        time: 'Jun 29',
      },
      {
        who: 'Substack',
        subject: '5 new posts from writers you follow',
        preview:
          "Catch up on the latest essays and newsletters from your subscriptions. New from 5 writers you've been reading.",
        time: 'Jun 28',
      },
      {
        who: 'Headspace',
        subject: 'Keep the momentum going POOPOO 😌',
        preview:
          "You completed 4 sessions this week! Try today's new Wind Down meditation to finish off your progress strong.",
        time: 'Jun 27',
      },
      {
        who: 'Google',
        subject: 'Your storage is 85% full',
        preview:
          "You're running low on storage across Gmail, Drive, and Photos. Upgrade your plan to keep everything safe and synced.",
        time: 'Jun 26',
      },
      {
        who: 'Figma',
        subject: '7 new comments on your files',
        preview:
          'Your team left comments across 3 files while you were away. Jump in to review feedback and keep your designs moving.',
        time: 'Jun 25',
      },
    ],
  },
  {
    label: 'EARLIER',
    rows: [
      {
        who: 'The Hustle',
        subject: 'Why every SaaS company is adding AI',
        preview:
          "This week: the AI feature rush is real, Stripe's quiet expansion into banking, and the startup that's making $10M selling spreadsheet templates.",
        time: 'Jun 16',
      },
      {
        who: 'Loom',
        subject: 'Someone watched your video 👀',
        preview:
          "Your walkthrough video got 12 new views this week. See who's been watching and track engagement across all your recordings.",
        time: 'Jun 14',
      },
      {
        who: 'Canva',
        subject: 'Your June recap: 8 designs created',
        preview:
          'You made 8 designs this month. Your top template was downloaded 43 times by other creators on the platform.',
        time: 'Jun 12',
      },
      {
        who: 'Slack',
        subject: 'You missed 14 messages while away',
        preview:
          "Here's a digest of what happened: 14 channel messages, 3 mentions, and 2 direct messages waiting for your reply.",
        time: 'Jun 10',
      },
      {
        who: 'Medium',
        subject: "Stories we think you'll love",
        preview:
          "Based on your reading history: 'The death of the junior dev', 'Async is the future of work', and 3 more picked for you.",
        time: 'Jun 8',
      },
      {
        who: 'Wix',
        subject: 'Your site had 502 visitors this week',
        preview:
          'Traffic is up 18% from last week. Check your analytics dashboard for a full breakdown of where your visitors came from.',
        time: 'Jun 5',
      },
    ],
  },
];

function GroupDivider(props: { label: string }) {
  return (
    <div
      style={{
        'align-items': 'center',
        'box-sizing': 'border-box',
        display: 'flex',
        gap: '10px',
        padding: '4px 8px',
        width: '100%',
      }}
    >
      <span
        style={{
          color: INK.textMuted,
          'font-family': appFont,
          'font-size': '8px',
          'font-weight': 500,
          'white-space': 'nowrap',
        }}
      >
        {props.label}
      </span>
      <span
        aria-hidden="true"
        style={{
          'background-color': INK.hairline,
          flex: '1 1 0',
          height: '0.5px',
        }}
      />
    </div>
  );
}

function ListRow(props: { row: Row }) {
  const textColor = () => (props.row.unread ? INK.textBright : INK.textDim);
  return (
    <div
      style={{
        'align-items': 'center',
        'background-color': props.row.selected ? INK.rowHover : 'transparent',
        'border-radius': props.row.selected ? '6px' : '0',
        'box-sizing': 'border-box',
        display: 'flex',
        gap: '8px',
        height: '24px',
        padding: '0 8px',
        width: '100%',
      }}
    >
      <span
        style={{
          'align-items': 'center',
          display: 'flex',
          flex: 'none',
          'justify-content': 'center',
          width: '4px',
        }}
      >
        <Show when={props.row.unread}>
          <span
            aria-hidden="true"
            style={{
              'background-color': INK.unreadDot,
              'border-radius': '999px',
              display: 'block',
              height: '4px',
              width: '4px',
            }}
          />
        </Show>
      </span>
      <Show
        when={props.row.calendar}
        fallback={<EnvelopeIcon bold={props.row.unread} />}
      >
        <CalendarIcon bold={props.row.unread} />
      </Show>
      <span
        style={{
          color: textColor(),
          'font-family': appFont,
          'font-size': '10px',
          'font-weight': 500,
          'min-width': 0,
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
          width: '100px',
        }}
      >
        {props.row.who}
      </span>
      <span
        style={{
          'align-items': 'baseline',
          display: 'flex',
          flex: '1 1 0',
          gap: '10px',
          'min-width': 0,
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            color: textColor(),
            'font-family': appFont,
            'font-size': '10px',
            'font-weight': 500,
            'white-space': 'nowrap',
          }}
        >
          {props.row.subject}
        </span>
        <span
          style={{
            color: INK.textMuted,
            'font-family': appFont,
            'font-size': '10px',
            'font-weight': 500,
            'min-width': 0,
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            'white-space': 'nowrap',
          }}
        >
          {props.row.preview}
        </span>
      </span>
      <span
        style={{
          color: INK.textDim,
          flex: 'none',
          'font-family': appFont,
          'font-size': '10px',
          'font-weight': 500,
          'text-align': 'right',
          'white-space': 'nowrap',
          width: '64px',
        }}
      >
        {props.row.time}
      </span>
    </div>
  );
}

export function EmailListCardGraphic(props: {
  selectedTab: TabName;
  groups: Group[];
  footer?: boolean;
  style?: JSX.CSSProperties;
}) {
  return (
    <div
      style={{
        'background-color': INK.bg,
        border: `1px solid ${INK.outerBorder}`,
        'border-radius': '14px',
        'box-sizing': 'border-box',
        display: 'flex',
        'flex-direction': 'column',
        'max-width': '800px',
        overflow: 'hidden',
        padding: '8px',
        width: '100%',
        height: '400px',
        ...props.style,
      }}
    >
      {/* Header bar */}
      <div
        style={{
          'align-items': 'center',
          'border-bottom': `0.5px solid ${INK.hairline}`,
          'box-sizing': 'border-box',
          display: 'flex',
          'justify-content': 'space-between',
          'padding-bottom': '8px',
          'padding-left': '8px',
          width: '100%',
        }}
      >
        <div style={{ 'align-items': 'center', display: 'flex', gap: '20px' }}>
          <MacroLogoIcon />
          <TabSwitcher selected={props.selectedTab} />
          <span
            style={{
              'align-items': 'center',
              display: 'flex',
              gap: '6px',
              height: '24px',
            }}
          >
            <span
              style={{
                color: INK.textMuted,
                'font-family': appFont,
                'font-size': '10px',
                'font-weight': 500,
                'white-space': 'nowrap',
              }}
            >
              All inboxes
            </span>
            <CaretDownIcon />
          </span>
        </div>
        <div
          style={{
            'align-items': 'center',
            display: 'flex',
            gap: '16px',
            'justify-content': 'flex-end',
          }}
        >
          <span
            style={{
              'align-items': 'center',
              'background-color': INK.chip,
              border: `0.5px solid ${INK.hairline}`,
              'border-radius': '12px',
              display: 'flex',
              gap: '6px',
              height: '18px',
              padding: '3px 10px 3px 6px',
            }}
          >
            <PlusIcon />
            <span
              style={{
                color: INK.textDim,
                'font-family': appFont,
                'font-size': '10px',
                'font-weight': 500,
                'white-space': 'nowrap',
              }}
            >
              Compose
            </span>
          </span>
          <SearchField />
        </div>
      </div>

      {/* List */}
      <div
        style={{
          'align-items': 'center',
          'box-sizing': 'border-box',
          display: 'flex',
          'flex-direction': 'column',
          gap: '4px',
          padding: '8px 0px',
          width: '100%',
        }}
      >
        <For each={props.groups}>
          {(group) => (
            <>
              <GroupDivider label={group.label} />
              <For each={group.rows}>{(row) => <ListRow row={row} />}</For>
            </>
          )}
        </For>

        <Show when={props.footer}>
          <div
            style={{
              'align-items': 'center',
              'box-sizing': 'border-box',
              display: 'flex',
              gap: '6px',
              'justify-content': 'center',
              padding: '24px 0 4px 8px',
              width: '100%',
            }}
          >
            <span
              style={{
                color: INK.textMuted,
                'font-family': appFont,
                'font-size': '8px',
                'font-weight': 500,
                'white-space': 'nowrap',
              }}
            >
              Powered by Macro
            </span>
            <MacroLogoIcon size={12} color={INK.textDim} />
          </div>
        </Show>
      </div>
    </div>
  );
}
