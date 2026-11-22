//! Macro Connect as a source of connections: the rows with `provider =
//! 'connect'`, served through `connect_client`. Connect owns the consent
//! flow, the grants and their refresh; Macro owns the OAuth apps.
//!
//! Connect's apps are addressed by the Pipedream slug they replace, or by
//! Connect's own id where they replace none.

mod source;
mod vendor;

#[expect(
    unused_imports,
    reason = "composition.rs builds the sources in the next step; remove this then"
)]
pub(crate) use source::ConnectSource;
pub use vendor::ConnectConfig;
pub(crate) use vendor::{ConnectVendor, ConnectVendorClient};
