//! This module defines all members of the holy 'domain'
//! Please research hexagonal architecture pattern for more info

pub mod models;
#[cfg(feature = "ports")]
pub mod ports;
#[cfg(feature = "ports")]
pub mod services;
