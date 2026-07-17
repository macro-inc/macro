use std::path::Path;

use super::*;

#[test]
fn strips_only_complete_app_path_segments() {
    assert_eq!(strip_app_prefix("/app/assets/main.js"), "assets/main.js");
    assert_eq!(strip_app_prefix("/app"), "");
    assert_eq!(strip_app_prefix("/app.css"), "/app.css");
}

#[test]
fn parses_asset_paths_without_query_parameters() {
    let uri = "tauri://localhost/app/assets/main.js?cache=1"
        .parse::<http::Uri>()
        .unwrap();

    let path = request_asset_path(&uri).unwrap();

    assert_eq!(path.as_path(), Path::new("assets/main.js"));
}

#[test]
fn root_path_resolves_to_the_entrypoint() {
    let uri = "tauri://localhost/app".parse::<http::Uri>().unwrap();

    let path = request_asset_path(&uri).unwrap();

    assert_eq!(path.as_path(), Path::new("index.html"));
}

#[test]
fn rejects_percent_encoded_path_traversal() {
    let uri = "tauri://localhost/app/assets/%2e%2e/secret"
        .parse::<http::Uri>()
        .unwrap();

    assert!(matches!(
        request_asset_path(&uri),
        Err(RequestPathError::Unsafe(_))
    ));
}

#[test]
fn rejects_invalid_percent_encoding() {
    let uri = "tauri://localhost/app/assets/%ZZ"
        .parse::<http::Uri>()
        .unwrap();

    assert_eq!(
        request_asset_path(&uri),
        Err(RequestPathError::InvalidEncoding)
    );
}

#[test]
fn rewrites_embedded_asset_uris() {
    assert_eq!(
        rewrite_uri("tauri://localhost/app/assets/main.js?cache=1"),
        "tauri://localhost/assets/main.js?cache=1"
    );
    assert_eq!(
        rewrite_uri("https://tauri.localhost/app/login"),
        "https://tauri.localhost/login"
    );
    assert_eq!(
        rewrite_uri("tauri://localhost/app.css"),
        "tauri://localhost/app.css"
    );
}
