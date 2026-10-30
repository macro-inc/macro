use super::*;

#[test]
fn runs_the_end_to_end_tests_on_every_platform() {
    let yaml = test_macrod_update()
        .to_string()
        .expect("workflow should serialize");
    for runner in [
        runners::Runner::RustCi,
        runners::Runner::MacOsArm,
        runners::Runner::Windows,
    ] {
        assert!(yaml.contains(&runner.to_string()), "{runner}");
    }
    assert!(yaml.contains("update_e2e.py"));
    assert!(yaml.contains("windows_test.ps1"));
    assert!(yaml.contains("crates/coding_agent_worker/**"));
}
