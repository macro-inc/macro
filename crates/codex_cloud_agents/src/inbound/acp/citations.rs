//! Present cloud file citations without inventing a URL for the remote checkout.

pub(super) fn markdown(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("【F:") {
        output.push_str(&rest[..start]);
        rest = &rest[start + "【F:".len()..];
        let Some(end) = rest.find('】') else {
            output.push_str("【F:");
            break;
        };
        let citation = &rest[..end];
        if let Some(label) = label(citation) {
            // A longer delimiter also handles filenames containing backticks.
            let delimiter =
                "`".repeat(label.split(|c| c != '`').map(str::len).max().unwrap_or(0) + 1);
            let padding = if delimiter.len() > 1 { " " } else { "" };
            output.push_str(&format!("{delimiter}{padding}{label}{padding}{delimiter}"));
        } else {
            output.push_str("【F:");
            output.push_str(citation);
            output.push('】');
        }
        rest = &rest[end + '】'.len_utf8()..];
    }
    output.push_str(rest);
    output
}

fn label(citation: &str) -> Option<String> {
    let (path, lines) = citation.split_once('†')?;
    if path.trim().is_empty() || path.chars().any(|c| c.is_control() || "【】".contains(c)) {
        return None;
    }
    let lines = lines.strip_prefix('L')?;
    let (start, end) = match lines.split_once('-') {
        Some((start, end)) => (start, Some(end.strip_prefix('L')?)),
        None => (lines, None),
    };
    let parse_line = |s: &str| {
        s.bytes()
            .all(|b| b.is_ascii_digit())
            .then(|| s.parse::<u32>().ok())
            .flatten()
            .filter(|n| *n > 0)
    };
    let start = parse_line(start)?;
    match end {
        Some(end) => {
            let end = parse_line(end)?;
            (end >= start).then(|| format!("{path}:{start}-{end}"))
        }
        None => Some(format!("{path}:{start}")),
    }
}

#[cfg(test)]
mod test;
