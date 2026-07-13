use bebop::{Record, SubRecord};
use tracing::error;
use wasm_bindgen::JsValue;
use worker::{Env, Error, Headers, Method, Request, RequestInit, Response, Result, Stub};

use crate::{
    constants::header_names::{AUTHORIZATION, MACRO_INTERNAL_AUTH_KEY_HEADER_KEY},
    durable_object::{CopyDocumentRequest, GetSnapshotRequest, response, status_codes},
    error::ResultExt,
    generated::schema::InitializeFromSnapshotRequest,
    timeit_log,
    timeout::{DEFAULT_TIMEOUT_MS, timeout},
};
use std::sync::LazyLock;

const DURABLE_OBJECT_NAMESPACE: &str = "DOCUMENT_SYNC_SESSION";
mod markers {
    pub const ROOT: &str = "root";
    pub const HEALTH: &str = "health";
    pub const SCHEMA: &str = "schema";
    pub const COPY: &str = "copy";
    pub const REST: &str = "rest";
}

pub async fn router(env: Env, req: Request) -> Result<Response> {
    let url = req.url()?;
    let matched = ROUTER
        .at(url.path())
        .with_context(|| format!("MatchError on url [{url}]"))?;
    match *matched.value {
        markers::ROOT => Response::builder().ok("Hello Sync Service!"),
        markers::HEALTH => Response::builder().ok("healthy"),
        markers::SCHEMA => Response::builder().ok(include_str!("../bebop/schema.bop")),
        needs_document_id => {
            let document_id = matched.params.get("document_id").with_context(|| {
                Error::from(format!(
                    "Failed to get path parameter [doocument_id] from url: [{}]",
                    url.as_ref()
                ))
            })?;
            match needs_document_id {
                markers::COPY => copy_handler(env, req, document_id).await,
                markers::REST => pass_to_durable_object(&env, req, document_id).await,
                _ => Ok(response(status_codes::NOT_FOUND)),
            }
        }
    }
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

    let initialize_path = format!("/document/{}/initialize", new_document_id);
    let ss_res = do_helper(&env, init_body, &initialize_path, &req, &new_document_id).await?;
    Ok(ss_res)
}

pub static ROUTER: LazyLock<matchit::Router<&str>> = LazyLock::new(|| {
    let mut router = matchit::Router::new();
    router
        .insert("/", markers::ROOT)
        .unwrap_context("Router.insert failed");
    router
        .insert("/health", markers::HEALTH)
        .unwrap_context("Router.insert failed");
    router
        .insert("/schema", markers::SCHEMA)
        .unwrap_context("Router.insert failed");
    router
        .insert("/document/{document_id}/copy", markers::COPY)
        .unwrap_context("Router.insert failed");
    router
        .insert("/document/{document_id}/{*rest}", markers::REST)
        .unwrap_context("Router.insert failed");
    router
});

pub async fn pass_to_durable_object(
    env: &Env,
    req: Request,
    document_id: &str,
) -> Result<Response> {
    let stub = get_durable_object(env, document_id)?;

    let fut = timeout(stub.fetch_with_request(req), DEFAULT_TIMEOUT_MS);
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
