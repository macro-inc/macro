//! The permission model, its resolution, and the service that applies the
//! rules for who may read, change, tighten and reset an agent's permissions.

pub mod admission;
pub mod model;
pub mod ports;
pub mod resolve;
pub mod service;
