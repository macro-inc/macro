import ArrowUpRight from '@icon/system/regular/arrow-up-right.svg';
import Bookmark from '@phosphor/bookmark.svg';
import Heart from '@phosphor/heart.svg';
import { For, onCleanup, onMount } from 'solid-js';
import { SitePageClosing } from '../../features/marketing/components/SitePageClosing';
import {
  socialLoveVerifiedAt,
  wallOfLove,
} from '../../features/marketing/core/customer-love';
import { setPageSeo } from '../utils/utilSeo';
import './RouteWallOfLove.css';

export function RouteWallOfLove() {
  let wall: HTMLElement | undefined;

  onMount(() => {
    // Keep ranked DOM order while packing variable-height quotes into the grid.
    const observer = new ResizeObserver((entries) => {
      for (const { target } of entries) {
        const card = target as HTMLElement;
        card.style.gridRowEnd = `span ${Math.ceil(card.getBoundingClientRect().height) + 16}`;
      }
      wall?.setAttribute('data-masonry', 'true');
    });
    wall
      ?.querySelectorAll('.love-card')
      .forEach((card) => observer.observe(card));
    onCleanup(() => observer.disconnect());
  });
  setPageSeo({
    title: 'Wall of love · Macro',
    description:
      'Real people on X, LinkedIn and thousands of support channels.',
    path: '/wall-of-love',
  });

  return (
    <>
      <div class="wall-of-love">
        <header class="love-hero">
          <p class="love-title">Wall of love.</p>
          <h1 class="love-intro">
            Every Macro user (free or paid) gets a dedicated channel with our
            executive and engineering team. It's a lot of work for us to read
            but it has been the most valuable thing we've done. Below is some of
            the kind words we've heard in these channels, on X and on LinkedIn.
            Thank you!
          </h1>
        </header>
        <section
          ref={wall}
          aria-label="Customer and community love"
          class="love-wall"
        >
          <For each={wallOfLove}>
            {(entry) => (
              <figure class="love-card">
                <figcaption>
                  {'handle' in entry ? (
                    <img
                      class="love-profile-photo"
                      src={entry.avatar}
                      alt=""
                      width="40"
                      height="40"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span class="love-avatar" aria-hidden="true">
                      {entry.initials}
                    </span>
                  )}
                  <span class="love-author">
                    <span>{entry.name}</span>
                    <span class="love-source">
                      {'handle' in entry
                        ? entry.handle
                        : 'From a customer conversation'}
                    </span>
                  </span>
                  {'handle' in entry ? (
                    <span class="love-x" aria-hidden="true">
                      𝕏
                    </span>
                  ) : (
                    <Heart class="love-card-heart" aria-hidden="true" />
                  )}
                </figcaption>
                <blockquote>
                  <For each={entry.quote.split('[redacted]')}>
                    {(part, index) => (
                      <>
                        {index() > 0 && (
                          <span
                            class="love-redacted"
                            role="img"
                            aria-label="redacted company"
                          />
                        )}
                        {part}
                      </>
                    )}
                  </For>
                </blockquote>
                {'handle' in entry && (
                  <>
                    <div
                      class="love-engagement"
                      title={`Counts verified on X · ${socialLoveVerifiedAt}`}
                    >
                      <span aria-label={`${entry.likes} likes`}>
                        <Heart aria-hidden="true" />
                        {entry.likes.toLocaleString('en-US')}
                      </span>
                      <span aria-label={`${entry.bookmarks} bookmarks`}>
                        <Bookmark aria-hidden="true" />
                        {entry.bookmarks.toLocaleString('en-US')}
                      </span>
                    </div>
                    <a
                      class="love-original"
                      href={entry.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Read ${entry.name}'s original post on X`}
                    >
                      <span>{entry.note}</span>
                      <ArrowUpRight aria-hidden="true" />
                    </a>
                  </>
                )}
              </figure>
            )}
          </For>
        </section>
      </div>
      <div class="love-page-closing">
        <SitePageClosing />
      </div>
    </>
  );
}
