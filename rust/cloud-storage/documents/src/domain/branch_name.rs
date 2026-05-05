//! Branch name construction for task documents.

/// Maximum allowed length of a generated branch name.
const MAX_BRANCH_LENGTH: usize = 200;

/// Convert a task title into a slug suitable for a git branch name.
pub fn slugify(name: &str) -> String {
    let mut result = String::with_capacity(name.len());
    let mut prev_hyphen = false;
    for c in name.chars() {
        let to_push = if c.is_ascii_alphabetic() {
            c.to_ascii_lowercase()
        } else if c.is_ascii_digit() || c == '-' {
            c
        } else if c.is_whitespace() {
            '-'
        } else {
            continue;
        };
        if to_push == '-' {
            if !prev_hyphen {
                result.push('-');
                prev_hyphen = true;
            }
        } else {
            result.push(to_push);
            prev_hyphen = false;
        }
    }
    result.trim_matches('-').to_string()
}

/// Build the full task branch name from the document's short id and title.
///
/// Format: `{slug}-macro-{short_id}`, capped at [`MAX_BRANCH_LENGTH`]
/// characters. If the slug must be truncated to fit, it's cut at the
/// last hyphen boundary so words aren't split mid-string.
pub fn build_task_branch_name(short_id: &str, document_name: &str) -> String {
    let suffix = format!("macro-{short_id}");
    let slug = slugify(document_name);
    let max_slug_len = MAX_BRANCH_LENGTH.saturating_sub(suffix.len() + 1);

    // slugify output is pure ASCII, so byte-indexing is safe.
    let truncated = if slug.len() > max_slug_len {
        let cut = &slug[..max_slug_len];
        match cut.rfind('-').filter(|&i| i > 0) {
            Some(boundary) => &cut[..boundary],
            None => cut,
        }
    } else {
        slug.as_str()
    };

    let truncated = truncated.trim_end_matches('-');
    if truncated.is_empty() {
        suffix
    } else {
        format!("{truncated}-{suffix}")
    }
}

#[cfg(test)]
mod test;
