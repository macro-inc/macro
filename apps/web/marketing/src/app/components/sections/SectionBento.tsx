import { A } from '@solidjs/router';
import { createSignal, For, Show } from 'solid-js';
import IconChannels from '../../../assets/icons/icon-channels.svg';
import IconDocuments from '../../../assets/icons/icon-documents.svg';
import IconEmail from '../../../assets/icons/icon-email.svg';
import IconTasks from '../../../assets/icons/icon-tasks.svg';
import { breakpoint, viewportWidth } from '../../utils/utilBreakpoint';

const bento = [
  {
    Icon: IconChannels,
    title: 'Quieter than Slack',
    href: '/posts/what-we-learned-from-slack',
    body: 'An email-style inbox with some help from AI to filter out noise.',
  },
  {
    Icon: IconDocuments,
    title: 'Simpler than Notion',
    href: '/posts/what-we-learned-from-notion',
    body: '@linked docs, live collab, fully compatible with markdown.',
  },
  {
    Icon: IconEmail,
    title: 'Faster than Superhuman',
    href: '/posts/what-we-learned-from-superhuman',
    body: 'Email, messages, and tasks in one keyboard-driven inbox.',
  },
  {
    Icon: IconTasks,
    title: 'Lighter than Linear',
    href: '/posts/what-we-learned-from-linear',
    body: 'Create and link @tasks from email, messages, and docs.',
  },
];

function BentoItem(props: {
  Icon: any;
  title: string;
  href: string;
  body: string;
}) {
  const [open, setOpen] = createSignal(false);
  const isCompact = () => viewportWidth() < 700;

  return (
    <div
      style={{
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        'grid-template-rows': !breakpoint() || open() ? 'auto 1fr' : 'auto',
        gap: isCompact() && open() ? '10px' : '14px',
        'min-height': '0',
        height: '100%',
        padding: isCompact() ? '14px 16px' : '0px',
      }}
    >
      <div
        style={{
          cursor: breakpoint() ? 'pointer' : 'default',
          'user-select': 'none',
          display: 'grid',
          'grid-template-columns': breakpoint() ? 'auto minmax(0, 1fr)' : '1fr',
          'grid-template-rows': breakpoint() ? 'auto' : 'auto auto',
          'column-gap': isCompact() ? '12px' : breakpoint() ? '14px' : '0',
          'row-gap': isCompact() ? '10px' : '14px',
          'align-items': 'start',
        }}
        onClick={() => {
          if (breakpoint()) setOpen(!open());
        }}
      >
        <div
          style={{
            display: 'grid',
            'justify-items': 'start',
            'align-items': 'center',
          }}
        >
          <props.Icon
            style={{
              color: 'var(--a0)',
              display: 'block',
              width: isCompact() ? '28px' : '34px',
              height: isCompact() ? '28px' : '34px',
              flex: 'none',
            }}
          />
        </div>
        <div
          style={{
            display: 'grid',
            'grid-template-columns': 'minmax(0, 1fr) auto',
            'align-items': 'center',
            'column-gap': isCompact() ? '10px' : '14px',
          }}
        >
          <h3
            style={{
              'font-family': 'display',
              'font-weight': '450',
              'font-size': isCompact()
                ? '17px'
                : breakpoint()
                  ? '20px'
                  : '21px',
              'line-height': isCompact() ? '1.12' : '1.18',
              margin: '0',
              'min-width': '0',
            }}
          >
            <A
              href={props.href}
              style={{
                color: 'inherit',
                'text-decoration': 'none',
              }}
            >
              {props.title}
            </A>
          </h3>
          <Show when={breakpoint()}>
            <svg
              viewBox="0 0 256 256"
              width={isCompact() ? '14' : '16'}
              height={isCompact() ? '14' : '16'}
              fill="currentColor"
              style={{
                color: 'var(--c4)',
                transform: open() ? 'rotate(180deg)' : 'rotate(0deg)',
              }}
            >
              <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
            </svg>
          </Show>
        </div>
      </div>
      <Show when={!breakpoint() || open()}>
        <>
          <p
            style={{
              'line-height': '1.5',
              color: 'var(--c4)',
              'font-size': isCompact()
                ? '15px'
                : breakpoint()
                  ? '17px'
                  : '18px',
              margin: '0',
              'min-height': '0',
              'align-self': 'start',
              'padding-right': breakpoint() ? '0' : '28px',
            }}
          >
            {props.body}
          </p>
          <A
            href={props.href}
            style={{
              color: 'var(--a0)',
              'font-size': isCompact()
                ? '14px'
                : breakpoint()
                  ? '16px'
                  : '17px',
              'font-weight': '500',
              'line-height': '1',
              'text-decoration': 'none',
            }}
          >
            Read why
          </A>
        </>
      </Show>
    </div>
  );
}

export function SectionBento() {
  return (
    <div
      style={{
        'grid-template-columns': breakpoint()
          ? '1fr'
          : '1.25fr repeat(4, minmax(0, 1fr))',
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        overflow: 'hidden',
        display: 'grid',
        'z-index': '2',
        gap: breakpoint() ? '18px' : '28px',
        'align-items': 'start',
      }}
    >
      <h2
        style={{
          'font-family': 'display',
          'font-size': breakpoint() ? '38px' : '40px',
          'font-weight': '400',
          'letter-spacing': '-0.024em',
          margin: '0',
          color: 'var(--c2)',
        }}
      >
        Everything in one interface, one graph database.
      </h2>
      <For each={bento}>
        {(item) => (
          <BentoItem
            Icon={item.Icon}
            title={item.title}
            href={item.href}
            body={item.body}
          />
        )}
      </For>
    </div>
  );
}
