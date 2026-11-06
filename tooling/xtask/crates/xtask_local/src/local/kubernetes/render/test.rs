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
    let build = flake(
        &state,
        &json!({"name":"test", "devBinaries":null}),
        "push null",
    )
    .expect("render image build flake");
    let source = build.join("flake.nix");
    let original_time = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1);
    std::fs::File::options()
        .write(true)
        .open(&source)
        .expect("open flake")
        .set_times(std::fs::FileTimes::new().set_modified(original_time))
        .expect("set timestamp");
    flake(
        &state,
        &json!({"name":"test", "devBinaries":null}),
        "push null",
    )
    .expect("repeat identical image build");
    let retained_time = std::fs::metadata(source)
        .expect("flake metadata")
        .modified()
        .expect("timestamp");
    let retained = std::fs::read(&running).expect("running configuration remains");
    std::fs::remove_dir_all(state).expect("remove test state");
    assert_eq!(retained, original);
    assert_eq!(retained_time, original_time);
}
