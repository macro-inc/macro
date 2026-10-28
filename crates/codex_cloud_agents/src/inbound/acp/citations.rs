//! Present cloud file citations without inventing a URL for the remote checkout.

use lazy_regex::{Captures, regex, regex_captures};

pub(super) fn markdown(text: &str) -> String {
    regex!(r"【F:([^】]*)】")
        .replace_all(text, |captures: &Captures<'_>| {
            let Some(label) = label(&captures[1]) else {
                return captures[0].to_owned();
            };
            // A longer delimiter also handles filenames containing backticks.
            let delimiter =
                "`".repeat(label.split(|c| c != '`').map(str::len).max().unwrap_or(0) + 1);
            let padding = if delimiter.len() > 1 { " " } else { "" };
            format!("{delimiter}{padding}{label}{padding}{delimiter}")
        })
        .into_owned()
}

fn label(citation: &str) -> Option<String> {
    let (_, path, start, end) =
        regex_captures!(r"\A([^†【】\p{Cc}]+)†L([0-9]+)(?:-L([0-9]+))?\z", citation)?;
    if path.trim().is_empty() {
        return None;
    }
    let start = start.parse::<u32>().ok().filter(|n| *n > 0)?;
    if end.is_empty() {
        return Some(format!("{path}:{start}"));
    }
    let end = end.parse::<u32>().ok()?;
    (end >= start).then(|| format!("{path}:{start}-{end}"))
}

#[cfg(test)]
mod test;
