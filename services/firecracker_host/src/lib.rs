//! The Firecracker host agent for Macro computers: restores computers from
//! golden snapshots in jailed Firecracker processes, one netns each, and
//! serves the `firecracker_host_api` contract over mTLS.

pub mod config;
pub mod crash_point;
pub mod domain;
pub mod inbound;
pub mod outbound;
