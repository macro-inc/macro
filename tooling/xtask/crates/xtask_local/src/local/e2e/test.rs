use super::*;

#[test]
fn derives_host_endpoints_and_test_environment_from_the_instance() {
    let instance = Instance::derive(Some("e2e-test"), Some(31_000)).unwrap();
    let endpoints = Endpoints::for_instance(&instance);

    assert_eq!(endpoints.proxy_url, "http://localhost:31009");
    assert_eq!(endpoints.frontend_url, "http://localhost:31010/app");
    assert_eq!(
        endpoints.postgres_url,
        "postgres://user:password@localhost:31000/macrodb"
    );
    assert_eq!(endpoints.fusionauth_url, "http://localhost:31005");
    assert_eq!(endpoints.localstack_url, "http://localhost:31006");
    assert_eq!(
        endpoints.connection_gateway_ws_url,
        "ws://localhost:31009/connection-gateway"
    );

    let env = endpoints.test_env();
    assert_eq!(env["LOCAL_E2E_BACKEND_ORIGIN"], endpoints.proxy_url);
    assert_eq!(
        env["LOCAL_E2E_CONNECTION_GATEWAY_WS_URL"],
        "ws://localhost:31009/connection-gateway"
    );
    assert_eq!(env["DATABASE_URL"], endpoints.postgres_url);
    assert_eq!(
        env["LOCAL_E2E_ENV_FILE"],
        endpoints.generated_env.display().to_string()
    );
}

#[test]
fn ui_requires_the_web_suite() {
    let args = LocalE2eArgs {
        suite: LocalE2eSuite::Rust,
        ui: true,
        ..LocalE2eArgs::default()
    };

    let error = validate_args(&args).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("only supported with --suite web")
    );
}
