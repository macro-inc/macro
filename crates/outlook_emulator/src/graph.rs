//! The Graph v1.0 API: what every request passes (access token, faults,
//! the mailbox's request limit), and the table of routes.

mod batch;
mod calendar;
mod compose;
mod folders;
mod messages;
mod people;
mod subscriptions;
mod uploads;

use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, RawQuery, Request, State as AxumState};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use chrono::{DateTime, Utc};
use nom::Parser;
use nom::bytes::complete::{tag, take_until, take_while1};
use nom::combinator::all_consuming;
use nom::sequence::delimited;
use serde_json::{Value, json};

use crate::error::GraphError;
use crate::fault::Route;
use crate::mailbox::Mailbox;
use crate::odata::Query;
use crate::state::State;
use crate::{OutlookEmulator, RequestRecord};

pub(crate) const API_VERSION: &str = "v1.0";
const CONTROL_PREFIX: &str = "/_emulator";
const DEFAULT_PAGE_SIZE: usize = 10;
const MAX_PAGE_SIZE: usize = 1000;
/// What Graph's front end answers a write that names no body length.
const LENGTH_REQUIRED_PAGE: &str = "<!DOCTYPE HTML PUBLIC \"-//W3C//DTD HTML 4.01//EN\"\"http://www.w3.org/TR/html4/strict.dtd\">\r\n<HTML><HEAD><TITLE>Length Required</TITLE></HEAD>\r\n<BODY><h2>Length Required</h2>\r\n<hr><p>HTTP Error 411. The request must be chunked or have a content length.</p>\r\n</BODY></HTML>\r\n";

/// One Graph request, as the route table reads it.
pub(crate) struct Call {
    pub(crate) method: Method,
    /// The path after the API version, with OData keys (`mailFolders('x')`)
    /// split into their own segments.
    pub(crate) segments: Vec<String>,
    pub(crate) pairs: Vec<(String, String)>,
    pub(crate) if_match: Option<String>,
    pub(crate) content_range: Option<String>,
    /// The `odata.maxpagesize` of the request's `Prefer` headers.
    pub(crate) max_page_size: Option<usize>,
    pub(crate) body: Vec<u8>,
    /// The API root links are built on, such as `http://127.0.0.1:1/v1.0`.
    pub(crate) root: String,
}

impl Call {
    pub(crate) fn new(
        method: Method,
        path: &str,
        raw_query: Option<&str>,
        headers: &HeaderMap,
        body: Vec<u8>,
        root: String,
    ) -> Self {
        let text = |name: header::HeaderName| {
            headers
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string)
        };
        Self {
            method,
            segments: segments(path),
            pairs: serde_urlencoded::from_str(raw_query.unwrap_or_default()).unwrap_or_default(),
            if_match: text(header::IF_MATCH),
            content_range: text(header::CONTENT_RANGE),
            max_page_size: max_page_size(headers),
            body,
            root,
        }
    }
}

/// `name('key')`, the OData form of `name/key`.
fn keyed(segment: &str) -> Option<(&str, &str)> {
    let name = take_while1::<_, &str, nom::error::Error<&str>>(|c: char| c.is_ascii_alphanumeric());
    let key = delimited(tag("('"), take_until("')"), tag("')"));
    all_consuming((name, key))
        .parse(segment)
        .ok()
        .map(|(_, parts)| parts)
}

fn segments(path: &str) -> Vec<String> {
    let mut segments = Vec::new();
    for segment in path.split('/').filter(|segment| !segment.is_empty()) {
        match keyed(segment) {
            Some((name, key)) => segments.extend([name.to_string(), key.to_string()]),
            None => segments.push(segment.to_string()),
        }
    }
    segments
}

/// What a route answers.
pub(crate) enum Reply {
    Json(u16, Value),
    Bytes(String, Vec<u8>),
    Empty(u16),
}

pub(crate) type Handled = Result<Reply, GraphError>;

/// A request inside its mailbox, while the state is locked.
pub(crate) struct Ctx<'a> {
    pub(crate) state: &'a mut State,
    /// The mailbox the access token belongs to. Empty for an upload URL,
    /// which carries no token.
    pub(crate) email: String,
    pub(crate) call: &'a Call,
    pub(crate) query: Query,
    pub(crate) now: DateTime<Utc>,
    route: Option<Route>,
    delay: Option<Duration>,
}

impl Ctx<'_> {
    /// Names the route the request matched, then applies injected faults
    /// and the mailbox's request limit.
    pub(crate) fn enter(&mut self, route: Route) -> Result<(), GraphError> {
        self.route = Some(route);
        let email = (!self.email.is_empty()).then_some(self.email.as_str());
        if let Some(fault) = self.state.take_fault(email, route) {
            self.delay = fault.delay_ms.map(Duration::from_millis);
            if let Some(error) = fault.error {
                return Err(error.graph_error(fault.retry_after_seconds));
            }
        }
        let now_ms = self.state.now_ms();
        if let Some(mailbox) = self.state.mailboxes.get_mut(&self.email) {
            mailbox
                .admit(now_ms)
                .map_err(|seconds| GraphError::throttled("RequestRate", Some(seconds)))?;
        }
        Ok(())
    }

    pub(crate) fn mailbox(&mut self) -> Result<&mut Mailbox, GraphError> {
        self.state
            .mailboxes
            .get_mut(&self.email)
            .ok_or_else(GraphError::item_not_found)
    }

    pub(crate) fn json_body(&self) -> Result<Value, GraphError> {
        serde_json::from_slice(&self.call.body).map_err(|_| {
            GraphError::bad_request(
                "Unable to read JSON request payload. Please ensure Content-Type header is set \
                 and payload is of valid JSON format.",
            )
        })
    }

    /// A link back to this API: the root, a path and query parameters.
    pub(crate) fn link(&self, path: &str, pairs: &[(String, String)]) -> String {
        let query = serde_urlencoded::to_string(pairs).unwrap_or_default();
        format!("{}/{path}?{query}", self.call.root)
    }

    pub(crate) fn context(&self, entity: &str) -> String {
        format!("{}/$metadata#{entity}", self.call.root)
    }

    /// One page of a collection by `$skip` and `$top`, and the link to the
    /// next page when there is one.
    pub(crate) fn page<T>(&self, items: Vec<T>) -> (Vec<T>, Option<String>) {
        let top = self
            .query
            .top
            .unwrap_or(DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE);
        let total = items.len();
        let page: Vec<T> = items.into_iter().skip(self.query.skip).take(top).collect();
        let next_skip = self.query.skip + page.len();
        if next_skip >= total {
            return (page, None);
        }
        let mut pairs: Vec<(String, String)> = self
            .call
            .pairs
            .iter()
            .filter(|(name, _)| !name.eq_ignore_ascii_case("$skip"))
            .cloned()
            .collect();
        if self.query.top.is_none() {
            pairs.push(("$top".to_string(), top.to_string()));
        }
        pairs.push(("$skip".to_string(), next_skip.to_string()));
        let path = self.call.segments.join("/");
        (page, Some(self.link(&path, &pairs)))
    }

    /// A collection response.
    pub(crate) fn collection(
        &self,
        entity: &str,
        values: Vec<Value>,
        next: Option<String>,
    ) -> Reply {
        let mut body = json!({"@odata.context": self.context(entity), "value": values});
        if let Some(next) = next {
            body["@odata.nextLink"] = json!(next);
        }
        Reply::Json(200, body)
    }
}

/// What the request log and the HTTP layer learn about a served request.
pub(crate) struct Served {
    pub(crate) route: Option<Route>,
    pub(crate) mailbox: Option<String>,
    pub(crate) delay: Option<Duration>,
    pub(crate) result: Handled,
}

/// The page size a request's `Prefer: odata.maxpagesize=N` asks for.
fn max_page_size(headers: &HeaderMap) -> Option<usize> {
    headers
        .get_all("prefer")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .find_map(|preference| preference.trim().strip_prefix("odata.maxpagesize="))
        .and_then(|size| size.trim().parse().ok())
}

pub(crate) fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

/// Resolves the request's access token and query, before any route runs.
pub(crate) fn open<'a>(
    state: &'a mut State,
    token: Option<&str>,
    call: &'a Call,
) -> Result<Ctx<'a>, (Option<String>, GraphError)> {
    // An upload URL is preauthorized: it carries no bearer token.
    let anonymous = call
        .segments
        .first()
        .is_some_and(|first| first == uploads::SEGMENT);
    let email = match (anonymous, token) {
        (true, _) => String::new(),
        (false, None) => {
            return Err((None, GraphError::unauthenticated("Access token is empty.")));
        }
        (false, Some(token)) => state.token_owner(token).map_err(|error| (None, error))?,
    };
    let mailbox = (!email.is_empty()).then(|| email.clone());
    let query = Query::parse(&call.pairs).map_err(|error| (mailbox, error))?;
    let now = state.now();
    Ok(Ctx {
        state,
        email,
        call,
        query,
        now,
        route: None,
        delay: None,
    })
}

impl Ctx<'_> {
    /// What the request log learns, once the route has answered.
    pub(crate) fn served(self, result: Handled) -> Served {
        Served {
            route: self.route,
            mailbox: (!self.email.is_empty()).then_some(self.email),
            delay: self.delay,
            result,
        }
    }
}

/// Serves one request against the locked state.
pub(crate) fn serve(state: &mut State, token: Option<&str>, call: &Call) -> Served {
    match open(state, token, call) {
        Ok(mut ctx) => {
            let result = route(&mut ctx);
            ctx.served(result)
        }
        Err((mailbox, error)) => Served {
            route: None,
            mailbox,
            delay: None,
            result: Err(error),
        },
    }
}

/// The route table. `me` and `users/{id}` name the token's own mailbox.
fn route(ctx: &mut Ctx<'_>) -> Handled {
    let call = ctx.call;
    let all: Vec<&str> = call.segments.iter().map(String::as_str).collect();
    let rest = match all.as_slice() {
        ["me", rest @ ..] => rest,
        ["users", user, rest @ ..] => {
            let mailbox = ctx.mailbox()?;
            if !user.eq_ignore_ascii_case(&mailbox.user_id)
                && !user.eq_ignore_ascii_case(&mailbox.email)
            {
                return Err(GraphError::access_denied());
            }
            rest
        }
        other => return top_level(ctx, other),
    };

    use Route as R;
    let method = &call.method;
    match rest {
        [] if method == Method::GET => {
            ctx.enter(R::MeGet)?;
            people::me(ctx)
        }
        ["photo", "$value"] if method == Method::GET => {
            ctx.enter(R::MePhoto)?;
            people::my_photo(ctx)
        }

        ["mailFolders"] if method == Method::GET => {
            ctx.enter(R::FoldersList)?;
            folders::list(ctx, None)
        }
        ["mailFolders"] if method == Method::POST => {
            ctx.enter(R::FoldersCreate)?;
            folders::create(ctx, None)
        }
        ["mailFolders", "inbox", "messageRules"] if method == Method::GET => {
            ctx.enter(R::RulesList)?;
            folders::rules(ctx)
        }
        ["mailFolders", "inbox", "messageRules"] if method == Method::POST => {
            ctx.enter(R::RulesCreate)?;
            folders::create_rule(ctx)
        }
        ["mailFolders", "inbox", "messageRules", rule] if method == Method::DELETE => {
            ctx.enter(R::RulesDelete)?;
            folders::delete_rule(ctx, rule)
        }
        ["mailFolders", folder] if method == Method::GET => {
            ctx.enter(R::FoldersGet)?;
            folders::get(ctx, folder)
        }
        ["mailFolders", folder, "childFolders"] if method == Method::GET => {
            ctx.enter(R::FoldersList)?;
            folders::list(ctx, Some(folder))
        }
        ["mailFolders", folder, "childFolders"] if method == Method::POST => {
            ctx.enter(R::FoldersCreate)?;
            folders::create(ctx, Some(folder))
        }
        ["mailFolders", folder, "messages"] if method == Method::GET => {
            ctx.enter(R::MessagesList)?;
            messages::list(ctx, Some(folder))
        }
        ["mailFolders", folder, "messages"] if method == Method::POST => {
            ctx.enter(R::MessagesCreate)?;
            compose::create(ctx, Some(folder))
        }
        ["mailFolders", folder, "messages", "delta"] if method == Method::GET => {
            ctx.enter(R::MessagesDelta)?;
            messages::delta(ctx, folder)
        }
        ["mailFolders", _, "messages", id, action @ ..] => message(ctx, id, action),

        ["messages"] if method == Method::GET => {
            ctx.enter(R::MessagesList)?;
            messages::list(ctx, None)
        }
        ["messages"] if method == Method::POST => {
            ctx.enter(R::MessagesCreate)?;
            compose::create(ctx, None)
        }
        ["messages", id, action @ ..] => message(ctx, id, action),
        ["sendMail"] if method == Method::POST => {
            ctx.enter(R::SendMail)?;
            compose::send_mail(ctx)
        }

        ["outlook", "masterCategories"] if method == Method::GET => {
            ctx.enter(R::CategoriesList)?;
            folders::categories(ctx)
        }
        ["outlook", "masterCategories"] if method == Method::POST => {
            ctx.enter(R::CategoriesCreate)?;
            folders::create_category(ctx)
        }
        ["outlook", "masterCategories", category] if method == Method::DELETE => {
            ctx.enter(R::CategoriesDelete)?;
            folders::delete_category(ctx, category)
        }

        ["mailboxSettings"] if method == Method::GET => {
            ctx.enter(R::MailboxSettingsGet)?;
            calendar::mailbox_settings(ctx)
        }
        ["calendars"] if method == Method::GET => {
            ctx.enter(R::CalendarsList)?;
            calendar::list_calendars(ctx)
        }
        ["calendars", id] if method == Method::GET => {
            ctx.enter(R::CalendarsGet)?;
            calendar::get_calendar(ctx, id)
        }
        ["calendarView", "delta"] if method == Method::GET => {
            ctx.enter(R::CalendarViewDelta)?;
            calendar::view_delta(ctx)
        }
        ["calendars", id, "calendarView"] if method == Method::GET => {
            ctx.enter(R::CalendarViewList)?;
            calendar::calendar_view(ctx, id)
        }
        ["calendars", id, "events"] if method == Method::GET => {
            ctx.enter(R::EventsList)?;
            calendar::list_events(ctx, id)
        }
        ["calendars", id, "events"] if method == Method::POST => {
            ctx.enter(R::EventsCreate)?;
            calendar::create_event(ctx, id)
        }
        ["calendars", calendar, "events", id] if method == Method::GET => {
            ctx.enter(R::EventsGet)?;
            calendar::get_event(ctx, Some(calendar), id)
        }
        [
            "calendars",
            calendar,
            "events",
            id,
            action @ ("accept" | "tentativelyAccept" | "decline"),
        ] if method == Method::POST => {
            ctx.enter(R::EventsRespond)?;
            calendar::respond(ctx, Some(calendar), id, action)
        }
        ["events", id] if method == Method::GET => {
            ctx.enter(R::EventsGet)?;
            calendar::get_event(ctx, None, id)
        }
        ["events", id] if method == Method::PATCH => {
            ctx.enter(R::EventsUpdate)?;
            calendar::update_event(ctx, id)
        }
        ["events", id] if method == Method::DELETE => {
            ctx.enter(R::EventsDelete)?;
            calendar::delete_event(ctx, id)
        }
        ["events", id, "instances"] if method == Method::GET => {
            ctx.enter(R::EventsInstances)?;
            calendar::instances(ctx, id)
        }
        [
            "events",
            id,
            action @ ("accept" | "tentativelyAccept" | "decline"),
        ] if method == Method::POST => {
            ctx.enter(R::EventsRespond)?;
            calendar::respond(ctx, None, id, action)
        }

        ["contactFolders"] | ["contactFolders", _, "childFolders"] if method == Method::GET => {
            ctx.enter(R::ContactFoldersList)?;
            people::contact_folders(ctx)
        }
        ["contacts"] if method == Method::GET => {
            ctx.enter(R::ContactsList)?;
            people::contacts(ctx)
        }
        ["contactFolders", folder, "contacts", "delta"] if method == Method::GET => {
            ctx.enter(R::ContactsDelta)?;
            people::contacts_delta(ctx, folder)
        }
        ["contactFolders", _, "contacts", _, "photo", "$value"] if method == Method::GET => {
            ctx.enter(R::ContactsPhoto)?;
            Err(GraphError::server(
                404,
                "ErrorItemNotFound",
                "The specified object was not found in the store., The contact has no photo.",
            ))
        }

        other => Err(unknown(other)),
    }
}

/// `/me/messages/{id}` and what hangs off it.
fn message(ctx: &mut Ctx<'_>, id: &str, action: &[&str]) -> Handled {
    use Route as R;
    let method = &ctx.call.method;
    match action {
        [] if method == Method::GET => {
            ctx.enter(R::MessagesGet)?;
            messages::get(ctx, id)
        }
        [] if method == Method::PATCH => {
            ctx.enter(R::MessagesUpdate)?;
            messages::update(ctx, id)
        }
        [] if method == Method::DELETE => {
            ctx.enter(R::MessagesDelete)?;
            messages::delete(ctx, id)
        }
        ["$value"] if method == Method::GET => {
            ctx.enter(R::MessagesValue)?;
            messages::value(ctx, id)
        }
        ["move"] if method == Method::POST => {
            ctx.enter(R::MessagesMove)?;
            messages::move_or_copy(ctx, id, false)
        }
        ["copy"] if method == Method::POST => {
            ctx.enter(R::MessagesCopy)?;
            messages::move_or_copy(ctx, id, true)
        }
        ["send"] if method == Method::POST => {
            ctx.enter(R::MessagesSend)?;
            compose::send(ctx, id)
        }
        [kind @ ("createReply" | "createReplyAll")] if method == Method::POST => {
            ctx.enter(R::MessagesCreateReply)?;
            compose::create_response(ctx, id, compose::kind(kind), false)
        }
        ["createForward"] if method == Method::POST => {
            ctx.enter(R::MessagesCreateForward)?;
            compose::create_response(ctx, id, compose::Kind::Forward, false)
        }
        [kind @ ("reply" | "replyAll")] if method == Method::POST => {
            ctx.enter(R::MessagesReply)?;
            compose::create_response(ctx, id, compose::kind(kind), true)
        }
        ["forward"] if method == Method::POST => {
            ctx.enter(R::MessagesForward)?;
            compose::create_response(ctx, id, compose::Kind::Forward, true)
        }
        ["attachments"] if method == Method::GET => {
            ctx.enter(R::AttachmentsList)?;
            messages::attachments(ctx, id)
        }
        ["attachments"] if method == Method::POST => {
            ctx.enter(R::AttachmentsCreate)?;
            compose::add_attachment(ctx, id)
        }
        ["attachments", "createUploadSession"] if method == Method::POST => {
            ctx.enter(R::UploadsCreate)?;
            uploads::create(ctx, id)
        }
        ["attachments", attachment] if method == Method::GET => {
            ctx.enter(R::AttachmentsGet)?;
            messages::attachment(ctx, id, attachment, false)
        }
        ["attachments", attachment, "$value"] if method == Method::GET => {
            ctx.enter(R::AttachmentsValue)?;
            messages::attachment(ctx, id, attachment, true)
        }
        ["attachments", attachment] if method == Method::DELETE => {
            ctx.enter(R::AttachmentsDelete)?;
            compose::delete_attachment(ctx, id, attachment)
        }
        other => Err(unknown(other)),
    }
}

/// Routes outside a mailbox path. Creating a subscription is not here: it
/// calls the subscriber, so it cannot run while the state is locked.
fn top_level(ctx: &mut Ctx<'_>, segments: &[&str]) -> Handled {
    use Route as R;
    let method = &ctx.call.method;
    match segments {
        ["subscriptions"] if method == Method::GET => {
            ctx.enter(R::SubscriptionsList)?;
            subscriptions::list(ctx)
        }
        ["subscriptions", id] if method == Method::PATCH => {
            ctx.enter(R::SubscriptionsUpdate)?;
            subscriptions::update(ctx, id)
        }
        ["subscriptions", id] if method == Method::DELETE => {
            ctx.enter(R::SubscriptionsDelete)?;
            subscriptions::delete(ctx, id)
        }
        [uploads::SEGMENT, id] if method == Method::GET => {
            ctx.enter(R::UploadsGet)?;
            uploads::status(ctx, id)
        }
        [uploads::SEGMENT, id] if method == Method::PUT => {
            ctx.enter(R::UploadsPut)?;
            uploads::put(ctx, id)
        }
        [uploads::SEGMENT, id] if method == Method::DELETE => {
            ctx.enter(R::UploadsDelete)?;
            uploads::cancel(ctx, id)
        }
        other => Err(unknown(other)),
    }
}

fn unknown(segments: &[&str]) -> GraphError {
    GraphError::unknown_segment(segments.first().copied().unwrap_or_default())
}

/// A request id in the shape of Graph's.
fn request_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// The HTTP response of a served request, with Graph's headers.
pub(crate) fn response(result: Handled, date: DateTime<Utc>) -> Response {
    let id = request_id();
    let mut response = match result {
        Ok(Reply::Json(status, body)) => (status_code(status), axum::Json(body)).into_response(),
        Ok(Reply::Bytes(content_type, bytes)) => {
            let content_type = HeaderValue::from_str(&content_type)
                .unwrap_or(HeaderValue::from_static("application/octet-stream"));
            ([(header::CONTENT_TYPE, content_type)], bytes).into_response()
        }
        Ok(Reply::Empty(status)) => status_code(status).into_response(),
        Err(error) => {
            let body = error.body(&id, &crate::render::time(date));
            let mut response = (status_code(error.status), axum::Json(body)).into_response();
            if let Some(seconds) = error.retry_after_seconds {
                response
                    .headers_mut()
                    .insert(header::RETRY_AFTER, HeaderValue::from(seconds));
            }
            response
        }
    };
    if let Ok(id) = HeaderValue::from_str(&id) {
        response.headers_mut().insert("request-id", id.clone());
        response.headers_mut().insert("client-request-id", id);
    }
    response
}

fn status_code(status: u16) -> StatusCode {
    StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
}

/// What a handler tells the request log.
#[derive(Clone, Debug)]
pub(crate) struct Logged {
    pub(crate) route: Option<Route>,
    pub(crate) mailbox: Option<String>,
}

pub(crate) fn logged(
    mut response: Response,
    route: Option<Route>,
    mailbox: Option<String>,
) -> Response {
    response.extensions_mut().insert(Logged { route, mailbox });
    response
}

async fn graph(
    AxumState(emulator): AxumState<OutlookEmulator>,
    Path(path): Path<String>,
    RawQuery(raw_query): RawQuery,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let call = Call::new(
        method,
        &path,
        raw_query.as_deref(),
        &headers,
        body.to_vec(),
        emulator.graph_url(),
    );
    if lacks_length(&call.method, &headers) {
        return logged(length_required(), None, None);
    }
    let token = bearer(&headers);
    let segments: Vec<&str> = call.segments.iter().map(String::as_str).collect();
    match (&call.method, segments.as_slice()) {
        (&Method::POST, ["subscriptions"]) => subscriptions::create(&emulator, token, &call).await,
        (&Method::POST, ["$batch"]) => batch::serve_batch(&emulator, token, &call).await,
        _ => {
            let (served, date) =
                emulator.with_state(|state| (serve(state, token, &call), state.now()));
            if let Some(delay) = served.delay {
                tokio::time::sleep(delay).await;
            }
            logged(response(served.result, date), served.route, served.mailbox)
        }
    }
}

/// Whether a write names no body length. A client that sends a `POST` or
/// `PATCH` with no body (`/send`, `/createReply`) and leaves `Content-Length`
/// out is refused by Graph's front end before the request reaches a mailbox.
fn lacks_length(method: &Method, headers: &HeaderMap) -> bool {
    matches!(*method, Method::POST | Method::PATCH)
        && !headers.contains_key(header::CONTENT_LENGTH)
        && !headers.contains_key(header::TRANSFER_ENCODING)
}

/// The front end's 411 page: HTML, with no Graph error code.
fn length_required() -> Response {
    (
        StatusCode::LENGTH_REQUIRED,
        [(header::CONTENT_TYPE, "text/html; charset=us-ascii")],
        LENGTH_REQUIRED_PAGE,
    )
        .into_response()
}

pub(crate) fn router() -> Router<OutlookEmulator> {
    Router::new().route(&format!("/{API_VERSION}/{{*path}}"), any(graph))
}

/// Records every provider request, with the route and mailbox its handler
/// reported.
pub(crate) async fn log_request(
    AxumState(emulator): AxumState<OutlookEmulator>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().to_string();
    let path = request
        .uri()
        .path_and_query()
        .map_or_else(|| request.uri().path().to_string(), ToString::to_string);
    let response = next.run(request).await;
    let logged = response.extensions().get::<Logged>().cloned();
    // The control API is not a provider request; the authentication-service
    // stand-in under it is, and reports itself.
    if path.starts_with(CONTROL_PREFIX) && logged.is_none() {
        return response;
    }

    let status = response.status().as_u16();
    tracing::debug!(%method, %path, status, "outlook emulator request");
    emulator.with_state(|state| {
        let at = state.now();
        state.requests.push(RequestRecord {
            at,
            method,
            path,
            route: logged.as_ref().and_then(|logged| logged.route),
            mailbox: logged.and_then(|logged| logged.mailbox),
            status,
        });
    });
    response
}
