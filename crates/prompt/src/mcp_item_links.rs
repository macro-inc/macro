//! Rules for linking to Macro items in responses sent to external MCP clients.
//!
//! Unlike the in-app [`crate::mentions`] section — which tells the model to emit
//! `<m-document-mention>` XML tags that only render inside the Macro app — MCP
//! responses are rendered by third-party clients that cannot resolve that
//! markup. So over MCP the model must link items as plain Markdown URLs built
//! from the app base URL, and list multiple items as a Markdown table.
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
         When referring the user to a Macro item (document, channel, chat, \
         project, task, or email thread) in your responses, write a plain URL of \
         the form `{base_url}/app/<type>/<id>`, where `<type>` is the item's type \
         — `md` for a document, `channel`, `chat`, `project`, `task`, or `email` \
         for an email thread — and `<id>` is the item id. Render it as a normal \
         Markdown link, e.g. `[Name]({base_url}/app/md/<id>)`.\n\
         \n\
         Do NOT emit `<m-document-mention>` XML tags or any other Macro internal \
         mention/markup format in these responses. Those only render inside the \
         Macro app and appear as raw text to MCP clients. This rule overrides any \
         other instruction about mention tags: over MCP, always link items with \
         plain Markdown URLs, never mention tags.\n\
         \n\
         When you list multiple Macro items, present them as a Markdown table with \
         the columns `number`, `name`, and `link`, where `link` is the \
         `{base_url}/app/<type>/<id>` URL for each item.\n"
    )
}
