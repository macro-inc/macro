//! The user's Dialpad grant, held by Macro Connect.
use crate::domain::{
    models::{AccessToken, DIALPAD_APP, Grant},
    ports::{Grants, Result},
};
use async_trait::async_trait;
use connect_client::{ConnectClient, Error};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use zeroize::Zeroizing;

pub struct ConnectGrants(pub Arc<ConnectClient>);

#[async_trait]
impl Grants for ConnectGrants {
    async fn grant(&self, user: &MacroUserIdStr<'static>) -> Result<Grant> {
        match self.0.access_token(user.as_ref(), DIALPAD_APP).await {
            Ok(mut token) => Ok(Grant::Active(AccessToken(Zeroizing::new(std::mem::take(
                &mut token.access_token,
            ))))),
            Err(Error::NotConnected) => Ok(Grant::NotConnected),
            Err(Error::NeedsReauth) => Ok(Grant::NeedsReauth),
            Err(error) => Err(rootcause::report!(
                "Macro Connect token export failed: {error}"
            )),
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
            .await
            .map_err(|error| rootcause::report!("Macro Connect session failed: {error}"))?;
        Ok(session.connect_url)
    }

    async fn disconnect(&self, user: &MacroUserIdStr<'static>) -> Result<()> {
        match self.0.delete_connection(user.as_ref(), DIALPAD_APP).await {
            Ok(_) | Err(Error::NotConnected) => Ok(()),
            Err(error) => Err(rootcause::report!(
                "Macro Connect disconnect failed: {error}"
            )),
        }
    }
}
