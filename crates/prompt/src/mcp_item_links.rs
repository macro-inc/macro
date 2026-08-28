//! Rules for linking to Macro items in the model's own *conversational
//! replies* sent over MCP.
//!
//! External MCP hosts (Claude Desktop, Cursor IDE, and similar) cannot render
//! [`crate::mentions`]'s `<m-document-mention>` tags, so those replies must
//! use plain Markdown URLs built from the app base URL. Macro agent sessions
//! are the exception: their replies stream back into the Macro app, which
//! *can* render mention tags, so they must use the same XML mentions as
//! in-app agents — even when the tools they called arrived over MCP.
//!
//! This is scoped to the model's chat replies only. It does not govern content
//! the model writes *into* a Macro document (e.g. via `CreateDocument` or
//! `EditDocument`) — see [`crate::document_content_links`] for that, which
//! still requires `<m-document-mention>` tags even over MCP, since that content
//! is rendered by the Macro app itself, not by the MCP client.
//!
//! The base URL is only known at runtime (from `APP_BASE_URL`), so this section
//! is rendered by [`render`] rather than declared as a `'static` prompt.

static TITLE: &str = "Linking to and listing Macro items";

/// Renders the MCP item-linking section, interpolating `base_url` (already
/// trimmed of any trailing slash) into the example URLs. The output matches the
/// `# {title}\n{body}` shape of the other prompt sections so it composes
/// cleanly with them.
pub fn render(base_url: &str) -> String {
    format!(
        "# {TITLE}\n\
         External MCP hosts (Claude Desktop, Cursor IDE, and similar) cannot \
         render Macro mention tags. In those hosts, when referring the user to a \
         Macro item (document, channel, chat, project, task, or email thread) in \
         your responses, write a plain URL of the form `{base_url}/app/<type>/<id>`, \
         where `<type>` is the item's type — `md` for a document, `channel`, \
         `chat`, `project`, `task`, or `email` for an email thread — and `<id>` \
         is the item id. Render it as a normal Markdown link, e.g. \
         `[Name]({base_url}/app/md/<id>)`. Do NOT emit `<m-document-mention>` XML \
         tags in those hosts — they appear as raw text.\n\
         \n\
         If you are a Macro agent session (your replies stream back into the \
         Macro app), ignore the URL rule above. Cite each item with an \
         `<m-document-mention>` tag so it renders as an @mention, e.g. \
         `<m-document-mention>{{\"documentId\":\"{{id}}\",\"documentName\":\"\",\"blockName\":\"md\",\"blockParams\":{{}}}}</m-document-mention>`. \
         People use `<m-user-mention>{{\"userId\":\"{{id}}\",\"email\":\"{{email}}\"}}</m-user-mention>`. \
         Never a bare URL or GFM `@name` in a Macro agent-session reply.\n\
         \n\
         This URL-vs-mention split applies to your own conversational replies \
         only. Content you write into a Macro document, e.g. via the \
         `CreateDocument` or `EditDocument` tools, is rendered by the Macro app \
         itself, so it must still use `<m-document-mention>` tags to link \
         correctly — see \"Linking Macro items inside document content\" below.\n\
         \n\
         When you list multiple Macro items in an external MCP host, present \
         them as a Markdown table with the columns `number`, `name`, and `link`, \
         where `link` is the `{base_url}/app/<type>/<id>` URL for each item. In a \
         Macro agent session, list them as mention tags instead.\n"
    )
}
