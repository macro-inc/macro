use crate::tool_context::*;
use sqlx::PgPool;
use std::sync::Arc;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path, path_regex},
};

pub(super) struct Host {
    pub creator: crate::ToolEntityCreator,
    _http: MockServer,
}

pub(super) async fn host(pool: &PgPool) -> Host {
    let http = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/snapshot/notion"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({"snapshot":"AQID", "markdown":"Body"})),
        )
        .mount(&http)
        .await;
    Mock::given(method("POST"))
        .and(path("/snapshot/markdown"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![1, 2, 3]))
        .mount(&http)
        .await;
    Mock::given(method("POST"))
        .and(path_regex(r"/document/.*/initialize"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&http)
        .await;
    let lexical = lexical_client::LexicalClient::new("test".into(), http.uri());
    let sync = sync_service_client::SyncServiceClient::new("test".into(), http.uri());
    let access = Arc::new(ToolEntityAccessService::new(
        entity_access::outbound::PgAccessRepository::new(pool.clone()),
    ));
    let properties = build_properties_service(pool.clone(), access.clone());
    let registrar = entity_registry_db_utils::OwnedEntityRegistrar::new(
        entity_registry::OwnerGrantPolicy::new(bots::outbound::pg_bots_repo::PgBotsRepo::new(
            pool.clone(),
        )),
    );
    // All event delivery is confined to an unavailable loopback endpoint.
    let broker = macro_event_broker::MacroEventBrokerService::new(
        macro_event_broker::KafkaEventPublisher::new("127.0.0.1:1").unwrap(),
        tokio_util::task::TaskTracker::new(),
    );
    let s3_config = aws_sdk_s3::Config::builder()
        .behavior_version(aws_sdk_s3::config::BehaviorVersion::latest())
        .region(aws_sdk_s3::config::Region::new("us-east-1"))
        .credentials_provider(aws_sdk_s3::config::Credentials::new(
            "test", "test", None, None, "test",
        ))
        .build();
    let document_service = documents::domain::service::DocumentServiceImpl::new(
        documents::outbound::pg_document_repo::PgDocumentRepo::new(pool.clone(), registrar.clone()),
        documents::domain::models::CloudFrontConfig {
            distribution_url: http.uri(),
            signer_public_key_id: "test".into(),
            signer_private_key: "test".into(),
            presigned_url_expiry_seconds: 60,
            browser_cache_expiry_seconds: 60,
        },
        sync.clone(),
        documents::outbound::s3_upload_url::S3UploadUrlAdapter::new(
            aws_sdk_s3::Client::from_conf(s3_config),
            "test",
            "test",
        ),
        build_task_properties_adapter(pool.clone(), properties.clone(), access.clone()),
        NoOpConnectionService,
        ToolEntityAccessManagementService::new(
            entity_access_management::outbound::PgRepository::new(pool.clone()),
        ),
        foreign_entity::domain::service::ForeignEntityServiceImpl::new(
            foreign_entity::outbound::pg_foreign_entity_repo::PgForeignEntityRepo::new(
                pool.clone(),
            ),
        ),
        broker.clone(),
    );
    let mut documents = documents::inbound::toolset::DocumentToolContext::new(
        document_service,
        (*access).clone(),
        lexical.clone(),
        sync.clone(),
        documents::outbound::editing_worker_client::ReqwestEditingWorkerClient::from_url(
            http.uri(),
        ),
        "test".into(),
        build_message_service_without_side_effects(pool.clone(), Arc::new(lexical.clone())),
    );
    documents.creator = documents::domain::create::DocumentCreator::new(
        documents.service.clone(),
        documents::outbound::markdown_init::LexicalSyncMarkdownInitializer::new(
            lexical.clone(),
            sync,
        ),
        documents::outbound::document_bytes_upload::ReqwestDocumentBytesUploader::default(),
        documents::domain::ports::mentions::NoOpDocumentMentionTracker,
    );
    let initiatives = build_initiative_tool_context(
        pool.clone(),
        &documents,
        properties.clone(),
        access.clone(),
        broker.clone(),
    );
    let project_service = Arc::new(projects::domain::service::ProjectServiceImpl::new(
        projects::outbound::PgProjectRepo::new(pool.clone(), registrar),
        projects::domain::ports::UnavailableProjectUploadUrlPort,
        projects::domain::ports::UnavailableBulkUploadRequestPort,
        projects::domain::ports::UnavailableShaCounterPort,
        ToolEntityAccessManagementService::new(
            entity_access_management::outbound::PgRepository::new(pool.clone()),
        ),
        projects::domain::ports::UnavailableProjectSearchIndexer,
        projects::domain::ports::UnavailableFiledItemsUnfiler,
        None,
        broker,
    ));
    let databases = build_databases_tool_context(
        pool.clone(),
        access.clone(),
        ToolTableEventPublisher::NoOp(Default::default()),
        MaybeToolEventBroker::NoOp(Default::default()),
    );
    Host {
        creator: crate::ToolEntityCreator {
            notion_link_editor: None,
            document_creator: documents.creator,
            document_service: documents.service,
            entity_access_service: access.clone(),
            channel_service: build_channel_tool_context_without_side_effects(
                pool.clone(),
                Arc::new(lexical),
            )
            .service,
            task_properties: build_task_properties_adapter(
                pool.clone(),
                properties.clone(),
                access,
            ),
            document_properties:
                import::outbound::document_properties::DocumentPropertiesApplicator::new(properties),
            team_repository: build_team_repository(pool.clone()),
            initiative_service: initiatives.service,
            project_service,
            databases_service: databases.service,
        },
        _http: http,
    }
}
