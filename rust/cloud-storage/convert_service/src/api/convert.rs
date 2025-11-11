use std::{fs::File, io::Write, str::FromStr, thread, time::Duration};

use anyhow::Context;
use axum::{
    Json, Router,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use model::{
    convert::ConvertRequest,
    document::FileType,
    response::{EmptyResponse, ErrorResponse},
};
use nix::{
    libc::exit,
    unistd::{ForkResult, fork},
};
use rs_libreoffice_bindings::Office;

use crate::{
    config::LOK_PATH,
    utils::{cleanup_folder, get_lok_filter_from_file_types},
};

use super::context::ApiContext;

/// Convert call
#[utoipa::path(
        post,
        path = "/internal/convert",
        operation_id = "convert",
        security(
            ("internal" = [])
        ),
        responses(
            (status = 200, description = "convert", body = EmptyResponse),
            (status = 400, description = "invalid request", body = ErrorResponse),
            (status = 401, description = "unauthorized", body = ErrorResponse),
            (status = 500, description = "internal server error", body = ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    extract::Json(req): extract::Json<ConvertRequest>,
) -> Result<Response, Response> {
    let job_id = macro_uuid::generate_uuid_v7().to_string();

    tracing::info!(job_id=%job_id, "starting conversion job");

    let from_file_type: FileType = req
        .from_key
        .split('.')
        .next_back()
        .context("expected key to contain a file type")
        .and_then(|s| FileType::from_str(s).map_err(anyhow::Error::from))
        .map_err(|e| {
            tracing::error!(error=?e, job_id=%job_id, "unable to get file type");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get file type",
                }),
            )
                .into_response()
        })?;

    let to_file_type: FileType = req
        .to_key
        .split('.')
        .next_back()
        .context("expected key to contain a file type")
        .and_then(|s| FileType::from_str(s).map_err(anyhow::Error::from))
        .map_err(|e| {
            tracing::error!(error=?e, job_id=%job_id, "unable to get file type");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get file type",
                }),
            )
                .into_response()
        })?;

    let filter = get_lok_filter_from_file_types(&from_file_type, &to_file_type).map_err(|e| {
        tracing::error!(error=?e, job_id=%job_id, "unable to get lok filter");
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: &e.to_string(),
            }),
        )
            .into_response()
    })?;

    // Make directory of job_id
    let file_content = ctx
        .s3_client
        .get(&req.from_bucket, &req.from_key)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, job_id=%job_id, "unable to get object from S3");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get object from S3",
                }),
            )
                .into_response()
        })?;

    std::fs::create_dir(format!("./{}", job_id)).map_err(|e| {
        tracing::error!(error=?e, job_id=%job_id, "unable to create directory");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to create directory",
            }),
        )
            .into_response()
    })?;

    let mut file =
        File::create(format!("./{}/IN.{}", job_id, from_file_type.as_str())).map_err(|e| {
            tracing::error!(error=?e, job_id=%job_id, "unable to create file");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to create file",
                }),
            )
                .into_response()
        })?;

    file.write_all(&file_content).map_err(|e| {
        tracing::error!(error=?e, job_id=%job_id, "unable to write file");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to write file",
            }),
        )
            .into_response()
    })?;

    let in_file_path = format!("./{}/IN.{}", job_id, from_file_type.as_str());
    let out_file_path = format!("./{}/OUT.{}", job_id, to_file_type.as_str());

    let office_path = &*LOK_PATH;
    let mut child_pids = vec![];
    match unsafe { fork() } {
        Ok(ForkResult::Parent { child }) => {
            tracing::info!(job_id=%job_id, "parent process: spawned child with PID: {}", child);
            child_pids.push(child);
        }
        Ok(ForkResult::Child) => unsafe {
            tracing::info!(job_id=%job_id, "child process: initializing lok");
            std::env::set_var("SAL_LOG", "");
            let result: anyhow::Result<()> = (|| {
                let office = Office::new(office_path)
                    .map_err(|e| anyhow::anyhow!(e))
                    .context("unable to initialize lok")?;
                let document = office
                    .load_document(&in_file_path)
                    .map_err(|e| anyhow::anyhow!(e))
                    .context("unable to load document")?;
                document
                    .save_as(&out_file_path, to_file_type.as_str(), &filter)
                    .map_err(|e| anyhow::anyhow!(e))
                    .context("unable to save document")?;

                drop(document);
                drop(office);
                Ok(())
            })();

            match result {
                Ok(_) => exit(0),
                Err(e) => {
                    tracing::error!(job_id=%job_id, error=?e, "unable to convert");
                    exit(1)
                }
            }
        },
        Err(err) => {
            tracing::error!(job_id=%job_id, error=?err, "fork failed");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "fork failed",
                }),
            )
                .into_response());
        }
    }

    let mut status_code = 1;
    loop {
        if child_pids.is_empty() {
            break;
        }

        thread::sleep(Duration::from_millis(100));

        // check for completed children
        child_pids.retain(|&pid| {
            match nix::sys::wait::waitpid(
                nix::unistd::Pid::from_raw(pid.into()),
                Some(nix::sys::wait::WaitPidFlag::WNOHANG),
            ) {
                Ok(nix::sys::wait::WaitStatus::StillAlive) => true,
                Ok(nix::sys::wait::WaitStatus::Exited(_, status)) => {
                    tracing::debug!(job_id=%job_id, status=status, "pid {} completed", pid);
                    status_code = status;
                    false
                }
                _ => {
                    tracing::warn!(job_id=%job_id, "pid {} completed without exiting", pid);
                    false
                }
            }
        });
    }

    if status_code != 0 {
        tracing::error!(job_id=%job_id, status=status_code, "conversion failed with non-zero status code");
        if let Err(e) = cleanup_folder(&job_id) {
            tracing::error!(error=?e, job_id=%job_id, "unable to cleanup folder");
        }
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "conversion failed",
            }),
        )
            .into_response());
    }

    let file_content = std::fs::read(out_file_path).map_err(|e| {
        tracing::error!(error=?e, job_id=%job_id, "unable to read file");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to read file",
            }),
        )
            .into_response()
    })?;

    ctx.s3_client
        .put(&req.to_bucket, &req.to_key, &file_content)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, job_id=%job_id, "unable to upload file");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to upload file",
                }),
            )
                .into_response()
        })?;

    if let Err(e) = cleanup_folder(&job_id) {
        tracing::error!(error=?e, job_id=%job_id, "unable to cleanup folder");
    }

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}

pub fn router() -> Router<ApiContext> {
    Router::new().route("/", post(handler))
}
