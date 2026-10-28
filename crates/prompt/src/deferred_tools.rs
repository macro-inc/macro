//! Lists Macro's deferred tools so the model knows they exist.
//!
//! Most of Macro's tools are not sent with every request: their parameter
//! schemas are large and most turns never use them. The model still needs to
//! know they exist, so this section names each one with a one-line summary,
//! and the model loads the ones it needs with `LoadTools`.
//!
//! The deferred set depends on the host's toolset, so this section is rendered
//! by [`render`] rather than declared as a `'static` prompt.

#[cfg(test)]
mod test;

static TITLE: &str = "More Macro Tools";

/// The most of a description a summary keeps when it has no sentence break.
const MAX_SUMMARY_CHARS: usize = 200;

/// Renders the section listing `tools` as `(name, description)` pairs, each
/// description cut to its first sentence. `None` when nothing is deferred.
pub fn render(tools: &[(&str, &str)]) -> Option<String> {
    if tools.is_empty() {
        return None;
    }
    let list = tools
        .iter()
        .map(|(name, description)| format!("- {name}: {}", summary(description)))
        .collect::<Vec<_>>()
        .join("\n");
    Some(format!(
        "# {TITLE}\n\
         These tools are available too, but their parameters are not loaded \
         yet. To use one, call `LoadTools` with its exact name (load several \
         at once if the task needs them), then call it on your next step. \
         `SearchTools` also finds them by keyword. Once you have called a \
         tool, it stays loaded for the rest of the conversation.\n\
         {list}\n"
    ))
}

/// The first sentence of `description`, on one line.
fn summary(description: &str) -> String {
    let line = description.split_whitespace().collect::<Vec<_>>().join(" ");
    let sentence = match line.find(". ") {
        Some(end) => &line[..=end],
        None => line.as_str(),
    };
    match sentence.char_indices().nth(MAX_SUMMARY_CHARS) {
        Some((cut, _)) => format!("{}…", &sentence[..cut]),
        None => sentence.to_string(),
    }
}
