use axum::{
    Router,
    body::Bytes,
    extract::{Path as AxumPath, Request as AxumRequest, State as AxumState},
    http::HeaderMap,
    routing::{any, get, post},
};
use bebop::{Record, SubRecord};
use tracing::{Instrument, error};
use wasm_bindgen::JsValue;
use worker::{Env, Headers, Method, Request, RequestInit, Response, Result, Stub};

use crate::{
    constants::header_names::{AUTHORIZATION, MACRO_INTERNAL_AUTH_KEY_HEADER_KEY},
    domain::{
        document_id::DocumentId,
        models::{CopyDocumentRequest, GetSnapshotRequest},
    },
    error::ResultExt,
    generated::schema::InitializeFromSnapshotRequest,
    inbound::{
        cors::cors_layer,
        durable_object::{response, status_codes},
        router::HandlerResult,
    },
    timeit_log,
    timeout::{DEFAULT_TIMEOUT_MS, timeout},
};

const DURABLE_OBJECT_NAMESPACE: &str = "DOCUMENT_SYNC_SESSION";
const SCHEMA: &str = include_str!("../../bebop/schema.bop");

/// The worker's top-level axum router. Static endpoints are served directly,
/// `/document/{id}/copy` is orchestrated here, and everything else under a
/// document (including the websocket `connect` upgrade) proxies to the durable
/// object.
pub fn outer_router(env: Env) -> Router {
    // Static endpoints get CORS here. Document responses already carry the
    // durable object's CORS, so the proxy routes must not add it again.
    let public = Router::new()
        .route("/", get(|| async { "Hello Sync Service!" }))
        .route("/health", get(|| async { "healthy" }))
        .route("/schema", get(|| async { SCHEMA }))
        .layer(cors_layer());

    let documents = Router::new()
        .route("/document/{document_id}/copy", post(copy_route))
        .route("/document/{document_id}/{*rest}", any(proxy_route));

    public.merge(documents).with_state(env)
}

/// Proxy any document request to its durable object. Websocket `connect`
/// upgrades survive the request/response conversion.
#[worker::send]
async fn proxy_route(
    AxumState(env): AxumState<Env>,
    AxumPath((document_id, _rest)): AxumPath<(DocumentId, String)>,
    req: AxumRequest,
) -> HandlerResult {
    Ok(
        pass_to_durable_object(&env, Request::try_from(req)?, &document_id)
            .await?
            .into(),
    )
}

/// Copy a document: fetch the source snapshot, then initialize a new document
/// with it. Orchestrated here because it spans two durable objects.
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
    AxumState(env): AxumState<Env>,
    AxumPath(document_id): AxumPath<DocumentId>,
    headers: HeaderMap,
    body: Bytes,
) -> HandlerResult {
    async fn do_helper(
        env: &Env,
        body: Vec<u8>,
        path: &str,
        headers: &HeaderMap,
        document_id: &DocumentId,
    ) -> Result<Response> {
        let out_headers = Headers::new();
        for name in [
            AUTHORIZATION,
            MACRO_INTERNAL_AUTH_KEY_HEADER_KEY,
            worker_rs_otel::TRACEPARENT,
        ] {
            if let Some(value) = headers.get(name).and_then(|v| v.to_str().ok()) {
                out_headers.set(name, value)?;
            }
        }
        let mut init = RequestInit::new();
        init.with_method(Method::Post)
            .with_body(Some(JsValue::from(body)))
            .with_headers(out_headers);
        let req = Request::new_with_init(&format!("http://do{path}"), &init)?;
        pass_to_durable_object(env, req, document_id).await
    }

    let req: CopyDocumentRequest = serde_json::from_slice(&body)?;
    let new_document_id = DocumentId::from(req.target_document_id);

    let init_body = {
        let snapshot_req = serde_json::to_vec(&GetSnapshotRequest {
            version_id: req.version_id,
        })?;
        let snapshot_path = format!("/document/{document_id}/snapshot");

        let mut res = do_helper(&env, snapshot_req, &snapshot_path, &headers, &document_id).await?;
        if res.status_code() != status_codes::OK {
            return Ok(response(res.status_code()).into());
        }

        let snapshot = InitializeFromSnapshotRequest {
            snapshot: bebop::SliceWrapper::Raw(&res.bytes().await?),
        };
        let mut buf = Vec::with_capacity(snapshot.serialized_size());
        _ = snapshot
            .serialize(&mut buf)
            .context("Failed to serialize new snapshot")?;
        buf
    };

    let initialize_path = format!("/document/{new_document_id}/initialize");
    Ok(do_helper(
        &env,
        init_body,
        &initialize_path,
        &headers,
        &new_document_id,
    )
    .await?
    .into())
}

pub async fn pass_to_durable_object(
    env: &Env,
    req: Request,
    document_id: &DocumentId,
) -> Result<Response> {
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

fn get_durable_object(env: &Env, document_id: &DocumentId) -> Result<Stub> {
    env.durable_object(DURABLE_OBJECT_NAMESPACE)?
        .id_from_name(document_id.as_str())?
        .get_stub()
}
