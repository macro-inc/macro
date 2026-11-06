use super::*;

#[test]
fn rendering_images_does_not_replace_the_running_instance_configuration() {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("current time")
        .as_nanos();
    let state = std::env::temp_dir().join(format!("macro-render-{}-{nonce}", std::process::id()));
    std::fs::create_dir(&state).expect("create test state");
    let running = state.join("test.json");
    let original = br#"{"name":"test","devBinaries":"/running/binaries","slot":1}"#;
    std::fs::write(&running, original).expect("record running configuration");
    expression(
        &state,
        &json!({"name":"test", "devBinaries":null}),
        "push null",
    )
    .expect("render image build expression");
    let retained = std::fs::read(&running).expect("running configuration remains");
    std::fs::remove_dir_all(state).expect("remove test state");
    assert_eq!(retained, original);
}
