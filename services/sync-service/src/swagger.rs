use utoipa::OpenApi;

use crate::domain::models::{
    BlameRow, CopyDocumentRequest, DocumentMetadata, GetSnapshotRequest, PeerResponse,
    PeerWithUserId, VersionIndicator,
};

/// OpenAPI spec for the sync service's JSON HTTP endpoints.
///
/// The WebSocket sync protocol is bebop-encoded and lives in the bebop schema
/// (`/schema`); only the JSON control-plane endpoints are described here.
#[derive(OpenApi)]
#[openapi(
    info(
        title = "Sync Service",
        description = "Document sync service JSON control plane",
        contact(name = "Macro"),
    ),
    modifiers(&Security),
    paths(
        crate::inbound::worker::copy_route,
        crate::inbound::router::exists,
        crate::inbound::router::metadata,
        crate::inbound::router::blame,
        crate::inbound::router::raw,
        crate::inbound::router::active_peers,
        crate::inbound::router::peer,
        crate::inbound::router::wakeup,
        crate::inbound::router::snapshot,
        crate::inbound::router::initialize,
        crate::inbound::router::document_state,
        crate::inbound::router::document_update,
        crate::inbound::router::delete_document,
    ),
    components(schemas(
        CopyDocumentRequest,
        GetSnapshotRequest,
        VersionIndicator,
        DocumentMetadata,
        PeerResponse,
        PeerWithUserId,
        BlameRow,
    )),
    tags((name = "sync_service", description = "Sync service"))
)]
pub struct ApiDoc;

struct Security;

impl utoipa::Modify for Security {
    fn modify(&self, api: &mut utoipa::openapi::OpenApi) {
        use utoipa::openapi::security::{
            ApiKey, ApiKeyValue, Http, HttpAuthScheme, SecurityScheme,
        };
        // An unspecified Cargo license is not a valid OpenAPI 3.1 license.
        api.info.license = None;
        let components = api.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "document_permission",
            SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
        );
        components.add_security_scheme(
            "internal_key",
            SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::new(
                crate::constants::header_names::MACRO_INTERNAL_AUTH_KEY_HEADER_KEY,
            ))),
        );
    }
}

/// Raw octet-stream payload used by the binary HTTP endpoints.
pub(crate) struct BinaryBody;

impl utoipa::PartialSchema for BinaryBody {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        use utoipa::openapi::schema::{KnownFormat, ObjectBuilder, SchemaFormat, Type};
        ObjectBuilder::new()
            .schema_type(Type::String)
            .format(Some(SchemaFormat::KnownFormat(KnownFormat::Binary)))
            .into()
    }
}

impl utoipa::ToSchema for BinaryBody {}
