//! Auth service wrapper.

use std::net::{IpAddr, Ipv4Addr};

#[cfg(test)]
pub use MockSeedAuth as Auth;
#[cfg(not(test))]
pub use SeedAuth as Auth;

use fusionauth::FusionAuthClient;
#[allow(unused_imports)]
use mockall::automock;

/// Wrapper around the FusionAuth client.
#[cfg_attr(test, allow(dead_code))]
pub struct SeedAuth {
    /// Fusionauth client
    inner: FusionAuthClient,
}

#[cfg_attr(test, automock)]
#[cfg_attr(test, allow(dead_code))]
impl SeedAuth {
    /// Create a new auth wrapper.
    pub fn new(inner: FusionAuthClient) -> Self {
        Self { inner }
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn create_user<'a>(
        &self,
        user: fusionauth::user::create::User<'a>,
    ) -> anyhow::Result<String> {
        let result = self
            .inner
            .create_user(
                user,
                true, /*skip_verification*/
                IpAddr::V4(Ipv4Addr::LOCALHOST),
            )
            .await?;

        Ok(result)
    }
}
