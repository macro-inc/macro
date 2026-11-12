//! Authorized sender identities for an inbox. Provider transport stays behind a port.

use std::{future::Future, pin::Pin};

use macro_user_id::email::EmailStr;

use super::models::{EmailErr, Link};

/// A provider-configured address and its verification facts.
#[derive(Clone, Debug)]
pub struct SendAsAddress {
    /// Address registered with the provider.
    pub email_address: EmailStr<'static>,
    /// Provider-configured sender display name.
    pub display_name: Option<String>,
    /// Whether the provider has verified this sender.
    pub verified: bool,
}

/// Provider lookup result, boxed so a service can inject the capability without
/// propagating transport-specific generics to every email consumer.
pub type SendAsFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<SendAsAddress>, EmailErr>> + Send + 'a>>;

/// Fetch sender facts for an inbox already authorized by the domain service.
pub trait EmailSenderProvider: Send + Sync + 'static {
    /// `refresh` bypasses cached facts before authorizing delivery.
    fn send_as<'a>(&'a self, link: &'a Link, refresh: bool) -> SendAsFuture<'a>;
}

/// Hosts without provider access may still use the primary sending address.
pub struct UnavailableEmailSenderProvider;

impl EmailSenderProvider for UnavailableEmailSenderProvider {
    fn send_as<'a>(&'a self, _link: &'a Link, _refresh: bool) -> SendAsFuture<'a> {
        Box::pin(async { Err(EmailErr::SendAsUnavailable) })
    }
}
