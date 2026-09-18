use crate::domain::{Budget, Lease, PreviewError, PreviewService, ports::Stream};
use axum::{
    Router,
    body::Body,
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::any,
};
use http_body_util::Limited;
use hyper_util::rt::TokioIo;
use std::{
    future::Future,
    io,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

const COOKIE: &str = "__Host-macro-preview";
const AUTH_PATH: &str = "/.macro-preview/auth";

impl IntoResponse for PreviewError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::Invalid => StatusCode::BAD_REQUEST,
            Self::Denied => StatusCode::FORBIDDEN,
            Self::Offline => StatusCode::GONE,
            Self::Limited => StatusCode::TOO_MANY_REQUESTS,
            Self::Unavailable => StatusCode::BAD_GATEWAY,
        };
        (
            status,
            [
                (header::CACHE_CONTROL, "no-store"),
                (header::REFERRER_POLICY, "no-referrer"),
            ],
            self.to_string(),
        )
            .into_response()
    }
}
/// Public listener. Mount only on the isolated preview domain, never a Macro cookie domain.
pub fn router(service: PreviewService) -> Router {
    Router::new().fallback(any(handle)).with_state(service)
}
async fn handle(
    State(service): State<PreviewService>,
    mut request: Request,
) -> Result<Response, PreviewError> {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .ok_or(PreviewError::Invalid)?
        .to_ascii_lowercase();
    let settings = service.settings();
    let suffix = if settings.https_port == 443 {
        format!(".{}", settings.domain)
    } else {
        format!(".{}:{}", settings.domain, settings.https_port)
    };
    let id = host
        .strip_suffix(&suffix)
        .filter(|s| s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or(PreviewError::Invalid)?
        .to_owned();
    let origin = settings.origin(&id);
    if request.uri().path() == AUTH_PATH {
        if request.method() != Method::POST
            || request
                .headers()
                .get(header::ORIGIN)
                .and_then(|v| v.to_str().ok())
                != Some(settings.app_origin.as_str())
        {
            return Err(PreviewError::Denied);
        }
        let body = tokio::time::timeout(
            Duration::from_secs(10),
            axum::body::to_bytes(request.into_body(), 1024),
        )
        .await
        .map_err(|_| PreviewError::Invalid)?
        .map_err(|_| PreviewError::Invalid)?;
        let ticket = url::form_urlencoded::parse(&body)
            .find(|(k, _)| k == "ticket")
            .map(|(_, v)| v.into_owned())
            .ok_or(PreviewError::Invalid)?;
        let cookie = service.redeem(&id, &ticket).await?;
        return Ok((
            StatusCode::SEE_OTHER,
            [
                (
                    header::SET_COOKIE,
                    format!(
                        "{COOKIE}={cookie}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600"
                    ),
                ),
                (header::LOCATION, "/".into()),
                (header::CACHE_CONTROL, "no-store".into()),
                (header::REFERRER_POLICY, "no-referrer".into()),
                (
                    header::CONTENT_SECURITY_POLICY,
                    "default-src 'none'; frame-ancestors 'none'".into(),
                ),
            ],
        )
            .into_response());
    }
    // Disallow cross-origin unsafe requests and upgrades; host-only cookies alone do not prevent CSRF.
    let upgrade = request
        .headers()
        .get(header::UPGRADE)
        .is_some_and(|v| v.as_bytes().eq_ignore_ascii_case(b"websocket"));
    if request.method() == Method::CONNECT
        || (request.headers().contains_key(header::UPGRADE) && !upgrade)
    {
        return Err(PreviewError::Invalid);
    }
    let incoming_origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let navigation = matches!(*request.method(), Method::GET | Method::HEAD)
        && request
            .headers()
            .get("sec-fetch-mode")
            .is_some_and(|v| v == "navigate")
        && request
            .headers()
            .get("sec-fetch-dest")
            .is_some_and(|v| v == "document");
    if !navigation
        && (incoming_origin
            .as_deref()
            .is_some_and(|value| value != origin)
            || ((upgrade
                || !matches!(
                    *request.method(),
                    Method::GET | Method::HEAD | Method::OPTIONS
                ))
                && incoming_origin.is_none())
            || request
                .headers()
                .get("sec-fetch-site")
                .is_some_and(|v| v == "cross-site"))
    {
        return Err(PreviewError::Denied);
    }
    let cookie = cookie_value(request.headers()).ok_or(PreviewError::Denied)?;
    let lease = service.viewer(&id, &cookie, true).await?;
    let permit = Arc::new(
        lease
            .requests
            .clone()
            .try_acquire_owned()
            .map_err(|_| PreviewError::Limited)?,
    );
    let upgrade_permit = if upgrade {
        Some(
            lease
                .upgrades
                .clone()
                .try_acquire_owned()
                .map_err(|_| PreviewError::Limited)?,
        )
    } else {
        None
    };
    let upstream = format!("localhost:{}", lease.port());
    clean_request(request.headers_mut(), &host, &origin, &upstream, upgrade)?;
    // Hyper's client sends origin-form URIs. Preserve the exact application path and query.
    *request.uri_mut() = request
        .uri()
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/")
        .parse()
        .map_err(|_| PreviewError::Invalid)?;
    let downstream_upgrade = if upgrade {
        Some(hyper::upgrade::on(&mut request))
    } else {
        None
    };
    let stream = lease.tunnel()?.open().await?;
    let stream = Metered {
        inner: stream,
        budget: lease.budget.clone(),
        read_wait: None,
        write_wait: None,
    };
    let (mut sender, connection) = hyper::client::conn::http1::Builder::new()
        .max_headers(64)
        .max_buf_size(32 * 1024)
        .handshake(TokioIo::new(stream))
        .await
        .map_err(|_| PreviewError::Unavailable)?;
    let cancel = lease.cancel.clone();
    let (parts, body) = request.into_parts();
    let request =
        hyper::Request::from_parts(parts, Body::new(Limited::new(body, 16 * 1024 * 1024)));
    // The permit must live through the response body, not merely its headers.
    let connection_permit = permit.clone();
    let connection_service = service.clone();
    let connection_id = id.clone();
    let connection_cookie = cookie.clone();
    tokio::spawn(async move {
        let _permit = connection_permit;
        let connection = connection.with_upgrades();
        tokio::pin!(connection);
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = &mut connection => break,
                _ = tokio::time::sleep(Duration::from_secs(30)) => {
                    if connection_service.viewer(&connection_id, &connection_cookie, false).await.is_err() { break; }
                }
            }
        }
    });
    let mut response = tokio::time::timeout(Duration::from_secs(30), sender.send_request(request))
        .await
        .map_err(|_| PreviewError::Unavailable)?
        .map_err(|_| PreviewError::Unavailable)?;
    if response.status() == StatusCode::SWITCHING_PROTOCOLS {
        let downstream = downstream_upgrade.ok_or(PreviewError::Invalid)?;
        let upstream_upgrade = hyper::upgrade::on(&mut response);
        let lease = lease.clone();
        tokio::spawn(async move {
            let _request_permit = permit;
            let _upgrade_permit = upgrade_permit;
            let upgraded = tokio::time::timeout(Duration::from_secs(10), async {
                Ok::<_, hyper::Error>((downstream.await?, upstream_upgrade.await?))
            })
            .await;
            let Ok(Ok((downstream, upstream))) = upgraded else {
                return;
            };
            let mut downstream = TokioIo::new(downstream);
            let mut upstream = TokioIo::new(upstream);
            // Revoke already-open sockets as well as future handshakes. HMR pings do not renew idle leases.
            let copy = tokio::io::copy_bidirectional(&mut downstream, &mut upstream);
            tokio::pin!(copy);
            loop {
                tokio::select! {
                    _ = lease.cancel.cancelled() => break,
                    _ = &mut copy => break,
                    _ = tokio::time::sleep(Duration::from_secs(30)) => {
                        if service.viewer(&id, &cookie, false).await.is_err() { break; }
                    }
                }
            }
        });
    }
    let upgraded = response.status() == StatusCode::SWITCHING_PROTOCOLS;
    clean_response(response.headers_mut(), &origin, &upstream, upgraded);
    Ok(response.map(Body::new))
}
fn cookie_value(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|part| {
            let (name, value) = part.trim().split_once('=')?;
            (name.trim() == COOKIE && value.len() <= 128).then(|| value.to_owned())
        })
}
fn clean_request(
    headers: &mut HeaderMap,
    host: &str,
    origin: &str,
    upstream: &str,
    upgrade: bool,
) -> Result<(), PreviewError> {
    let cookies = headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter(|p| {
            p.trim()
                .split_once('=')
                .is_some_and(|(name, _)| name.trim() != COOKIE)
        })
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("; ");
    headers.remove(header::COOKIE);
    if !cookies.is_empty() {
        headers.insert(
            header::COOKIE,
            HeaderValue::from_str(&cookies).map_err(|_| PreviewError::Invalid)?,
        );
    }
    strip_hop_headers(headers);
    let remove: Vec<_> = headers
        .keys()
        .filter(|k| k.as_str().starts_with("x-forwarded-") || k.as_str().starts_with("x-macro-"))
        .cloned()
        .collect();
    for key in remove {
        headers.remove(key);
    }
    headers.remove("forwarded");
    headers.insert(
        header::HOST,
        HeaderValue::from_str(upstream).map_err(|_| PreviewError::Invalid)?,
    );
    headers.insert(
        "x-forwarded-host",
        HeaderValue::from_str(host).map_err(|_| PreviewError::Invalid)?,
    );
    headers.insert("x-forwarded-proto", HeaderValue::from_static("https"));
    if headers.get(header::ORIGIN).is_some_and(|v| v == origin) {
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_str(&format!("http://{upstream}"))
                .map_err(|_| PreviewError::Invalid)?,
        );
    }
    if upgrade {
        headers.insert(header::CONNECTION, HeaderValue::from_static("upgrade"));
        headers.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
    }
    Ok(())
}
fn strip_hop_headers(headers: &mut HeaderMap) {
    let named: Vec<String> = headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .map(|v| v.trim().to_owned())
        .collect();
    for name in named {
        headers.remove(name);
    }
    for name in [
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ] {
        headers.remove(name);
    }
}
fn clean_response(headers: &mut HeaderMap, origin: &str, upstream: &str, upgrade: bool) {
    let cookies: Vec<_> = headers
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|cookie| {
            let mut parts = cookie.split(';');
            let pair = parts.next()?;
            if pair
                .trim()
                .split_once('=')
                .is_some_and(|(name, _)| name.trim() == COOKIE)
            {
                return None;
            }
            let parts = std::iter::once(pair).chain(parts.filter(|p| {
                !p.trim()
                    .split_once('=')
                    .is_some_and(|(k, _)| k.eq_ignore_ascii_case("domain"))
            }));
            HeaderValue::from_str(&parts.collect::<Vec<_>>().join(";")).ok()
        })
        .collect();
    headers.remove(header::SET_COOKIE);
    for cookie in cookies {
        headers.append(header::SET_COOKIE, cookie);
    }
    strip_hop_headers(headers);
    if upgrade {
        headers.insert(header::CONNECTION, HeaderValue::from_static("upgrade"));
        headers.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
    }
    if let Some(location) = headers.get(header::LOCATION).and_then(|v| v.to_str().ok()) {
        let local = format!("http://{upstream}");
        if let Some(path) = location.strip_prefix(&local).filter(|p| {
            p.is_empty() || p.starts_with('/') || p.starts_with('?') || p.starts_with('#')
        }) && let Ok(value) = HeaderValue::from_str(&format!("{origin}{path}"))
        {
            headers.insert(header::LOCATION, value);
        }
    }
    // The gateway serves private developer content, even if the app marks it public.
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
}
struct Metered {
    inner: Stream,
    budget: Arc<Budget>,
    read_wait: Option<Pin<Box<tokio::time::Sleep>>>,
    write_wait: Option<Pin<Box<tokio::time::Sleep>>>,
}
fn wait(wait: &mut Option<Pin<Box<tokio::time::Sleep>>>, cx: &mut Context<'_>) -> Poll<()> {
    if let Some(sleep) = wait
        && sleep.as_mut().poll(cx).is_pending()
    {
        return Poll::Pending;
    }
    *wait = None;
    Poll::Ready(())
}
impl AsyncRead for Metered {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if wait(&mut self.read_wait, cx).is_pending() {
            return Poll::Pending;
        }
        let before = buf.filled().len();
        let result = Pin::new(&mut self.inner).poll_read(cx, buf);
        if matches!(result, Poll::Ready(Ok(()))) {
            match self.budget.bytes(buf.filled().len() - before) {
                Ok(delay) => self.read_wait = Some(Box::pin(tokio::time::sleep(delay))),
                Err(_) => return Poll::Ready(Err(io::Error::other("preview byte limit"))),
            }
        }
        result
    }
}
impl AsyncWrite for Metered {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        if wait(&mut self.write_wait, cx).is_pending() {
            return Poll::Pending;
        }
        let result = Pin::new(&mut self.inner).poll_write(cx, &buf[..buf.len().min(32 * 1024)]);
        if let Poll::Ready(Ok(count)) = result {
            match self.budget.bytes(count) {
                Ok(delay) => self.write_wait = Some(Box::pin(tokio::time::sleep(delay))),
                Err(_) => return Poll::Ready(Err(io::Error::other("preview byte limit"))),
            }
        }
        result
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}
/// Readiness probe traverses the actual forwarded HTTP server, without following redirects.
pub(super) async fn probe(lease: &Arc<Lease>) -> Result<(), PreviewError> {
    tokio::time::timeout(Duration::from_secs(3), async {
        let stream = lease.tunnel()?.open().await?;
        let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
            .await
            .map_err(|_| PreviewError::Unavailable)?;
        let task = tokio_util::task::AbortOnDropHandle::new(tokio::spawn(connection));
        let request = hyper::Request::builder()
            .method(Method::HEAD)
            .uri("/")
            .header(header::HOST, format!("localhost:{}", lease.port()))
            .body(Body::empty())
            .map_err(|_| PreviewError::Invalid)?;
        let result = sender
            .send_request(request)
            .await
            .map(|_| ())
            .map_err(|_| PreviewError::Unavailable);
        task.abort();
        result
    })
    .await
    .map_err(|_| PreviewError::Unavailable)?
}

#[cfg(test)]
mod test;
