import { createChannelHeroProject } from '../../features/marketing/components/channels/channelProject';
import { EmailThread } from '../../features/marketing/components/email/frozen/EmailThread';
import HomepageEmailCompose from '../../features/marketing/components/HomepageEmailCompose';
import { ProductDemo } from '../../features/marketing/components/product/ProductPage';
import { ProductWorkspace } from '../../features/marketing/components/product/ProductWorkspace';
import {
  meetingDraft,
  meetingEmail,
} from '../../features/marketing/core/email-demo-story';
import '../../features/marketing/components/email/email-feature-demos.css';

export function PostChatSplits() {
  const engineering = createChannelHeroProject();
  const website = createChannelHeroProject();
  engineering.setChannel('engineering');
  website.setChannel('website');
  engineering.open('messages');
  website.open('messages');
  return (
    <div class="post-chat-splits">
      <ProductDemo label="Engineering channel" height={440} mobileHeight={390}>
        <ProductWorkspace workspace={engineering} />
      </ProductDemo>
      <ProductDemo label="Website channel" height={440} mobileHeight={390}>
        <ProductWorkspace workspace={website} />
      </ProductDemo>
    </div>
  );
}

export function PostEmailSplits() {
  return (
    <div class="post-email-splits">
      <div class="post-email-surface glass">
        <EmailThread email={meetingEmail} hideReply />
      </div>
      <div class="post-email-draft glass">
        <HomepageEmailCompose draft={meetingDraft} animate={false} appChrome />
      </div>
    </div>
  );
}

export function PostEmailThread() {
  return (
    <div class="post-email-surface glass">
      <EmailThread
        email={meetingEmail}
        replyContent={
          <HomepageEmailCompose
            draft={meetingDraft}
            animate={false}
            appChrome
          />
        }
      />
    </div>
  );
}
