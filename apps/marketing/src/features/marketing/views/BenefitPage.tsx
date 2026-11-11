import { For, Match, Switch } from 'solid-js';
import { FeatureGuide } from '../../documentation/components/FeatureGuide';
import { AgentParallelSearchStory } from '../components/agents/AgentParallelSearchStory';
import { BenefitGraphic } from '../components/benefits/BenefitGraphic';
import {
  CompanyGraphDemo,
  isCompanyGraphScene,
} from '../components/benefits/CompanyGraphDemo';
import { DemoInteractionBoundary } from '../components/DemoInteractionBoundary';
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
              demo={
                section.scene === 'parallel-search'
                  ? { tone: 'agents' }
                  : section.scene === 'pr-channel'
                    ? { tone: 'chat' }
                    : section.scene === 'references'
                      ? { tone: 'documents' }
                      : section.scene === 'task-task'
                        ? { tone: 'tasks' }
                        : undefined
              }
            >
              <Switch>
                <Match when={section.scene === 'parallel-search'}>
                  <DemoInteractionBoundary
                    class="feature-page-visual"
                    render={() => <AgentParallelSearchStory />}
                  />
                </Match>
                <Match
                  when={isCompanyGraphScene(section.scene) && section.scene}
                >
                  {(scene) => <CompanyGraphDemo scene={scene()} />}
                </Match>
                <Match
                  when={
                    section.scene !== 'parallel-search' &&
                    !isCompanyGraphScene(section.scene) &&
                    section.scene
                  }
                >
                  {(scene) => (
                    <BenefitGraphic
                      scene={scene()}
                      label={`${section.title} ${section.description}`}
                    />
                  )}
                </Match>
              </Switch>
            </FeaturePageSection>
          )}
        </For>
        <FeatureGuide slug={props.slug} />
      </div>
    </ProductPage>
  );
}
