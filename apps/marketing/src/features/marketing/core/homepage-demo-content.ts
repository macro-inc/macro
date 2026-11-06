import { dummyData } from './dummy-workspace';

/** Curated sample conversation about the website work, not copied private messages. */
export function homepageChatData() {
  const data = dummyData();
  const launch = data.channels.find((channel) => channel.id === 'launch');
  if (launch)
    launch.messages = [
      {
        id: 'website-review',
        person: 'jacob',
        time: '9:34 AM',
        body: 'Can we collect the website feedback here before we make another pass?',
      },
      {
        id: 'website-design',
        person: 'valentina',
        time: '9:36 AM',
        body: 'The layout is close. The demo should use the same screens people see in the app.',
      },
      {
        id: 'website-crm',
        person: 'teo',
        time: '9:38 AM',
        body: 'CRM has pipelines now. I’ll check the demo against the new view.',
      },
      {
        id: 'website-copy',
        person: 'julia',
        time: '9:40 AM',
        body: 'I’ll keep the captions short. Each one should explain what you can do with that screen.',
      },
      {
        id: 'website-plan',
        person: 'jacob',
        time: '9:42 AM',
        body: 'Thanks. I put the remaining checks in the launch plan.',
        documentId: 'plan',
      },
      {
        id: 'website-check',
        person: 'valentina',
        time: '9:44 AM',
        body: 'I’ll review the light version and the phone layout after this pass.',
        replyTo: 'website-plan',
      },
      {
        id: 'website-ready',
        person: 'teo',
        time: '9:46 AM',
        body: 'Sounds good. Let’s use the actual task list too, not a separate mockup.',
      },
    ];
  return data;
}
