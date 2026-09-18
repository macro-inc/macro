use super::*;

#[test]
fn default_redirect_uses_explicit_local_app_but_preserves_deployed_defaults() {
    let app = Url::parse("https://forge:3000").unwrap();
    for (environment, expected) in [
        (Environment::Local, "https://forge:3000/app"),
        (Environment::Develop, "https://dev.macro.com/app"),
        (Environment::Production, "https://macro.com/app"),
    ] {
        assert_eq!(
            default_redirect_for_environment(environment, Some(app.clone()), Some("3009")).as_str(),
            expected
        );
    }
    assert_eq!(
        default_redirect_for_environment(Environment::Local, None, Some("3009")).as_str(),
        "http://localhost:3009/"
    );
    assert_eq!(
        default_redirect_for_environment(Environment::Local, None, None).as_str(),
        "http://localhost:3000/"
    );
}
