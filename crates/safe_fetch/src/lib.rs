//! Fetching URLs that someone outside Macro controls, without server-side
//! request forgery.
//!
//! A user, an agent, an email or a webhook config can name any URL. Fetching
//! it naively lets them reach internal services and cloud metadata, follow a
//! redirect into the VPC, rebind DNS between a check and the connection, or
//! hold a worker open with a slow or endless body. [`SafeFetcher`] closes all
//! of these in one place:
//!
//! - addresses are checked on the exact answer the connection uses
//!   ([`AddressPolicy`], applied by the resolver), so DNS rebinding has no
//!   window; IP-literal hosts are checked before the request;
//! - redirects are followed by hand, each hop re-checked, up to a limit;
//! - schemes and ports are allowlisted; credentials in URLs are refused;
//! - one total deadline covers every hop and the body, with a separate idle
//!   limit between body chunks and a byte cap enforced while streaming;
//! - only listed media types are accepted; the image preset refuses SVG.
//!
//! ```
//! use std::time::Duration;
//! use safe_fetch::{
//!     AcceptedMediaTypes, AddressPolicy, AllowedPorts, AllowedSchemes, FetchPolicy, SafeFetcher,
//! };
//!
//! let fetcher = SafeFetcher::new(FetchPolicy {
//!     schemes: AllowedSchemes::HttpAndHttps,
//!     ports: AllowedPorts::SchemeDefault,
//!     addresses: AddressPolicy::public_only(),
//!     max_redirects: 5,
//!     connect_timeout: Duration::from_secs(5),
//!     total_timeout: Duration::from_secs(15),
//!     body_idle_timeout: Duration::from_secs(5),
//!     max_body_bytes: 10 * 1024 * 1024,
//!     media_types: AcceptedMediaTypes::images_except_svg(),
//! });
//! assert!(fetcher.is_ok());
//! ```
//!
//! Callers that re-serve fetched bytes to a browser send the media type the
//! policy accepted (never one derived from the URL) with
//! `X-Content-Type-Options: nosniff`. The one exception is octet-stream
//! served for `<img>`, which browsers must sniff to render and never sniff
//! into a document.
#![deny(missing_docs)]

mod address;
mod body;
mod error;
mod fetcher;
mod policy;
mod resolver;

pub use address::{AddressPolicy, is_non_public};
pub use body::SafeBody;
pub use error::{BuildError, FetchError};
pub use fetcher::{SafeFetcher, SafeResponse};
pub use policy::{
    AcceptedMediaTypes, AllowedPorts, AllowedSchemes, FetchPolicy, MediaType, Scheme,
};
pub use resolver::{HostLookup, SystemLookup};

pub use ipnet::IpNet;
