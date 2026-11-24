import { useLocation } from '@solidjs/router';
import { createRenderEffect, For, Match, Show, Switch } from 'solid-js';
import { setPageSeo } from '../../../app/utils/utilSeo';
import { BookingLinkStories } from '../components/BookingLinkStories';
import { CalendarStories } from '../components/CalendarStories';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { FeaturePhoneScreens } from '../components/FeatureScreenshot';
import { HomepageClosing } from '../components/HomepageClosing';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import { featureScreens, phoneScreens } from '../core/feature-screens';
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
        <Switch
          fallback={
            <>
              <FeaturePageSection
                id={`${slug()}-workspace`}
                title={feature().heading}
                description={feature().detail}
                screen={featureScreens[`${slug()}-workspace`]}
              />
              <For each={feature().sections}>
                {(section, index) => (
                  <FeaturePageSection
                    id={`${slug()}-detail-${index() + 1}`}
                    title={section.title}
                    description={section.description}
                    screen={featureScreens[`${slug()}-detail-${index() + 1}`]}
                  />
                )}
              </For>
            </>
          }
        >
          <Match when={slug() === 'calendar'}>
            <CalendarStories />
          </Match>
          <Match when={slug() === 'booking-links'}>
            <BookingLinkStories />
          </Match>
        </Switch>
        <Show when={phoneScreens[slug()]}>
          {(screens) => (
            <FeaturePhoneScreens
              screens={screens()}
              product={feature().product}
            />
          )}
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
