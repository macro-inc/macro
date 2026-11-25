use super::*;
use crate::domain::models::Surfaces;
use serde_json::json;

fn path(kind: ConnectorKind, id: &str) -> ConnectorPath {
    ConnectorPath {
        kind,
        id: id.to_owned(),
    }
}

fn app(slug: &str) -> ConnectorKey {
    ConnectorKey::App(ConnectorId::parse(slug).unwrap())
}

fn server(url: &str) -> ConnectorKey {
    ConnectorKey::Server(ServerUrl::parse(url).unwrap())
}

#[test]
fn an_app_key_is_its_slug() {
    assert_eq!(key_string(&app("linear")), "app/linear");
    assert_eq!(key_string(&app("slack_v2")), "app/slack");
}

#[test]
fn a_server_key_is_its_url_in_base64url() {
    assert_eq!(
        key_string(&server("https://mcp.example.com/mcp/")),
        "server/aHR0cHM6Ly9tY3AuZXhhbXBsZS5jb20vbWNw"
    );
}

#[test]
fn keys_round_trip_through_their_path() {
    for key in [
        app("linear"),
        app("google_sheets"),
        server("https://mcp.example.com/mcp?team=a&b=c"),
        server("http://localhost:8080/sse"),
    ] {
        let string = key_string(&key);
        let (kind, id) = string.split_once('/').unwrap();
        let kind: ConnectorKind = serde_json::from_value(json!(kind)).unwrap();

        assert!(
            id.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
            "{string} is not URL-safe"
        );
        assert_eq!(path(kind, id).key().unwrap(), key);
    }
}

#[test]
fn malformed_keys_are_refused() {
    assert!(matches!(
        path(ConnectorKind::App, "Not A Slug").key(),
        Err(InvalidKey::App(_))
    ));
    assert!(matches!(
        path(ConnectorKind::Server, "not base64!").key(),
        Err(InvalidKey::Encoding)
    ));
    // `ftp://example.com`
    assert!(matches!(
        path(ConnectorKind::Server, "ZnRwOi8vZXhhbXBsZS5jb20").key(),
        Err(InvalidKey::Server(_))
    ));
}

#[test]
fn a_connector_serializes_without_any_source() {
    let connector = Connector::new(
        app("linear"),
        "Linear".to_owned(),
        Status::NeedsReauth,
        true,
        Surfaces::new(true, true),
    );
    let importable =
        Importable::new().with(ConnectorId::parse("linear").unwrap(), ImportSurface::Api);

    let body = serde_json::to_value(ConnectorResponse::new(&connector, &importable)).unwrap();

    assert_eq!(
        body,
        json!({
            "key": "app/linear",
            "target": {"type": "app", "slug": "linear"},
            "name": "Linear",
            "status": "needsReauth",
            "connectable": true,
            "mcp": true,
            "api": true,
            "importAvailable": true,
        })
    );
}

#[test]
fn import_needs_the_surface_the_import_reads() {
    let importable = Importable::new()
        .with(ConnectorId::parse("notion").unwrap(), ImportSurface::Api)
        .with(ConnectorId::parse("slack").unwrap(), ImportSurface::Mcp);
    let connector =
        |key, surfaces| Connector::new(key, "x".to_owned(), Status::Connected, true, surfaces);

    let mcp_only = Surfaces::new(true, false);
    assert!(!importable.available(&connector(app("notion"), mcp_only)));
    assert!(importable.available(&connector(app("slack"), mcp_only)));
    assert!(!importable.available(&connector(app("linear"), Surfaces::new(true, true))));
    assert!(!importable.available(&connector(server("https://mcp.notion.com/mcp"), mcp_only)));
}

#[test]
fn a_server_connector_names_its_url() {
    let connector = Connector::new(
        server("https://mcp.example.com/mcp"),
        "Example".to_owned(),
        Status::Connected,
        true,
        Surfaces::new(true, false),
    );

    let body =
        serde_json::to_value(ConnectorResponse::new(&connector, &Importable::new())).unwrap();

    assert_eq!(
        body["target"],
        json!({"type": "server", "url": "https://mcp.example.com/mcp"})
    );
    assert_eq!(body["status"], "connected");
}

#[test]
fn connect_steps_never_say_whose_flow_they_are() {
    let open = ConnectStepResponse::from(ConnectStep::OpenUrl(
        url::Url::parse("https://connect.example.com/start?x=1").unwrap(),
    ));
    let dialog = ConnectStepResponse::from(ConnectStep::EmbeddedDialog {
        token: "ctok_1".to_owned(),
        expires_at: "2026-11-22T00:00:00Z".to_owned(),
        link: url::Url::parse("https://connect.example.com/link").unwrap(),
    });

    assert_eq!(
        serde_json::to_value(open).unwrap(),
        json!({"type": "openUrl", "url": "https://connect.example.com/start?x=1"})
    );
    assert_eq!(
        serde_json::to_value(dialog).unwrap(),
        json!({
            "type": "embeddedDialog",
            "token": "ctok_1",
            "expiresAt": "2026-11-22T00:00:00Z",
            "link": "https://connect.example.com/link",
        })
    );
}
