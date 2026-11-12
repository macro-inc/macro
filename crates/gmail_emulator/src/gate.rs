//! What every Google API request passes before its handler: the access
//! token, injected faults and the mailbox's quota. Also the request log.

use std::time::Duration;

use axum::extract::{Request, State as AxumState};
use axum::http::{HeaderMap, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::error::ApiError;
use crate::fault::Route;
use crate::state::State;
use crate::{GmailEmulator, RequestRecord};

const CONTROL_PREFIX: &str = "/_emulator";

/// What a handler tells the request log about the request it served.
#[derive(Clone, Debug)]
pub(crate) struct Served {
    pub(crate) route: Route,
    pub(crate) mailbox: Option<String>,
}

/// A request's query parameters, which Google repeats for lists.
pub(crate) struct Params(pub(crate) Vec<(String, String)>);

impl Params {
    pub(crate) fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    pub(crate) fn all(&self, name: &str) -> Vec<String> {
        self.0
            .iter()
            .filter(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
            .collect()
    }

    pub(crate) fn flag(&self, name: &str) -> bool {
        self.get(name) == Some("true")
    }

    /// A page size: the default when absent, capped at `max`.
    pub(crate) fn page_size(&self, name: &str, default: usize, max: usize) -> usize {
        self.get(name)
            .and_then(|value| value.parse::<usize>().ok())
            .map_or(default, |size| size.clamp(1, max))
    }

    /// The offset a `pageToken` names.
    pub(crate) fn offset(&self) -> Result<usize, ApiError> {
        match self.get("pageToken") {
            None => Ok(0),
            Some(token) => token
                .parse()
                .map_err(|_| ApiError::invalid_argument("Invalid pageToken")),
        }
    }
}

pub(crate) fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

fn tagged(mut response: Response, route: Route, mailbox: Option<String>) -> Response {
    response.extensions_mut().insert(Served { route, mailbox });
    response
}

/// Applies the first matching fault: its error, and how long to wait.
pub(crate) fn fault(
    state: &mut State,
    mailbox: Option<&str>,
    route: Route,
) -> (Option<ApiError>, Option<Duration>) {
    let Some(fault) = state.take_fault(mailbox, route) else {
        return (None, None);
    };
    (
        State::fault_error(&fault),
        fault.delay_ms.map(Duration::from_millis),
    )
}

/// Serves one mailbox request: resolves the access token to its mailbox,
/// applies faults and quota, then runs the handler with the mailbox's
/// address.
pub(crate) async fn mailbox_request<T: IntoResponse>(
    emulator: &GmailEmulator,
    headers: &HeaderMap,
    user_id: Option<&str>,
    route: Route,
    handler: impl FnOnce(&mut State, &str) -> Result<T, ApiError>,
) -> Response {
    let Some(token) = bearer(headers) else {
        return tagged(ApiError::unauthenticated().into_response(), route, None);
    };

    let (mailbox, delay, result) = emulator.with_state(|state| {
        let Some(email) = state
            .token_owner(token)
            .map(|(mailbox, _)| mailbox.email.clone())
        else {
            return (None, None, Err(ApiError::unauthenticated()));
        };
        if user_id.is_some_and(|user| user != "me" && !user.eq_ignore_ascii_case(&email)) {
            let denied = ApiError::permission_denied(&format!("Delegation denied for {email}"));
            return (Some(email), None, Err(denied));
        }

        let (error, delay) = fault(state, Some(&email), route);
        if let Some(error) = error {
            return (Some(email), delay, Err(error));
        }

        let now_ms = state.now_ms();
        let spent = state.mailboxes.get_mut(&email).map_or(Ok(()), |mailbox| {
            mailbox.spend_quota(now_ms, route.quota_units())
        });
        if let Err(retry_after_seconds) = spent {
            let limited = ApiError::rate_limited(
                "User-rate limit exceeded.  Retry later.",
                Some(retry_after_seconds),
            );
            return (Some(email), delay, Err(limited));
        }

        let result = handler(state, &email);
        (Some(email), delay, result)
    });

    if let Some(delay) = delay {
        tokio::time::sleep(delay).await;
    }
    let response = match result {
        Ok(body) => body.into_response(),
        Err(error) => error.into_response(),
    };
    tagged(response, route, mailbox)
}

/// Serves a request that has no mailbox token, such as a token refresh.
pub(crate) async fn open_request(
    emulator: &GmailEmulator,
    route: Route,
    handler: impl FnOnce(&mut State) -> (Option<String>, Response),
) -> Response {
    let (mailbox, delay, response) = emulator.with_state(|state| {
        let (mailbox, response) = handler(state);
        let (error, delay) = fault(state, mailbox.as_deref(), route);
        match error {
            Some(error) => (mailbox, delay, error.into_response()),
            None => (mailbox, delay, response),
        }
    });

    if let Some(delay) = delay {
        tokio::time::sleep(delay).await;
    }
    tagged(response, route, mailbox)
}

/// Records every Google API request, with the route and mailbox its
/// handler reported.
pub(crate) async fn log_request(
    AxumState(emulator): AxumState<GmailEmulator>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().to_string();
    let path = request
        .uri()
        .path_and_query()
        .map_or_else(|| request.uri().path().to_string(), ToString::to_string);
    let response = next.run(request).await;
    if path.starts_with(CONTROL_PREFIX) {
        return response;
    }

    let served = response.extensions().get::<Served>().cloned();
    let status = response.status().as_u16();
    tracing::debug!(%method, %path, status, "gmail emulator request");
    emulator.with_state(|state| {
        let at = state.now();
        state.requests.push(RequestRecord {
            at,
            method,
            path,
            route: served.as_ref().map(|served| served.route),
            mailbox: served.and_then(|served| served.mailbox),
            status,
        });
    });
    response
}
