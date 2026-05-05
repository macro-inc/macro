//! Branch name construction for task documents.
//!
//! Keep [`slugify`] in sync with `slugify` in
//! `js/app/packages/core/util/branchName.ts`.

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
pub fn build_task_branch_name(short_id: &str, document_name: &str) -> String {
    format!("macro-{short_id}-{}", slugify(document_name))
}

#[cfg(test)]
mod test;
