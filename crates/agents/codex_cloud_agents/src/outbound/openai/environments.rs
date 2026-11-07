//! Project repository identity without retaining provider setup or secret fields.

use super::{Environment, EnvironmentRepository};
use crate::domain::cloud::CloudId;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize)]
pub(super) struct ProviderEnvironment {
    id: String,
    label: Option<String>,
    #[serde(default)]
    repos: Vec<String>,
    #[serde(default)]
    repo_map: HashMap<String, ProviderRepository>,
}

#[derive(Deserialize)]
struct ProviderRepository {
    repository_full_name: Option<String>,
    clone_url: Option<String>,
    default_branch: Option<String>,
}

impl ProviderEnvironment {
    pub(super) fn project(self) -> Result<Environment, rootcause::Report> {
        CloudId::new(self.id.clone())?;
        // Missing or invalid primary metadata must not promote a secondary repo.
        // Keep the environment available for explicit selection, without auto candidates.
        let repositories = self
            .repos
            .iter()
            .map(|id| self.repo_map.get(id)?.project())
            .collect::<Option<Vec<_>>>()
            .unwrap_or_default();
        Ok(Environment {
            id: self.id,
            label: self.label,
            repositories,
        })
    }
}

impl ProviderRepository {
    fn project(&self) -> Option<EnvironmentRepository> {
        let full_name = self.repository_full_name.as_deref()?;
        let parts: Vec<_> = full_name.split('/').collect();
        if parts.len() != 2
            || parts.iter().any(|part| {
                part.is_empty()
                    || *part == "."
                    || *part == ".."
                    || !part
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
            })
        {
            return None;
        }
        let clone_url = self.clone_url.as_deref()?;
        let url = reqwest::Url::parse(clone_url).ok()?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url
                .path()
                .trim_start_matches('/')
                .strip_suffix(".git")
                .unwrap_or(url.path().trim_start_matches('/'))
                != full_name
        {
            return None;
        }
        let default_branch = self.default_branch.as_deref()?;
        crate::domain::cloud::validate_branch(default_branch).ok()?;
        Some(EnvironmentRepository {
            full_name: full_name.into(),
            clone_url: url.to_string(),
            default_branch: default_branch.into(),
        })
    }
}

#[cfg(test)]
mod test;
