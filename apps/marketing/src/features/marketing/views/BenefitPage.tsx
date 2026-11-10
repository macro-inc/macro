import { For } from 'solid-js';
import { FeatureGuide } from '../../documentation/components/FeatureGuide';
import { BenefitGraphic } from '../components/benefits/BenefitGraphic';
import { FeaturePageSection } from '../components/FeaturePage';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import { BENEFIT_PAGES } from '../core/benefit-pages';
import '../components/benefits/benefit-page.css';

export function BenefitPage(props: { slug: string }) {
  const page = () => BENEFIT_PAGES[props.slug];
  return (
    <ProductPage auraAccent="#b8b8c0">
      <div class="benefit-page" style={{ '--benefit-accent': page().accent }}>
        <ProductHero
          tutorial={page().tutorial}
          product={page().product}
          title={page().title}
          description={page().description}
          cta={`benefit-${props.slug}`}
        />
        <For each={page().sections}>
          {(section) => (
            <FeaturePageSection
              id={section.id}
              title={section.title}
              description={section.description}
            >
              <BenefitGraphic
                scene={section.scene}
                label={`${section.title} ${section.description}`}
              />
            </FeaturePageSection>
          )}
        </For>
        <FeatureGuide slug={props.slug} />
      </div>
    </ProductPage>
  );
}
