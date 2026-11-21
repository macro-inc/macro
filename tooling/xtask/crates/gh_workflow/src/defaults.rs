//!
//! Default settings types for GitHub workflows.

use derive_setters::Setters;
use serde::{Deserialize, Serialize};

/// Represents default settings for jobs.
#[derive(Debug, Setters, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[setters(strip_option, into)]
pub struct Defaults {
    /// Default settings for running jobs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run: Option<RunDefaults>,
}

/// Represents default settings for running commands.
#[derive(Debug, Setters, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[setters(strip_option, into)]
pub struct RunDefaults {
    /// The shell to use for running commands.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shell: Option<String>,

    /// The working directory for running commands.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
}
