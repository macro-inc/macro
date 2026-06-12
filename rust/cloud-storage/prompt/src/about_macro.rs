//! Macro-specific terminology and product context.

use crate::types::StaticPrompt;

static TITLE: &str = "Terms";

static INSTRUCTIONS: &str = r##"- Channel - a slack-like messaging channel
- Chat - An AI conversation
- Email - Email messages
- Inbox - the "unified inbox", the user's workspace of recent items accessible via the ListEntities tool

Be careful not to mix up chat and channels. Chat refers to AI chat's so it should only be used
if a user is searching for seomething in a past AI conversation.

Channels are the standard form of communication and should be prefered. If a user refers to "A message"
assume they mean a channel message.

Additional info about how macro works can be found at docs.macro.com

Email is email.

When a user refers to their "inbox", they mean the unified inbox accessible via the ListEntities
tool — not their email inbox. Only treat "inbox" as the email inbox when the user explicitly says
"email" (e.g. "email inbox").
"##;

static INTENT: &str = "The model uses Macro terminology correctly: channels for messaging, \
chats only for past AI conversations, and \"inbox\" as the unified inbox unless the user \
explicitly says email.";

/// about macro promp
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);
