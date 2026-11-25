use super::installer_args;

#[test]
fn only_restart_reopens_the_app() {
    assert_eq!(installer_args(true), ["/P", "/UPDATE", "/R"]);
    assert_eq!(installer_args(false), ["/P", "/UPDATE"]);
}
