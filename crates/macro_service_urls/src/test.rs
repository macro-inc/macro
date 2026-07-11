use super::testing_harness::with_mock_override_env;
use super::*;
use macro_env::Environment;

const ENVS: [Environment; 3] = [
    Environment::Production,
    Environment::Develop,
    Environment::Local,
];

fn assert_parses_for_all_environments<T>(service_url_for_environment: impl Fn(Environment) -> T)
where
    T: AsRef<str>,
{
    for environment in ENVS {
        service_url_for_environment(environment)
            .as_ref()
            .parse::<Url>()
            .unwrap();
    }
}

#[test]
fn app_service_url_parses() {
    assert_parses_for_all_environments(AppServiceUrl::default_for_environment);
}

#[test]
fn auth_service_url_parses() {
    assert_parses_for_all_environments(AuthServiceUrl::default_for_environment);
}

#[test]
fn pdf_service_url_parses() {
    assert_parses_for_all_environments(PdfServiceUrl::default_for_environment);
}

#[test]
fn document_storage_service_url_parses() {
    assert_parses_for_all_environments(DocumentStorageServiceUrl::default_for_environment);
}

#[test]
fn websocket_service_url_parses() {
    assert_parses_for_all_environments(WebsocketServiceUrl::default_for_environment);
}

#[test]
fn connection_gateway_url_parses() {
    assert_parses_for_all_environments(ConnectionGatewayUrl::default_for_environment);
}

#[test]
fn connection_gateway_websocket_url_parses() {
    assert_parses_for_all_environments(ConnectionGatewayWebsocketUrl::default_for_environment);
}

#[test]
fn document_cognition_service_url_parses() {
    assert_parses_for_all_environments(DocumentCognitionServiceUrl::default_for_environment);
}

#[test]
fn notification_service_url_parses() {
    assert_parses_for_all_environments(NotificationServiceUrl::default_for_environment);
}

#[test]
fn static_file_service_url_parses() {
    assert_parses_for_all_environments(StaticFileServiceUrl::default_for_environment);
}

#[test]
fn unfurl_service_url_parses() {
    assert_parses_for_all_environments(UnfurlServiceUrl::default_for_environment);
}

#[test]
fn contacts_service_url_parses() {
    assert_parses_for_all_environments(ContactsServiceUrl::default_for_environment);
}

#[test]
fn email_service_url_parses() {
    assert_parses_for_all_environments(EmailServiceUrl::default_for_environment);
}

#[test]
fn image_proxy_service_url_parses() {
    assert_parses_for_all_environments(ImageProxyServiceUrl::default_for_environment);
}

#[test]
fn lexical_service_url_parses() {
    assert_parses_for_all_environments(LexicalServiceUrl::default_for_environment);
}

#[test]
fn sync_service_url_parses() {
    assert_parses_for_all_environments(SyncServiceUrl::default_for_environment);
}

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
fn exported_service_urls_match_local_values() {
    let service_urls = ServiceUrls::default_for_environment(macro_env::Environment::Local);

    assert_eq!(
        service_urls.app_service_url.as_ref(),
        "http://localhost:3000"
    );
    assert_eq!(
        service_urls.auth_service_url.as_ref(),
        "http://localhost:8080"
    );
    assert_eq!(
        service_urls.pdf_service_url.as_ref(),
        "http://localhost:4567"
    );
    assert_eq!(
        service_urls.document_storage_service_url.as_ref(),
        "http://localhost:8086",
    );
    assert_eq!(
        service_urls.websocket_service_url.as_ref(),
        "ws://localhost:6969"
    );
    assert_eq!(
        service_urls.connection_gateway_url.as_ref(),
        "http://localhost:8082",
    );
    assert_eq!(
        service_urls.connection_gateway_websocket_url.as_ref(),
        "ws://localhost:8082",
    );
    assert_eq!(
        service_urls.document_cognition_service_url.as_ref(),
        "http://localhost:8085",
    );
    assert_eq!(
        service_urls.notification_service_url.as_ref(),
        "http://localhost:8089",
    );
    assert_eq!(
        service_urls.static_file_service_url.as_ref(),
        "http://localhost:8100",
    );
    assert_eq!(
        service_urls.unfurl_service_url.as_ref(),
        "http://localhost:8095"
    );
    assert_eq!(
        service_urls.contacts_service_url.as_ref(),
        "http://localhost:8083"
    );
    assert_eq!(
        service_urls.email_service_url.as_ref(),
        "http://localhost:8087"
    );
    assert_eq!(
        service_urls.image_proxy_service_url.as_ref(),
        "http://localhost:8097",
    );
    assert_eq!(
        service_urls.lexical_service_url.as_ref(),
        "http://localhost:8096"
    );
    assert_eq!(
        service_urls.sync_service_url.as_ref(),
        "http://localhost:8787"
    );
}

#[test]
fn exported_service_urls_match_dev_values() {
    let service_urls = ServiceUrls::default_for_environment(macro_env::Environment::Develop);

    assert_eq!(
        service_urls.app_service_url.as_ref(),
        "https://dev.macro.com"
    );
    assert_eq!(
        service_urls.auth_service_url.as_ref(),
        "https://auth-service-dev.macro.com",
    );
    assert_eq!(
        service_urls.pdf_service_url.as_ref(),
        "https://pdf-service-dev.macro.com",
    );
    assert_eq!(
        service_urls.document_storage_service_url.as_ref(),
        "https://cloud-storage-dev.macro.com",
    );
    assert_eq!(
        service_urls.websocket_service_url.as_ref(),
        "wss://services-dev.macro.com",
    );
    assert_eq!(
        service_urls.connection_gateway_url.as_ref(),
        "https://connection-gateway-dev.macro.com",
    );
    assert_eq!(
        service_urls.connection_gateway_websocket_url.as_ref(),
        "wss://connection-gateway-dev.macro.com",
    );
    assert_eq!(
        service_urls.document_cognition_service_url.as_ref(),
        "https://document-cognition-dev.macro.com",
    );
    assert_eq!(
        service_urls.notification_service_url.as_ref(),
        "https://notifications-dev.macro.com",
    );
    assert_eq!(
        service_urls.static_file_service_url.as_ref(),
        "https://static-file-service-dev.macro.com",
    );
    assert_eq!(
        service_urls.unfurl_service_url.as_ref(),
        "https://unfurl-service-dev.macro.com",
    );
    assert_eq!(
        service_urls.contacts_service_url.as_ref(),
        "https://contacts-dev.macro.com",
    );
    assert_eq!(
        service_urls.email_service_url.as_ref(),
        "https://email-service-dev.macro.com",
    );
    assert_eq!(
        service_urls.image_proxy_service_url.as_ref(),
        "https://image-proxy-dev.macro.com",
    );
    assert_eq!(
        service_urls.lexical_service_url.as_ref(),
        "https://lexical-service-dev.macroverse.workers.dev",
    );
    assert_eq!(
        service_urls.sync_service_url.as_ref(),
        "https://sync-service-dev3.macroverse.workers.dev",
    );
}

#[test]
fn exported_service_urls_match_prod_values() {
    let service_urls = ServiceUrls::default_for_environment(macro_env::Environment::Production);

    assert_eq!(service_urls.app_service_url.as_ref(), "https://macro.com");
    assert_eq!(
        service_urls.auth_service_url.as_ref(),
        "https://auth-service.macro.com",
    );
    assert_eq!(
        service_urls.pdf_service_url.as_ref(),
        "https://pdf-service.macro.com",
    );
    assert_eq!(
        service_urls.document_storage_service_url.as_ref(),
        "https://cloud-storage.macro.com",
    );
    assert_eq!(
        service_urls.websocket_service_url.as_ref(),
        "wss://services.macro.com",
    );
    assert_eq!(
        service_urls.connection_gateway_url.as_ref(),
        "https://connection-gateway.macro.com",
    );
    assert_eq!(
        service_urls.connection_gateway_websocket_url.as_ref(),
        "wss://connection-gateway.macro.com",
    );
    assert_eq!(
        service_urls.document_cognition_service_url.as_ref(),
        "https://document-cognition.macro.com",
    );
    assert_eq!(
        service_urls.notification_service_url.as_ref(),
        "https://notifications.macro.com",
    );
    assert_eq!(
        service_urls.static_file_service_url.as_ref(),
        "https://static-file-service.macro.com",
    );
    assert_eq!(
        service_urls.unfurl_service_url.as_ref(),
        "https://unfurl-service.macro.com",
    );
    assert_eq!(
        service_urls.contacts_service_url.as_ref(),
        "https://contacts.macro.com",
    );
    assert_eq!(
        service_urls.email_service_url.as_ref(),
        "https://email-service.macro.com",
    );
    assert_eq!(
        service_urls.image_proxy_service_url.as_ref(),
        "https://image-proxy.macro.com",
    );
    assert_eq!(
        service_urls.lexical_service_url.as_ref(),
        "https://lexical-service-prod.macroverse.workers.dev",
    );
    assert_eq!(
        service_urls.sync_service_url.as_ref(),
        "https://sync-service-prod2.macroverse.workers.dev",
    );
}

#[test]
fn exported_service_url_override_names_are_derived_from_env_var_names() {
    assert_eq!(
        AppServiceUrl::local().override_env_var_name(),
        "OVERRIDE_APP_SERVICE_URL",
    );
    assert_eq!(
        AuthServiceUrl::local().override_env_var_name(),
        "OVERRIDE_AUTH_SERVICE_URL",
    );
    assert_eq!(
        PdfServiceUrl::local().override_env_var_name(),
        "OVERRIDE_PDF_SERVICE_URL",
    );
    assert_eq!(
        DocumentStorageServiceUrl::local().override_env_var_name(),
        "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL",
    );
    assert_eq!(
        WebsocketServiceUrl::local().override_env_var_name(),
        "OVERRIDE_WEBSOCKET_SERVICE_URL",
    );
    assert_eq!(
        ConnectionGatewayUrl::local().override_env_var_name(),
        "OVERRIDE_CONNECTION_GATEWAY_URL",
    );
    assert_eq!(
        ConnectionGatewayWebsocketUrl::local().override_env_var_name(),
        "OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL",
    );
    assert_eq!(
        DocumentCognitionServiceUrl::local().override_env_var_name(),
        "OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL",
    );
    assert_eq!(
        NotificationServiceUrl::local().override_env_var_name(),
        "OVERRIDE_NOTIFICATION_SERVICE_URL",
    );
    assert_eq!(
        StaticFileServiceUrl::local().override_env_var_name(),
        "OVERRIDE_STATIC_FILE_SERVICE_URL",
    );
    assert_eq!(
        UnfurlServiceUrl::local().override_env_var_name(),
        "OVERRIDE_UNFURL_SERVICE_URL",
    );
    assert_eq!(
        ContactsServiceUrl::local().override_env_var_name(),
        "OVERRIDE_CONTACTS_SERVICE_URL",
    );
    assert_eq!(
        EmailServiceUrl::local().override_env_var_name(),
        "OVERRIDE_EMAIL_SERVICE_URL",
    );
    assert_eq!(
        ImageProxyServiceUrl::local().override_env_var_name(),
        "OVERRIDE_IMAGE_PROXY_SERVICE_URL",
    );
    assert_eq!(
        LexicalServiceUrl::local().override_env_var_name(),
        "OVERRIDE_LEXICAL_SERVICE_URL",
    );
    assert_eq!(
        SyncServiceUrl::local().override_env_var_name(),
        "OVERRIDE_SYNC_SERVICE_URL",
    );
}

#[test]
fn service_url_converts_to_string() {
    let service_url = ServiceUrl::borrowed("https://borrowed.macro.com");
    let url_string: String = service_url.into();

    assert_eq!(url_string, "https://borrowed.macro.com");
}
