//! One-hop HTTP transport, preserving the public request for owner-side checks.
use crate::domain::{PreviewError, ports::PeerConnection};
use axum::{body::Body, extract::Request, response::Response};
use hyper_util::rt::TokioIo;
use std::time::Duration;
use tracing::Instrument;
/// A routing marker grants no authentication. Any marked request needing a second hop is refused.
pub(super) const FORWARDED: &str = "x-macro-preview-hop";

#[tracing::instrument(skip_all, err)]
pub(super) async fn forward(
    mut request: Request,
    peer: PeerConnection,
) -> Result<Response, PreviewError> {
    let PeerConnection {
        stream,
        permit,
        upgrade_permit,
    } = peer;
    let upgrade = request.headers().get(axum::http::header::UPGRADE).is_some();
    // Connection tokens are client-controlled. Normalize this hop so they
    // cannot designate our routing marker (or auth/origin fields) for removal.
    request.headers_mut().remove(axum::http::header::CONNECTION);
    if upgrade {
        request.headers_mut().insert(
            axum::http::header::CONNECTION,
            axum::http::HeaderValue::from_static("upgrade"),
        );
    }
    request
        .headers_mut()
        .insert(FORWARDED, axum::http::HeaderValue::from_static("1"));
    macro_tower_layers::inject_trace_headers(request.headers_mut());
    *request.uri_mut() = request
        .uri()
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/")
        .parse()
        .map_err(|_| PreviewError::Invalid)?;
    let downstream = upgrade.then(|| hyper::upgrade::on(&mut request));
    let (mut sender, connection) = hyper::client::conn::http1::Builder::new()
        .max_headers(64)
        .max_buf_size(32 * 1024)
        .handshake(TokioIo::new(stream))
        .await
        .map_err(|_| PreviewError::Unavailable)?;
    let connection_permit = permit.clone();
    tokio::spawn(
        async move {
            let _permit = connection_permit;
            if let Err(error) = connection.with_upgrades().await {
                tracing::debug!(?error, "preview peer connection ended");
            }
        }
        .instrument(tracing::Span::current()),
    );
    let mut response = tokio::time::timeout(Duration::from_secs(30), sender.send_request(request))
        .await
        .map_err(|_| PreviewError::Unavailable)?
        .map_err(|_| PreviewError::Unavailable)?;
    if response.status() == axum::http::StatusCode::SWITCHING_PROTOCOLS {
        let downstream = downstream.ok_or(PreviewError::Invalid)?;
        let upstream = hyper::upgrade::on(&mut response);
        tokio::spawn(
            async move {
                let _permit = permit;
                let _upgrade_permit = upgrade_permit;
                let upgraded = tokio::time::timeout(Duration::from_secs(10), async {
                    Ok::<_, hyper::Error>((downstream.await?, upstream.await?))
                })
                .await;
                if let Ok(Ok((downstream, upstream))) = upgraded {
                    let _ = tokio::io::copy_bidirectional(
                        &mut TokioIo::new(downstream),
                        &mut TokioIo::new(upstream),
                    )
                    .await;
                }
            }
            .instrument(tracing::Span::current()),
        );
    }
    Ok(response.map(Body::new))
}
