//! One HTTP server standing in for the other Macro services the email
//! services call.
//!
//! The authentication service's token routes are answered by the provider
//! emulators' own stand-ins: `email_service` has one authentication service
//! URL, and a stack runs both providers, so this server sends each token
//! request to the emulator that owns it. Every other service
//! (static files, document storage, the connection gateway, notifications)
//! answers `200 {}` and records the request, so a scenario can assert on what
//! the email services told them. On a stack that runs the real
//! `document_storage_service`, its requests are recorded and passed on to it.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex, PoisonError};

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use rootcause::prelude::*;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

#[cfg(test)]
mod test;

/// The path prefix of the authentication service stand-in.
const AUTHENTICATION: &str = "authentication";
/// Where both emulators serve their authentication service stand-in.
const EMULATOR_AUTHENTICATION_PATH: &str = "/_emulator/authentication-service";
/// How long a request passed on to an emulator may take.
const FORWARD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
/// The largest request body the stand-ins read.
const BODY_LIMIT: usize = 32 * 1024 * 1024;

/// A request one of the email services made to another Macro service.
#[derive(Clone, Debug)]
pub struct ServiceRequest {
    /// The service called: `static-files`, `document-storage`
    /// or `connection-gateway`.
    pub service: String,
    /// The HTTP method.
    pub method: String,
    /// The path within the service, with its query string.
    pub path: String,
    /// The body, when it was JSON.
    pub body: Option<serde_json::Value>,
}

#[derive(Clone)]
struct Routes {
    http: reqwest::Client,
    gmail_authentication: String,
    outlook_authentication: String,
    /// Where the stand-ins tell callers to upload bytes: a bucket of the
    /// scenario's object storage.
    uploads_url: String,
    requests: Arc<Mutex<Vec<ServiceRequest>>>,
    gmail_token_requests: GmailTokenRequests,
    failures: Failures,
    holds: Holds,
    /// Cancelled when the stand-in stops, so a request still held then is
    /// let go.
    stopping: CancellationToken,
    document_storage: RealService,
}

/// The method and status of every request for a Gmail access token. The
/// Gmail emulator answers them on its control API, which its request log
/// leaves out, so the evidence of a scenario takes them from here.
type GmailTokenRequests = Arc<Mutex<Vec<(String, u16)>>>;

/// The base URL of a real service that answers in a stand-in's place,
/// once the stack has started it.
type RealService = Arc<Mutex<Option<String>>>;

/// An answer a scenario asked a stand-in to give instead of its usual one.
struct Failure {
    service: String,
    method: String,
    path_prefix: String,
    status: StatusCode,
    body: serde_json::Value,
}

type Failures = Arc<Mutex<Vec<Failure>>>;

/// A request a scenario asked a stand-in to keep waiting.
struct Hold {
    service: String,
    method: String,
    path_prefix: String,
    arrived: oneshot::Sender<()>,
    release: oneshot::Receiver<()>,
}

type Holds = Arc<Mutex<Vec<Hold>>>;

/// A request to another Macro service that waits until the scenario lets
/// it go: what the scenario does meanwhile happens between the caller's
/// request and its answer. Dropping it lets the request go as well.
pub struct HeldRequest {
    arrived: Option<oneshot::Receiver<()>>,
    release: oneshot::Sender<()>,
}

impl HeldRequest {
    /// Waits until the request has been made and is being held.
    pub async fn arrived(&mut self) -> Result<(), Report> {
        match self.arrived.take() {
            Some(arrived) => Ok(arrived
                .await
                .context("the stand-in stopped before the request arrived")?),
            None => Ok(()),
        }
    }

    /// Lets the request go on to its answer.
    pub fn release(self) {
        // The request may already be gone with its stack.
        self.release.send(()).ok();
    }
}

/// The running stand-in server.
pub(crate) struct MacroServices {
    address: SocketAddr,
    requests: Arc<Mutex<Vec<ServiceRequest>>>,
    gmail_token_requests: GmailTokenRequests,
    failures: Failures,
    holds: Holds,
    document_storage: RealService,
    cancel: CancellationToken,
    tracker: TaskTracker,
}

impl MacroServices {
    /// Starts the server. `gmail_url` and `outlook_url` are the emulators'
    /// base URLs.
    pub(crate) async fn start(
        gmail_url: &str,
        outlook_url: &str,
        uploads_url: &str,
    ) -> Result<Self, Report> {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let gmail_token_requests = GmailTokenRequests::default();
        let failures = Failures::default();
        let holds = Holds::default();
        let document_storage = RealService::default();
        let cancel = CancellationToken::new();
        let routes = Routes {
            http: reqwest::Client::builder()
                .timeout(FORWARD_TIMEOUT)
                .build()
                .context("could not build the stand-in's HTTP client")?,
            gmail_authentication: format!("{gmail_url}{EMULATOR_AUTHENTICATION_PATH}"),
            outlook_authentication: format!("{outlook_url}{EMULATOR_AUTHENTICATION_PATH}"),
            uploads_url: uploads_url.to_owned(),
            requests: requests.clone(),
            gmail_token_requests: gmail_token_requests.clone(),
            failures: failures.clone(),
            holds: holds.clone(),
            stopping: cancel.clone(),
            document_storage: document_storage.clone(),
        };

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .context("could not bind the Macro services stand-in")?;
        let address = listener.local_addr()?;
        let app = Router::new().fallback(answer).with_state(routes);

        let tracker = TaskTracker::new();
        let stopped = cancel.clone();
        tracker.spawn(async move {
            let served = axum::serve(listener, app)
                .with_graceful_shutdown(async move { stopped.cancelled().await })
                .await;
            if let Err(error) = served {
                tracing::error!(error = ?error, "the Macro services stand-in stopped");
            }
        });

        Ok(Self {
            address,
            requests,
            gmail_token_requests,
            failures,
            holds,
            document_storage,
            cancel,
            tracker,
        })
    }

    /// The base URL of one stand-in service.
    pub(crate) fn url(&self, service: &str) -> String {
        format!("http://{}/{service}", self.address)
    }

    /// The authentication service stand-in's base URL.
    pub(crate) fn authentication_url(&self) -> String {
        self.url(AUTHENTICATION)
    }

    /// Every request the other stand-ins received, oldest first.
    pub(crate) fn requests(&self) -> Vec<ServiceRequest> {
        self.requests
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Every request for a Gmail access token the authentication stand-in
    /// passed on to the Gmail emulator, oldest first: (method, status).
    pub(crate) fn gmail_token_requests(&self) -> Vec<(String, u16)> {
        self.gmail_token_requests
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Makes the next request to `service` with this method, whose path
    /// starts with `path_prefix`, answer `status` and `body`.
    pub(crate) fn fail_next(
        &self,
        service: &str,
        method: &str,
        path_prefix: &str,
        status: u16,
        body: &serde_json::Value,
    ) -> Result<(), Report> {
        let status = StatusCode::from_u16(status).context("not an HTTP status")?;
        self.failures
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(Failure {
                service: service.to_owned(),
                method: method.to_ascii_uppercase(),
                path_prefix: path_prefix.to_owned(),
                status,
                body: body.clone(),
            });
        Ok(())
    }

    /// Keeps the next request to `service` with this method, whose path
    /// starts with `path_prefix`, waiting until the scenario releases it.
    pub(crate) fn hold_next(&self, service: &str, method: &str, path_prefix: &str) -> HeldRequest {
        let (arrived, has_arrived) = oneshot::channel();
        let (release, released) = oneshot::channel();
        self.holds
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(Hold {
                service: service.to_owned(),
                method: method.to_ascii_uppercase(),
                path_prefix: path_prefix.to_owned(),
                arrived,
                release: released,
            });
        HeldRequest {
            arrived: Some(has_arrived),
            release,
        }
    }

    /// Passes what the email services ask document storage on to the real
    /// service at `url` from now on. Requests are still recorded, and a
    /// failure a scenario asked for is still answered here.
    pub(crate) fn route_document_storage(&self, url: &str) {
        *self
            .document_storage
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(url.to_owned());
    }

    /// Stops the server.
    pub(crate) async fn stop(self) {
        self.cancel.cancel();
        self.tracker.close();
        self.tracker.wait().await;
    }
}

async fn answer(State(routes): State<Routes>, request: Request) -> Response {
    let method = request.method().clone();
    let headers = request.headers().clone();
    let path_and_query = request
        .uri()
        .path_and_query()
        .map(|path| path.as_str().to_owned())
        .unwrap_or_default();
    let Ok(body) = axum::body::to_bytes(request.into_body(), BODY_LIMIT).await else {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    };

    let trimmed = path_and_query.trim_start_matches('/');
    let (service, rest) = trimmed.split_once('/').unwrap_or((trimmed, ""));
    if service == AUTHENTICATION {
        return forward_token_request(&routes, method, &headers, rest, body).await;
    }

    routes
        .requests
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push(ServiceRequest {
            service: service.to_owned(),
            method: method.to_string(),
            path: format!("/{rest}"),
            body: serde_json::from_slice(&body).ok(),
        });
    let path = format!("/{rest}");
    let hold = {
        let mut holds = routes.holds.lock().unwrap_or_else(PoisonError::into_inner);
        holds
            .iter()
            .position(|hold| {
                hold.service == service
                    && hold.method == method.as_str()
                    && path.starts_with(&hold.path_prefix)
            })
            .map(|index| holds.remove(index))
    };
    if let Some(hold) = hold {
        // A scenario that no longer waits has let the request go, and so
        // has a stand-in that is stopping: its shutdown waits for every
        // request in flight.
        hold.arrived.send(()).ok();
        tokio::select! {
            _ = hold.release => {}
            () = routes.stopping.cancelled() => {}
        }
    }
    let failure = {
        let mut failures = routes
            .failures
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        failures
            .iter()
            .position(|failure| {
                failure.service == service
                    && failure.method == method.as_str()
                    && path.starts_with(&failure.path_prefix)
            })
            .map(|index| failures.remove(index))
    };
    if let Some(failure) = failure {
        return (failure.status, axum::Json(failure.body)).into_response();
    }

    if service == DOCUMENT_STORAGE {
        let real = routes
            .document_storage
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        if let Some(real) = real {
            let mut passed_on = headers;
            // The client sets these for the request it makes itself.
            passed_on.remove(axum::http::header::HOST);
            passed_on.remove(axum::http::header::CONTENT_LENGTH);
            return forward(
                &routes.http,
                method,
                passed_on,
                format!("{real}/{rest}"),
                body,
            )
            .await;
        }
    }

    let body: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
    axum::Json(stand_in_answer(
        &routes.uploads_url,
        service,
        &method,
        &body,
    ))
    .into_response()
}

/// Sends an authentication service request to the emulator of the provider
/// its route names, and answers what the emulator answered.
async fn forward_token_request(
    routes: &Routes,
    method: Method,
    headers: &HeaderMap,
    rest: &str,
    body: Bytes,
) -> Response {
    let emulator = if rest.contains("microsoft") {
        &routes.outlook_authentication
    } else {
        &routes.gmail_authentication
    };

    let mut passed_on = HeaderMap::new();
    if let Some(content_type) = headers.get(axum::http::header::CONTENT_TYPE) {
        passed_on.insert(axum::http::header::CONTENT_TYPE, content_type.clone());
    }
    // The route of the authentication service that refreshes a Gmail grant.
    let gmail_token = rest
        .starts_with("internal/google_access_token")
        .then(|| method.to_string());
    let answered = forward(
        &routes.http,
        method,
        passed_on,
        format!("{emulator}/{rest}"),
        body,
    )
    .await;
    if let Some(method) = gmail_token {
        routes
            .gmail_token_requests
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push((method, answered.status().as_u16()));
    }
    answered
}

/// Makes the request at `url` and answers its status, content type and body.
async fn forward(
    http: &reqwest::Client,
    method: Method,
    headers: HeaderMap,
    url: String,
    body: Bytes,
) -> Response {
    let forwarded = http.request(method, &url).headers(headers).body(body);
    let answered = match forwarded.send().await {
        Ok(answered) => answered,
        Err(error) => {
            tracing::error!(error = ?error, url, "could not pass a request on");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };
    let status = answered.status();
    let content_type = answered
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .cloned();
    let Ok(bytes) = answered.bytes().await else {
        return StatusCode::BAD_GATEWAY.into_response();
    };

    let mut response = (status, bytes).into_response();
    if let Some(content_type) = content_type {
        response
            .headers_mut()
            .insert(axum::http::header::CONTENT_TYPE, content_type);
    }
    response
}

/// The static file service's stand-in.
pub(crate) const STATIC_FILES: &str = "static-files";
/// The document storage service's stand-in.
pub(crate) const DOCUMENT_STORAGE: &str = "document-storage";
/// The connection gateway's stand-in.
pub(crate) const CONNECTION_GATEWAY: &str = "connection-gateway";

/// What each service answers, with new ids and an upload address in the
/// scenario's object storage where the real service hands out one.
fn stand_in_answer(
    uploads_url: &str,
    service: &str,
    method: &Method,
    body: &serde_json::Value,
) -> serde_json::Value {
    let id = uuid::Uuid::now_v7();
    match (service, method) {
        (STATIC_FILES, &Method::PUT) => serde_json::json!({
            "id": id,
            "upload_url": format!("{uploads_url}/{STATIC_FILES}/{id}"),
            "file_location": format!("{uploads_url}/{STATIC_FILES}/{id}"),
        }),
        (DOCUMENT_STORAGE, &Method::POST) => serde_json::json!({
            "error": false,
            "data": {
                "documentMetadata": {
                    "documentId": id,
                    "documentVersionId": 1,
                    "owner": "macro|document-storage@example.com",
                    "documentName": body["documentName"],
                    "createdAt": null,
                    "updatedAt": null,
                },
                "presignedUrl": format!("{uploads_url}/{DOCUMENT_STORAGE}/{id}"),
                "contentType": body["mimeType"].as_str().unwrap_or("application/octet-stream"),
                "fileType": body["fileType"],
            },
        }),
        (CONNECTION_GATEWAY, _) => serde_json::json!({ "receipts": [] }),
        _ => serde_json::json!({}),
    }
}
