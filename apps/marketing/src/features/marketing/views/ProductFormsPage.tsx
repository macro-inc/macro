import CalendarIcon from '@icon/system/regular/calendar.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import DatabaseIcon from '@icon/system/regular/database.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import FormIcon from '@phosphor/clipboard-text.svg';
import { For } from 'solid-js';
import { setPageSeo } from '../../../app/utils/utilSeo';
import { FeatureDemoBackdrop } from '../components/FeatureDemoBackdrop';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import { HomepageConversation } from '../components/HomepageConversation';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import './forms-page.css';

const questions = ['Name', 'Company', 'Team size'];
const responses = [
  ['Dana', 'Northpeak', '40'],
  ['Priya', 'Fieldnote', '12'],
  ['Noah', 'Tidewater', '8'],
];

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
        >
          <div
            class="forms-story forms-story-responses"
            role="img"
            aria-label="A demo-request form with Name, Company, and Team size questions. Submitted answers appear as rows in its connected database."
          >
            <FeatureDemoBackdrop />
            <div class="forms-card forms-question-card">
              <div class="forms-card-label">
                <FormIcon /> Book a demo
              </div>
              <h3>Tell us about your team.</h3>
              <For each={questions}>
                {(question) => (
                  <div class="forms-question">
                    <span>{question}</span>
                    <div class="forms-answer">
                      {question === 'Team size'
                        ? '12'
                        : question === 'Name'
                          ? 'Priya'
                          : 'Fieldnote'}
                    </div>
                  </div>
                )}
              </For>
              <span class="forms-submit">Submit</span>
            </div>
            <div class="forms-card forms-response-card">
              <div class="forms-card-label">
                <DatabaseIcon /> Demo requests <span>3 responses</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Team size</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={responses}>
                    {(row) => (
                      <tr>
                        <For each={row}>{(cell) => <td>{cell}</td>}</For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        </FeaturePageSection>
        <FeaturePageSection
          id="forms-booking"
          title="Integrated with Macro Booking Links."
          description="Add a gate to qualify requests, then a booking link as the last step. People who pass the gate can choose a time after their response is saved."
        >
          <div
            class="forms-story forms-story-booking"
            role="img"
            aria-label="A form gate lets teams of at least five continue. After submitting, respondents can book a 30-minute product demo."
          >
            <FeatureDemoBackdrop />
            <div class="forms-card forms-gate-card">
              <div class="forms-card-label">
                <CheckIcon /> Continue when
              </div>
              <div class="forms-rule">
                <span>Team size</span>
                <span>is at least</span>
                <strong>5</strong>
              </div>
              <p>People who meet this condition continue to booking.</p>
            </div>
            <div class="forms-card forms-booking-card">
              <div class="forms-card-label">
                <LinkIcon /> Booking · Last step
              </div>
              <h3>Product demo</h3>
              <p>
                <CalendarIcon /> 30 minutes · Your local time
              </p>
              <div class="forms-times">
                <span>10:00 AM</span>
                <span>11:30 AM</span>
                <span>2:00 PM</span>
              </div>
              <span class="forms-submit">Choose a time</span>
            </div>
          </div>
        </FeaturePageSection>
        <FeaturePageSection
          id="forms-agents"
          title="Create forms with agents."
          description="Describe the questions, qualification rules, and booking link you need. Your agent can create the form and edit it as your needs change."
        >
          <div
            class="forms-story forms-story-agent"
            role="img"
            aria-label="Julia asks Macro to create a demo-request form with three questions, a minimum team size of five, and a product-demo booking link."
          >
            <FeatureDemoBackdrop />
            <div class="forms-conversation" inert aria-hidden="true">
              <HomepageConversation
                messages={[
                  {
                    person: 'julia',
                    text: (
                      <>
                        <span class="forms-mention">@Macro</span> make a
                        demo-request form. Ask for name, company, and team size.
                        Teams of 5 or more can book our product demo.
                      </>
                    ),
                  },
                ]}
              />
            </div>
            <div class="forms-card forms-agent-card">
              <div class="forms-card-label">
                <FormIcon /> Book a demo <span>Draft</span>
              </div>
              <For each={questions}>
                {(question) => (
                  <div class="forms-draft-row">
                    <CheckIcon />
                    {question}
                  </div>
                )}
              </For>
              <div class="forms-draft-row">
                <CheckIcon />
                Team size is at least 5
              </div>
              <div class="forms-draft-row">
                <LinkIcon />
                Product demo · 30 min
              </div>
              <p>Ready to review and share.</p>
            </div>
          </div>
        </FeaturePageSection>
        <FeaturePageSection
          id="forms-sharing"
          title="Share a form with your own branding."
          description="Add your logo and accent color. Share with specific people or a channel, or let anyone with the link respond without signing in."
        >
          <div
            class="forms-story forms-story-sharing"
            role="img"
            aria-label="Form settings show a custom logo, a coral accent color, and two audience options: invited people or anyone with the link."
          >
            <FeatureDemoBackdrop />
            <div class="forms-card forms-settings-card">
              <div class="forms-card-label">
                <FormIcon /> Form settings
              </div>
              <h3>Make it yours.</h3>
              <div class="forms-branding">
                <span class="forms-example-logo">N</span>
                <div>
                  Northpeak<small>Logo</small>
                </div>
                <span class="forms-color-chip" /> <span>#E98276</span>
              </div>
              <div class="forms-audience">
                <span>Who can respond</span>
                <span>Invited people</span>
                <span class="forms-selected">
                  <CheckIcon /> Anyone with the link
                </span>
              </div>
            </div>
          </div>
        </FeaturePageSection>
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
