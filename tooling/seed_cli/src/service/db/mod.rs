//! Database service wrapper.

use std::str::FromStr;

#[cfg(test)]
pub use MockSeedDb as Db;
#[cfg(not(test))]
pub use SeedDb as Db;

#[allow(unused_imports)]
use mockall::automock;

use chrono::{DateTime, Utc};
use comms_db_client::channels::create_channel::CreateChannelOptions;
use comms_db_client::channels::seed_channel::SeedChannelOptions;
use comms_db_client::messages::create_message::CreateMessageOptions;
use comms_db_client::messages::create_message_mentions::CreateMessageMentionOptions;
use comms_db_client::messages::seed_message::SeedMessageOptions;
use comms_db_client::model::SimpleMention;
use model::document::DocumentMetadata;
use models_email::email::service;
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use uuid::Uuid;

/// Everything needed to seed one scenario user.
#[derive(Debug)]
pub struct AdoptOrSeedUserArgs {
    /// Login email.
    pub email: String,
    /// The `macro|email` user id.
    pub user_id: String,
    /// Derived uuid used when no `macro_user` row exists for the email.
    pub derived_macro_user_id: Uuid,
    /// First name for `macro_user_info`.
    pub first_name: String,
    /// Last name for `macro_user_info`.
    pub last_name: String,
    /// Fabricated stripe customer id used on fresh inserts.
    pub stripe_customer_id: String,
    /// Role rows written on top of the default `self_serve`.
    pub extra_roles: Vec<String>,
}

/// Everything needed to seed an archived call record.
#[derive(Debug)]
pub struct InsertCallRecordArgs {
    /// Call record id (same id the live call would have had).
    pub call_id: Uuid,
    /// Channel the call happened in.
    pub channel_id: Uuid,
    /// LiveKit-style room name.
    pub room_name: String,
    /// Creator user id.
    pub created_by: String,
    /// Call start time.
    pub started_at: DateTime<Utc>,
    /// Call end time.
    pub ended_at: DateTime<Utc>,
    /// Pre-derived share permission id.
    pub share_permission_id: String,
    /// Whether the creator's team gets view access.
    pub share_with_team: bool,
    /// Optional custom display name.
    pub custom_name: Option<String>,
    /// The creator's team, when `share_with_team` applies.
    pub team_id: Option<Uuid>,
    /// Participants as (user id, joined_at, left_at).
    pub participants: Vec<(String, DateTime<Utc>, DateTime<Utc>)>,
    /// Transcript segments as (speaker id, content, started_at, ended_at).
    pub transcripts: Vec<(String, String, DateTime<Utc>, DateTime<Utc>)>,
}

/// Wrapper around the database connection pool.
#[cfg_attr(test, allow(dead_code))]
pub struct SeedDb {
    /// The macrodb pool
    inner: sqlx::PgPool,
}

#[cfg_attr(test, automock)]
#[cfg_attr(test, allow(dead_code))]
impl SeedDb {
    /// Create a new database wrapper.
    pub fn new(inner: sqlx::PgPool) -> Self {
        Self { inner }
    }

    /// Execute a semicolon-delimited SQL script inside a transaction.
    #[tracing::instrument(skip(self, sql), err)]
    #[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
    pub async fn execute_sql_script(&self, sql: &str) -> anyhow::Result<()> {
        let mut transaction = self.inner.begin().await?;

        for statement in sql.split(';').map(str::trim).filter(|s| !s.is_empty()) {
            sqlx::query(statement).execute(&mut *transaction).await?;
        }

        transaction.commit().await?;
        Ok(())
    }

    /// Execute SQL only when the table exists in the current database.
    #[tracing::instrument(skip(self, sql), err)]
    #[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
    pub async fn execute_sql_if_table_exists(
        &self,
        table_name: &str,
        sql: &str,
    ) -> anyhow::Result<()> {
        let exists = sqlx::query_scalar::<_, Option<String>>("SELECT to_regclass($1)::text")
            .bind(table_name)
            .fetch_one(&self.inner)
            .await?
            .is_some();

        if exists {
            sqlx::query(sql).execute(&self.inner).await?;
        }

        Ok(())
    }

    /// Create a document in the database.
    #[tracing::instrument(skip(self), err)]
    pub async fn create_document<'a>(
        &self,
        args: macro_db_client::document::v2::create::CreateDocumentArgs<'a>,
    ) -> anyhow::Result<DocumentMetadata> {
        macro_db_client::document::v2::create::create_document(&self.inner, args).await
    }

    /// Create a channel in the database.
    #[tracing::instrument(skip(self), err)]
    pub async fn create_channel(
        &self,
        options: CreateChannelOptions,
    ) -> anyhow::Result<uuid::Uuid> {
        let id =
            comms_db_client::channels::create_channel::create_channel(&self.inner, options).await?;
        Ok(id)
    }

    /// Seed a channel with a pre-defined UUID.
    #[tracing::instrument(skip(self), err)]
    pub async fn seed_channel(&self, options: SeedChannelOptions) -> anyhow::Result<uuid::Uuid> {
        let id =
            comms_db_client::channels::seed_channel::seed_channel(&self.inner, options).await?;
        Ok(id)
    }

    /// Create a message in the database.
    #[tracing::instrument(skip(self), err)]
    pub async fn create_message(
        &self,
        options: CreateMessageOptions,
    ) -> anyhow::Result<uuid::Uuid> {
        let message =
            comms_db_client::messages::create_message::create_message(&self.inner, options).await?;
        Ok(message.id)
    }

    /// Seed a message with a pre-defined UUID.
    #[tracing::instrument(skip(self), err)]
    pub async fn seed_message(&self, options: SeedMessageOptions) -> anyhow::Result<uuid::Uuid> {
        let message =
            comms_db_client::messages::seed_message::seed_message(&self.inner, options).await?;
        Ok(message.id)
    }

    /// Create entity mentions for a message.
    #[tracing::instrument(skip(self), err)]
    pub async fn create_message_mentions(
        &self,
        message_id: uuid::Uuid,
        mentions: Vec<SimpleMention>,
    ) -> anyhow::Result<Vec<String>> {
        let options = CreateMessageMentionOptions {
            message_id,
            mentions,
        };
        comms_db_client::messages::create_message_mentions::create_message_mentions(
            &self.inner,
            options,
        )
        .await
    }

    /// Update channel share permissions for a mentioned entity (seed-data only, no access check).
    #[tracing::instrument(skip(self), err)]
    pub async fn update_share_permissions_for_mention(
        &self,
        channel_id: uuid::Uuid,
        item_id: &str,
        item_type: &str,
    ) -> anyhow::Result<()> {
        let share_permission_id = macro_db_client::share_permission::get::get_share_permission_id(
            &self.inner,
            item_id,
            item_type,
        )
        .await?;

        let channel_id_str = channel_id.to_string();
        if let Err(e) =
            macro_db_client::share_permission::channel_permission::create::insert_channel_share_permission(
                &self.inner,
                &share_permission_id,
                &channel_id_str,
                &AccessLevel::View,
            )
            .await
        {
            tracing::warn!(error=?e, "channel share permission may already exist, continuing");
        }

        let mut tx = self.inner.begin().await?;
        entity_access_db_utils::insert_entity_access_row(
            &mut tx,
            &macro_uuid::string_to_uuid(item_id).unwrap(),
            model_entity::EntityType::from_str(item_type).unwrap(),
            &channel_id.to_string(),
            entity_access_db_utils::EntityAccessSourceType::Channel,
            AccessLevel::View,
        )
        .await?;
        tx.commit().await?;

        Ok(())
    }

    /// Fetch an email link by its ID.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_email_link(
        &self,
        link_id: uuid::Uuid,
    ) -> anyhow::Result<Option<service::link::Link>> {
        let result = email_db_client::links::get::fetch_link_by_id(&self.inner, link_id).await?;
        Ok(result)
    }

    /// Upsert an email link (connects a user to an email provider).
    #[tracing::instrument(skip(self), err)]
    pub async fn upsert_email_link(
        &self,
        link: service::link::Link,
    ) -> anyhow::Result<service::link::Link> {
        let mut conn = self.inner.acquire().await?;
        let result = email_db_client::links::insert::upsert_link(&mut conn, link).await?;
        Ok(result)
    }

    /// Insert or update email labels for a link.
    #[tracing::instrument(skip(self), err)]
    pub async fn insert_email_labels(
        &self,
        labels: Vec<service::label::Label>,
    ) -> anyhow::Result<()> {
        email_db_client::labels::insert::insert_or_update_labels(&self.inner, labels).await
    }

    /// Insert an email thread with all its messages, contacts, recipients, and labels.
    #[tracing::instrument(skip(self), err)]
    pub async fn insert_email_thread(
        &self,
        thread: service::thread::Thread,
        link_id: uuid::Uuid,
    ) -> anyhow::Result<uuid::Uuid> {
        let id = email_db_client::threads::insert::insert_thread_and_messages(
            &self.inner,
            thread,
            link_id,
        )
        .await?;
        Ok(id)
    }

    /// Execute a list of standalone SQL statements inside one transaction.
    ///
    /// Unlike [`Self::execute_sql_script`] the statements are not split on
    /// semicolons, so they may contain CTEs with embedded semicolons-free
    /// bodies of arbitrary complexity.
    #[tracing::instrument(skip(self, statements), err)]
    #[allow(clippy::disallowed_methods, reason = "seed-only dynamic SQL")]
    pub async fn execute_statements(&self, statements: &[String]) -> anyhow::Result<()> {
        let mut transaction = self.inner.begin().await?;
        for statement in statements {
            sqlx::query(statement).execute(&mut *transaction).await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    /// Upsert an `entity_access` row, replacing the level on conflict.
    #[tracing::instrument(skip(self), err)]
    #[allow(clippy::disallowed_methods, reason = "seed-only dynamic SQL")]
    pub async fn upsert_entity_access(
        &self,
        entity_id: &str,
        entity_type: entity_access_db_utils::EntityType,
        source_id: &str,
        source_type: entity_access_db_utils::EntityAccessSourceType,
        access_level: AccessLevel,
        granted_from_project_id: Option<String>,
    ) -> anyhow::Result<()> {
        let entity_uuid = macro_uuid::string_to_uuid(entity_id)
            .map_err(|e| anyhow::anyhow!("entity id {entity_id} is not a uuid: {e:?}"))?;
        let conflict = if granted_from_project_id.is_some() {
            r#"(entity_id, entity_type, source_id, source_type, granted_from_project_id)
               WHERE granted_from_project_id IS NOT NULL"#
        } else {
            r#"(entity_id, entity_type, source_id, source_type)
               WHERE granted_from_project_id IS NULL"#
        };
        let query = format!(
            r#"INSERT INTO entity_access
                 (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT {conflict}
               DO UPDATE SET access_level = EXCLUDED.access_level"#
        );
        sqlx::query(&query)
            .bind(entity_uuid)
            .bind(entity_type.as_ref())
            .bind(source_id)
            .bind(source_type)
            .bind(access_level)
            .bind(granted_from_project_id.as_deref())
            .execute(&self.inner)
            .await?;
        Ok(())
    }

    /// Grant a channel access to a shareable item: writes the
    /// `ChannelSharePermission` row (when the item has a share permission)
    /// and the `entity_access` row, like mention-sharing does.
    #[tracing::instrument(skip(self), err)]
    pub async fn upsert_channel_share_permission(
        &self,
        item_id: &str,
        item_type: &str,
        channel_id: &str,
        access_level: AccessLevel,
    ) -> anyhow::Result<()> {
        match macro_db_client::share_permission::get::get_share_permission_id(
            &self.inner,
            item_id,
            item_type,
        )
        .await
        {
            Ok(share_permission_id) => {
                if let Err(e) =
                    macro_db_client::share_permission::channel_permission::create::insert_channel_share_permission(
                        &self.inner,
                        &share_permission_id,
                        channel_id,
                        &access_level,
                    )
                    .await
                {
                    tracing::warn!(error=?e, "channel share permission may already exist, continuing");
                }
            }
            Err(e) => {
                tracing::debug!(error=?e, item_type, "no share permission for item, skipping channel share row");
            }
        }

        self.upsert_entity_access(
            item_id,
            entity_access_db_utils::EntityType::from_str(item_type)
                .map_err(|e| anyhow::anyhow!("invalid entity type {item_type}: {e:?}"))?,
            channel_id,
            entity_access_db_utils::EntityAccessSourceType::Channel,
            access_level,
            None,
        )
        .await
    }

    /// Insert a project row with a pre-defined id.
    #[tracing::instrument(skip(self), err)]
    pub async fn insert_project(
        &self,
        project_id: &str,
        name: &str,
        owner_id: &str,
        parent_id: Option<String>,
    ) -> anyhow::Result<()> {
        sqlx::query!(
            r#"INSERT INTO "Project" (id, name, "userId", "parentId", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, NOW(), NOW())"#,
            project_id,
            name,
            owner_id,
            parent_id.as_deref(),
        )
        .execute(&self.inner)
        .await?;
        Ok(())
    }

    /// Insert an AI chat row with a pre-defined id.
    #[tracing::instrument(skip(self), err)]
    pub async fn insert_chat(
        &self,
        chat_id: &str,
        owner_id: &str,
        name: &str,
    ) -> anyhow::Result<()> {
        sqlx::query!(
            r#"INSERT INTO "Chat" (id, "userId", name, "isPersistent") VALUES ($1, $2, $3, true)"#,
            chat_id,
            owner_id,
            name,
        )
        .execute(&self.inner)
        .await?;
        Ok(())
    }

    /// Create a public share permission attached to a project.
    #[tracing::instrument(skip(self, share_permission), err)]
    pub async fn create_project_public_permission(
        &self,
        project_id: &str,
        share_permission: &SharePermissionV2,
    ) -> anyhow::Result<()> {
        let mut transaction = self.inner.begin().await?;
        macro_db_client::share_permission::create::create_project_permission(
            &mut transaction,
            project_id,
            share_permission,
        )
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    /// Create a public share permission attached to a chat.
    #[tracing::instrument(skip(self, share_permission), err)]
    pub async fn create_chat_public_permission(
        &self,
        chat_id: &str,
        share_permission: &SharePermissionV2,
    ) -> anyhow::Result<()> {
        let mut transaction = self.inner.begin().await?;
        macro_db_client::share_permission::create::create_chat_permission(
            &mut transaction,
            chat_id,
            share_permission,
        )
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    /// Insert an archived call record with its share permission, access
    /// rows, participants, and transcripts — the same rows `create_call` +
    /// `archive_call` leave behind.
    #[tracing::instrument(skip(self, args), fields(call_id = %args.call_id), err)]
    pub async fn insert_call_record(&self, args: InsertCallRecordArgs) -> anyhow::Result<()> {
        let mut transaction = self.inner.begin().await?;

        sqlx::query!(
            r#"INSERT INTO "SharePermission" (id, "isPublic", "publicAccessLevel", "createdAt", "updatedAt")
               VALUES ($1, false, NULL, NOW(), NOW())"#,
            args.share_permission_id,
        )
        .execute(transaction.as_mut())
        .await?;

        macro_db_client::share_permission::channel_permission::create::create_channel_share_permissions(
            &mut transaction,
            &args.share_permission_id,
            &vec![models_permissions::share_permission::channel_share_permission::ChannelSharePermission {
                channel_id: args.channel_id.to_string(),
                access_level: AccessLevel::Edit,
            }],
        )
        .await?;

        entity_access_db_utils::insert_entity_access_row(
            &mut transaction,
            &args.call_id,
            entity_access_db_utils::EntityType::Call,
            &args.created_by,
            entity_access_db_utils::EntityAccessSourceType::User,
            entity_access_db_utils::AccessLevel::Owner,
        )
        .await?;
        entity_access_db_utils::insert_entity_access_row(
            &mut transaction,
            &args.call_id,
            entity_access_db_utils::EntityType::Call,
            &args.channel_id.to_string(),
            entity_access_db_utils::EntityAccessSourceType::Channel,
            entity_access_db_utils::AccessLevel::Edit,
        )
        .await?;
        if let Some(team_id) = args.team_id {
            entity_access_db_utils::insert_entity_access_row(
                &mut transaction,
                &args.call_id,
                entity_access_db_utils::EntityType::Call,
                &team_id.to_string(),
                entity_access_db_utils::EntityAccessSourceType::Team,
                entity_access_db_utils::AccessLevel::View,
            )
            .await?;
        }

        let duration_ms = (args.ended_at - args.started_at).num_milliseconds().max(0);
        sqlx::query!(
            r#"INSERT INTO call_records
                 (id, channel_id, room_name, created_by, started_at, ended_at, duration_ms,
                  share_permission_id, share_with_team, custom_name)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"#,
            args.call_id,
            args.channel_id,
            args.room_name,
            args.created_by,
            args.started_at,
            args.ended_at,
            duration_ms,
            args.share_permission_id,
            args.share_with_team,
            args.custom_name.as_deref(),
        )
        .execute(transaction.as_mut())
        .await?;

        for (user_id, joined_at, left_at) in &args.participants {
            sqlx::query!(
                r#"INSERT INTO call_record_participants (call_record_id, user_id, joined_at, left_at)
                   VALUES ($1, $2, $3, $4)"#,
                args.call_id,
                user_id,
                joined_at,
                left_at as _,
            )
            .execute(transaction.as_mut())
            .await?;
        }

        for (index, (speaker_id, content, started_at, ended_at)) in
            args.transcripts.iter().enumerate()
        {
            sqlx::query!(
                r#"INSERT INTO call_record_transcripts
                     (call_record_id, segment_id, speaker_id, content, started_at, ended_at, sequence_num)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
                args.call_id,
                format!("seed-seg-{index}"),
                speaker_id,
                content,
                started_at,
                ended_at as _,
                index as i32,
            )
            .execute(transaction.as_mut())
            .await?;
        }

        transaction.commit().await?;
        Ok(())
    }

    /// Delegate an email link from its owner to another user.
    #[tracing::instrument(skip(self), err)]
    pub async fn insert_macro_user_link(
        &self,
        primary_macro_id: &str,
        child_macro_id: &str,
        link_id: uuid::Uuid,
    ) -> anyhow::Result<()> {
        sqlx::query!(
            r#"INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
               VALUES ($1, $2, $3)
               ON CONFLICT DO NOTHING"#,
            primary_macro_id,
            child_macro_id,
            link_id,
        )
        .execute(&self.inner)
        .await?;
        Ok(())
    }

    /// Seed one user, adopting rows the signup webhook may already have
    /// created for the email (their `macro_user` id wins over the derived
    /// one so login-created accounts stay intact).
    #[tracing::instrument(skip(self), err)]
    pub async fn adopt_or_seed_user(&self, args: AdoptOrSeedUserArgs) -> anyhow::Result<()> {
        let AdoptOrSeedUserArgs {
            email,
            user_id,
            derived_macro_user_id,
            first_name,
            last_name,
            stripe_customer_id,
            extra_roles,
        } = args;
        let (email, user_id) = (email.as_str(), user_id.as_str());
        let (first_name, last_name) = (first_name.as_str(), last_name.as_str());
        let stripe_customer_id = stripe_customer_id.as_str();
        let mut transaction = self.inner.begin().await?;

        let existing: Option<Uuid> =
            sqlx::query_scalar!("SELECT id FROM macro_user WHERE email = $1 LIMIT 1", email)
                .fetch_optional(transaction.as_mut())
                .await?;

        let macro_user_id = match existing {
            Some(id) => id,
            None => {
                sqlx::query!(
                    r#"INSERT INTO macro_user (id, username, email, stripe_customer_id, has_trialed)
                       VALUES ($1, $2, $3, $4, false)"#,
                    derived_macro_user_id,
                    email,
                    email,
                    stripe_customer_id,
                )
                .execute(transaction.as_mut())
                .await?;
                derived_macro_user_id
            }
        };

        sqlx::query!(
            r#"INSERT INTO "User" (id, email, "stripeCustomerId", macro_user_id, "tutorialComplete", "hasOnboardingDocuments")
               VALUES ($1, $2, $3, $4, true, true)
               ON CONFLICT (id) DO UPDATE SET
                 macro_user_id = EXCLUDED.macro_user_id,
                 "tutorialComplete" = true,
                 "hasOnboardingDocuments" = true"#,
            user_id,
            email,
            stripe_customer_id,
            macro_user_id,
        )
        .execute(transaction.as_mut())
        .await?;

        sqlx::query!(
            r#"INSERT INTO macro_user_email_verification (macro_user_id, email, is_verified)
               VALUES ($1, $2, true)
               ON CONFLICT (email) DO UPDATE SET
                 macro_user_id = EXCLUDED.macro_user_id,
                 is_verified = true"#,
            macro_user_id,
            email,
        )
        .execute(transaction.as_mut())
        .await?;

        sqlx::query!(
            r#"INSERT INTO macro_user_info (macro_user_id, first_name, last_name)
               VALUES ($1, $2, $3)
               ON CONFLICT (macro_user_id) DO UPDATE SET
                 first_name = EXCLUDED.first_name,
                 last_name = EXCLUDED.last_name"#,
            macro_user_id,
            first_name,
            last_name,
        )
        .execute(transaction.as_mut())
        .await?;

        // Converge on exactly self_serve + the configured roles, dropping
        // whatever a previous apply granted.
        sqlx::query!(r#"DELETE FROM "RolesOnUsers" WHERE "userId" = $1"#, user_id)
            .execute(transaction.as_mut())
            .await?;
        sqlx::query!(
            r#"INSERT INTO "RolesOnUsers" ("userId", "roleId") VALUES ($1, 'self_serve')
               ON CONFLICT DO NOTHING"#,
            user_id,
        )
        .execute(transaction.as_mut())
        .await?;

        for role in &extra_roles {
            sqlx::query!(
                r#"INSERT INTO "RolesOnUsers" ("userId", "roleId") VALUES ($1, $2)
                   ON CONFLICT DO NOTHING"#,
                user_id,
                role,
            )
            .execute(transaction.as_mut())
            .await?;
        }

        transaction.commit().await?;
        Ok(())
    }

    /// Mark a document's content as ready at the given location
    /// (`sync_service` for native markdown, `object_storage` for uploads).
    #[tracing::instrument(skip(self), err)]
    pub async fn set_document_content_ready(
        &self,
        document_id: &str,
        location: &str,
    ) -> anyhow::Result<()> {
        sqlx::query!(
            r#"UPDATE "Document"
               SET uploaded = true, "contentState" = 'ready', "contentLocation" = $2, "updatedAt" = NOW()
               WHERE id = $1"#,
            document_id,
            location,
        )
        .execute(&self.inner)
        .await?;
        Ok(())
    }

    /// Upsert pairwise contact connections, the rows the contacts worker
    /// derives from channel/team membership messages. Pairs must already be
    /// normalized (`user1 <= user2`, no self-pairs).
    #[tracing::instrument(skip(self, pairs), err)]
    pub async fn insert_contact_connections(
        &self,
        pairs: Vec<(String, String)>,
    ) -> anyhow::Result<()> {
        if pairs.is_empty() {
            return Ok(());
        }
        let (users1, users2): (Vec<String>, Vec<String>) = pairs.into_iter().unzip();
        sqlx::query!(
            "INSERT INTO contacts_connections(user1, user2)
             SELECT * FROM unnest($1::text[], $2::text[])
             ON CONFLICT(user1, user2) DO UPDATE SET updated_at = now()",
            &users1,
            &users2,
        )
        .execute(&self.inner)
        .await?;
        Ok(())
    }

    /// Read-only handle to the underlying pool (for the matrix verifier).
    pub fn pool(&self) -> sqlx::PgPool {
        self.inner.clone()
    }
}
