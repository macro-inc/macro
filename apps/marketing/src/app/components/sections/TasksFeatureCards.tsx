import { createSignal, For, Match, Show, Switch } from 'solid-js';
import TasksAiHandoffGraphic from '../../../assets/graphics/tasks-ai-handoff.svg';
import TasksAlongsideGraphic from '../../../assets/graphics/tasks-alongside.svg';
import TasksFollowPrGraphic from '../../../assets/graphics/tasks-follow-pr.svg';
import TasksSendAsTaskGraphic from '../../../assets/graphics/tasks-send-as-task.svg';
import { viewportWidth } from '../../utils/utilBreakpoint';
import { InfiniteCarousel } from '../utils/InfiniteCarousel';
import { SsgDesktop, SsgMobile } from '../utils/SsgGate';
import '../../routes/RouteTasks.css';

const mobile = () => viewportWidth() < 700;

// Four cards on a 2x2 grid. Each carries its own graphic treatment: `spotlight`
// frames the art in a cutout, `bleed` runs it off the right edge, and the rest
// fall back to a centred fig sized by `width`/`mobileWidth` — those widths are
// per-card because the artboards differ in aspect, and matching on width alone
// would drive the height of the row every card shares.
const tasksCards = [
  {
    Graphic: TasksSendAsTaskGraphic,
    title: 'Built for chat',
    desc: 'Messages are designed to be converted to tasks. A message can be sent as a task to any channel.',
    compose: true,
  },
  {
    Graphic: TasksAlongsideGraphic,
    title: 'In your inbox',
    desc: 'Your tasks live in the same keyboard-driven inbox as your email and messages.',
    spotlight: true,
  },
  {
    Graphic: TasksFollowPrGraphic,
    title: 'Linked to your pull requests',
    desc: 'Once work moves to a PR, tasks update based on merge status.',
    // Narrower than the art it replaced: this is a 56x88 artboard against the
    // old 1050x1226, so matching on width would have rendered it ~100px taller
    // and driven up the row every card shares. These widths are set from the
    // aspect to hold the previous rendered height (256px / 208px) instead.
    width: '163px',
    mobileWidth: '132px',
    dropShadow: true,
  },
  {
    Graphic: TasksAiHandoffGraphic,
    title: 'Agents pick up and close them',
    desc: 'Assign a task to a Macro agent. The agent can open PRs, update docs, and close out the task.',
    bleed: true,
  },
];

type TasksCard = (typeof tasksCards)[number];

function TaskFeatureCard(props: {
  bordered?: { left?: boolean; top?: boolean };
  card: TasksCard;
  compact: boolean;
  index: number;
}) {
  const compact = () => props.compact;

  return (
    <article
      style={{
        // On the 2x2 grid the left border belongs to the right-hand
        // column (odd indices) and the top border to the second row
        // (index >= 2); stacked, every card but the first takes a top
        // border and none take a left one. The mobile carousel drops
        // the borders — each slide is its own card.
        'border-left': props.bordered?.left
          ? '1px solid color-mix(in srgb, var(--b4) 32%, transparent)'
          : 'none',
        'border-top': props.bordered?.top
          ? '1px solid color-mix(in srgb, var(--b4) 32%, transparent)'
          : 'none',
        'box-sizing': 'border-box',
        display: 'grid',
        gap: compact() ? '32px' : '44px',
        // Fixed rather than minmax/1fr: with 1fr each row sized to its
        // own tallest card, so the four graphics came out at different
        // heights. A fixed track makes every graphic box identical.
        'grid-template-rows': `${compact() ? '208px' : '256px'} 1fr`,
        height: '100%',
        // Bottom sits a couple of px short of the horizontal so the
        // GLYPHS land level: the last line's box extends below its ink
        // by the half-leading, so a literal 30/30 reads bottom-heavy.
        padding: compact() ? '24px 18px 16px' : '28px 30px 28px',
        width: '100%',
      }}
    >
      {/* Bottom-anchored so the graphics share a baseline: the first
          two artworks touch their viewBox bottom edge. */}
      <Switch
        // No edge fade on this variant: it centres a fig that fits
        // inside its box, so there is no overflow to soften — the mask
        // would only have dimmed the art's own extremities.
        fallback={
          <div
            class="tasks-fig"
            style={{
              'align-items': 'flex-end',
              display: 'flex',
              'justify-content': 'center',
            }}
          >
            <props.card.Graphic
              aria-hidden="true"
              style={{
                color: 'color-mix(in srgb, var(--a0) 60%, var(--b0))',
                display: 'block',
                // On the svg ROOT a filter resolves in CSS px, not the
                // artboard units a filter on a child would use. The
                // shadow is cast from the whole composition's
                // silhouette, so the nodes and badges get lifted while
                // the icon strokes drawn on top of them do not throw
                // their own — those fall behind opaque shapes.
                filter: props.card.dropShadow
                  ? 'drop-shadow(0 2px 4px rgb(0 0 0 / 0.5))'
                  : undefined,
                height: 'auto',
                'max-width': compact()
                  ? props.card.mobileWidth
                  : props.card.width,
                width: '100%',
              }}
            />
          </div>
        }
      >
        <Match when={props.card.spotlight}>
          {/* The art, scaled up and framed on the three row icons, seen
              through a cutout: the window's overflow does the cropping
              and its inset shadow does the framing. */}
          <div class="tasks-fig tasks-fig-vignette tasks-fig-spot">
            <props.card.Graphic
              aria-hidden="true"
              class="tasks-fig-spot__art"
            />
          </div>
        </Match>
        <Match when={props.card.compose}>
          {/* Framed on the send button and the "Send as task" toggle,
              with the rest of the composer running off the left edge —
              the mirror of the bleed treatment above. */}
          <div class="tasks-fig tasks-fig-vignette tasks-fig-compose">
            <props.card.Graphic
              aria-hidden="true"
              class="tasks-fig-compose__art"
            />
          </div>
        </Match>
        <Match when={props.card.bleed}>
          {/* Scaled past the card's right edge so the composition's
              weight sits left, over a faint glow and dissolved by a
              radial mask. Unlike card 1 this is not a framed box, so
              the mask can share the element with the glow. */}
          <div class="tasks-fig tasks-fig-vignette tasks-fig-bleed">
            <props.card.Graphic
              aria-hidden="true"
              class="tasks-fig-bleed__art"
            />
          </div>
        </Match>
      </Switch>
      {/* Generous gap: the description is meant to sit apart from its
          title, not tuck under it.

          The text column is indented by the width of the numeral badge
          plus its gap (19+10 desktop, 20+9 mobile — 29px either way),
          and the title outdents itself by the same amount. That puts
          the circled numeral on the card's padding edge with the title
          text and the description sharing a left edge to its right, the
          hanging-marker arrangement of a numbered list. Outdenting the
          numeral instead would push it into the 30px/18px padding and
          off the mobile card entirely. */}
      <div
        style={{
          'align-self': 'end',
          display: 'grid',
          gap: compact() ? '16px' : '20px',
          'padding-left': '29px',
        }}
      >
        <h2
          style={{
            'align-items': 'center',
            color: 'var(--c2)',
            display: 'flex',
            'font-family': 'body',
            'font-size': compact() ? '15px' : '14px',
            'font-weight': '700',
            gap: compact() ? '9px' : '10px',
            'letter-spacing': '0.07em',
            'line-height': 1.2,
            // Cancels the column's indent so the badge lands on the
            // padding edge; the title span still starts at +29px.
            margin: '0 0 0 -29px',
            'text-transform': 'uppercase',
            'text-wrap': 'balance',
          }}
        >
          {/* Numeral comes from the card's position rather than being
              baked into the title string, so reordering the array
              renumbers the set. aria-hidden because the ordering is
              decorative — the headings already read in sequence. */}
          <span
            aria-hidden="true"
            style={{
              'align-items': 'center',
              border:
                '1px solid color-mix(in srgb, var(--c4) 42%, transparent)',
              'border-radius': '999px',
              'box-sizing': 'border-box',
              display: 'inline-flex',
              flex: 'none',
              'font-family': 'rajdhani, body',
              'font-size': compact() ? '11.5px' : '11px',
              'font-variant-numeric': 'tabular-nums',
              height: compact() ? '20px' : '19px',
              'justify-content': 'center',
              // The title's tracking would push the digit off-centre.
              'letter-spacing': '0',
              'line-height': 1,
              width: compact() ? '20px' : '19px',
            }}
          >
            {props.index + 1}
          </span>
          <span>{props.card.title}</span>
        </h2>
        <p
          style={{
            color: compact()
              ? 'color-mix(in srgb, var(--c4) 84%, transparent)'
              : 'color-mix(in srgb, var(--c4) 64%, transparent)',
            'font-family': 'body',
            'font-size': compact() ? '14px' : '12.5px',
            'font-weight': '500',
            'line-height': 1.4,
            margin: '0',
            // Cap the measure so the descriptions wrap to a similar
            // depth. No min-height: the graphic row above is a fixed
            // track, so every card's text block already starts at the
            // same y and the titles align without reserving height —
            // and reserving it left ~18px of dead space under the last
            // line, which is what threw off the corner padding.
            'max-width': '44ch',
            'text-wrap': 'balance',
          }}
        >
          {props.card.desc}
        </p>
      </div>
    </article>
  );
}

export function TasksFeatureCards(props: { cardsOnly?: boolean } = {}) {
  const [activeCard, setActiveCard] = createSignal(0);

  const selectCard = (index: number) => {
    const track = document.querySelector<HTMLElement>(
      '.tasks-cards-mobile-track'
    );
    const slide = document.getElementById(`tasks-card-${index}`);
    if (!track || !slide) return;
    track.scrollTo({
      left: Math.max(
        0,
        slide.offsetLeft + slide.offsetWidth / 2 - track.clientWidth / 2
      ),
      behavior: 'smooth',
    });
  };
  return (
    <>
      <style>{`
        .tasks-fig-spot {
          --art-scale: 1.7;
          --art-nudge: 0.9%;
          background-image: radial-gradient(
            ellipse 58% 72% at
              calc(50% - var(--art-scale) * 3.18% + var(--art-scale) * var(--art-nudge)) 50%,
            color-mix(in srgb, var(--c4) 18%, transparent) 0%,
            color-mix(in srgb, var(--c4) 6%, transparent) 45%,
            transparent 78%
          );
          overflow: hidden;
          position: relative;
        }
        .tasks-fig-spot__art {
          display: block;
          height: auto;
          width: calc(var(--art-scale) * 100%);
          left: 50%;
          position: absolute;
          top: 50%;
          transform: translate(calc(-8.72% + var(--art-nudge)), -50%);
          overflow: visible;
        }
        .tasks-fig-spot__art rect[fill]:not([fill*="pattern"]) {
          filter: drop-shadow(0 2.2px 4.4px rgb(0 0 0 / 0.7));
        }
        .tasks-fig-bleed {
          --bleed-scale: 1.05;
          overflow: hidden;
          position: relative;
          background-image: radial-gradient(
            ellipse 62% 72% at 40% 50%,
            color-mix(in srgb, var(--ambient-ink) 7%, transparent) 0%,
            color-mix(in srgb, var(--ambient-ink) 2.5%, transparent) 45%,
            transparent 78%
          );
        }
        .tasks-fig-bleed__art {
          display: block;
          height: auto;
          left: 0;
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: calc(var(--bleed-scale) * 100%);
          overflow: visible;
        }
        .tasks-fig-bleed__art rect[width="200"][fill] {
          filter: drop-shadow(0 1.6px 3.2px rgb(0 0 0 / 0.6));
        }
        .tasks-fig-compose {
          --compose-scale: 2.2;
          overflow: hidden;
          position: relative;
        }
        .tasks-fig-compose__art {
          display: block;
          height: auto;
          left: 50%;
          position: absolute;
          top: 50%;
          transform: translate(-78.63%, -69.61%);
          width: calc(var(--compose-scale) * 100%);
          overflow: visible;
        }
        .tasks-fig {
          opacity: 0.9;
        }
        .tasks-fig-vignette {
          --fade: 16%;
          mask-image:
            linear-gradient(to right, transparent 0%, #000 var(--fade), #000 calc(100% - var(--fade)), transparent 100%),
            linear-gradient(to bottom, transparent 0%, #000 var(--fade), #000 calc(100% - var(--fade)), transparent 100%);
          -webkit-mask-image:
            linear-gradient(to right, transparent 0%, #000 var(--fade), #000 calc(100% - var(--fade)), transparent 100%),
            linear-gradient(to bottom, transparent 0%, #000 var(--fade), #000 calc(100% - var(--fade)), transparent 100%);
          -webkit-mask-composite: source-in;
          mask-composite: intersect;
        }
        .tasks-fig-compose {
          mask-image: linear-gradient(to right, transparent 0%, #000 26%);
          -webkit-mask-image: linear-gradient(to right, transparent 0%, #000 26%);
        }
        .tasks-cards-mobile-wrap {
          display: grid;
          gap: 16px;
          margin-inline: -18px;
          overflow: hidden;
          width: calc(100% + 36px);
        }
        .tasks-cards-mobile-track {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .tasks-cards-mobile-track::-webkit-scrollbar { display: none; }
      `}</style>
      <section
        style={{
          'box-sizing': 'border-box',
          margin: '0 auto',
          'max-width': '1160px',
          padding: props.cardsOnly
            ? '0'
            : mobile()
              ? '56px 18px'
              : '136px 24px',
          width: '100%',
        }}
      >
        <Show when={!props.cardsOnly}>
          {/* The statement is one centred column that the heading and the body
          both live inside, rather than two siblings each carrying their own
          measure. The column is what gets centred (max-width + auto side
          margins); everything within it is flush left, so the heading and the
          paragraphs share a left edge by construction and cannot drift apart.
          Matching a max-width on the h2 and on the body separately would look
          identical today and silently misalign the moment either one changed.

          Note this centres the statement against the section, so it no longer
          shares a left edge with the bento grid below — the grid keeps the full
          content width. That is the intent: the statement reads as its own
          centred beat. */}
          <div
            style={{
              // Wide bottom margin: the statement is a beat of its own, and the
              // card row below should read as a separate movement rather than as
              // its continuation.
              margin: mobile() ? '0 auto 104px' : '0 auto 160px',
              'max-width': mobile() ? '100%' : '104ch',
              width: '100%',
            }}
          >
            <h2
              class="tasks-h3"
              style={{
                margin: mobile() ? '0 0 40px' : '0 0 56px',
                'text-align': 'left',
                'text-wrap': 'balance',
              }}
            >
              Why did we build Macro Tasks?
            </h2>
            {/* Why the product exists, in place of a demo reel: the cards below show
            what it does, so this says why it was built. */}
            <div
              style={{
                display: 'grid',
                gap: mobile() ? '18px' : '22px',
              }}
            >
              <p
                style={{
                  color: 'var(--c4)',
                  // Cyberreader rather than the site's Rajdhani 'body': this is a
                  // longer read than anything else on the page, and cyberreader —
                  // a blend of Rajdhani's edge and Inter's readability, used for
                  // the blog — carries it at length while still sounding like the
                  // site. It ships as discrete faces at 300/400/700 only (not a
                  // variable axis), so the 300 below is the real Light file rather
                  // than a synthesised weight.
                  'font-family': 'cyberreader',
                  'font-size': mobile() ? '16.5px' : '18px',
                  'font-weight': '300',
                  'line-height': 1.6,
                  margin: '0',
                  'text-align': 'left',
                  'text-wrap': 'pretty',
                }}
              >
                Macro Tasks was designed based off our frustration with tools
                like Linear, Notion and Jira... we've tried every task manager
                and every way of using them. None of them helped our team move
                faster. Each kept us organized for a while until they inevitably
                got stale. The core problem is "tracking tasks" felt like
                busywork to our team. We migrated from Github Issues to Notion
                to Linear and nothing seemed to make us more organized.
                <br />
                <br />
                Macro Tasks fixes this by tightly co-locating tasks with your
                team chat. Tickets are so easy to create from task messages, and
                their status gets updated automatically so they'll actually get
                closed. After two years of dogfooding it's finally working for
                us. We hope you like it too!
              </p>
              <p
                style={{
                  color: 'var(--c2)',
                  // Cyberreader rather than the site's Rajdhani 'body': this is a
                  // longer read than anything else on the page, and cyberreader —
                  // a blend of Rajdhani's edge and Inter's readability, used for
                  // the blog — carries it at length while still sounding like the
                  // site. It ships as discrete faces at 300/400/700 only (not a
                  // variable axis), so the 300 below is the real Light file rather
                  // than a synthesised weight.
                  'font-family': 'cyberreader',
                  'font-size': mobile() ? '16.5px' : '18px',
                  'font-weight': '300',
                  'line-height': 1.6,
                  margin: '0',
                  'text-align': 'left',
                  'text-wrap': 'pretty',
                }}
              >
                - Jacob Beckerman, CEO and founder of Macro
              </p>
            </div>
          </div>
        </Show>
        <SsgDesktop>
          <div
            style={{
              display: 'grid',
              'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
              width: '100%',
            }}
          >
            <For each={tasksCards}>
              {(card, index) => (
                <TaskFeatureCard
                  bordered={{
                    left: index() % 2 === 1,
                    top: index() >= 2,
                  }}
                  card={card}
                  compact={false}
                  index={index()}
                />
              )}
            </For>
          </div>
        </SsgDesktop>
        <SsgMobile>
          <div class="tasks-cards-mobile-wrap">
            <InfiniteCarousel
              ariaLabel="Task features"
              class="tasks-cards-mobile-track"
              items={tasksCards}
              onActiveChange={setActiveCard}
              style={{
                'align-items': 'stretch',
                display: 'flex',
                overflow: 'auto',
                'overscroll-behavior-x': 'contain',
                padding: '0',
                'scroll-behavior': 'smooth',
                'scroll-snap-type': 'x mandatory',
                width: '100%',
              }}
            >
              {(card, context) => (
                <div
                  aria-hidden={context.isClone()}
                  id={
                    context.isClone()
                      ? undefined
                      : `tasks-card-${context.logicalIndex()}`
                  }
                  style={{
                    'box-sizing': 'border-box',
                    display: 'flex',
                    flex: '0 0 calc(100% - 48px)',
                    margin: '0 8px',
                    'min-width': '0',
                    'scroll-snap-align': 'center',
                    'scroll-snap-stop': 'always',
                  }}
                >
                  <TaskFeatureCard
                    card={card}
                    compact
                    index={context.logicalIndex()}
                  />
                </div>
              )}
            </InfiniteCarousel>
            <div
              aria-label="Task features"
              style={{
                display: 'flex',
                gap: '8px',
                'justify-content': 'center',
              }}
            >
              <For each={tasksCards}>
                {(card, index) => (
                  <button
                    aria-controls={`tasks-card-${index()}`}
                    aria-label={`Show ${card.title}`}
                    aria-pressed={activeCard() === index()}
                    onClick={() => selectCard(index())}
                    style={{
                      background:
                        activeCard() === index()
                          ? 'var(--a0)'
                          : 'color-mix(in srgb, var(--c4) 34%, transparent)',
                      border: '0',
                      'border-radius': '999px',
                      cursor: 'pointer',
                      height: '7px',
                      padding: '0',
                      transition:
                        'background-color 180ms ease, transform 180ms ease, width 180ms ease',
                      width: activeCard() === index() ? '24px' : '7px',
                    }}
                    type="button"
                  />
                )}
              </For>
            </div>
          </div>
        </SsgMobile>
      </section>
    </>
  );
}
