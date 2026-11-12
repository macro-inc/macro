//! HTTP and websocket routes.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::ws::{Message as Frame, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRequest, Multipart, Path, Query, Request, State as Extract};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::Shared;
use crate::login;
use crate::state::{Injected, LoginMagic, RecordedCall, Socket, SocketCommand};
use crate::web_api::{self, Caller, Fields, error};

pub(crate) fn router(shared: Arc<Shared>) -> Router {
    Router::new()
        .route("/api/{method}", post(api).get(api_get))
        .route("/cache/{team}/users/info", post(edge_users_info))
        .route("/magic/{team}", get(magic_link))
        .route("/client/{team}", get(client_page))
        .route("/auth", get(app_auth))
        .route("/upload/{file}", post(upload))
        .route("/files/{file}/{name}", get(download))
        .route("/websocket/", get(websocket))
        .with_state(shared)
}

fn cookies(headers: &HeaderMap) -> BTreeMap<String, String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .map(|(name, value)| (name.to_owned(), value.to_owned()))
        .collect()
}

fn decoded_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    cookies(headers).get(name).map(|value| percent_decode(value))
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let hex = bytes.get(index + 1..index + 3).and_then(|hex| std::str::from_utf8(hex).ok());
        match (bytes[index], hex.and_then(|hex| u8::from_str_radix(hex, 16).ok())) {
            (b'%', Some(byte)) => {
                decoded.push(byte);
                index += 3;
            }
            (byte, _) => {
                decoded.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

async fn read_fields(request: Request) -> Option<Fields> {
    let is_multipart = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("multipart/form-data"));
    if is_multipart {
        let mut multipart = Multipart::from_request(request, &()).await.ok()?;
        let mut fields = Fields::new();
        while let Ok(Some(field)) = multipart.next_field().await {
            let name = field.name().unwrap_or_default().to_owned();
            let value = field.text().await.ok()?;
            fields.insert(name, value);
        }
        Some(fields)
    } else {
        let axum::Form(pairs) = axum::Form::<Vec<(String, String)>>::from_request(request, &()).await.ok()?;
        Some(pairs.into_iter().collect())
    }
}

fn json_response(body: Value, set_cookies: &[String]) -> Response {
    let mut response = axum::Json(body).into_response();
    for cookie in set_cookies {
        if let Ok(value) = cookie.parse() {
            response.headers_mut().append(header::SET_COOKIE, value);
        }
    }
    response
}

/// Checks the token and `d` cookie of a signed-in call.
fn authenticate(shared: &Shared, token: Option<&str>, headers: &HeaderMap) -> Result<Caller, Value> {
    let Some(token) = token.filter(|token| !token.is_empty()) else {
        return Err(error("not_authed"));
    };
    let state = shared.lock();
    let Some(session) = state.sessions.get(token) else {
        return Err(error("invalid_auth"));
    };
    if let Some(code) = &session.ended {
        return Err(error(code));
    }
    if decoded_cookie(headers, "d").as_deref() != Some(session.cookie.as_str()) {
        return Err(error("invalid_auth"));
    }
    Ok(Caller {
        user_id: session.user_id.clone(),
        team_id: session.team_id.clone(),
        token: token.to_owned(),
    })
}

async fn api(Extract(shared): Extract<Arc<Shared>>, Path(method): Path<String>, request: Request) -> Response {
    let headers = request.headers().clone();
    let Some(mut fields) = read_fields(request).await else {
        return json_response(error("invalid_form_data"), &[]);
    };
    let token = fields.remove("token");
    let injected = {
        let mut state = shared.lock();
        state.calls.push(RecordedCall {
            method: method.clone(),
            fields: fields.clone(),
        });
        state.injected.remove(&method)
    };
    shared.changed();
    match injected {
        Some(Injected::Error(code)) => return json_response(error(&code), &[]),
        Some(Injected::RateLimited { retry_after_seconds }) => {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                [(header::RETRY_AFTER, retry_after_seconds.to_string())],
                axum::Json(error("ratelimited")),
            )
                .into_response();
        }
        None => {}
    }

    let login = login::call(&mut shared.lock(), &method, &fields, &cookies(&headers));
    if let Some(login) = login {
        shared.changed();
        return json_response(login.body, &login.set_cookies);
    }

    let caller = match authenticate(&shared, token.as_deref(), &headers) {
        Ok(caller) => caller,
        Err(body) => return json_response(body, &[]),
    };
    let body = web_api::call(&mut shared.lock(), &method, &fields, &caller);
    shared.changed();
    json_response(body, &[])
}

/// `GET /api/auth.loginMagicBulk`: exchanges a magic login code for the
/// workspace's session (token in the body, `d` cookie set).
async fn api_get(
    Extract(shared): Extract<Arc<Shared>>,
    Path(method): Path<String>,
    Query(query): Query<BTreeMap<String, String>>,
) -> Response {
    if method != "auth.loginMagicBulk" {
        return json_response(error("unknown_method"), &[]);
    }
    let magic = query.get("magic_tokens").cloned().unwrap_or_default();
    let state = shared.lock();
    let Some(workspace) = login::workspace_by_magic(&state, &magic) else {
        return json_response(error("invalid_magic_token"), &[]);
    };
    let body = json!({
        "ok": true,
        "token_results": {
            magic.clone(): {
                "ok": true,
                "token": workspace.token,
                "team": { "id": workspace.team_id, "name": workspace.name, "domain": workspace.domain },
            },
        },
    });
    json_response(body, &login::session_cookies(workspace))
}

/// A magic link: sets the session cookie and redirects to the client page.
async fn magic_link(Extract(shared): Extract<Arc<Shared>>, Path(team): Path<String>) -> Response {
    let state = shared.lock();
    let workspace = state
        .login_accounts
        .iter()
        .flat_map(|account| &account.workspaces)
        .find(|workspace| workspace.team_id == team && workspace.magic == LoginMagic::Link);
    let Some(workspace) = workspace else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut response = (StatusCode::FOUND, [(header::LOCATION, format!("/client/{team}"))]).into_response();
    for cookie in login::session_cookies(workspace) {
        if let Ok(value) = cookie.parse() {
            response.headers_mut().append(header::SET_COOKIE, value);
        }
    }
    response
}

/// The client page; like Slack's it doesn't always hold the token.
async fn client_page() -> Response {
    ([(header::CONTENT_TYPE, "text/html")], "<html><body>Slack</body></html>").into_response()
}

/// `GET /auth?teams=T`: the app hands the signed-in browser its token.
async fn app_auth(
    Extract(shared): Extract<Arc<Shared>>,
    Query(query): Query<BTreeMap<String, String>>,
    headers: HeaderMap,
) -> Response {
    let team = query.get("teams").cloned().unwrap_or_default();
    let cookie = decoded_cookie(&headers, "d");
    let state = shared.lock();
    let token = state
        .login_accounts
        .iter()
        .flat_map(|account| &account.workspaces)
        .find(|workspace| workspace.team_id == team && Some(&workspace.cookie) == cookie.as_ref())
        .map(|workspace| workspace.token.clone());
    match token {
        Some(token) => json_response(json!({ "ok": true, "teams": { team: { "token": token } } }), &[]),
        None => json_response(json!({ "ok": true, "teams": {} }), &[]),
    }
}

async fn edge_users_info(
    Extract(shared): Extract<Arc<Shared>>,
    Path(_team): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Ok(body) = serde_json::from_slice::<Value>(&body) else {
        return json_response(error("invalid_json"), &[]);
    };
    let token = body.get("token").and_then(Value::as_str);
    if let Err(error) = authenticate(&shared, token, &headers) {
        return json_response(error, &[]);
    }
    let requested: Vec<String> = body
        .get("updated_ids")
        .and_then(Value::as_object)
        .map(|ids| ids.keys().cloned().collect())
        .unwrap_or_default();
    let mut state = shared.lock();
    state.calls.push(RecordedCall {
        method: "edgeapi.users.info".to_owned(),
        fields: requested.iter().map(|id| (id.clone(), String::new())).collect(),
    });
    let results: Vec<Value> = requested.iter().filter_map(|id| state.users.get(id).cloned()).collect();
    drop(state);
    shared.changed();
    json_response(json!({ "ok": true, "results": results }), &[])
}

async fn upload(Extract(shared): Extract<Arc<Shared>>, Path(file): Path<String>, body: Bytes) -> Response {
    let mut state = shared.lock();
    let Some(stored) = state.files.get_mut(&file) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    stored.bytes = body.to_vec();
    drop(state);
    shared.changed();
    "OK - 0".into_response()
}

async fn download(
    Extract(shared): Extract<Arc<Shared>>,
    Path((file, _name)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let sign_in_page = ([(header::CONTENT_TYPE, "text/html")], "<html>Sign in</html>").into_response();
    if authenticate(&shared, token, &headers).is_err() {
        return sign_in_page;
    }
    let state = shared.lock();
    let Some(stored) = state.files.get(&file) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let content_type = stored
        .info
        .get("mimetype")
        .and_then(Value::as_str)
        .unwrap_or("application/octet-stream")
        .to_owned();
    ([(header::CONTENT_TYPE, content_type)], Body::from(stored.bytes.clone())).into_response()
}

async fn websocket(
    Extract(shared): Extract<Arc<Shared>>,
    Query(query): Query<BTreeMap<String, String>>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if shared.lock().reject_sockets {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let caller = match authenticate(&shared, query.get("token").map(String::as_str), &headers) {
        Ok(caller) => caller,
        Err(_) => return StatusCode::UNAUTHORIZED.into_response(),
    };
    upgrade.on_upgrade(move |socket| serve_socket(shared, socket, caller))
}

async fn serve_socket(shared: Arc<Shared>, mut socket: WebSocket, caller: Caller) {
    let (commands, mut received) = mpsc::unbounded_channel();
    let base = shared.lock().base_url.replacen("http://", "ws://", 1);
    let hello = json!({ "type": "hello" });
    let reconnect = json!({
        "type": "reconnect_url",
        "url": format!("{base}websocket/?token={}&resume=1", caller.token),
    });
    for frame in [hello, reconnect] {
        if socket.send(Frame::text(frame.to_string())).await.is_err() {
            return;
        }
    }
    {
        let mut state = shared.lock();
        state.sockets.push(Socket {
            user_id: caller.user_id.clone(),
            commands,
        });
        state.socket_connections += 1;
    }
    shared.changed();

    let cancel = shared.cancel.clone();
    loop {
        tokio::select! {
            () = cancel.cancelled() => break,
            command = received.recv() => match command {
                Some(SocketCommand::Send(event)) => {
                    if socket.send(Frame::text(event.to_string())).await.is_err() {
                        break;
                    }
                }
                Some(SocketCommand::Goodbye) => {
                    let _ = socket.send(Frame::text(json!({ "type": "goodbye" }).to_string())).await;
                    break;
                }
                Some(SocketCommand::Close) | None => break,
            },
            frame = socket.recv() => match frame {
                Some(Ok(Frame::Text(text))) => {
                    let Ok(frame) = serde_json::from_str::<Value>(&text) else {
                        continue;
                    };
                    if frame.get("type") == Some(&json!("ping")) {
                        let pong = json!({ "type": "pong", "reply_to": frame.get("id"), "ts": frame.get("ts") });
                        if socket.send(Frame::text(pong.to_string())).await.is_err() {
                            break;
                        }
                    }
                }
                Some(Ok(_)) => {}
                Some(Err(_)) | None => break,
            },
        }
    }
    let _ = socket.send(Frame::Close(None)).await;
}
