use super::testing_harness::with_mock_override_env;
use super::*;

crate::service_url! {
    #[derive(Debug, Clone)]
    pub struct TestServiceUrl {
        local: "http://localhost:8080",
        dev: "https://test-dev.macro.com",
        prod: "https://test.macro.com",
    }
}

fn missing_override(_: &'static str) -> Result<String, std::env::VarError> {
    Err(std::env::VarError::NotPresent)
}

#[test]
fn defaults_are_selected_by_environment() {
    with_mock_override_env(missing_override, || {
        assert_eq!(
            TestServiceUrl::new_for_environment(macro_env::Environment::Local)
                .unwrap()
                .as_ref(),
            "http://localhost:8080",
        );
        assert_eq!(
            TestServiceUrl::new_for_environment(macro_env::Environment::Develop)
                .unwrap()
                .as_ref(),
            "https://test-dev.macro.com",
        );
        assert_eq!(
            TestServiceUrl::new_for_environment(macro_env::Environment::Production)
                .unwrap()
                .as_ref(),
            "https://test.macro.com",
        );
    });
}

#[test]
fn default_values_are_borrowed() {
    let service_url = TestServiceUrl::default_for_environment(macro_env::Environment::Local);

    assert_eq!(service_url.as_ref(), "http://localhost:8080");
    assert_eq!(
        service_url.inner().borrowed_inner(),
        Some("http://localhost:8080"),
    );
}

fn mock_test_service_override(var_name: &'static str) -> Result<String, std::env::VarError> {
    (var_name == "OVERRIDE_TEST_SERVICE_URL")
        .then(|| "https://override.macro.com".to_string())
        .ok_or(std::env::VarError::NotPresent)
}

#[test]
fn override_env_var_wins_over_environment_default() {
    let service_url = with_mock_override_env(mock_test_service_override, || {
        TestServiceUrl::new_for_environment(macro_env::Environment::Local).unwrap()
    });

    assert_eq!(service_url.as_ref(), "https://override.macro.com");
    assert_eq!(
        service_url.override_env_var_name(),
        "OVERRIDE_TEST_SERVICE_URL",
    );
    assert_eq!(
        service_url.inner().owned_inner().unwrap(),
        "https://override.macro.com",
    );
}

#[test]
fn helpers_construct_expected_defaults() {
    assert_eq!(TestServiceUrl::local().as_ref(), "http://localhost:8080");
    assert_eq!(TestServiceUrl::dev().as_ref(), "https://test-dev.macro.com");
    assert_eq!(TestServiceUrl::prod().as_ref(), "https://test.macro.com");
}

#[test]
fn copied_returns_a_borrowed_view() {
    let service_url = TestServiceUrl::from_owned("https://runtime.macro.com");
    let copied = service_url.copied();

    assert_eq!(copied.as_ref(), "https://runtime.macro.com");
    assert_eq!(copied.borrowed_inner(), Some("https://runtime.macro.com"));
}

crate::service_url! {
    #[derive(Debug)]
    pub struct TestServiceUrls {
        #[derive(Debug, Clone)]
        pub TestDocumentStorageServiceUrl {
            local: "http://localhost:8086",
            dev: "https://cloud-storage-dev.macro.com",
            prod: "https://cloud-storage.macro.com",
        },
        #[derive(Debug, Clone)]
        pub TestEmailServiceUrl {
            local: "http://localhost:8087",
            dev: "https://email-service-dev.macro.com",
            prod: "https://email-service.macro.com",
        },
    }
}

fn mock_group_overrides(var_name: &'static str) -> Result<String, std::env::VarError> {
    match var_name {
        "OVERRIDE_TEST_EMAIL_SERVICE_URL" => Ok("https://email-override.macro.com".to_string()),
        _ => Err(std::env::VarError::NotPresent),
    }
}

#[test]
fn grouped_macro_resolves_all_service_urls() {
    let service_urls = with_mock_override_env(mock_group_overrides, || {
        TestServiceUrls::new_for_environment(macro_env::Environment::Develop).unwrap()
    });

    assert_eq!(
        service_urls.test_document_storage_service_url.as_ref(),
        "https://cloud-storage-dev.macro.com",
    );
    assert_eq!(
        service_urls.test_email_service_url.as_ref(),
        "https://email-override.macro.com",
    );
}

#[test]
fn grouped_defaults_do_not_check_overrides() {
    let service_urls = TestServiceUrls::default_for_environment(macro_env::Environment::Production);

    assert_eq!(
        service_urls.test_document_storage_service_url.as_ref(),
        "https://cloud-storage.macro.com",
    );
    assert_eq!(
        service_urls.test_email_service_url.as_ref(),
        "https://email-service.macro.com",
    );
}

#[test]
fn exported_service_urls_match_local_docker_compose_values() {
    let service_urls = ServiceUrls::default_for_environment(macro_env::Environment::Local);

    assert_eq!(
        service_urls.document_storage_service_url.as_ref(),
        "http://localhost:8086",
    );
    assert_eq!(
        service_urls.connection_gateway_url.as_ref(),
        "http://localhost:8082",
    );
    assert_eq!(
        service_urls.document_cognition_service_url.as_ref(),
        "http://localhost:8085",
    );
    assert_eq!(
        service_urls.lexical_service_url.as_ref(),
        "http://localhost:8096",
    );
    assert_eq!(
        service_urls.sync_service_url.as_ref(),
        "http://localhost:8787",
    );
    assert_eq!(
        service_urls.static_file_service_url.as_ref(),
        "http://localhost:8100",
    );
    assert_eq!(
        service_urls.email_service_url.as_ref(),
        "http://localhost:8087",
    );
}

#[test]
fn exported_service_urls_match_infra_shared_dev_values() {
    let service_urls = ServiceUrls::default_for_environment(macro_env::Environment::Develop);

    assert_eq!(
        service_urls.document_storage_service_url.as_ref(),
        "https://cloud-storage-dev.macro.com",
    );
    assert_eq!(
        service_urls.connection_gateway_url.as_ref(),
        "https://connection-gateway-dev.macro.com",
    );
    assert_eq!(
        service_urls.document_cognition_service_url.as_ref(),
        "https://document-cognition-dev.macro.com",
    );
    assert_eq!(
        service_urls.lexical_service_url.as_ref(),
        "https://lexical-service-dev.macroverse.workers.dev",
    );
    assert_eq!(
        service_urls.sync_service_url.as_ref(),
        "https://sync-service-dev3.macroverse.workers.dev",
    );
    assert_eq!(
        service_urls.static_file_service_url.as_ref(),
        "https://static-file-service-dev.macro.com",
    );
    assert_eq!(
        service_urls.email_service_url.as_ref(),
        "https://email-service-dev.macro.com",
    );
}

#[test]
fn exported_service_urls_match_infra_shared_prod_values() {
    let service_urls = ServiceUrls::default_for_environment(macro_env::Environment::Production);

    assert_eq!(
        service_urls.document_storage_service_url.as_ref(),
        "https://cloud-storage.macro.com",
    );
    assert_eq!(
        service_urls.connection_gateway_url.as_ref(),
        "https://connection-gateway.macro.com",
    );
    assert_eq!(
        service_urls.document_cognition_service_url.as_ref(),
        "https://document-cognition.macro.com",
    );
    assert_eq!(
        service_urls.lexical_service_url.as_ref(),
        "https://lexical-service.macroverse.workers.dev",
    );
    assert_eq!(
        service_urls.sync_service_url.as_ref(),
        "https://sync-service-prod2.macroverse.workers.dev",
    );
    assert_eq!(
        service_urls.static_file_service_url.as_ref(),
        "https://static-file-service.macro.com",
    );
    assert_eq!(
        service_urls.email_service_url.as_ref(),
        "https://email-service.macro.com",
    );
}

#[test]
fn exported_service_url_override_names_are_derived_from_env_var_names() {
    assert_eq!(
        DocumentStorageServiceUrl::local().override_env_var_name(),
        "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL",
    );
    assert_eq!(
        ConnectionGatewayUrl::local().override_env_var_name(),
        "OVERRIDE_CONNECTION_GATEWAY_URL",
    );
    assert_eq!(
        DocumentCognitionServiceUrl::local().override_env_var_name(),
        "OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL",
    );
    assert_eq!(
        LexicalServiceUrl::local().override_env_var_name(),
        "OVERRIDE_LEXICAL_SERVICE_URL",
    );
    assert_eq!(
        SyncServiceUrl::local().override_env_var_name(),
        "OVERRIDE_SYNC_SERVICE_URL",
    );
    assert_eq!(
        StaticFileServiceUrl::local().override_env_var_name(),
        "OVERRIDE_STATIC_FILE_SERVICE_URL",
    );
    assert_eq!(
        EmailServiceUrl::local().override_env_var_name(),
        "OVERRIDE_EMAIL_SERVICE_URL",
    );
}

#[test]
fn service_url_converts_to_string() {
    let service_url = ServiceUrl::borrowed("https://borrowed.macro.com");
    let url_string: String = service_url.into();

    assert_eq!(url_string, "https://borrowed.macro.com");
}
