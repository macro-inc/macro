import { setPageSeo } from '../../../app/utils/utilSeo';
import { SavingsCalculator } from '../components/pricing/SavingsCalculator';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import type { ReplacementApp } from '../components/product/ReplacementAppIcon';
import '../components/benefits/benefit-page.css';
import './replace-apps-page.css';

const replacementApps: ReplacementApp[] = [
  'Superhuman',
  'Outlook',
  'Slack',
  'Teams',
  'Discord',
  'Linear',
  'Jira',
  'Asana',
  'ClickUp',
  'Notion',
  'Word',
  'Google Workspace',
  'Confluence',
  'Salesforce',
  'HubSpot',
  'Excel',
  'Airtable',
  'Dropbox',
  'Zoom',
  'Calendly',
  'Cal.com',
  'Miro',
  'FigJam',
  'Lucidchart',
];

export default function ReplaceAppsPage() {
  setPageSeo({
    title: 'Replace 27+ apps with Macro',
    description:
      'Bring your team’s work into one connected workspace. Compare the cost of your current tools with Macro using our savings calculator.',
    path: '/replace-apps',
  });
  return (
    <ProductPage>
      <div class="benefit-page replace-apps-page">
        <ProductHero
          product="Workspace"
          title="Replace 27+ apps."
          description="Email, chat, docs, and tasks. All included with Macro."
          cta="replace_apps_hero"
        />
        <section class="replacement-calculator" aria-label="Compare app costs">
          <SavingsCalculator apps={replacementApps} />
          <a class="replacement-pricing-link" href="/pricing">
            See all Macro plans →
          </a>
        </section>
      </div>
    </ProductPage>
  );
}
