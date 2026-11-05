use super::*;

#[test]
fn missing_git_cannot_publish_a_healthy_service() {
    let error =
        check(Path::new("/does-not-exist/agent-git-runtime/git")).expect_err("git is missing");
    assert!(error.to_string().contains("git is required"));
}

#[test]
fn installed_git_includes_the_smart_http_backend() {
    check(Path::new("git")).expect("git and git-http-backend are installed");
}
