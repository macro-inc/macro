use super::*;

#[test]
fn content_origins_put_the_document_before_the_host() {
    let local = content_origin(&ArtifactContentUrl::local()).unwrap();
    assert_eq!(
        local.for_document("0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f"),
        "http://0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f.artifacts.localhost:8086"
    );

    let prod = content_origin(&ArtifactContentUrl::prod()).unwrap();
    assert_eq!(
        prod.for_document("0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f"),
        "https://0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f.artifacts.macro-agent-gateway.com"
    );
}

#[test]
fn production_frames_only_the_app_and_the_native_shells() {
    assert_eq!(
        frame_ancestors(&AppServiceUrl::prod(), Environment::Production).unwrap(),
        vec![
            "https://macro.com",
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
        ]
    );
    assert!(
        frame_ancestors(&AppServiceUrl::dev(), Environment::Develop)
            .unwrap()
            .contains(&"http://localhost:*".to_string())
    );
}
