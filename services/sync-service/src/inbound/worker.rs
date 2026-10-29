use bebop::{Record, SubRecord};
use macro_sync_service_jwt::session::{SessionIdentity, SessionKind};
use tracing::{Instrument, error};
use wasm_bindgen::JsValue;
use worker::{Env, Headers, Method, Request, RequestInit, Response, Result, Stub};

use crate::{
    constants::{
        USER_PEER_D1_BINDING,
        header_names::{AUTHORIZATION, MACRO_INTERNAL_AUTH_KEY_HEADER_KEY},
    },
    d1::copy_user_mappings,
    durable_object::{CopyDocumentRequest, GetSnapshotRequest, response, status_codes},
    error::ResultExt,
    generated::schema::InitializeFromSnapshotRequest,
    timeit_log,
    timeout::{DEFAULT_TIMEOUT_MS, timeout},
};
use axum::response::IntoResponse;

const DURABLE_OBJECT_NAMESPACE: &str = "DOCUMENT_SYNC_SESSION";
/// Dispatch public endpoints and proxy session requests through Axum.
pub async fn router(env: Env, req: Request) -> Result<Response> {
    use axum::{
        Router,
        routing::{any, get, post},
    };
    use tower_service::Service;
    let mut router = Router::new()
        .route("/", get(|| async { "Hello Sync Service!" }))
        .route("/health", get(|| async { "healthy" }))
        .route(
            "/schema",
            get(|| async { include_str!("../../bebop/schema.bop") }),
        )
        .route("/surface/{surface_id}/activate", post(activate_route))
        .route("/document/{document_id}/copy", any(copy_route))
        .route("/document/{document_id}/{*rest}", any(document_route))
        .route("/surface/{surface_id}/{*rest}", any(surface_route))
        .with_state(env);
    let response = router.call(worker::HttpRequest::try_from(req)?).await;
    let response = response.unwrap_or_else(|error: std::convert::Infallible| match error {});
    Response::try_from(response)
}

#[cfg_attr(feature = "openapi", utoipa::path(
    post,
    path = "/document/{document_id}/copy",
    operation_id = "copy_document",
    tag = "sync_service",
    params(("document_id" = String, Path, description = "Source document to copy from")),
    request_body = CopyDocumentRequest,
    responses(
        (status = 200, description = "Copy succeeded; the new document was initialized"),
        (status = 404, description = "Source snapshot not found"),
    ),
))]
#[worker::send]
pub(crate) async fn copy_route(
    axum::extract::State(env): axum::extract::State<Env>,
    axum::extract::Path(id): axum::extract::Path<String>,
    req: axum::extract::Request,
) -> super::router::HandlerResult {
    Ok(copy_handler(env, Request::try_from(req)?, &id)
        .await?
        .into())
}

#[worker::send]
async fn document_route(
    axum::extract::State(env): axum::extract::State<Env>,
    axum::extract::Path((id, _)): axum::extract::Path<(String, String)>,
    req: axum::extract::Request,
) -> super::router::HandlerResult {
    Ok(pass_to_durable_object(&env, Request::try_from(req)?, &id)
        .await?
        .into())
}

#[worker::send]
async fn surface_route(
    axum::extract::State(env): axum::extract::State<Env>,
    axum::extract::Path((id, _rest)): axum::extract::Path<(String, String)>,
    req: axum::extract::Request,
) -> super::router::HandlerResult {
    let Ok(identity) = SessionIdentity::new(SessionKind::Surface, &id) else {
        return Ok(axum::http::StatusCode::BAD_REQUEST.into_response());
    };
    let req = Request::try_from(req)?;
    let response = pass_to_session(&env, req, &identity.storage_key()).await?;
    Ok(response.into())
}

/// Seal the verified original before enabling the imported target. A failed or
/// ambiguous response is retried forward; the source can no longer be thawed.
async fn activate_surface(
    env: &Env,
    mut req: Request,
    identity: &SessionIdentity,
) -> Result<Response> {
    let bytes = req.bytes().await?;
    let Ok(proof) =
        serde_json::from_slice::<crate::durable_object::surface_migration::SnapshotProof>(&bytes)
    else {
        return Ok(response(400));
    };
    let Some(source_id) = proof.source_id else {
        return Ok(response(409));
    };
    if identity.storage_key() != format!("surface:{source_id}") {
        return Ok(response(409));
    }
    for (key, path) in [
        (
            identity.storage_key(),
            format!("/surface/{source_id}/verify"),
        ),
        (
            source_id.to_string(),
            format!("/document/{source_id}/migration/seal"),
        ),
        (
            identity.storage_key(),
            format!("/surface/{source_id}/activate"),
        ),
    ] {
        let mut url = req.url()?;
        url.set_path(&path);
        let mut init = RequestInit::new();
        init.with_method(Method::Post)
            .with_headers(req.headers().clone())
            .with_body(Some(JsValue::from(bytes.clone())));
        let request = Request::new_with_init(url.as_ref(), &init)?;
        let result = pass_to_session(env, request, &key).await?;
        if result.status_code() != status_codes::OK || path.ends_with("/activate") {
            return Ok(result);
        }
    }
    Ok(response(409))
}

/// Get the original snapshot then initialize a new document with it.
/// Copying interacts with multiple durable objects so we orchestrate it from the worker.
pub async fn copy_handler(env: Env, mut req: Request, document_id: &str) -> Result<Response> {
    fn mv_header(source: &Headers, dest: &Headers, header_name: &str) -> Result<()> {
        if let Some(value) = source.get(header_name)? {
            dest.set(header_name, &value)?;
        }
        Ok(())
    }

    /// build a request to send to a durable object
    async fn do_helper(
        env: &Env,
        new_req_body: Vec<u8>,
        new_req_path: &str,
        og_req: &Request,
        document_id: &str,
    ) -> Result<Response> {
        let mut ss_req = RequestInit::new();
        ss_req.with_method(Method::Post);
        ss_req.with_body(Some(JsValue::from(new_req_body)));

        let headers = Headers::new();
        mv_header(og_req.headers(), &headers, AUTHORIZATION)?;
        mv_header(
            og_req.headers(),
            &headers,
            MACRO_INTERNAL_AUTH_KEY_HEADER_KEY,
        )?;
        mv_header(og_req.headers(), &headers, worker_rs_otel::TRACEPARENT)?;
        ss_req.with_headers(headers);

        let mut url = og_req.url()?;
        url.set_path(new_req_path);
        let ss_req = Request::new_with_init(url.as_ref(), &ss_req)?;

        pass_to_durable_object(env, ss_req, document_id).await
    }

    let body: CopyDocumentRequest = serde_json::from_slice(&req.bytes().await?)?;
    let new_document_id = body.target_document_id;

    let init_body = {
        let new_req_body = serde_json::to_vec(&GetSnapshotRequest {
            version_id: body.version_id,
        })?;
        let new_req_path = format!("/document/{}/snapshot", document_id);

        let mut ss_res = do_helper(&env, new_req_body, &new_req_path, &req, document_id).await?;
        if ss_res.status_code() != status_codes::OK {
            return Ok(response(ss_res.status_code()));
        }

        let snapshot_body = InitializeFromSnapshotRequest {
            snapshot: bebop::SliceWrapper::Raw(&ss_res.bytes().await?),
        };
        let mut buf = Vec::with_capacity(snapshot_body.serialized_size());
        _ = snapshot_body
            .serialize(&mut buf)
            .context("Failed to serialize new snapshot")?;
        buf
    };

    // The copy keeps the source's history, so it keeps its authors too. Copied
    // before initializing, which maps every still-unmapped peer to the system.
    let db = env.d1(USER_PEER_D1_BINDING)?;
    copy_user_mappings(&db, document_id, &new_document_id).await?;

    let initialize_path = format!("/document/{}/initialize", new_document_id);
    let ss_res = do_helper(&env, init_body, &initialize_path, &req, &new_document_id).await?;
    Ok(ss_res)
}

pub async fn pass_to_durable_object(
    env: &Env,
    req: Request,
    document_id: &str,
) -> Result<Response> {
    // Legacy document names remain valid, but cannot address the reserved namespace.
    if document_id.starts_with("surface:") {
        return Ok(response(400));
    }
    pass_to_session(env, req, document_id).await
}

async fn pass_to_session(env: &Env, req: Request, document_id: &str) -> Result<Response> {
    let stub = get_durable_object(env, document_id)?;
    let span = tracing::info_span!("do.fetch", document.id = %document_id);
    let req = match worker_rs_otel::traceparent_for_span(&span) {
        Some(traceparent) => {
            let mut cloned = req.clone_mut()?;
            cloned
                .headers_mut()?
                .set(worker_rs_otel::TRACEPARENT, &traceparent)?;
            cloned
        }
        None => req,
    };

    let fut = timeout(stub.fetch_with_request(req), DEFAULT_TIMEOUT_MS).instrument(span);
    let res = timeit_log!("worker -> do_fetch", fut.await);
    Ok(match res {
        crate::timeout::TimeoutResult::Ok(x) => x?,
        crate::timeout::TimeoutResult::Timeout(timeout_error) => {
            error!(err =? timeout_error, "A durable object RPC call has timed out");
            response(408)
        }
    })
}

fn get_durable_object(env: &Env, document_id: &str) -> Result<Stub> {
    env.durable_object(DURABLE_OBJECT_NAMESPACE)?
        .id_from_name(document_id)?
        .get_stub()
}

impl axum::extract::FromRef<Env> for crate::secrets::Secrets {
    fn from_ref(env: &Env) -> Self {
        Self::from(env)
    }
}

#[worker::send]
async fn activate_route(
    axum::extract::State(env): axum::extract::State<Env>,
    _: super::auth::InternalAccess,
    axum::extract::Path(id): axum::extract::Path<String>,
    req: axum::extract::Request,
) -> super::router::HandlerResult {
    let Ok(identity) = SessionIdentity::new(SessionKind::Surface, &id) else {
        return Ok(axum::http::StatusCode::BAD_REQUEST.into_response());
    };
    Ok(activate_surface(&env, Request::try_from(req)?, &identity)
        .await?
        .into())
}
