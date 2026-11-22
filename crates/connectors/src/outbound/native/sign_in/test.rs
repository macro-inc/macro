use super::*;
use crate::outbound::native::models::McpServerRecord;
use macro_user_id::cowlike::CowLike as _;

/// Exchanges one known code for a stored server.
struct FakeOAuth;

impl OAuthClient for FakeOAuth {
    async fn start_authorization(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _server_url: &str,
        _server_name: &str,
    ) -> anyhow::Result<String> {
        anyhow::bail!("not used")
    }

    async fn exchange_authorization_code(
        &self,
        code: &str,
        state: &str,
    ) -> anyhow::Result<McpServerRecord> {
        anyhow::ensure!(code == "a-code" && state == "a-state", "unknown code");
        Ok(McpServerRecord {
            user_id: MacroUserIdStr::parse_from_str("macro|signer@example.com")?.into_owned(),
            url: "https://mcp.example.com/mcp/".to_owned(),
            server_name: "Example".to_owned(),
            credentials: None,
            enabled: true,
            requires_sign_in: false,
        })
    }
}

fn sign_in() -> OAuthSignIn<FakeOAuth> {
    let metadata = OAuthClientMetadata::new(
        "https://macro.test/client-metadata".to_owned(),
        "https://macro.test/callback".to_owned(),
    );
    OAuthSignIn::new(Arc::new(FakeOAuth), &metadata).unwrap()
}

#[tokio::test]
async fn completion_answers_the_signer_and_the_normalized_server() {
    let (user, url) = sign_in().complete("a-code", "a-state").await.unwrap();

    assert_eq!(user.to_string(), "macro|signer@example.com");
    assert_eq!(
        url,
        ServerUrl::parse("https://mcp.example.com/mcp").unwrap()
    );
}

#[tokio::test]
async fn a_refused_exchange_fails() {
    assert!(sign_in().complete("other", "a-state").await.is_err());
}

#[test]
fn the_metadata_document_is_published_as_built() {
    let metadata = sign_in().client_metadata();

    assert_eq!(metadata["client_id"], "https://macro.test/client-metadata");
    assert_eq!(metadata["redirect_uris"][0], "https://macro.test/callback");
}
