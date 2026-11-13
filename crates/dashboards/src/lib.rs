//! Dashboards: saved dynamic-UI views with an owner, grants and a version per
//! save. An agent account points its home dashboard at one.
#![deny(missing_docs)]

pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;
