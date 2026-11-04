//! The user's Dialpad grant, held by Macro Connect.
use crate::domain::{
    models::{AccessToken, DIALPAD_APP, Grant},
    ports::{Grants, Result},
};
use async_trait::async_trait;
use connect_client::{ConnectClient, Error};
use macro_user_id::user_id::MacroUserIdStr;
use zeroize::Zeroizing;

/// [`Grants`] over Macro Connect, as the customer its key names.
pub struct ConnectGrants(ConnectClient);

impl ConnectGrants {
    /// Grants from the Connect API at `base_url`.
    pub fn new(base_url: &str, customer_key: impl Into<String>) -> Result<Self> {
        Ok(Self(ConnectClient::new(base_url, customer_key)?))
    }
}

#[async_trait]
impl Grants for ConnectGrants {
    async fn grant(&self, user: &MacroUserIdStr<'static>) -> Result<Grant> {
        match self.0.access_token(user.as_ref(), DIALPAD_APP).await {
            // The response zeroizes on drop, so move the token out, not a copy.
            Ok(mut token) => Ok(Grant::Active(AccessToken(Zeroizing::new(std::mem::take(
                &mut token.access_token,
            ))))),
            Err(Error::NotConnected) => Ok(Grant::NotConnected),
            Err(Error::NeedsReauth) => Ok(Grant::NeedsReauth),
            Err(error) => Err(error.into()),
        }
    }

    async fn connect_url(
        &self,
        user: &MacroUserIdStr<'static>,
        redirect_url: &str,
    ) -> Result<String> {
        let session = self
            .0
            .create_connect_session(user.as_ref(), DIALPAD_APP, redirect_url)
            .await?;
        Ok(session.connect_url)
    }

    async fn disconnect(&self, user: &MacroUserIdStr<'static>) -> Result<()> {
        match self.0.delete_connection(user.as_ref(), DIALPAD_APP).await {
            Ok(_) | Err(Error::NotConnected) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

#[cfg(test)]
mod test;
