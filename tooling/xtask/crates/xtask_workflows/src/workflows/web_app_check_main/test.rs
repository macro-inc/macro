use super::*;

#[test]
fn nix_dev_shell_does_not_start_typecheck() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let filters = yaml
        .split("filters: |")
        .nth(1)
        .and_then(|rest| rest.split("id: filter").next())
        .expect("path-check filters");
    let should_run = filters
        .split("api_changed:")
        .next()
        .expect("should_run block");
    assert!(
        !should_run.contains("setup-nix-dev-shell"),
        "Typecheck is should_run || api_changed; nix-dev-shell must not be in should_run: {should_run}"
    );
    assert!(
        should_run.contains("setup-reqs-web"),
        "web setup action still belongs in should_run: {should_run}"
    );
}
