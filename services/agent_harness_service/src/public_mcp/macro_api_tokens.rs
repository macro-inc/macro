//! The Macro API tokens the OAuth broker issues to MCP servers that hand their
//! bearer straight to Macro's APIs.

use agent_egress::outbound::macro_mcp::{MINTED_TOKEN_LIFETIME_SECONDS, MacroApiTokenSigner};
use ai_toolset::ToolCaller;
use anyhow::Context;
use macro_auth::middleware::decode_jwt::{JwtToken, JwtValidationArgs, handler};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_auth_proxy::domain::{
    models::AccessToken,
    ports::{MacroApiTokenMinter, MintedAccessToken, MintedAccessTokenFuture},
};
use std::time::Duration;

/// Signs, for the user a FusionAuth access token names, the attribution the
/// public MCP gives an OAuth client: the Macro bot, labelled with the client's
/// name, as public `ExecuteCode` signs into its SDK token.
pub struct SignedMacroApiTokens {
    pub signer: MacroApiTokenSigner,
    pub jwt_args: JwtValidationArgs,
}

impl MacroApiTokenMinter for SignedMacroApiTokens {
    fn mint<'a>(
        &'a self,
        upstream: &'a AccessToken,
        client_name: Option<&'a str>,
        lifetime: Duration,
    ) -> MintedAccessTokenFuture<'a> {
        Box::pin(async move {
            let JwtToken::MacroAccessToken(access) = handler(&self.jwt_args, upstream.as_str())
                .context("upstream access token failed validation")?
            else {
                anyhow::bail!("upstream access token is not a FusionAuth access token");
            };
            let user = MacroUserIdStr::try_from(access.macro_user_id)
                .context("upstream access token names an invalid user")?;
            // The signer refuses lifetimes past its cap, so a long FusionAuth
            // token gets a shorter Macro API token; the client refreshes.
            let seconds = lifetime
                .as_secs()
                .clamp(1, u64::try_from(MINTED_TOKEN_LIFETIME_SECONDS)?);
            let caller = ToolCaller::McpClient {
                name: client_name.map(str::to_owned),
            };

            let token = self
                .signer
                .mint_for_agent(
                    &user,
                    usize::try_from(seconds)?,
                    Some(bot_id::MACRO_AI_BOT_ID.as_uuid()),
                    caller.via().map(str::to_owned),
                    None,
                    None,
                )
                .await?;
            Ok(MintedAccessToken {
                token: AccessToken::from(token),
                lifetime: Duration::from_secs(seconds),
            })
        })
    }
}
