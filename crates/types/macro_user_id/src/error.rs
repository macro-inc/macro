//! This module exposes a commonly used error type across this crate
use thiserror::Error;

/// describes the error that occurred while parsing a [MacroUserId]
#[derive(Debug, Error)]
#[error(transparent)]
pub struct ParseErr(#[from] nom::error::Error<String>);
