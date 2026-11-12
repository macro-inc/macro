//! Web API methods for signed-in sessions.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use crate::state::{State, StoredFile};

/// Form fields of a call.
pub(crate) type Fields = BTreeMap<String, String>;

/// Who is calling.
pub(crate) struct Caller {
    pub(crate) user_id: String,
    pub(crate) team_id: String,
    pub(crate) token: String,
}

fn ok(mut body: Value) -> Value {
    if let Some(object) = body.as_object_mut() {
        object.insert("ok".to_owned(), json!(true));
    }
    body
}

pub(crate) fn error(code: &str) -> Value {
    json!({ "ok": false, "error": code })
}

fn field<'fields>(fields: &'fields Fields, name: &str) -> Option<&'fields str> {
    fields
        .get(name)
        .map(String::as_str)
        .filter(|value| !value.is_empty())
}

fn limit(fields: &Fields) -> usize {
    field(fields, "limit")
        .and_then(|limit| limit.parse().ok())
        .unwrap_or(100)
}

fn offset(fields: &Fields) -> usize {
    field(fields, "cursor")
        .and_then(|cursor| cursor.strip_prefix("offset:"))
        .and_then(|offset| offset.parse().ok())
        .unwrap_or(0)
}

/// Pages `items` with `offset:N` cursors.
fn page(items: Vec<Value>, fields: &Fields) -> (Vec<Value>, Option<String>) {
    let start = offset(fields).min(items.len());
    let end = (start + limit(fields)).min(items.len());
    let next = (end < items.len()).then(|| format!("offset:{end}"));
    (items[start..end].to_vec(), next)
}

fn is_thread_reply(message: &Value) -> bool {
    match (message.get("thread_ts"), message.get("ts")) {
        (Some(thread_ts), Some(ts)) => {
            thread_ts != ts && message.get("subtype") != Some(&json!("thread_broadcast"))
        }
        _ => false,
    }
}

fn in_range(ts: &str, fields: &Fields) -> bool {
    let inclusive = field(fields, "inclusive") == Some("true");
    let after_oldest =
        field(fields, "oldest").is_none_or(|oldest| ts > oldest || (inclusive && ts == oldest));
    let before_latest =
        field(fields, "latest").is_none_or(|latest| ts < latest || (inclusive && ts == latest));
    after_oldest && before_latest
}

fn ts_of(message: &Value) -> &str {
    message
        .get("ts")
        .and_then(Value::as_str)
        .unwrap_or_default()
}

/// Dispatches one Web API call.
pub(crate) fn call(state: &mut State, method: &str, fields: &Fields, caller: &Caller) -> Value {
    match method {
        "auth.test" => {
            let team_name = state
                .teams
                .get(&caller.team_id)
                .and_then(|team| team.get("name"))
                .cloned();
            let user_name = state
                .users
                .get(&caller.user_id)
                .and_then(|user| user.get("name"))
                .cloned();
            ok(json!({
                "url": state.base_url,
                "team": team_name,
                "user": user_name,
                "team_id": caller.team_id,
                "user_id": caller.user_id,
            }))
        }
        "auth.signout" => {
            if let Some(session) = state.sessions.get_mut(&caller.token) {
                session.ended = Some("token_revoked".to_owned());
            }
            ok(json!({}))
        }
        "client.userBoot" => user_boot(state, caller),
        "client.counts" => counts(state, caller),
        "users.conversations" => users_conversations(state, fields, caller),
        "conversations.info" => match field(fields, "channel")
            .and_then(|channel| state.conversation_for(channel, &caller.user_id))
        {
            Some(channel) => ok(json!({ "channel": channel })),
            None => error("channel_not_found"),
        },
        "conversations.view" => conversation_view(state, fields, caller),
        "conversations.members" => {
            match field(fields, "channel").and_then(|channel| state.conversations.get(channel)) {
                Some(conversation) => {
                    let members = conversation
                        .members
                        .iter()
                        .map(|member| json!(member))
                        .collect();
                    let (members, next) = page(members, fields);
                    ok(
                        json!({ "members": members, "response_metadata": { "next_cursor": next.unwrap_or_default() } }),
                    )
                }
                None => error("channel_not_found"),
            }
        }
        "conversations.history" => history(state, fields),
        "conversations.replies" => replies(state, fields),
        "conversations.mark" => mark(state, fields, caller),
        "subscriptions.thread.mark" => mark_thread(state, fields, caller),
        "chat.postMessage" => post_message(state, fields, caller),
        "chat.update" => update_message(state, fields, caller),
        "chat.delete" => delete_message(state, fields, caller),
        "reactions.add" => react(state, fields, caller, true),
        "reactions.remove" => react(state, fields, caller, false),
        "files.getUploadURLExternal" => upload_url(state, fields, caller),
        "files.completeUploadExternal" => complete_upload(state, fields, caller),
        "files.info" => match field(fields, "file").and_then(|file| state.files.get(file)) {
            Some(file) => ok(json!({ "file": file.info })),
            None => error("file_not_found"),
        },
        "users.info" => match field(fields, "user").and_then(|user| state.users.get(user)) {
            Some(user) => ok(json!({ "user": user })),
            None => error("user_not_found"),
        },
        "users.profile.get" => {
            let user_id = field(fields, "user").unwrap_or(&caller.user_id);
            match state.users.get(user_id) {
                Some(user) => {
                    ok(json!({ "profile": user.get("profile").cloned().unwrap_or(json!({})) }))
                }
                None => error("user_not_found"),
            }
        }
        "team.info" => {
            let team_id = field(fields, "team").unwrap_or(&caller.team_id);
            match state.teams.get(team_id) {
                Some(team) => ok(json!({ "team": team })),
                None => error("team_not_found"),
            }
        }
        "emoji.list" => ok(json!({ "emoji": state.emoji })),
        _ => error("unknown_method"),
    }
}

fn user_boot(state: &State, caller: &Caller) -> Value {
    let mut channels = Vec::new();
    let mut ims = Vec::new();
    for (id, conversation) in &state.conversations {
        if !conversation.members.contains(&caller.user_id) {
            continue;
        }
        let Some(mut info) = state.conversation_for(id, &caller.user_id) else {
            continue;
        };
        if let (Some(object), Some(latest)) = (info.as_object_mut(), conversation.messages.last()) {
            object.insert("latest".to_owned(), json!(ts_of(latest)));
        }
        if info.get("is_im") == Some(&json!(true)) {
            ims.push(info);
        } else {
            channels.push(info);
        }
    }
    let team = state
        .teams
        .get(&caller.team_id)
        .cloned()
        .unwrap_or(json!({ "id": caller.team_id }));
    ok(json!({
        "self": state.users.get(&caller.user_id),
        "team": team,
        "channels": channels,
        "ims": ims,
        "is_open": [],
        "workspaces": [team],
    }))
}

fn counts(state: &State, caller: &Caller) -> Value {
    let mut channels = Vec::new();
    let mut ims = Vec::new();
    let mut mpims = Vec::new();
    for (id, conversation) in &state.conversations {
        if !conversation.members.contains(&caller.user_id) {
            continue;
        }
        let latest = conversation
            .messages
            .last()
            .map(ts_of)
            .unwrap_or("0000000000.000000");
        let last_read = conversation
            .last_read
            .get(&caller.user_id)
            .map_or("0000000000.000000", String::as_str);
        let entry = json!({
            "id": id,
            "last_read": last_read,
            "latest": latest,
            "has_unreads": latest > last_read,
            "mention_count": 0,
        });
        if conversation.info.get("is_im") == Some(&json!(true)) {
            ims.push(entry);
        } else if conversation.info.get("is_mpim") == Some(&json!(true)) {
            mpims.push(entry);
        } else {
            channels.push(entry);
        }
    }
    ok(json!({
        "channels": channels,
        "ims": ims,
        "mpims": mpims,
        "threads": { "has_unreads": false, "mention_count": 0 },
    }))
}

fn users_conversations(state: &State, fields: &Fields, caller: &Caller) -> Value {
    let types: Vec<&str> = field(fields, "types").map_or_else(
        || vec!["public_channel"],
        |types| types.split(',').collect(),
    );
    let mut channels = Vec::new();
    for (id, conversation) in &state.conversations {
        if !conversation.members.contains(&caller.user_id) {
            continue;
        }
        let info = &conversation.info;
        let flag = |name: &str| info.get(name) == Some(&json!(true));
        let kind = if flag("is_im") {
            "im"
        } else if flag("is_mpim") {
            "mpim"
        } else if flag("is_private") {
            "private_channel"
        } else {
            "public_channel"
        };
        if types.contains(&kind)
            && let Some(info) = state.conversation_for(id, &caller.user_id)
        {
            channels.push(info);
        }
    }
    let (channels, next) = page(channels, fields);
    ok(
        json!({ "channels": channels, "response_metadata": { "next_cursor": next.unwrap_or_default() } }),
    )
}

fn conversation_view(state: &State, fields: &Fields, caller: &Caller) -> Value {
    let Some(channel) = field(fields, "channel") else {
        return error("channel_not_found");
    };
    let (Some(info), Some(conversation)) = (
        state.conversation_for(channel, &caller.user_id),
        state.conversations.get(channel),
    ) else {
        return error("channel_not_found");
    };
    let users: Vec<&Value> = conversation
        .members
        .iter()
        .filter_map(|member| state.users.get(member))
        .collect();
    ok(json!({ "channel": info, "users": users }))
}

fn history(state: &State, fields: &Fields) -> Value {
    let Some(conversation) =
        field(fields, "channel").and_then(|channel| state.conversations.get(channel))
    else {
        return error("channel_not_found");
    };
    let newest_first: Vec<Value> = conversation
        .messages
        .iter()
        .rev()
        .filter(|message| !is_thread_reply(message) && in_range(ts_of(message), fields))
        .cloned()
        .collect();
    let (messages, next) = page(newest_first, fields);
    ok(json!({
        "messages": messages,
        "has_more": next.is_some(),
        "response_metadata": { "next_cursor": next.unwrap_or_default() },
    }))
}

fn replies(state: &State, fields: &Fields) -> Value {
    let Some(conversation) =
        field(fields, "channel").and_then(|channel| state.conversations.get(channel))
    else {
        return error("channel_not_found");
    };
    let Some(thread_ts) = field(fields, "ts") else {
        return error("thread_not_found");
    };
    let thread: Vec<Value> = conversation
        .messages
        .iter()
        .filter(|message| {
            let ts = ts_of(message);
            let in_thread = ts == thread_ts
                || message.get("thread_ts").and_then(Value::as_str) == Some(thread_ts);
            in_thread && (ts == thread_ts || in_range(ts, fields))
        })
        .cloned()
        .collect();
    if thread.is_empty() {
        return error("thread_not_found");
    }
    let (messages, next) = page(thread, fields);
    ok(json!({
        "messages": messages,
        "has_more": next.is_some(),
        "response_metadata": { "next_cursor": next.unwrap_or_default() },
    }))
}

fn mark(state: &mut State, fields: &Fields, caller: &Caller) -> Value {
    let (Some(channel), Some(ts)) = (field(fields, "channel"), field(fields, "ts")) else {
        return error("invalid_arguments");
    };
    let Some(conversation) = state.conversations.get_mut(channel) else {
        return error("channel_not_found");
    };
    conversation
        .last_read
        .insert(caller.user_id.clone(), ts.to_owned());
    let info = &conversation.info;
    let event_type = if info.get("is_im") == Some(&json!(true)) {
        "im_marked"
    } else if info.get("is_mpim") == Some(&json!(true)) {
        "mpim_marked"
    } else if info.get("is_private") == Some(&json!(true)) {
        "group_marked"
    } else {
        "channel_marked"
    };
    let event =
        json!({ "type": event_type, "channel": channel, "ts": ts, "unread_count_display": 0 });
    state.push_to_user(&caller.user_id, &event);
    ok(json!({}))
}

fn mark_thread(state: &mut State, fields: &Fields, caller: &Caller) -> Value {
    let (Some(channel), Some(thread_ts), Some(ts)) = (
        field(fields, "channel"),
        field(fields, "thread_ts"),
        field(fields, "ts"),
    ) else {
        return error("invalid_arguments");
    };
    if !state.conversations.contains_key(channel) {
        return error("channel_not_found");
    }
    let event = json!({
        "type": "thread_marked",
        "subscription": { "channel": channel, "thread_ts": thread_ts, "last_read": ts, "active": true },
    });
    state.push_to_user(&caller.user_id, &event);
    ok(json!({}))
}

fn parse_json_field(fields: &Fields, name: &str) -> Result<Option<Value>, Value> {
    match field(fields, name) {
        None => Ok(None),
        Some(raw) => serde_json::from_str(raw)
            .map(Some)
            .map_err(|_| error(&format!("invalid_{name}"))),
    }
}

fn post_message(state: &mut State, fields: &Fields, caller: &Caller) -> Value {
    let Some(channel) = field(fields, "channel").map(str::to_owned) else {
        return error("channel_not_found");
    };
    let blocks = match parse_json_field(fields, "blocks") {
        Ok(blocks) => blocks,
        Err(error) => return error,
    };
    let text = field(fields, "text").unwrap_or_default().to_owned();
    if text.is_empty() && blocks.is_none() {
        return error("no_text");
    }
    let Some(conversation) = state.conversations.get(&channel) else {
        return error("channel_not_found");
    };
    if !conversation.members.contains(&caller.user_id) {
        return error("not_in_channel");
    }
    let ts = state.next_ts();
    let mut message = Map::new();
    message.insert("type".to_owned(), json!("message"));
    message.insert("user".to_owned(), json!(caller.user_id));
    message.insert("team".to_owned(), json!(caller.team_id));
    message.insert("user_team".to_owned(), json!(caller.team_id));
    message.insert("text".to_owned(), json!(text));
    message.insert("ts".to_owned(), json!(ts));
    if let Some(blocks) = blocks {
        message.insert("blocks".to_owned(), blocks);
    }
    if let Some(client_msg_id) = field(fields, "client_msg_id") {
        message.insert("client_msg_id".to_owned(), json!(client_msg_id));
    }
    if let Some(thread_ts) = field(fields, "thread_ts") {
        message.insert("thread_ts".to_owned(), json!(thread_ts));
        message.insert("parent_user_id".to_owned(), json!(caller.user_id));
        if field(fields, "reply_broadcast") == Some("true") {
            message.insert("subtype".to_owned(), json!("thread_broadcast"));
        }
    }
    let message = Value::Object(message);
    add_message(state, &channel, message.clone());
    ok(json!({ "channel": channel, "ts": ts, "message": message }))
}

/// Stores a message, updates its thread root, and pushes the `message`
/// event to the conversation's members.
pub(crate) fn add_message(state: &mut State, channel: &str, message: Value) {
    let Some(conversation) = state.conversations.get_mut(channel) else {
        return;
    };
    let thread_ts = message
        .get("thread_ts")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let ts = ts_of(&message).to_owned();
    if let Some(thread_ts) = thread_ts.filter(|thread_ts| *thread_ts != ts) {
        let replier = message.get("user").cloned().unwrap_or(Value::Null);
        if let Some(root) = conversation
            .messages
            .iter_mut()
            .find(|root| ts_of(root) == thread_ts)
        {
            let replies = root.get("reply_count").and_then(Value::as_u64).unwrap_or(0) + 1;
            let mut reply_users: Vec<Value> = root
                .get("reply_users")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if !reply_users.contains(&replier) {
                reply_users.push(replier);
            }
            if let Some(root) = root.as_object_mut() {
                root.insert("thread_ts".to_owned(), json!(thread_ts));
                root.insert("reply_count".to_owned(), json!(replies));
                root.insert("reply_users".to_owned(), json!(reply_users));
                root.insert("latest_reply".to_owned(), json!(ts));
            }
        }
    }
    conversation.messages.push(message.clone());
    conversation
        .messages
        .sort_by(|left, right| ts_of(left).cmp(ts_of(right)));
    let mut event = message;
    if let Some(object) = event.as_object_mut() {
        object.insert("channel".to_owned(), json!(channel));
        object.insert("event_ts".to_owned(), json!(ts));
    }
    state.push_to_members(channel, &event);
}

fn update_message(state: &mut State, fields: &Fields, caller: &Caller) -> Value {
    let (Some(channel), Some(ts)) = (field(fields, "channel"), field(fields, "ts")) else {
        return error("message_not_found");
    };
    let blocks = match parse_json_field(fields, "blocks") {
        Ok(blocks) => blocks,
        Err(error) => return error,
    };
    let text = field(fields, "text").unwrap_or_default().to_owned();
    let edit_ts = state.next_ts();
    let Some(conversation) = state.conversations.get_mut(channel) else {
        return error("channel_not_found");
    };
    let Some(message) = conversation
        .messages
        .iter_mut()
        .find(|message| ts_of(message) == ts)
    else {
        return error("message_not_found");
    };
    if message.get("user").and_then(Value::as_str) != Some(&caller.user_id) {
        return error("cant_update_message");
    }
    let previous = message.clone();
    if let Some(object) = message.as_object_mut() {
        object.insert("text".to_owned(), json!(text));
        if let Some(blocks) = blocks {
            object.insert("blocks".to_owned(), blocks);
        }
        object.insert(
            "edited".to_owned(),
            json!({ "user": caller.user_id, "ts": edit_ts }),
        );
    }
    let updated = message.clone();
    let event = json!({
        "type": "message",
        "subtype": "message_changed",
        "channel": channel,
        "hidden": true,
        "ts": edit_ts,
        "event_ts": edit_ts,
        "message": updated,
        "previous_message": previous,
    });
    let channel = channel.to_owned();
    state.push_to_members(&channel, &event);
    ok(json!({ "channel": channel, "ts": ts, "text": text }))
}

fn delete_message(state: &mut State, fields: &Fields, caller: &Caller) -> Value {
    let (Some(channel), Some(ts)) = (field(fields, "channel"), field(fields, "ts")) else {
        return error("message_not_found");
    };
    let event_ts = state.next_ts();
    let Some(conversation) = state.conversations.get_mut(channel) else {
        return error("channel_not_found");
    };
    let Some(index) = conversation
        .messages
        .iter()
        .position(|message| ts_of(message) == ts)
    else {
        return error("message_not_found");
    };
    if conversation.messages[index]
        .get("user")
        .and_then(Value::as_str)
        != Some(&caller.user_id)
    {
        return error("cant_delete_message");
    }
    let previous = conversation.messages.remove(index);
    let event = json!({
        "type": "message",
        "subtype": "message_deleted",
        "channel": channel,
        "hidden": true,
        "ts": event_ts,
        "event_ts": event_ts,
        "deleted_ts": ts,
        "previous_message": previous,
    });
    let channel = channel.to_owned();
    state.push_to_members(&channel, &event);
    ok(json!({ "channel": channel, "ts": ts }))
}

fn react(state: &mut State, fields: &Fields, caller: &Caller, add: bool) -> Value {
    let (Some(channel), Some(ts), Some(name)) = (
        field(fields, "channel"),
        field(fields, "timestamp"),
        field(fields, "name"),
    ) else {
        return error("invalid_arguments");
    };
    let Some(conversation) = state.conversations.get_mut(channel) else {
        return error("channel_not_found");
    };
    let Some(message) = conversation
        .messages
        .iter_mut()
        .find(|message| ts_of(message) == ts)
    else {
        return error("message_not_found");
    };
    let item_user = message.get("user").cloned();
    let mut reactions: Vec<Value> = message
        .get("reactions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let existing = reactions
        .iter()
        .position(|reaction| reaction.get("name") == Some(&json!(name)));
    let user = json!(caller.user_id);
    match (add, existing) {
        (true, Some(index)) => {
            let users = reactions[index]
                .get("users")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if users.contains(&user) {
                return error("already_reacted");
            }
            let mut users = users;
            users.push(user);
            reactions[index] = json!({ "name": name, "users": users, "count": users.len() });
        }
        (true, None) => reactions.push(json!({ "name": name, "users": [user], "count": 1 })),
        (false, Some(index)) => {
            let mut users = reactions[index]
                .get("users")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let Some(position) = users.iter().position(|reactor| *reactor == user) else {
                return error("no_reaction");
            };
            users.remove(position);
            if users.is_empty() {
                reactions.remove(index);
            } else {
                reactions[index] = json!({ "name": name, "users": users, "count": users.len() });
            }
        }
        (false, None) => return error("no_reaction"),
    }
    if let Some(object) = message.as_object_mut() {
        object.insert("reactions".to_owned(), json!(reactions));
    }
    let event = json!({
        "type": if add { "reaction_added" } else { "reaction_removed" },
        "user": caller.user_id,
        "reaction": name,
        "item_user": item_user,
        "item": { "type": "message", "channel": channel, "ts": ts },
        "event_ts": ts,
    });
    let channel = channel.to_owned();
    state.push_to_members(&channel, &event);
    ok(json!({}))
}

fn upload_url(state: &mut State, fields: &Fields, caller: &Caller) -> Value {
    let Some(filename) = field(fields, "filename").map(str::to_owned) else {
        return error("invalid_arguments");
    };
    state.next_file += 1;
    let file_id = format!("F{:08}", state.next_file);
    let info = json!({
        "id": file_id,
        "name": filename,
        "title": filename,
        "user": caller.user_id,
        "user_team": caller.team_id,
        "mode": "hosted",
        "file_access": "visible",
        "url_private": format!("{}files/{file_id}/{filename}", state.base_url),
        "url_private_download": format!("{}files/{file_id}/{filename}?download=1", state.base_url),
    });
    state.files.insert(
        file_id.clone(),
        StoredFile {
            info,
            bytes: Vec::new(),
        },
    );
    ok(json!({ "upload_url": format!("{}upload/{file_id}", state.base_url), "file_id": file_id }))
}

fn complete_upload(state: &mut State, fields: &Fields, caller: &Caller) -> Value {
    let files = match parse_json_field(fields, "files") {
        Ok(Some(Value::Array(files))) => files,
        _ => return error("invalid_arguments"),
    };
    let Some(channel) = field(fields, "channel_id").map(str::to_owned) else {
        return error("invalid_arguments");
    };
    let mut shared = Vec::new();
    for file in &files {
        let Some(id) = file.get("id").and_then(Value::as_str) else {
            return error("invalid_arguments");
        };
        let Some(stored) = state.files.get_mut(id) else {
            return error("file_not_found");
        };
        if let (Some(object), Some(title)) = (stored.info.as_object_mut(), file.get("title")) {
            object.insert("title".to_owned(), title.clone());
            object.insert("size".to_owned(), json!(stored.bytes.len()));
        }
        shared.push(stored.info.clone());
    }
    let ts = state.next_ts();
    let shared_in = if channel.starts_with('C') {
        "public"
    } else {
        "private"
    };
    for file in &files {
        if let Some(stored) = file
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| state.files.get_mut(id))
            && let Some(object) = stored.info.as_object_mut()
        {
            object.insert(
                "shares".to_owned(),
                json!({ shared_in: { channel.clone(): [{ "ts": ts, "thread_ts": field(fields, "thread_ts") }] } }),
            );
        }
    }
    let mut message = json!({
        "type": "message",
        "subtype": "file_share",
        "user": caller.user_id,
        "team": caller.team_id,
        "user_team": caller.team_id,
        "text": field(fields, "initial_comment").unwrap_or_default(),
        "ts": ts,
        "files": shared,
        "upload": true,
    });
    if let (Some(object), Some(thread_ts)) = (message.as_object_mut(), field(fields, "thread_ts")) {
        object.insert("thread_ts".to_owned(), json!(thread_ts));
    }
    add_message(state, &channel, message);
    let summaries: Vec<Value> = shared
        .iter()
        .map(|file| json!({ "id": file.get("id"), "title": file.get("title") }))
        .collect();
    ok(json!({ "files": summaries }))
}
