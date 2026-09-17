//! Validated names of repository branches selected when a session starts.

/// A branch name, without the `refs/heads/` prefix.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryBranch(String);

impl RepositoryBranch {
    /// Parse a Git branch name, rejecting ref syntax and revision expressions.
    pub fn parse(value: String) -> Result<Self, &'static str> {
        let valid = !value.is_empty()
            && value != "@"
            && !value.starts_with('-')
            && !value.ends_with('.')
            && !value.contains("..")
            && !value.contains("@{")
            && !value
                .chars()
                .any(|c| c.is_control() || c.is_whitespace() || "~^:?*[\\".contains(c))
            && value
                .split('/')
                .all(|part| !part.is_empty() && !part.starts_with('.') && !part.ends_with(".lock"));
        if !valid {
            return Err("invalid repository branch");
        }
        Ok(Self(value))
    }

    /// The validated branch name passed to the runtime.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod test;
