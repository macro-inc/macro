import { useLocation } from '@solidjs/router';
import { createRenderEffect, For, Show } from 'solid-js';
import { setPageSeo } from '../../../app/utils/utilSeo';
import { BookingLinkStories } from '../components/BookingLinkStories';
import { CalendarStories } from '../components/CalendarStories';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import { DatabaseStories } from '../components/paper/DatabaseStories';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import { SpreadsheetStories } from '../components/spreadsheets/SpreadsheetStories';
import { workspaceFeatures } from '../core/workspace-features';
import './workspace-feature-page.css';

export default function WorkspaceFeaturePage() {
  const location = useLocation();
  const slug = () => location.pathname.replace(/^\//, '').replace(/\/$/, '');
  const feature = () => workspaceFeatures[slug()];
  createRenderEffect(() =>
    setPageSeo({
      title: `Macro ${feature().product} | ${feature().title}`,
      description: feature().description,
      path: `/${slug()}`,
    })
  );
  return (
    <ProductPage>
      <div class="workspace-feature-page" data-feature={slug()}>
        <ProductHero
          tutorial={feature().tutorial}
          product={feature().product}
          title={feature().title}
          description={feature().description}
          cta={`${slug()}_hero_get_started`}
        />
        <Show
          when={slug() === 'calendar'}
          fallback={
            <Show
              when={slug() === 'spreadsheets'}
              fallback={
                <Show
                  when={slug() === 'databases'}
                  fallback={
                    <>
                      <Show
                        when={slug() === 'booking-links'}
                        fallback={
                          <FeaturePageSection
                            id={`${slug()}-workspace`}
                            title={feature().heading}
                            description={feature().detail}
                            demo={{
                              tone: feature().tone,
                              glassFrame: true,
                              message: feature().message
                                ? { person: 'julia', text: feature().message }
                                : undefined,
                            }}
                          >
                            <div
                              class="workspace-feature-scene glass"
                              data-feature={slug()}
                              role="img"
                              aria-label={`${feature().product} example: ${feature().sceneTitle}`}
                            >
                              <div class="workspace-feature-toolbar">
                                <span>{feature().product}</span>
                                <span aria-hidden="true">•••</span>
                              </div>
                              <h3>{feature().sceneTitle}</h3>
                              <div class="workspace-feature-rows">
                                <For each={feature().rows}>
                                  {(row) => (
                                    <div class="workspace-feature-row">
                                      {row}
                                    </div>
                                  )}
                                </For>
                              </div>
                            </div>
                          </FeaturePageSection>
                        }
                      >
                        <BookingLinkStories />
                      </Show>
                      <For each={feature().sections}>
                        {(section, index) => (
                          <FeaturePageSection
                            id={`${slug()}-detail-${index() + 1}`}
                            title={section.title}
                            description={section.description}
                          />
                        )}
                      </For>
                    </>
                  }
                >
                  <DatabaseStories />
                </Show>
              }
            >
              <SpreadsheetStories />
            </Show>
          }
        >
          <CalendarStories />
        </Show>
        <FeaturePageFaq
          id={`${slug()}-questions`}
          title={`Questions about ${feature().product.toLowerCase()}`}
          items={feature().faq}
          guide={{
            href: `/docs/product/${slug()}`,
            label: feature().product.toLowerCase(),
          }}
        ></FeaturePageFaq>
        <HomepageClosing />
      </div>
    </ProductPage>
  );
}
