import { setPageSeo } from '../../../app/utils/utilSeo';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { FeaturePhoneScreens } from '../components/FeatureScreenshot';
import { HomepageClosing } from '../components/HomepageClosing';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import { featureScreens, phoneScreens } from '../core/feature-screens';

export default function ProductFormsPage() {
  setPageSeo({
    title: 'Macro Forms | Forms connected to your work',
    description:
      'Collect form responses in Macro Databases, qualify requests, and let people book a call. Create and edit forms with agents.',
    path: '/forms',
  });
  return (
    <ProductPage>
      <div class="forms-page">
        <ProductHero
          product="Forms"
          title="Forms connected to your work."
          description="Every response lands in a database. Collect answers, qualify requests, and let people book a call."
          tutorial="forms"
          cta="forms_hero_get_started"
        />
        <FeaturePageSection
          id="forms-databases"
          title="Forms populate Macro Databases."
          description="Each question is a column, and every response is a row. Responses appear as they come in. Open the database to sort, filter, and work with the answers."
          screen={featureScreens['forms-databases']}
        />
        <FeaturePageSection
          id="forms-booking"
          title="Integrated with Macro Booking Links."
          description="Add a gate to qualify requests, then a booking link as the last step. People who pass the gate can choose a time after their response is saved."
          screen={featureScreens['forms-booking']}
        />
        <FeaturePageSection
          id="forms-agents"
          title="Create forms with Macro Agents."
          description="Describe the questions, qualification rules, and booking link you need. Your agent can create the form and edit it as your needs change."
          screen={featureScreens['forms-agents']}
        />
        <FeaturePageSection
          id="forms-sharing"
          title="Share a form with your own branding."
          description="Add your logo and accent color. Share with specific people or a channel in Macro Chat, or let anyone with the link respond without signing in."
          screen={featureScreens['forms-sharing']}
        />
        <FeaturePhoneScreens screens={phoneScreens['forms']} product="Forms" />
        <FeaturePageFaq
          id="forms-questions"
          title="Questions about forms"
          items={[
            {
              q: 'Where do form responses go?',
              a: 'Every form is backed by a database. Each submitted response becomes a row. Use the Responses tab to view and sort answers, or open the database for filters and other views.',
            },
            {
              q: 'Can I create a form from an existing table?',
              a: 'Yes. On a database you own, choose New form from the table menu. Macro creates questions from its columns.',
            },
            {
              q: 'What happens when someone does not pass a gate?',
              a: 'They see your gate message and cannot continue. Their response is not saved. A gate’s rule describes who can continue.',
            },
            {
              q: 'Do respondents need a Macro account?',
              a: 'Choose Anyone with the link to allow responses without signing in. Invited people sign in to respond.',
            },
            {
              q: 'Can I run a quick poll in a channel?',
              a: 'Yes. Type /poll, add a question and its options, and post it to the channel. Everyone in the channel can vote.',
            },
          ]}
        />
        <HomepageClosing />
      </div>
    </ProductPage>
  );
}
