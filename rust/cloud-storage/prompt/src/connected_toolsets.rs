//! Tells the model which connected integrations (MCP toolsets) are available
//! to discover via tool search.
//!
//! Tools from the user's connected MCP servers are NOT advertised on every
//! request — they are loaded on demand via the `SearchTools` / `LoadTools`
//! tools (see the tool-search mechanism). The downside is that nothing in the
//! request tells the model those integrations exist, so it never thinks to
//! search for them. This section closes that gap by naming the toolsets the
//! user actually has connected and instructing the model to use tool search to
//! reach their tools when a task calls for it.
//!
//! The set of connected toolsets is per-user and only known at request time, so
//! this section is rendered by [`render`] rather than declared as a `'static`
//! prompt.

static TITLE: &str = "Connected Integrations";

/// Renders the connected-integrations section, listing the `names` of the
/// toolsets (MCP servers) the user currently has connected and instructing the
/// model to reach their tools via `SearchTools` / `LoadTools`.
///
/// Returns `None` when `names` is empty — there is nothing to discover, so the
/// section is omitted rather than emitting an empty, confusing block. Names are
/// rendered in the order given (callers should pass them de-duplicated and
/// sorted for a stable prompt).
pub fn render(names: &[String]) -> Option<String> {
    if names.is_empty() {
        return None;
    }

    let list = names
        .iter()
        .map(|name| format!("- {name}"))
        .collect::<Vec<_>>()
        .join("\n");

    Some(format!(
        "# {TITLE}\n\
         You have these integrations connected:\n\
         {list}\n\
         \n\
         Their individual tools are NOT all listed upfront. When a task might \
         need a capability from one of these integrations: (1) call \
         `SearchTools` with keywords (e.g. \"linear issue\", \"github commits\") \
         to find matching tools by name and description; (2) call `LoadTools` \
         with the names you want to make them callable; (3) call the loaded tool \
         by its name. Searching is cheap — search broadly, then load only what \
         you need. Think about whether a connected integration is relevant \
         before answering from what you already have; e.g. a question about \
         recent work may be answerable from a connected issue tracker or code \
         host even though those tools aren't visible yet.\n"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_names_omit_the_section() {
        assert!(render(&[]).is_none());
    }

    #[test]
    fn lists_each_connected_toolset_name() {
        let section = render(&["Linear".to_string(), "GitHub".to_string()]).unwrap();
        assert!(section.contains(&format!("# {TITLE}")));
        assert!(section.contains("- Linear"));
        assert!(section.contains("- GitHub"));
    }

    #[test]
    fn instructs_the_model_to_use_tool_search() {
        let section = render(&["Slack".to_string()]).unwrap();
        assert!(section.contains("SearchTools"));
        assert!(section.contains("LoadTools"));
    }
}
