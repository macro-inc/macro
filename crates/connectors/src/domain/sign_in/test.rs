use super::*;
use crate::fake::FakeOverlays;
use macro_user_id::cowlike::CowLike as _;

/// Completes every sign-in as `user` at `url`.
struct FakeAuthorization {
    url: &'static str,
}

#[async_trait::async_trait]
impl ServerAuthorization for FakeAuthorization {
    async fn complete(
        &self,
        code: &str,
        _state: &str,
    ) -> Result<(MacroUserIdStr<'static>, ServerUrl), rootcause::Report> {
        if code != "a-code" {
            return Err(rootcause::report!(
                "the authorization server refused the code"
            ));
        }
        Ok((
            MacroUserIdStr::parse_from_str("macro|signer@example.com")
                .unwrap()
                .into_owned(),
            ServerUrl::parse(self.url).unwrap(),
        ))
    }

    fn client_metadata(&self) -> serde_json::Value {
        serde_json::json!({"client_id": "https://macro.test/client"})
    }
}

fn sign_ins(url: &'static str) -> ServerSignIns {
    let overlays = Overlays::new([
        (
            crate::domain::models::ConnectorId::parse("jira").unwrap(),
            ServerUrl::parse("https://mcp.atlassian.com/v1/mcp").unwrap(),
        ),
        (
            crate::domain::models::ConnectorId::parse("confluence").unwrap(),
            ServerUrl::parse("https://mcp.atlassian.com/v1/mcp").unwrap(),
        ),
    ]);
    ServerSignIns::new(Arc::new(FakeAuthorization { url }), FakeOverlays(overlays))
}

#[tokio::test]
async fn a_server_added_by_url_is_itself() {
    let signed_in = sign_ins("https://mcp.example.com/mcp")
        .complete_sign_in("a-code", "a-state")
        .await
        .unwrap();

    assert_eq!(signed_in.user().to_string(), "macro|signer@example.com");
    assert_eq!(
        signed_in.keys(),
        [ConnectorKey::Server(
            ServerUrl::parse("https://mcp.example.com/mcp").unwrap()
        )]
    );
}

#[tokio::test]
async fn an_overlay_address_is_every_app_overlaid_there() {
    let signed_in = sign_ins("https://mcp.atlassian.com/v1/mcp/")
        .complete_sign_in("a-code", "a-state")
        .await
        .unwrap();

    let apps: Vec<String> = signed_in.keys().iter().map(ToString::to_string).collect();
    assert_eq!(apps, ["confluence", "jira"]);
}

#[tokio::test]
async fn a_refused_code_fails() {
    let result = sign_ins("https://mcp.example.com/mcp")
        .complete_sign_in("other", "a-state")
        .await;

    assert!(result.is_err());
}

#[test]
fn the_metadata_document_comes_from_the_client() {
    assert_eq!(
        sign_ins("https://mcp.example.com/mcp").client_metadata()["client_id"],
        "https://macro.test/client"
    );
}

/// Completes every REST app sign-in as the signer, to Autodesk.
struct FakeAppAuthorization;

#[async_trait::async_trait]
impl AppAuthorization for FakeAppAuthorization {
    async fn complete(
        &self,
        _code: &str,
        _state: &str,
    ) -> Result<(MacroUserIdStr<'static>, ConnectorId), rootcause::Report> {
        Ok((
            MacroUserIdStr::parse_from_str("macro|signer@example.com")
                .unwrap()
                .into_owned(),
            ConnectorId::parse("autodesk").unwrap(),
        ))
    }
}

#[tokio::test]
async fn a_rest_app_sign_in_is_the_app() {
    let signed_in = sign_ins("https://mcp.example.com/mcp")
        .with_apps(Arc::new(FakeAppAuthorization))
        .complete_app_sign_in("a-code", "a-state")
        .await
        .unwrap();

    assert_eq!(
        signed_in.keys(),
        [ConnectorKey::App(ConnectorId::parse("autodesk").unwrap())]
    );
}

#[tokio::test]
async fn without_rest_apps_an_app_sign_in_fails() {
    let result = sign_ins("https://mcp.example.com/mcp")
        .complete_app_sign_in("a-code", "a-state")
        .await;

    assert!(result.is_err());
}
