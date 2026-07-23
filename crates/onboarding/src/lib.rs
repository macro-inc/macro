//! The onboarding flow (`/setup`): one row per user tracking whether they
//! are still in the flow, plus the hook that starts import gather runs when
//! connectors authenticate.
//!
//! All the actual import machinery — staging, dedup, gather/import jobs —
//! lives in the `import` crate. Onboarding is just a feature that uses it:
//! it starts auto-importing gathers for authenticated connectors while the
//! flow is active, and deletes unreserved onboarding-staged rows when the
//! flow completes.

#![deny(missing_docs)]

pub mod domain;
pub mod inbound;
pub mod outbound;
