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

/// Build the user path component for a generated branch name.
///
/// Prefer the linked GitHub username when present; otherwise use the local
/// part of the user's email address.
pub fn user_branch_prefix(github_username: Option<&str>, user_email: &str) -> String {
    let raw_prefix = github_username
        .and_then(non_empty_trimmed)
        .unwrap_or_else(|| email_local_part(user_email));
    let prefix = sanitize_branch_component(raw_prefix);

    if prefix.is_empty() {
        "macro".to_string()
    } else {
        prefix
    }
}

fn non_empty_trimmed(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

fn email_local_part(email: &str) -> &str {
    let email = email.trim();
    email
        .split_once('@')
        .map(|(local_part, _)| local_part)
        .filter(|local_part| !local_part.is_empty())
        .unwrap_or(email)
}

fn sanitize_branch_component(component: &str) -> String {
    let mut result = String::with_capacity(component.len());
    let mut prev_hyphen = false;

    for c in component.trim().chars() {
        let to_push = if c.is_ascii_alphanumeric() || matches!(c, '_' | '.') {
            c
        } else if c == '-' || c.is_whitespace() || matches!(c, '/' | '\\') {
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

    result
        .trim_matches(|c| matches!(c, '-' | '.' | '/'))
        .to_string()
}

fn team_branch_slug(team_slug: Option<&str>) -> String {
    let slug = team_slug
        .and_then(non_empty_trimmed)
        .map(str::to_ascii_lowercase)
        .unwrap_or_else(|| "macro".to_string());
    let slug = sanitize_branch_component(&slug);

    if slug.is_empty() {
        "macro".to_string()
    } else {
        slug
    }
}

fn task_reference(team_task_id: Option<i32>, short_id: &str) -> String {
    team_task_id
        .filter(|id| *id > 0)
        .map(|id| id.to_string())
        .unwrap_or_else(|| sanitize_branch_component(short_id))
}

fn truncate_slug_at_boundary(slug: &str, max_len: usize) -> &str {
    if max_len == 0 {
        return "";
    }

    if slug.len() <= max_len {
        return slug;
    }

    // slugify output is pure ASCII, so byte-indexing is safe.
    let cut = &slug[..max_len];
    match cut.rfind('-').filter(|&i| i > 0) {
        Some(boundary) => &cut[..boundary],
        None => cut,
    }
}

fn truncate_branch_at_limit(branch: String) -> String {
    if branch.len() <= MAX_BRANCH_LENGTH {
        return branch;
    }

    // All components passed to this function have been sanitized to ASCII.
    branch[..MAX_BRANCH_LENGTH]
        .trim_end_matches(['-', '.', '/'])
        .to_string()
}

/// Build the full task branch name.
///
/// Format:
/// `{github_username_or_email_prefix}/{lowercase_team_slug_or_macro}-{team_task_id_or_short_uuid}-{document-name-slug}`.
///
/// The branch is capped at [`MAX_BRANCH_LENGTH`] characters. If the document
/// slug must be truncated to fit, it is cut at the last hyphen boundary so
/// words aren't split mid-string.
pub fn build_task_branch_name(
    user_prefix: &str,
    team_slug: Option<&str>,
    team_task_id: Option<i32>,
    short_id: &str,
    document_name: &str,
) -> String {
    let user_prefix = sanitize_branch_component(user_prefix);
    let user_prefix = if user_prefix.is_empty() {
        "macro".to_string()
    } else {
        user_prefix
    };
    let team_slug = team_branch_slug(team_slug);
    let task_reference = task_reference(team_task_id, short_id);
    let branch_prefix = format!("{user_prefix}/{team_slug}-{task_reference}");

    let document_slug = slugify(document_name);
    if document_slug.is_empty() {
        return truncate_branch_at_limit(branch_prefix);
    }

    let max_document_slug_len = MAX_BRANCH_LENGTH.saturating_sub(branch_prefix.len() + 1);
    let truncated_document_slug =
        truncate_slug_at_boundary(&document_slug, max_document_slug_len).trim_end_matches('-');

    if truncated_document_slug.is_empty() {
        truncate_branch_at_limit(branch_prefix)
    } else {
        truncate_branch_at_limit(format!("{branch_prefix}-{truncated_document_slug}"))
    }
}

#[cfg(test)]
mod test;
