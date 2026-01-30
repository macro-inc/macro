# Problem

I want to remove the `comms_service_client` crate and replace any uses of it with calling `comms_db_cilent` directly.


# Notes 
- `macro_db_client` and `comms_db_client` use the same db under the hood.
- Use `/workspace` command when implementing the task
- Name the bookmark `chore-remove-comms-service-client`
- When in the new workspace run the following commands:

```bash
`just get_environment`
`just rust/cloud-storage/setup_test_envs`
```

- Create atomic commits via `jj commit -m '<MESSAGE>'`


# Tasks

## T00 - Scoping
I need you to go through all existing crates that import `comms_service_client` and create a list of them.
For each crate, find the calls that they use and map them to their db counter part calls.

Make a special note of any `comms_service_client` calls that require a `jwt_token` as those are public api endpoints so we'll need to
handle user authentication.

For each crate, create a new task below with a detailed explanation of what we need to change

---

### Scoping Analysis

#### Crates that import `comms_service_client` in Cargo.toml:

1. **search_processing_service** - ACTIVE USAGE
2. **scribe** - ACTIVE USAGE
3. **delete_document_worker** - ACTIVE USAGE
4. **authentication_service** - ACTIVE USAGE
5. **document_cognition_service** - ACTIVE USAGE (via scribe)
6. **macro_share_permissions** - NO ACTIVE USAGE (only Cargo.toml dependency)
7. **macro_project_utils** - NO ACTIVE USAGE (only Cargo.toml dependency)
8. **ai_tools** - NO ACTIVE USAGE (only Cargo.toml dependency)

#### `comms_service_client` API Methods and DB Mappings:

| Service Client Method | Requires JWT? | DB Client Equivalent | Notes |
|----------------------|---------------|---------------------|-------|
| `get_channel_message(channel_id, message_id)` | No | `comms_db_client::messages::get_channel_message::get_channel_message_by_id(db, channel_id, message_id)` | Direct mapping |
| `delete_mentions_by_source(item_ids)` | No | `comms_db_client::entity_mentions::delete_entity_mentions_by_source(db, item_ids)` | Direct mapping |
| `add_user_to_org_channels(user_id, org_id)` | No | `comms_db_client::channels::get_channels::get_org_channels(db, org_id)` + loop `comms_db_client::participants::add_participant::add_participant(db, opts)` | Requires orchestration |
| `remove_user_from_org_channels(user_id, org_id)` | No | `comms_db_client::channels::get_channels::get_org_channels(db, org_id)` + loop `comms_db_client::participants::remove_participant::remove_participant(db, opts)` | Requires orchestration |
| `get_channels_external(jwt_token)` | **YES** | Complex - uses `comms::domain::service::ChannelServiceImpl::get_channels()` | Public API - needs auth |
| `get_channel_metadata_external(channel_id, jwt_token)` | **YES** | Inline query in `comms_service/src/api/channels/get_channel_metadata.rs` | Public API - needs auth |
| `get_channel_metadata_internal(channel_id, user_id)` | No | Same inline query, no auth | Direct mapping possible |
| `get_channel_transcript_external(channel_id, jwt_token, since, limit)` | **YES** | `comms_db_client::messages::get_messages::get_messages(db, channel_id, since, limit)` + formatting | Public API - needs auth |
| `get_channel_transcript_internal(channel_id, since, limit)` | No | Same as above, no auth | Direct mapping possible |
| `get_message_with_context(message_id, before, after, jwt_token)` | **YES** | `comms_db_client::messages::read_message_with_context::get_messages_with_context(db, message_id, before, after)` | Public API - needs auth |

#### JWT-Required Methods (Public API Endpoints):

⚠️ **These methods require user authentication and permission checks:**

1. `get_channels_external(jwt_token)` - Used in **scribe** via `ChannelClient::list_channels()`
2. `get_channel_metadata_external(channel_id, jwt_token)` - Used in **scribe** via `ChannelClient::get_channel_metadata()` when jwt provided
3. `get_channel_transcript_external(channel_id, jwt_token, since, limit)` - Used in **scribe** via `ChannelClient::get_channel_transcript()` when jwt provided
4. `get_message_with_context(message_id, before, after, jwt_token)` - Used in **scribe** via `ChannelClient::get_message_with_context()`

For these JWT-required methods in **scribe/document_cognition_service**, the calling code needs access to the user's JWT to enforce permissions. We need to either:
- Keep HTTP calls to comms_service for these endpoints (maintains auth layer)
- Replicate permission checks in the calling code before DB access
- Pass user context and perform permission checks inline

---

## T01 - Remove unused dependencies from macro_share_permissions, macro_project_utils, ai_tools (COMPLETED)

**Crates affected:**
- `rust/cloud-storage/macro_share_permissions/Cargo.toml`
- `rust/cloud-storage/macro_project_utils/Cargo.toml`
- `rust/cloud-storage/ai_tools/Cargo.toml`

**Changes needed:**
- Remove `comms_service_client = { path = "../comms_service_client" }` from each Cargo.toml
- These crates have the dependency but no actual usage of `CommsServiceClient`

---

## T02 - Migrate search_processing_service (COMPLETED)

**Crate:** `rust/cloud-storage/search_processing_service`

**Current usage in `src/process/channel.rs`:**
```rust
comms_service_client.get_channel_message(&message.channel_id, &message.message_id)
```

**Changes needed:**
1. Remove `comms_service_client` from Cargo.toml
2. Add `comms_db_client` to Cargo.toml
3. Update `src/process/context.rs`:
   - Remove `comms_service_client: Arc<comms_service_client::CommsServiceClient>`
   - Add database pool if not present (may already have via `macro_db_client`)
4. Update `src/process/channel.rs`:
   - Replace `comms_service_client.get_channel_message(...)` with `comms_db_client::messages::get_channel_message::get_channel_message_by_id(db, channel_id, message_id)`
   - Parse UUIDs from string channel_id/message_id
5. Update `src/main.rs`:
   - Remove `CommsServiceClient::new(...)` initialization

---

## T03 - Migrate delete_document_worker (COMPLETED)

**Crate:** `rust/cloud-storage/delete_document_worker`

**Current usage in `src/process/handle.rs`:**
```rust
ctx.comms_service_client.delete_mentions_by_source(vec![document_id.to_string()])
```

**Changes needed:**
1. Remove `comms_service_client` from Cargo.toml
2. Add `comms_db_client` to Cargo.toml (may already be present)
3. Update `src/context.rs`:
   - Remove `comms_service_client: Arc<comms_service_client::CommsServiceClient>`
4. Update `src/config.rs`:
   - Remove `comms_service_auth_key` and `comms_service_url` fields
5. Update `src/process/handle.rs`:
   - Replace `ctx.comms_service_client.delete_mentions_by_source(...)` with `comms_db_client::entity_mentions::delete_entity_mentions_by_source(&ctx.db, item_ids)`
6. Update `src/main.rs`:
   - Remove `CommsServiceClient::new(...)` initialization
   - Remove env var reads for `COMMS_SERVICE_AUTH_KEY` and `COMMS_SERVICE_URL`

---

## T04 - Migrate authentication_service (COMPLETED)

**Crate:** `rust/cloud-storage/authentication_service`

**Current usage:**
- `src/api/webhooks/user/create_user_webhook.rs:177`: `comms_client.add_user_to_org_channels(&user_id, &(org_id as i64))`
- `src/api/webhooks/user/delete_user_webhook.rs:174`: `comms_client.remove_user_from_org_channels(&user_id, &(org_id as i64))`

**Changes needed:**
1. Remove `comms_service_client` from Cargo.toml
2. Add `comms_db_client` to Cargo.toml
3. Update `src/api/context.rs`:
   - Remove `comms_client: Arc<comms_service_client::CommsServiceClient>`
4. Update `src/main.rs`:
   - Remove `CommsServiceClient::new(...)` initialization
5. Create helper functions (or inline) for:
   - `add_user_to_org_channels`:
     ```rust
     let org_channels = comms_db_client::channels::get_channels::get_org_channels(&db, &org_id).await?;
     for channel in org_channels.iter() {
         comms_db_client::participants::add_participant::add_participant(
             &db,
             AddParticipantOptions {
                 channel_id: &channel.id.0,
                 user_id: &user_id,
                 participant_role: Some(ParticipantRole::Member),
             },
         ).await?;
     }
     ```
   - `remove_user_from_org_channels`:
     ```rust
     let org_channels = comms_db_client::channels::get_channels::get_org_channels(&db, &org_id).await?;
     for channel in org_channels.iter() {
         comms_db_client::participants::remove_participant::remove_participant(
             &db,
             RemoveParticipantOptions {
                 channel_id: &channel.id.0,
                 user_id: &user_id,
             },
         ).await?;
     }
     ```
6. Update webhook handlers to use new helper functions with `ctx.db`

---

## T05 - Migrate scribe and document_cognition_service (COMPLETED)

**Crates:**
- `rust/cloud-storage/scribe`
- `rust/cloud-storage/document_cognition_service`

**Current usage in `scribe/src/channel/client.rs`:**
- `list_channels(jwt_token)` → `get_channels_external(jwt_token)` **⚠️ REQUIRES JWT**
- `get_channel_metadata(channel_id, jwt_token)` → `get_channel_metadata_external/internal()` **⚠️ JWT OPTIONAL**
- `get_channel_transcript(channel_id, jwt_token, since, limit)` → `get_channel_transcript_external/internal()` **⚠️ JWT OPTIONAL**
- `get_message_with_context(message_id, before, after, jwt_token)` → `get_message_with_context()` **⚠️ REQUIRES JWT**

**⚠️ IMPORTANT:** These methods are for AI context gathering where user authentication matters. The scribe's `ChannelClient` is used to gather channel data for AI tools. Since these are user-facing operations, we need to maintain authorization.

**Options:**
1. **Keep HTTP calls for JWT methods** - Simplest, maintains existing auth pattern
2. **Add permission checks directly** - Requires replicating channel access permission logic
3. **Use a hybrid approach** - DB calls for internal, HTTP for external/JWT

**Recommended approach:** Option 3 - Hybrid
- For `jwt_token = None` cases: use DB directly (already internal/trusted)
- For `jwt_token = Some(...)` cases: Keep HTTP calls to comms_service to maintain auth layer

**Changes needed:**
1. Update `scribe/Cargo.toml`:
   - Keep `comms_service_client` for JWT-required methods OR add permission checking logic
   - Add `comms_db_client` for internal methods
2. Update `scribe/src/channel/client.rs`:
   - For `get_channel_metadata(channel_id, jwt_token: None)`: use `comms_db_client::channels::get_channel_info::get_channel_info(db, channel_id)`
   - For `get_channel_transcript(channel_id, jwt_token: None)`: use `comms_db_client::messages::get_messages::get_messages(db, channel_id, since, limit)` + formatting
   - Keep HTTP calls for JWT-required paths if not implementing permission checks
3. Update `scribe/src/channel/mod.rs`:
   - Change `with_channel_client` to accept DB pool or both DB + HTTP client
4. Update `document_cognition_service` accordingly (uses scribe's ChannelClient)

**Alternative if we want to fully eliminate HTTP:**
- Need to add channel membership verification before DB access
- Check `comms_channel_participants` table for user access
- This is more complex but removes inter-service HTTP dependency

---

## T06 - Clean up comms_service_client (COMPLETED - kept crate with only public API methods)

**Crate:** `rust/cloud-storage/comms_service_client`

**Changes made:**
1. ✅ Removed internal methods that are now handled via direct DB access:
   - `channel_message.rs` - get_channel_message
   - `mentions.rs` - get_channel_mentions, delete_mentions_by_source
   - `organization.rs` - add_user_to_org_channels, remove_user_from_org_channels
   - `create_welcome_message.rs` - create_welcome_message
   - `participants.rs` - get_channel_participants
   - `permissions.rs` - check_channels_for_user
   - `constants.rs` - internal auth key header constant
2. ✅ Removed internal methods from channels.rs (get_channel_metadata_internal, get_channel_transcript_internal, get_channels_history)
3. ✅ Removed `internal_auth_key` requirement from CommsServiceClient::new()
4. ✅ Kept JWT-authenticated public API methods in channels.rs and messages.rs

**Remaining public API methods (JWT-required):**
- `get_channels_external(jwt_token)`
- `get_channel_metadata_external(channel_id, jwt_token)`
- `get_channel_transcript_external(channel_id, jwt_token, since, limit)`
- `get_message_with_context(message_id, before, after, jwt_token)`

---

## T07 - Update comms_service internal routes (cleanup)

**Crate:** `rust/cloud-storage/comms_service`

After all clients are migrated, consider deprecating/removing internal routes that are no longer called:
- `/internal/add_user_to_org_channels`
- `/internal/remove_user_from_org_channels`
- `/internal/channel/:channel_id/:message_id`
- `/internal/delete_mentions_by_source`
- `/internal/get_channel_metadata/:channel_id`
- `/internal/get_channel_transcript/:channel_id`

**Note:** Keep routes that may be used by other services or external callers. Audit before removal.
