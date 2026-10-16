//! What an external agent needs to know to use Macro over MCP, kept short.
//!
//! MCP clients truncate server instructions (Claude Code keeps the first
//! 4,096 characters) and weigh the start most, so this replaces the in-app
//! "About Macro" section and the PDF citation rules with the few lines an
//! outside agent acts on. `[[...]]` citation ids render as raw text in MCP
//! clients, so sources are cited as item links instead.

use crate::pull_requests::READY_PULL_REQUEST;

static TITLE: &str = "Using Macro";

/// The "Using Macro" section of the MCP server instructions.
pub fn render() -> String {
    format!(
        "# {TITLE}\n\
         Macro is the person's work hub: email, docs, tasks, channels (team messaging), \
         calls and CRM in one linked workspace.\n\
         - Find: ContentSearch (by content), NameSearch (by name), ListEntities (recent items).\n\
         - Read: ReadContent and ReadMetadata; channel messages with ReadChannelMessages, \
         ReadChannelThread and ReadChannelMessageContext. Image and video attachments come with \
         download URLs; use a video-capable tool for video.\n\
         - Write: CreateDocument and EditDocument.\n\
         - Skills: ListSkills or SearchSkills, then ReadSkill before following one.\n\
         - Questions about Macro itself: call SelfKnowledge rather than answering from memory.\n\
         - Cite what you read with links to the Macro item, never `[[...]]` ids.\n\
         Terms: a channel is team messaging; a chat is a past AI conversation; \"inbox\" is the \
         unified inbox (ListEntities) unless the person says email.\n\
         {READY_PULL_REQUEST}\n"
    )
}
