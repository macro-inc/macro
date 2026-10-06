//! Bounded agent-authored organization; grouping does not change access.
use super::*;
use std::collections::HashSet;

#[cfg(test)]
mod test;

pub(super) fn validate_groups(revision: &Revision, groups: Option<&[FileGroup]>) -> Result<()> {
    let groups = groups.unwrap_or_default();
    if groups.len() > 32 || groups.iter().map(|group| group.files.len()).sum::<usize>() > 256 {
        return Err(ReviewError::Invalid(
            "Too many file groups or patterns".into(),
        ));
    }
    let mut keys = HashSet::new();
    for group in groups {
        validate_text(&group.key, 100)?;
        validate_text(&group.title, 100)?;
        if !keys.insert(&group.key) || group.files.is_empty() {
            return Err(ReviewError::Invalid(
                "File groups need unique keys and matching files".into(),
            ));
        }
        validate_patterns(revision, &group.files)?;
    }
    Ok(())
}

fn validate_patterns(revision: &Revision, patterns: &[String]) -> Result<()> {
    for pattern in patterns {
        validate_text(pattern, 512)?;
        if pattern.matches("**/").count() > 4
            || !revision
                .files
                .iter()
                .any(|file| diffd_core::kinds::matches(pattern, &file.path))
        {
            return Err(ReviewError::Invalid(format!(
                "File pattern does not match this revision: {pattern}"
            )));
        }
    }
    Ok(())
}
