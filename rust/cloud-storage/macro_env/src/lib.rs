#![deny(missing_docs)]
//! This crate provides a typed utility for determining what environment we are in at runtime

use macro_env_var::VarNameErr;
use std::{fmt::Display, str::FromStr};
use thiserror::Error;

pub mod ext;

mod var {
    macro_env_var::env_var!(
        #[derive(Clone)]
        pub struct Environment;
    );
}

/// The current environment the application is running in
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Copy)]
#[cfg_attr(feature = "strum", derive(strum::EnumIter))]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    /// Production environment
    Production,
    /// Dev and or staging environment
    /// TODO: update and add new value when we have real staging
    Develop,
    /// The server is running on localhost
    Local,
}

/// An error which can occur when constructing an [Environment]
#[derive(Debug, Error)]
pub enum MacroEnvErr {
    /// A std::env::var error while reading an env var
    #[error("{0}")]
    VarErr(#[from] VarNameErr),
    /// the input string value was not recognized as a valid env
    #[error("{0}")]
    InvalidValue(#[from] UnknownValue),
}

impl Environment {
    /// Attempt to construct a new version of [Environment] from the environment variables
    #[tracing::instrument(err, level = tracing::Level::TRACE)]
    pub fn new_from_env() -> Result<Self, MacroEnvErr> {
        let v = var::Environment::new()?;
        Ok(Self::from_str(&v)?)
    }

    /// attempt to create a new [Environment] falling back to local if we fail to construct
    pub fn new_or_prod() -> Self {
        Self::new_from_env().unwrap_or(Environment::Production)
    }
}

impl Display for Environment {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Environment::Production => write!(f, "prod"),
            Environment::Develop => write!(f, "dev"),
            Environment::Local => write!(f, "local"),
        }
    }
}

/// Represents a value which cannot be converted into an [Environment]
#[derive(Debug, Error)]
#[error("Could not convert {0} into an environment value")]
pub struct UnknownValue(String);

impl FromStr for Environment {
    type Err = UnknownValue;

    fn from_str(environment: &str) -> Result<Self, UnknownValue> {
        match environment {
            "prod" => Ok(Environment::Production),
            "dev" => Ok(Environment::Develop),
            "local" => Ok(Environment::Local),
            s => Err(UnknownValue(s.to_string())),
        }
    }
}
