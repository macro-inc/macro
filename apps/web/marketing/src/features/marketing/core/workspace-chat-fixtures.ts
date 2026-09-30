import type { DummyData, WorkspaceComment } from './dummy-workspace';
import type { HomepagePersonId } from './homepage-demo-people';

// Fictional conversations inspired by the team's cadence and product topics.
// Links resolve only to sample entities; no private messages or URLs are copied.
function message(
  id: string,
  person: HomepagePersonId,
  time: string,
  body: string,
  extra: Partial<
    Pick<
      WorkspaceComment,
      'replyTo' | 'reactions' | 'documentId' | 'taskId' | 'emailId'
    >
  > = {}
): WorkspaceComment {
  return { id, person, time, body, ...extra };
}

export function sampleWorkspaceChannels(): DummyData['channels'] {
  return [
    {
      id: 'dm-julia',
      person: 'julia',
      messages: [
        message('julia-coffee', 'julia', '8:12 AM', 'coffee then screenshots?'),
        message('julia-coffee-reply', 'jacob', '8:13 AM', 'yes. give me 10'),
        message(
          'julia-story',
          'julia',
          '8:31 AM',
          'I tried a few versions of the launch copy. The one inbox line is still the clearest.'
        ),
        message(
          'julia-story-reply',
          'jacob',
          '8:33 AM',
          'agree. emails, agents, tasks, messages. just say what it does'
        ),
        message(
          'julia-cut',
          'jacob',
          '8:34 AM',
          'can we cut the paragraph about unlocking productivity lol'
        ),
        message('julia-cut-reply', 'julia', '8:35 AM', 'already gone 😂', {
          reactions: ['jacob'],
        }),
        message(
          'julia-demo',
          'julia',
          '9:06 AM',
          'The recording is ready too. I start in the inbox, open the customer email, then ask Macro to draft the follow-up.'
        ),
        message(
          'julia-demo-reply',
          'jacob',
          '9:08 AM',
          'nice. show the actual edit happening in the doc too'
        ),
        message(
          'julia-take',
          'julia',
          '9:10 AM',
          'That’s in the second take. First take had my calendar notification right in the middle of it'
        ),
        message(
          'julia-take-reply',
          'jacob',
          '9:11 AM',
          'authentic demo experience'
        ),
        message('julia-take-laugh', 'julia', '9:11 AM', 'painfully authentic', {
          reactions: ['jacob'],
        }),
        message(
          'julia-assets',
          'julia',
          '9:47 AM',
          'Final assets are here. The customer example uses Meadow rather than one of the internal threads.',
          { emailId: 'assets' }
        ),
        message(
          'dm1',
          'julia',
          '10:43 AM',
          'copy is ready. can you take one last look at the plan?',
          { documentId: 'plan' }
        ),
        message(
          'dm2',
          'jacob',
          '10:45 AM',
          'looks good. sharing with the team now'
        ),
        message(
          'julia-mobile',
          'jacob',
          '11:02 AM',
          'mobile crop is a little tight. could we give the heading more room?'
        ),
        message(
          'julia-mobile-reply',
          'julia',
          '11:07 AM',
          'Yep. Exporting both sizes again. Keeping the type the same.'
        ),
        message(
          'julia-lunch',
          'julia',
          '11:24 AM',
          'lunch after the check-in?'
        ),
        message(
          'julia-lunch-reply',
          'jacob',
          '11:25 AM',
          'yes pls. i have been staring at this sidebar for too long'
        ),
      ],
    },
    {
      id: 'dm-teo',
      person: 'teo',
      messages: [
        message(
          'teo-morning',
          'jacob',
          '8:18 AM',
          'how’s the invite fix looking?'
        ),
        message(
          'teo-case',
          'teo',
          '8:21 AM',
          'New account works. Existing account was losing the selected team after sign-in.'
        ),
        message(
          'teo-case-reply',
          'jacob',
          '8:23 AM',
          'that’s the one Dana hit right?'
        ),
        message('teo-confirm', 'teo', '8:24 AM', 'Yep. I’ve got a repro now.'),
        message(
          'teo-test',
          'teo',
          '8:46 AM',
          'Added coverage for both paths. Also checked opening the invite in a second tab.'
        ),
        message('teo-test-reply', 'jacob', '8:48 AM', 'nice. thank you'),
        message('dm3', 'teo', '9:18 AM', 'invite flow is ready for review', {
          taskId: 'invite',
          reactions: ['jacob'],
        }),
        message(
          'teo-review',
          'jacob',
          '9:31 AM',
          'tried it with an existing account. landed in the right team'
        ),
        message(
          'teo-review-reply',
          'teo',
          '9:32 AM',
          'Great. I’ll include it in today’s deploy.'
        ),
        message(
          'teo-agent',
          'jacob',
          '9:46 AM',
          'also tried the agent edits on the launch doc. pretty wild seeing it type in the same document'
        ),
        message(
          'teo-agent-reply',
          'teo',
          '9:49 AM',
          'Try editing while it’s running. The CRDT merge is the interesting part.'
        ),
        message(
          'teo-merge',
          'jacob',
          '9:54 AM',
          'yep. changed a heading while it was fixing the bullets. both stayed'
        ),
        message(
          'teo-merge-reply',
          'teo',
          '9:55 AM',
          'That’s the test I wanted. Much better than replacing the whole document.'
        ),
        message(
          'teo-mobile',
          'jacob',
          '10:17 AM',
          'going to dogfood the mobile build on my walk'
        ),
        message(
          'teo-mobile-reply',
          'teo',
          '10:18 AM',
          'Please put bugs in the task, not twelve separate DMs 😂',
          { taskId: 'design' }
        ),
        message('teo-mobile-promise', 'jacob', '10:19 AM', 'no promises', {
          reactions: ['teo'],
        }),
        message(
          'teo-deploy',
          'teo',
          '11:12 AM',
          'Deploy is through. Invite and retry fixes are both in.'
        ),
        message(
          'teo-deploy-reply',
          'jacob',
          '11:14 AM',
          'great. i’ll tell Julia she can record the final take'
        ),
      ],
    },
    {
      id: 'launch',
      messages: [
        message(
          'launch-morning',
          'julia',
          '8:15 AM',
          'morning! final launch pass today. Copy, recording, customer email.'
        ),
        message(
          'launch-story',
          'jacob',
          '8:18 AM',
          'lead with one inbox. people get that immediately'
        ),
        message(
          'launch-story-reply',
          'julia',
          '8:20 AM',
          'Agreed. The agent editing clip comes right after.',
          { replyTo: 'launch-story' }
        ),
        message(
          'launch-story-confirm',
          'teo',
          '8:22 AM',
          'And show the edits in the actual doc, not just the agent saying it finished.',
          { replyTo: 'launch-story', reactions: ['jacob', 'julia'] }
        ),
        message(
          'launch-record',
          'julia',
          '8:49 AM',
          'New recording is up. Shortened the intro and kept the cursor visible this time.',
          { taskId: 'demo' }
        ),
        message(
          'launch-record-reply',
          'jacob',
          '8:52 AM',
          'much better. the first 20 seconds were mostly me waiting for you to click lol',
          { replyTo: 'launch-record' }
        ),
        message(
          'launch-record-laugh',
          'julia',
          '8:53 AM',
          'cinematic suspense',
          { replyTo: 'launch-record', reactions: ['jacob', 'teo'] }
        ),
        message(
          'launch-assets',
          'valentina',
          '9:05 AM',
          'Desktop and mobile exports are ready. I checked the dark backgrounds in both.',
          { documentId: 'design-review' }
        ),
        message(
          'm1',
          'julia',
          '9:32 AM',
          'announcement is ready. one last pass before Thursday?',
          { taskId: 'announcement' }
        ),
        message(
          'm1-reply',
          'jacob',
          '9:34 AM',
          'added the customer example. kept it short',
          { replyTo: 'm1', documentId: 'rollout', reactions: ['julia'] }
        ),
        message(
          'm1-followup',
          'teo',
          '9:35 AM',
          'Reviewed. The checklist is good. Just waiting on the final deploy.',
          { replyTo: 'm1' }
        ),
        message(
          'm2',
          'teo',
          '9:36 AM',
          'Deploy checks look good. Cursor is wrapping up the retry fix.',
          { taskId: 'deploy' }
        ),
        message(
          'm3',
          'jacob',
          '9:41 AM',
          'Dana confirmed Thursday. Sharing the rollout plan here.',
          { documentId: 'rollout' }
        ),
        message(
          'launch-email',
          'julia',
          '10:08 AM',
          'Customer email draft is ready too. Can someone check the meeting time before I schedule it?',
          { emailId: 'dana' }
        ),
        message(
          'launch-email-reply',
          'jacob',
          '10:10 AM',
          '9am Thursday. her team is on the west coast',
          { replyTo: 'launch-email' }
        ),
        message(
          'launch-timezone',
          'julia',
          '10:11 AM',
          'thank you. almost did that again',
          { replyTo: 'launch-email', reactions: ['jacob'] }
        ),
        message(
          'launch-checklist',
          'teo',
          '10:34 AM',
          'Last technical checks: existing-account invite, email reply, document sync after going offline.',
          { taskId: 'checklist' }
        ),
        message(
          'launch-done',
          'gabriel',
          '10:47 AM',
          'Checked all three. Offline edits came back correctly on reconnect.'
        ),
        message(
          'launch-ready',
          'jacob',
          '11:02 AM',
          'ok this is looking really good'
        ),
        message(
          'launch-notes',
          'teo',
          '11:15 AM',
          'I’ll publish the changelog once the deploy is through.',
          { taskId: 'changelog' }
        ),
        message(
          'launch-lunch',
          'julia',
          '11:28 AM',
          'then we all go outside for five minutes',
          { reactions: ['jacob', 'teo', 'gabriel'] }
        ),
      ],
    },
    {
      id: 'product',
      messages: [
        message(
          'product-inbox',
          'jacob',
          '8:03 AM',
          'one thing from the customer calls: they like seeing emails and agent updates in the same inbox. let’s make that obvious'
        ),
        message(
          'product-inbox-reply',
          'julia',
          '8:08 AM',
          'Yep. They keep asking if they need to open a separate chat to follow up. Showing it inline helps.',
          { replyTo: 'product-inbox' }
        ),
        message(
          'product-references',
          'teo',
          '8:21 AM',
          'References are now bidirectional for the new agent sessions too. Same behavior as docs.'
        ),
        message(
          'product-references-reply',
          'jacob',
          '8:23 AM',
          'nice. can we show that in the demo?',
          { replyTo: 'product-references' }
        ),
        message(
          'product-reference-example',
          'valentina',
          '8:27 AM',
          'I can use the rollout doc linked from the task. Click back to the discussion from References.',
          { replyTo: 'product-references', documentId: 'rollout' }
        ),
        message(
          'm4',
          'valentina',
          '8:50 AM',
          'Mobile navigation changes are ready. Bigger touch targets, same icons.',
          { taskId: 'design' }
        ),
        message(
          'product-mobile-reply',
          'jacob',
          '8:53 AM',
          'looks cleaner. can you keep the sidebar open when i select a task from Home?',
          { replyTo: 'm4' }
        ),
        message(
          'product-mobile-fixed',
          'valentina',
          '9:01 AM',
          'Yep. Home stays Home; the detail opens beside it.',
          { replyTo: 'm4', reactions: ['jacob'] }
        ),
        message(
          'product-tags',
          'julia',
          '9:15 AM',
          'Do we want the tags visible in the inbox by default? Customers with several accounts seem to use them a lot.'
        ),
        message(
          'product-tags-reply',
          'teo',
          '9:19 AM',
          'Yes, but keep the pills small. Subject should still get most of the row.',
          { replyTo: 'product-tags' }
        ),
        message(
          'product-search',
          'gabriel',
          '9:38 AM',
          'Search results now include the message that matched, not just the channel name. Makes the old conversations much easier to find.'
        ),
        message(
          'product-search-reply',
          'jacob',
          '9:41 AM',
          'this is good. i can never remember which channel something was in',
          { reactions: ['teo', 'julia'] }
        ),
        message(
          'product-offline',
          'teo',
          '10:04 AM',
          'Tested the doc on a train connection. Edits save locally, then sync when the connection comes back.'
        ),
        message(
          'product-offline-joke',
          'jacob',
          '10:05 AM',
          'the train is our most thorough QA engineer',
          { reactions: ['teo', 'valentina'] }
        ),
        message(
          'product-pricing',
          'julia',
          '10:31 AM',
          'Pricing questions from the calls are in this task. Mostly seats and what happens when you connect a second inbox.',
          { taskId: 'pricing' }
        ),
        message(
          'product-next',
          'jacob',
          '11:03 AM',
          'let’s finish the invite and reply flows before adding more stuff'
        ),
        message(
          'product-next-reply',
          'teo',
          '11:06 AM',
          'Agreed. Both are on today’s checklist.'
        ),
      ],
    },
    {
      id: 'customers',
      messages: [
        message(
          'm5',
          'julia',
          '8:09 AM',
          'Meadow is starting the team rollout this week. Dana wants to begin with email and customer follow-ups.',
          { documentId: 'rollout' }
        ),
        message(
          'customers-rollout-reply',
          'jacob',
          '8:14 AM',
          'good. let’s help them connect the second inbox on the call',
          { replyTo: 'm5' }
        ),
        message(
          'customers-rollout-notes',
          'julia',
          '8:16 AM',
          'Added that to the notes. They have a few people sharing customer threads already.',
          { replyTo: 'm5', documentId: 'notes' }
        ),
        message(
          'customers-feedback',
          'julia',
          '8:32 AM',
          'Pilot feedback just came in. They’re using the shared email links in their customer channel instead of forwarding each reply.',
          { emailId: 'feedback' }
        ),
        message(
          'customers-feedback-reply',
          'jacob',
          '8:35 AM',
          'that’s exactly the workflow. new replies just appear in the same thread',
          { replyTo: 'customers-feedback', reactions: ['julia'] }
        ),
        message(
          'customers-invite',
          'teo',
          '9:02 AM',
          'Dana’s invite issue is fixed. Existing members land in the selected team after signing in.',
          { taskId: 'invite' }
        ),
        message(
          'customers-invite-reply',
          'julia',
          '9:05 AM',
          'Thanks. I’ll check it with her before we invite the rest.',
          { replyTo: 'customers-invite' }
        ),
        message(
          'customers-agenda',
          'jacob',
          '9:18 AM',
          'Thursday agenda: connect inbox, invite team, share one email, make one task. should take 15 minutes'
        ),
        message(
          'customers-agenda-reply',
          'julia',
          '9:20 AM',
          'And show how to get back to the email from the task. That was their question last time.'
        ),
        message(
          'customers-summary',
          'julia',
          '9:54 AM',
          'Macro pulled out the open questions from the last call. Seats, shared email access, and importing their existing docs.',
          { documentId: 'notes' }
        ),
        message(
          'customers-summary-reply',
          'jacob',
          '9:57 AM',
          'can it draft the follow-up from those? i’ll review before sending'
        ),
        message(
          'customers-draft',
          'julia',
          '10:04 AM',
          'Yes. Draft is in the thread, with the rollout plan linked.',
          { emailId: 'dana' }
        ),
        message(
          'customers-research',
          'valentina',
          '10:26 AM',
          'Interview notes are here too. A few teams asked for clearer labels on the inbox filters.',
          { emailId: 'research' }
        ),
        message(
          'customers-research-reply',
          'jacob',
          '10:29 AM',
          'let’s use words people already know. important / other is clearer than inventing terminology',
          { replyTo: 'customers-research' }
        ),
        message(
          'customers-followup',
          'julia',
          '10:48 AM',
          'Dana confirmed the time. I’m sending the setup steps ahead of the call.',
          { taskId: 'follow-up' }
        ),
        message('customers-response', 'jacob', '10:50 AM', 'great. thanks'),
        message(
          'customers-small-win',
          'julia',
          '11:19 AM',
          'Small win: they found the rollout plan themselves through the email reference this morning.',
          { reactions: ['jacob', 'teo'] }
        ),
      ],
    },
    {
      id: 'engineers',
      messages: [
        message(
          'eng-mobile',
          'jacob',
          '8:02 AM',
          'hello from the mobile build. going to use this all day and see what breaks'
        ),
        message(
          'eng-mobile-reply',
          'teo',
          '8:04 AM',
          'Please also test going offline. The happy path is the easy bit.',
          { replyTo: 'eng-mobile' }
        ),
        message(
          'eng-mobile-train',
          'gabriel',
          '8:07 AM',
          'The subway will take care of that',
          { replyTo: 'eng-mobile', reactions: ['jacob', 'teo'] }
        ),
        message(
          'eng-cache',
          'gabriel',
          '8:29 AM',
          'Cache change is in. Opening a recent doc doesn’t wait on the network anymore. I checked reload and switching accounts.'
        ),
        message(
          'eng-cache-reply',
          'jacob',
          '8:31 AM',
          'feels way better. the load time was the thing i noticed first'
        ),
        message(
          'eng-sync',
          'teo',
          '8:52 AM',
          'Offline sync check: edited a heading locally while the agent updated the bullets on another client. Both changes survived reconnect.',
          { documentId: 'engineering-plan' }
        ),
        message(
          'eng-sync-reply',
          'gabriel',
          '8:56 AM',
          'Also tried the same paragraph from two tabs. Merge looks correct.',
          { replyTo: 'eng-sync', reactions: ['teo'] }
        ),
        message(
          'eng-retry',
          'cursor',
          '9:08 AM',
          'Retry fix is ready for review. Added checks for transient failures and the retry limit.',
          { taskId: 'deploy' }
        ),
        message(
          'eng-retry-review',
          'teo',
          '9:12 AM',
          'Looking now. Does a canceled run still stop the retry timer?',
          { replyTo: 'eng-retry' }
        ),
        message(
          'eng-retry-answer',
          'cursor',
          '9:14 AM',
          'Yes. Cancellation clears the pending retry. There’s a regression check for that path.',
          { replyTo: 'eng-retry' }
        ),
        message(
          'eng-invite',
          'teo',
          '9:27 AM',
          'Invite handoff fix is also ready. Tested a new account and an existing member.',
          { taskId: 'invite' }
        ),
        message(
          'eng-invite-reply',
          'jacob',
          '9:31 AM',
          'just tried the existing member case. good now',
          { reactions: ['teo'] }
        ),
        message(
          'eng-release',
          'gabriel',
          '10:12 AM',
          'Can we ship the retry fix with this release?',
          { taskId: 'deploy' }
        ),
        message(
          'eng-reply',
          'teo',
          '10:19 AM',
          'Yep. Transient failure, cancellation, and retry-limit checks passed. PR is ready for a final look.',
          { replyTo: 'eng-release' }
        ),
        message(
          'eng-release-review',
          'jacob',
          '10:20 AM',
          'reviewed. ship it',
          { replyTo: 'eng-release', reactions: ['teo', 'gabriel'] }
        ),
        message(
          'eng-plan',
          'jacob',
          '10:21 AM',
          'updated priorities for this week. invite + sync + email replies first',
          { documentId: 'engineering-plan' }
        ),
        message(
          'eng-doc-link',
          'gabriel',
          '10:36 AM',
          'Can someone check the reference panel on an agent session? Should behave exactly like the markdown doc.'
        ),
        message(
          'eng-doc-link-reply',
          'teo',
          '10:41 AM',
          'Checked. The task links back to the conversation and the doc.',
          { replyTo: 'eng-doc-link' }
        ),
        message('eng-deploy', 'teo', '11:03 AM', 'deploy time'),
        message(
          'eng-deploy-done',
          'teo',
          '11:12 AM',
          'Through. If you find something, please drop the repro in the task.',
          { taskId: 'release' }
        ),
        message(
          'eng-dogfood',
          'jacob',
          '11:17 AM',
          'still dogfooding mobile. typing this while walking is the real test',
          { reactions: ['gabriel'] }
        ),
      ],
    },
    {
      id: 'agents-team',
      messages: [
        message(
          'agents-morning',
          'teo',
          '8:06 AM',
          'Testing live edits in docs today. Especially typing while the agent is still editing.'
        ),
        message(
          'agents-morning-reply',
          'jacob',
          '8:09 AM',
          'nice. that’s the part that makes it feel different',
          { replyTo: 'agents-morning' }
        ),
        message(
          'agents-heading',
          'gabriel',
          '8:24 AM',
          'Tried it on the release notes. I changed the title while it rewrote the checklist. Both edits came through.'
        ),
        message(
          'agents-heading-reply',
          'teo',
          '8:26 AM',
          'Good. Can you try disconnecting halfway through as well?',
          { replyTo: 'agents-heading' }
        ),
        message(
          'agents-offline',
          'gabriel',
          '8:37 AM',
          'Yep, worked after reconnect. The local heading stayed and the agent’s bullets merged in.',
          { replyTo: 'agents-heading', reactions: ['jacob', 'teo'] }
        ),
        message(
          'agents-ui',
          'jacob',
          '8:51 AM',
          'the tool activity is still too tall for what it shows. can we make it shorter and just say what it’s doing'
        ),
        message(
          'agents-ui-reply',
          'valentina',
          '8:54 AM',
          'Trying a compact version. One line while running, expandable details underneath.',
          { replyTo: 'agents-ui' }
        ),
        message(
          'agents-ui-confirm',
          'teo',
          '8:56 AM',
          'Prefer that. The channel shouldn’t jump every time a tool finishes.',
          { replyTo: 'agents-ui', reactions: ['jacob'] }
        ),
        message(
          'agents-search',
          'julia',
          '9:12 AM',
          'Asked Macro to find the last Meadow call and draft the follow-up. It found the email too, which is handy.'
        ),
        message(
          'agents-search-reply',
          'jacob',
          '9:14 AM',
          'can you link the rollout plan in the draft?'
        ),
        message(
          'agents-search-result',
          'julia',
          '9:18 AM',
          'Done. It put the meeting questions into the draft and left it for review.',
          { emailId: 'dana' }
        ),
        message(
          'agents-1',
          'jacob',
          '9:54 AM',
          'customer summary is ready. emails, last call, open tasks. actually useful',
          { documentId: 'notes' }
        ),
        message(
          'agents-2',
          'julia',
          '10:02 AM',
          'Using this for Thursday. Saved me digging through the whole thread.',
          { replyTo: 'agents-1' }
        ),
        message(
          'agents-summary-question',
          'teo',
          '10:04 AM',
          'Does it link back to the source email?',
          { replyTo: 'agents-1' }
        ),
        message(
          'agents-summary-answer',
          'jacob',
          '10:05 AM',
          'yes. email and call notes are both linked',
          { replyTo: 'agents-1', reactions: ['teo'] }
        ),
        message(
          'agents-3',
          'teo',
          '10:07 AM',
          'Claude reviewed the invite flow too. Existing-member case looks good.',
          { taskId: 'invite' }
        ),
        message(
          'agents-cursor',
          'jacob',
          '10:21 AM',
          '@Cursor take the retry fix through review and update the task when the PR is ready',
          { taskId: 'deploy' }
        ),
        message(
          'agents-cursor-reply',
          'cursor',
          '10:24 AM',
          'PR is ready. The task has the review link and the checks that passed.',
          { replyTo: 'agents-cursor', taskId: 'release' }
        ),
        message(
          'agents-references',
          'gabriel',
          '10:43 AM',
          'References now show where the agent session is mentioned. Same panel as markdown docs.'
        ),
        message(
          'agents-references-reply',
          'jacob',
          '10:45 AM',
          'this is really nice. i keep losing the conversation after the task is done',
          { reactions: ['teo', 'gabriel'] }
        ),
        message(
          'agents-tools',
          'teo',
          '11:02 AM',
          'Next checks: task creation from a thread, editing the brief, and reviewing an email draft before sending.'
        ),
        message(
          'agents-lunch',
          'julia',
          '11:23 AM',
          'can the next tool be getting us lunch'
        ),
        message(
          'agents-lunch-reply',
          'jacob',
          '11:24 AM',
          'finally a useful benchmark',
          { reactions: ['julia', 'teo'] }
        ),
      ],
    },
    {
      id: 'design',
      messages: [
        message(
          'design-morning',
          'valentina',
          '8:08 AM',
          'Trying a few versions of the demo background. Cooler colors, less glow.'
        ),
        message(
          'design-morning-reply',
          'jacob',
          '8:12 AM',
          'yes. keep it subtle. the app should be the thing you look at',
          { replyTo: 'design-morning' }
        ),
        message(
          'design-noise',
          'valentina',
          '8:24 AM',
          'Added a little grain. It helps the gradient feel less flat without drawing an outline around the whole frame.'
        ),
        message(
          'design-noise-reply',
          'julia',
          '8:27 AM',
          'The teal version looks good with the email screenshot.'
        ),
        message(
          'design-review',
          'julia',
          '8:44 AM',
          'Launch assets are in the notes. Can someone check the mobile crops?',
          { documentId: 'design-review' }
        ),
        message(
          'design-reply',
          'valentina',
          '9:05 AM',
          'Checked both sizes. Updated the final screenshots and gave the sidebar more room.',
          { replyTo: 'design-review', reactions: ['julia'] }
        ),
        message(
          'design-review-second',
          'jacob',
          '9:08 AM',
          'much better. the old one felt squeezed',
          { replyTo: 'design-review' }
        ),
        message(
          'design-tabs',
          'valentina',
          '9:19 AM',
          'Matched the tab heights to the app. The sidebar tabs and conversation tabs are different components.'
        ),
        message(
          'design-tabs-reply',
          'jacob',
          '9:22 AM',
          'that was driving me crazy. thank you',
          { reactions: ['valentina'] }
        ),
        message(
          'design-labels',
          'julia',
          '9:38 AM',
          'Do we need labels for every icon outside the demo? Looks a bit busy now.'
        ),
        message(
          'design-labels-reply',
          'jacob',
          '9:40 AM',
          'agree. let’s simplify. people can just use it',
          { replyTo: 'design-labels' }
        ),
        message(
          'design-labels-result',
          'valentina',
          '9:51 AM',
          'Removed the connectors. Tooltips stay on the sidebar icons.',
          { replyTo: 'design-labels', reactions: ['jacob', 'julia'] }
        ),
        message(
          'design-type',
          'jacob',
          '10:12 AM',
          'the heading looks good but the gray copy is a bit loud. can we fade it slightly?'
        ),
        message(
          'design-type-reply',
          'valentina',
          '10:18 AM',
          'Done. Same gray as the previous section. Keeping the heading bright.'
        ),
        message(
          'design-mobile',
          'valentina',
          '10:36 AM',
          'Mobile stays on the smaller sidebar diagram. The full demo is too cramped at that width.',
          { taskId: 'design' }
        ),
        message(
          'design-mobile-reply',
          'julia',
          '10:41 AM',
          'Good call. That also keeps the email section closer to the top.'
        ),
        message(
          'design-finish',
          'jacob',
          '11:02 AM',
          'this feels really nice now. let’s stop touching the gradient before we make it worse lol',
          { reactions: ['julia', 'valentina'] }
        ),
        message(
          'design-finish-reply',
          'valentina',
          '11:04 AM',
          'closing the color picker as we speak'
        ),
      ],
    },
  ];
}
