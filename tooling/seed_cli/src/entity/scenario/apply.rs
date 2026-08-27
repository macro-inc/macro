//! Apply: compile a scenario spec into database rows.
//!
//! Applying always resets the scenario's own rows first (they are exactly
//! the rows carrying the scenario's id marker), then seeds fresh, so a
//! re-apply converges on the config.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::str::FromStr;

use anyhow::Context;
use channels::domain::models::ChannelType;
use chrono::{DateTime, Duration, Utc};
use comms_db_client::channels::seed_channel::SeedChannelOptions;
use comms_db_client::messages::seed_message::SeedMessageOptions;
use comms_db_client::model::SimpleMention;
use entity_access_db_utils::{AccessLevel, EntityAccessSourceType, EntityType};
use macro_db_client::document::v2::create::CreateDocumentArgs;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::FileType;
use model::item::ShareableItemType;
use models_email::email::service::address::ContactInfo;
use models_email::email::service::label::{
    Label, LabelListVisibility, LabelType, MessageListVisibility,
};
use models_email::email::service::link::{Link, UserProvider};
use models_email::email::service::message::Message;
use models_email::email::service::thread::Thread;
use models_permissions::share_permission::{LinkShare, SharePermissionV2};
use models_properties::service::property_value::PropertyValue;
use uuid::Uuid;

use super::reset::{reset_contacts_outbox_statement, reset_statements};
use super::spec::{
    ChannelKind, EntityRef, ScenarioSpec, ShareLevel, ShareSpec, TeamMemberRole, scenario_marker,
};
use super::{sql_string, values_sql};
use crate::config::SeedCliContext;

#[cfg(test)]
mod test;

fn scenario_body_html_sanitized(body_html: Option<&str>, body_text: &str) -> String {
    let raw = body_html
        .map(str::to_string)
        .unwrap_or_else(|| format!("<p>{body_text}</p>"));
    email_utils::sanitize_email_html(&raw)
}

/// Canonical blank-markdown loro snapshot, matching the one production uses
/// to initialize empty documents.
const MARKDOWN_GOLDEN_SNAPSHOT: &[u8] =
    include_bytes!("../../../../../static_assets/markdown-golden.1.bin");

/// System labels created for every seeded inbox.
const EMAIL_SYSTEM_LABELS: &[&str] = &[
    "INBOX",
    "SENT",
    "UNREAD",
    "STARRED",
    "IMPORTANT",
    "DRAFT",
    "TRASH",
    "SPAM",
    "CATEGORY_PERSONAL",
];

impl From<ShareLevel> for AccessLevel {
    fn from(level: ShareLevel) -> Self {
        match level {
            ShareLevel::View => AccessLevel::View,
            ShareLevel::Comment => AccessLevel::Comment,
            ShareLevel::Edit => AccessLevel::Edit,
        }
    }
}

/// A resolved access grant to write to `entity_access`.
#[derive(Debug, Clone)]
pub(super) struct AccessRow {
    /// Source principal id: user id, team uuid, or channel uuid as text.
    pub source_id: String,
    /// Source principal type.
    pub source_type: EntityAccessSourceType,
    /// Granted level.
    pub access_level: AccessLevel,
    /// Project id the grant is inherited from, if any.
    pub granted_from_project_id: Option<String>,
}

/// Resolve a share spec into an access row.
pub(super) fn share_to_row(spec: &ScenarioSpec, share: &ShareSpec) -> AccessRow {
    let (source_id, source_type) = match EntityRef::parse(&share.with).expect("validated") {
        EntityRef::User(user) => (spec.user_id(&user), EntityAccessSourceType::User),
        EntityRef::Team(team) => (
            spec.team_id(&team).to_string(),
            EntityAccessSourceType::Team,
        ),
        EntityRef::Channel(channel) => (
            spec.channel_id(&channel).to_string(),
            EntityAccessSourceType::Channel,
        ),
        other => unreachable!("validated share target, got {other:?}"),
    };
    AccessRow {
        source_id,
        source_type,
        access_level: share.level.into(),
        granted_from_project_id: None,
    }
}

/// The direct (non-inherited) access rows of a project: owner + shares.
pub(super) fn project_direct_rows(spec: &ScenarioSpec, project_key: &str) -> Vec<AccessRow> {
    let project = &spec.projects[project_key];
    let mut rows = vec![AccessRow {
        source_id: spec.user_id(&project.owner),
        source_type: EntityAccessSourceType::User,
        access_level: AccessLevel::Owner,
        granted_from_project_id: None,
    }];
    rows.extend(project.share.iter().map(|s| share_to_row(spec, s)));
    rows
}

/// Access rows an entity inherits from living in `project_key`: every
/// ancestor project's direct rows, marked `granted_from` that ancestor.
pub(super) fn inherited_rows(spec: &ScenarioSpec, project_key: &str) -> Vec<AccessRow> {
    let mut rows = Vec::new();
    for ancestor in spec.project_chain(project_key) {
        let granted_from = spec.project_id(&ancestor);
        rows.extend(
            project_direct_rows(spec, &ancestor)
                .into_iter()
                .map(|mut row| {
                    row.granted_from_project_id = Some(granted_from.clone());
                    row
                }),
        );
    }
    rows
}

/// Order project keys parents-first.
pub(super) fn projects_parents_first(spec: &ScenarioSpec) -> Vec<String> {
    let mut ordered: Vec<String> = Vec::new();
    for key in spec.projects.keys() {
        for member in spec.project_chain(key).into_iter().rev() {
            if !ordered.contains(&member) {
                ordered.push(member);
            }
        }
    }
    ordered
}

/// Apply a scenario: reset its rows, then seed everything fresh.
#[tracing::instrument(skip(ctx, spec, seed_dir), fields(scenario = %spec.scenario), err)]
pub async fn apply(
    ctx: &SeedCliContext,
    spec: &ScenarioSpec,
    seed_dir: &Path,
) -> anyhow::Result<()> {
    let marker = scenario_marker(&spec.scenario);
    if let Some(description) = spec.description.as_deref() {
        println!("{description}\n");
    }

    println!("Resetting scenario `{}` (marker {marker})", spec.scenario);
    ctx.db
        .execute_sql_if_table_exists(
            "public.contacts_backfill_outbox",
            &reset_contacts_outbox_statement(&marker),
        )
        .await?;
    ctx.db
        .execute_statements(&reset_statements(&marker))
        .await?;

    seed_users(ctx, spec).await?;
    seed_teams(ctx, spec).await?;
    seed_channels(ctx, spec).await?;
    seed_contacts(ctx, spec).await?;
    seed_projects(ctx, spec).await?;
    seed_documents(ctx, spec, seed_dir).await?;
    seed_tasks(ctx, spec).await?;
    seed_chats(ctx, spec).await?;
    seed_calls(ctx, spec).await?;
    seed_emails(ctx, spec).await?;
    seed_messages(ctx, spec).await?;

    println!("\nScenario `{}` applied.", spec.scenario);
    print_login_links(spec);
    Ok(())
}

/// Print one login link per persona.
pub(super) fn print_login_links(spec: &ScenarioSpec) {
    let frontend_port = crate::config::FrontendPort::new()
        .map(|port| port.to_string())
        .unwrap_or_else(|| "3000".to_string());
    for (key, user) in &spec.users {
        // Per-persona hostnames get separate cookie jars, so each of these
        // can hold its own live session in ordinary tabs of one browser.
        if key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        {
            println!(
                "  {key}: http://{key}.localhost:{frontend_port}/app/login?email={}",
                user.email
            );
        } else {
            println!("  {key}: log in as {}", user.email);
        }
    }
}

async fn seed_users(ctx: &SeedCliContext, spec: &ScenarioSpec) -> anyhow::Result<()> {
    if spec.users.is_empty() {
        return Ok(());
    }
    println!("Seeding {} users", spec.users.len());

    // Create the FusionAuth accounts first: the signup webhook writes the
    // base macrodb rows, and it refuses to create an account whose email
    // already has a User row — so FusionAuth must come before our upserts
    // for seeded users to be log-in-able through the real flow.
    let mut fusionauth_reachable = true;
    for (key, user) in &spec.users {
        if !fusionauth_reachable {
            break;
        }
        match ctx.fusionauth_client.ensure_user(user.email.clone()).await {
            Ok(true) => println!("  user `{key}`: created FusionAuth account"),
            Ok(false) => {}
            Err(e) => {
                let message = format!("{e:#}");
                if message.contains("connect") || message.contains("Connection") {
                    fusionauth_reachable = false;
                    println!(
                        "  FusionAuth unreachable — seeding database rows only (users won't be able to log in until it's up)"
                    );
                } else {
                    println!("  user `{key}`: FusionAuth account creation failed: {message}");
                }
            }
        }
    }

    for (key, user) in &spec.users {
        let mut chars = key.chars();
        let capitalized = chars
            .next()
            .map(|c| c.to_uppercase().collect::<String>() + chars.as_str())
            .unwrap_or_default();

        ctx.db
            .adopt_or_seed_user(crate::service::db::AdoptOrSeedUserArgs {
                email: user.email.clone(),
                user_id: spec.user_id(key),
                derived_macro_user_id: spec.macro_user_uuid(key),
                first_name: user
                    .first_name
                    .clone()
                    .unwrap_or_else(|| capitalized.clone()),
                last_name: user.last_name.clone().unwrap_or_else(|| "Seed".to_string()),
                stripe_customer_id: format!("stripe-seed-{}-{key}", spec.scenario),
                extra_roles: user.roles.clone(),
            })
            .await?;
        println!("  user `{key}` -> {}", spec.user_id(key));
    }
    Ok(())
}

async fn seed_teams(ctx: &SeedCliContext, spec: &ScenarioSpec) -> anyhow::Result<()> {
    if spec.teams.is_empty() {
        return Ok(());
    }
    println!("Seeding {} teams", spec.teams.len());

    let team_values = values_sql(spec.teams.iter().map(|(key, team)| {
        vec![
            sql_string(&spec.team_id(key).to_string()),
            sql_string(team.name.as_deref().unwrap_or(key)),
            sql_string(&spec.user_id(&team.owner)),
            sql_string(&format!("sub_seed_{}_{key}", spec.scenario)),
            (team.members.len() + 1).to_string(),
        ]
    }));

    let member_rows = spec.teams.iter().flat_map(|(key, team)| {
        let team_id = spec.team_id(key).to_string();
        std::iter::once((team.owner.clone(), "owner"))
            .chain(team.members.iter().map(|(member, role)| {
                let role = match role {
                    TeamMemberRole::Member => "member",
                    TeamMemberRole::Admin => "admin",
                };
                (member.clone(), role)
            }))
            .map(move |(user, role)| {
                vec![
                    sql_string(&spec.user_id(&user)),
                    sql_string(&team_id),
                    format!("{}::team_role", sql_string(role)),
                ]
            })
            .collect::<Vec<_>>()
    });
    let member_values = values_sql(member_rows);

    let crm_values = values_sql(spec.teams.iter().map(|(key, team)| {
        vec![
            sql_string(&spec.team_id(key).to_string()),
            if team.crm_enabled { "true" } else { "false" }.to_string(),
        ]
    }));

    let statements = vec![
        format!(
            "INSERT INTO team (id, name, owner_id, subscription_id, seat_count) VALUES\n  {team_values}"
        ),
        format!("INSERT INTO team_user (user_id, team_id, team_role) VALUES\n  {member_values}"),
        format!("INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES\n  {crm_values}"),
    ];

    ctx.db.execute_statements(&statements).await
}

async fn seed_channels(ctx: &SeedCliContext, spec: &ScenarioSpec) -> anyhow::Result<()> {
    if spec.channels.is_empty() {
        return Ok(());
    }
    println!("Seeding {} channels", spec.channels.len());

    for (key, channel) in &spec.channels {
        let owner = spec.channel_owner(key);
        let participants = spec
            .channel_members(key)
            .iter()
            .map(|member| spec.user_id(member))
            .collect::<Vec<_>>();

        let channel_type = match channel.kind {
            ChannelKind::Public => ChannelType::Public,
            ChannelKind::Private => ChannelType::Private,
            ChannelKind::DirectMessage => ChannelType::DirectMessage,
            ChannelKind::Team => ChannelType::Team,
        };
        let name = match channel.kind {
            ChannelKind::DirectMessage => None,
            _ => Some(channel.name.clone().unwrap_or_else(|| key.clone())),
        };
        let team_id = channel.team.as_deref().map(|team| spec.team_id(team));

        let options = SeedChannelOptions {
            channel_id: spec.channel_id(key),
            name,
            owner_id: spec.user_id(&owner),
            org_id: None,
            channel_type,
            participants,
            team_id,
        };
        let id = ctx.db.seed_channel(options).await?;
        println!("  channel `{key}` -> {id}");
    }
    Ok(())
}

/// Seed the pairwise contact edges that production derives from channel and
/// team membership (via the contacts SQS pipeline): everyone in a group
/// becomes everyone else's contact, which is what makes teammates
/// mentionable and assignable.
async fn seed_contacts(ctx: &SeedCliContext, spec: &ScenarioSpec) -> anyhow::Result<()> {
    let mut groups: Vec<Vec<String>> = Vec::new();
    for team in spec.teams.values() {
        let mut members = vec![team.owner.clone()];
        members.extend(team.members.keys().cloned());
        groups.push(members);
    }
    for channel_key in spec.channels.keys() {
        groups.push(spec.channel_members(channel_key));
    }

    let mut pairs: BTreeSet<(String, String)> = BTreeSet::new();
    for group in groups {
        for (i, a) in group.iter().enumerate() {
            for b in group.iter().skip(i + 1) {
                let (a, b) = (spec.user_id(a), spec.user_id(b));
                if a == b {
                    continue;
                }
                pairs.insert(if a <= b { (a, b) } else { (b, a) });
            }
        }
    }

    if pairs.is_empty() {
        return Ok(());
    }
    println!("Seeding {} contact connections", pairs.len());
    ctx.db
        .insert_contact_connections(pairs.into_iter().collect())
        .await
}

async fn apply_access_rows(
    ctx: &SeedCliContext,
    entity_id: &str,
    entity_type: EntityType,
    rows: &[AccessRow],
) -> anyhow::Result<()> {
    for row in rows {
        ctx.db
            .upsert_entity_access(
                entity_id,
                entity_type,
                &row.source_id,
                row.source_type,
                row.access_level,
                row.granted_from_project_id.clone(),
            )
            .await?;
    }
    Ok(())
}

/// Write channel share-permission rows mirroring what mention-sharing does,
/// for entity kinds that carry a `SharePermission`.
async fn apply_channel_share_rows(
    ctx: &SeedCliContext,
    spec: &ScenarioSpec,
    entity_id: &str,
    item_type: ShareableItemType,
    shares: &[ShareSpec],
) -> anyhow::Result<()> {
    let item_type = item_type.to_string();
    for share in shares {
        if let Ok(EntityRef::Channel(channel)) = EntityRef::parse(&share.with) {
            ctx.db
                .upsert_channel_share_permission(
                    entity_id,
                    &item_type,
                    &spec.channel_id(&channel).to_string(),
                    share.level.into(),
                )
                .await?;
        }
    }
    Ok(())
}

async fn seed_projects(ctx: &SeedCliContext, spec: &ScenarioSpec) -> anyhow::Result<()> {
    if spec.projects.is_empty() {
        return Ok(());
    }
    println!("Seeding {} projects", spec.projects.len());

    for key in projects_parents_first(spec) {
        let project = &spec.projects[&key];
        let project_id = spec.project_id(&key);
        let name = project.name.as_deref().unwrap_or(&key);
        let parent_id = project.parent.as_deref().map(|p| spec.project_id(p));

        ctx.db
            .insert_project(&project_id, name, &spec.user_id(&project.owner), parent_id)
            .await?;

        let mut rows = project_direct_rows(spec, &key);
        if let Some(parent) = project.parent.as_deref() {
            rows.extend(inherited_rows(spec, parent));
        }
        apply_access_rows(ctx, &project_id, EntityType::Project, &rows).await?;

        if let (Some(link_share), Some(access_level)) =
            (project.link_share, project.link_share_access_level)
        {
            ctx.db
                .create_project_link_share_permission(
                    &project_id,
                    &share_permission(spec, &project.owner, link_share, access_level),
                )
                .await?;
        }
        apply_channel_share_rows(
            ctx,
            spec,
            &project_id,
            ShareableItemType::Project,
            &project.share,
        )
        .await?;

        println!("  project `{key}` -> {project_id}");
    }
    Ok(())
}

fn permission_access_level(
    level: ShareLevel,
) -> models_permissions::share_permission::access_level::AccessLevel {
    match level {
        ShareLevel::View => models_permissions::share_permission::access_level::AccessLevel::View,
        ShareLevel::Comment => {
            models_permissions::share_permission::access_level::AccessLevel::Comment
        }
        ShareLevel::Edit => models_permissions::share_permission::access_level::AccessLevel::Edit,
    }
}

fn share_permission(
    spec: &ScenarioSpec,
    owner_key: &str,
    link_share: LinkShare,
    access_level: ShareLevel,
) -> SharePermissionV2 {
    SharePermissionV2 {
        id: String::new(),
        link_share: Some(link_share),
        link_share_access_level: Some(permission_access_level(access_level)),
        owner: spec.user_id(owner_key),
        channel_share_permissions: None,
    }
}

/// Native markdown documents live in sync-service, not object storage:
/// markdown -> loro snapshot (via lexical) -> boot the document's durable
/// object, then mark the content ready.
async fn initialize_markdown_content(
    ctx: &SeedCliContext,
    key: &str,
    document_id: &str,
    markdown: &str,
) -> anyhow::Result<()> {
    match ctx.doc_content.as_ref() {
        Some(clients) => {
            let snapshot = if markdown.trim().is_empty() {
                MARKDOWN_GOLDEN_SNAPSHOT.to_vec()
            } else {
                clients
                    .lexical
                    .markdown_to_loro_snapshot(markdown)
                    .await
                    .context("converting markdown via lexical-service")?
            };
            // Sync-service refuses to initialize a document that already
            // has a snapshot (and the local worker has no delete route), so
            // a re-apply keeps whatever content is already there. Probe via
            // the raw content route rather than `exists`: a stray websocket
            // connect instantiates an EMPTY durable object, which exists but
            // still needs initializing.
            if clients.sync.get_raw(document_id).await.is_ok() {
                println!("  `{key}`: sync-service already has content for this id, keeping it");
            } else {
                clients
                    .sync
                    .initialize_from_snapshot(document_id, &snapshot)
                    .await
                    .context("initializing document in sync-service")?;
            }
            ctx.db
                .set_document_content_ready(document_id, "sync_service")
                .await?;
        }
        None => println!(
            "  `{key}`: SYNC_SERVICE_URL/LEXICAL_SERVICE_URL unset — content left pending, the doc won't open"
        ),
    }
    Ok(())
}

async fn seed_documents(
    ctx: &SeedCliContext,
    spec: &ScenarioSpec,
    seed_dir: &Path,
) -> anyhow::Result<()> {
    if spec.documents.is_empty() {
        return Ok(());
    }
    println!("Seeding {} documents", spec.documents.len());
    let files_dir = seed_dir.join("documents").join("files");

    for (key, document) in &spec.documents {
        let document_id = spec.document_id(key);
        let name = document.name.as_deref().unwrap_or(key);
        let owner_id = spec.user_id(&document.owner);
        let owner =
            MacroUserIdStr::parse_from_str(owner_id.clone().leak()).context("valid owner id")?;

        let file_type = match (&document.content, document.file.as_deref()) {
            (Some(_), _) => Some(FileType::Md),
            (None, Some(file)) => {
                let extension = file
                    .split('.')
                    .next_back()
                    .context("document file needs an extension")?;
                Some(FileType::from_str(extension).context("valid file type")?)
            }
            (None, None) => None,
        };

        let project_id = document.project.as_deref().map(|p| spec.project_id(p));
        let project_name = document.project.as_deref().map(|p| {
            spec.projects[p]
                .name
                .clone()
                .unwrap_or_else(|| p.to_string())
        });
        let created = ctx
            .db
            .create_document(CreateDocumentArgs {
                id: Some(&document_id),
                sha: "sha",
                document_name: name,
                user_id: owner.clone(),
                file_type,
                project_id: project_id.as_deref(),
                project_name: project_name.as_deref(),
                share_permission: &SharePermissionV2 {
                    id: String::new(),
                    link_share: document.link_share,
                    link_share_access_level: document
                        .link_share_access_level
                        .map(permission_access_level),
                    owner: owner_id.clone(),
                    channel_share_permissions: None,
                },
                skip_history: true,
                email_attachment_id: None,
                created_at: None,
                is_task: false,
            })
            .await?;

        let markdown = match (&document.content, document.file.as_deref()) {
            (Some(content), _) => Some(content.clone()),
            (None, Some(file)) if file_type == Some(FileType::Md) => {
                let path = files_dir.join(file);
                Some(
                    std::fs::read_to_string(&path)
                        .with_context(|| format!("reading {}", path.display()))?,
                )
            }
            _ => None,
        };

        if let Some(markdown) = markdown {
            initialize_markdown_content(ctx, key, &document_id, &markdown).await?;
        } else if let Some(file) = document.file.as_deref() {
            let file_type = file_type.expect("file implies file type");
            let s3_key = format!(
                "{}/{}/{}.{}",
                created.owner,
                created.document_id,
                created.document_version_id,
                file_type.as_str()
            );
            let path = files_dir.join(file);
            ctx.s3
                .upload_file(&s3_key, &path.to_string_lossy())
                .await
                .with_context(|| format!("uploading {}", path.display()))?;
            ctx.db
                .set_document_content_ready(&document_id, "object_storage")
                .await?;
        }

        let mut rows: Vec<AccessRow> = document
            .share
            .iter()
            .map(|s| share_to_row(spec, s))
            .collect();
        if let Some(project) = document.project.as_deref() {
            rows.extend(inherited_rows(spec, project));
        }
        apply_access_rows(ctx, &document_id, EntityType::Document, &rows).await?;
        apply_channel_share_rows(
            ctx,
            spec,
            &document_id,
            ShareableItemType::Document,
            &document.share,
        )
        .await?;

        println!("  document `{key}` -> {document_id}");
    }
    Ok(())
}

async fn seed_tasks(ctx: &SeedCliContext, spec: &ScenarioSpec) -> anyhow::Result<()> {
    if spec.tasks.is_empty() {
        return Ok(());
    }
    println!("Seeding {} tasks", spec.tasks.len());

    for (key, task) in &spec.tasks {
        let document_id = spec.task_id(key);
        let name = task.name.as_deref().unwrap_or(key);
        let owner_id = spec.user_id(&task.owner);
        let owner =
            MacroUserIdStr::parse_from_str(owner_id.clone().leak()).context("valid owner id")?;

        let project_id = task.project.as_deref().map(|p| spec.project_id(p));
        let project_name = task.project.as_deref().map(|p| {
            spec.projects[p]
                .name
                .clone()
                .unwrap_or_else(|| p.to_string())
        });

        ctx.db
            .create_document(CreateDocumentArgs {
                id: Some(&document_id),
                sha: "sha",
                document_name: name,
                user_id: owner.clone(),
                file_type: Some(FileType::Md),
                project_id: project_id.as_deref(),
                project_name: project_name.as_deref(),
                share_permission: &SharePermissionV2 {
                    id: String::new(),
                    link_share: None,
                    link_share_access_level: None,
                    owner: owner_id.clone(),
                    channel_share_permissions: None,
                },
                skip_history: true,
                email_attachment_id: None,
                created_at: None,
                is_task: true,
            })
            .await?;

        let markdown = task.content.clone().unwrap_or_default();
        initialize_markdown_content(ctx, key, &document_id, &markdown).await?;

        let mut rows: Vec<AccessRow> = task.share.iter().map(|s| share_to_row(spec, s)).collect();
        if task.share_with_team
            && let Some(team) = spec.team_of(&task.owner)
        {
            // Mirrors the app's share-with-team toggle on tasks: the owner's
            // team gets comment access.
            rows.push(AccessRow {
                source_id: spec.team_id(team).to_string(),
                source_type: EntityAccessSourceType::Team,
                access_level: AccessLevel::Comment,
                granted_from_project_id: None,
            });
        }
        if let Some(project) = task.project.as_deref() {
            rows.extend(inherited_rows(spec, project));
        }
        apply_access_rows(ctx, &document_id, EntityType::Document, &rows).await?;
        apply_channel_share_rows(
            ctx,
            spec,
            &document_id,
            ShareableItemType::Document,
            &task.share,
        )
        .await?;

        let status = task
            .status
            .as_deref()
            .map(system_properties::StatusOption::try_from)
            .transpose()
            .map_err(|e| anyhow::anyhow!("task `{key}`: {e}"))?
            .unwrap_or(system_properties::StatusOption::NotStarted);
        properties::outbound::entity_property_queries::upsert_entity_property(
            &ctx.db.pool(),
            &document_id,
            models_properties::EntityType::Task,
            system_properties::SystemPropertyKey::STATUS_UUID,
            Some(PropertyValue::SelectOption(vec![status.uuid()])),
        )
        .await?;

        let assignees: Vec<&String> = if task.assignees.is_empty() {
            vec![&task.owner]
        } else {
            task.assignees.iter().collect()
        };
        let references = assignees
            .iter()
            .map(|assignee| models_properties::EntityReference {
                entity_id: spec.user_id(assignee),
                entity_type: models_properties::EntityType::User,
                specific_message_id: None,
            })
            .collect();
        properties::outbound::entity_property_queries::upsert_entity_property(
            &ctx.db.pool(),
            &document_id,
            models_properties::EntityType::Task,
            system_properties::SystemPropertyKey::ASSIGNEES_UUID,
            Some(PropertyValue::EntityRef(references)),
        )
        .await?;

        println!("  task `{key}` -> {document_id}");
    }
    Ok(())
}

async fn seed_chats(ctx: &SeedCliContext, spec: &ScenarioSpec) -> anyhow::Result<()> {
    if spec.chats.is_empty() {
        return Ok(());
    }
    println!("Seeding {} chats", spec.chats.len());

    for (key, chat) in &spec.chats {
        let chat_id = spec.chat_id(key);
        let owner_id = spec.user_id(&chat.owner);
        let name = chat.name.as_deref().unwrap_or(key);

        ctx.db.insert_chat(&chat_id, &owner_id, name).await?;

        let mut rows = vec![AccessRow {
            source_id: owner_id.clone(),
            source_type: EntityAccessSourceType::User,
            access_level: AccessLevel::Owner,
            granted_from_project_id: None,
        }];
        rows.extend(chat.share.iter().map(|s| share_to_row(spec, s)));
        apply_access_rows(ctx, &chat_id, EntityType::Chat, &rows).await?;

        if let (Some(link_share), Some(access_level)) =
            (chat.link_share, chat.link_share_access_level)
        {
            ctx.db
                .create_chat_link_share_permission(
                    &chat_id,
                    &share_permission(spec, &chat.owner, link_share, access_level),
                )
                .await?;
        }
        apply_channel_share_rows(ctx, spec, &chat_id, ShareableItemType::Chat, &chat.share).await?;

        println!("  chat `{key}` -> {chat_id}");
    }
    Ok(())
}

async fn seed_calls(ctx: &SeedCliContext, spec: &ScenarioSpec) -> anyhow::Result<()> {
    if spec.calls.is_empty() {
        return Ok(());
    }
    println!("Seeding {} calls", spec.calls.len());

    for (index, (key, call)) in spec.calls.iter().enumerate() {
        let call_id = spec.call_id(key);
        let channel_id = spec.channel_id(&call.channel);
        let creator_id = spec.user_id(&call.created_by);
        let share_permission_id =
            super::spec::derive_id(&spec.scenario, "call_share_permission", key);

        let duration = Duration::minutes(i64::from(call.duration_minutes.unwrap_or(15)));
        let ended_at = Utc::now()
            - Duration::minutes(i64::from(
                call.ended_minutes_ago.unwrap_or((index as u32 + 1) * 30),
            ));
        let started_at = ended_at - duration;

        let creator_team = if call.share_with_team {
            spec.team_of(&call.created_by)
                .map(|team| spec.team_id(team))
        } else {
            None
        };

        let participants: Vec<(String, DateTime<Utc>, DateTime<Utc>)> = spec
            .call_participants(key)
            .iter()
            .map(|participant| (spec.user_id(participant), started_at, ended_at))
            .collect();

        let segment_count = call.transcript.len().max(1) as i64;
        let segment_length = duration / (segment_count as i32);
        let transcripts: Vec<(String, String, DateTime<Utc>, DateTime<Utc>)> = call
            .transcript
            .iter()
            .enumerate()
            .map(|(i, segment)| {
                let seg_start = started_at + segment_length * (i as i32);
                (
                    spec.user_id(&segment.speaker),
                    segment.text.clone(),
                    seg_start,
                    seg_start + segment_length,
                )
            })
            .collect();

        ctx.db
            .insert_call_record(crate::service::db::InsertCallRecordArgs {
                call_id,
                channel_id,
                room_name: format!("seed-{}-{key}", spec.scenario),
                created_by: creator_id.clone(),
                started_at,
                ended_at,
                share_permission_id: share_permission_id.to_string(),
                share_with_team: call.share_with_team,
                custom_name: call.name.clone(),
                team_id: creator_team,
                participants,
                transcripts,
            })
            .await?;

        println!("  call `{key}` -> {call_id}");
    }
    Ok(())
}

async fn seed_emails(ctx: &SeedCliContext, spec: &ScenarioSpec) -> anyhow::Result<()> {
    if spec.emails.is_empty() {
        return Ok(());
    }
    println!("Seeding {} inboxes", spec.emails.len());
    let now = Utc::now();

    for (key, account) in &spec.emails {
        let owner = &spec.users[&account.owner];
        let address = account
            .address
            .clone()
            .unwrap_or_else(|| owner.email.clone());
        let link_id = spec.email_link_id(key);

        let macro_id = MacroUserIdStr::parse_from_str(spec.user_id(&account.owner).leak())
            .context("valid inbox owner id")?;
        let email_str = macro_user_id::email::EmailStr::try_from(address.clone())
            .map_err(|e| anyhow::anyhow!("invalid inbox address {address}: {e:?}"))?;
        let is_primary = Link::derive_is_primary(&macro_id, &email_str);

        let link = ctx
            .db
            .upsert_email_link(Link {
                id: link_id,
                macro_id,
                fusionauth_user_id: spec.user_id(&account.owner),
                email_address: email_str,
                provider: UserProvider::Gmail,
                is_sync_active: true,
                is_primary,
                needs_reauth: false,
                last_sync_error_at: None,
                created_at: now,
                updated_at: now,
            })
            .await?;

        let labels: Vec<Label> = EMAIL_SYSTEM_LABELS
            .iter()
            .map(|id| Label {
                id: None,
                link_id: link.id,
                provider_label_id: (*id).to_string(),
                name: Some((*id).to_string()),
                created_at: now,
                message_list_visibility: Some(MessageListVisibility::Show),
                label_list_visibility: Some(LabelListVisibility::LabelShow),
                type_: Some(LabelType::System),
            })
            .collect();
        ctx.db.insert_email_labels(labels).await?;

        for (thread_index, (thread_key, thread_spec)) in account.threads.iter().enumerate() {
            let thread = build_thread(
                spec,
                key,
                thread_key,
                thread_spec,
                link.id,
                &address,
                now - Duration::minutes(i64::from(
                    thread_spec
                        .sent_minutes_ago
                        .unwrap_or((thread_index as u32 + 1) * 60),
                )),
            );
            let thread_id = thread.db_id.to_string();
            ctx.db.insert_email_thread(thread, link.id).await?;

            let rows: Vec<AccessRow> = thread_spec
                .share
                .iter()
                .map(|s| share_to_row(spec, s))
                .collect();
            apply_access_rows(ctx, &thread_id, EntityType::EmailThread, &rows).await?;
            println!("  inbox `{key}` thread `{thread_key}` -> {thread_id}");
        }

        for delegate in &account.delegated_to {
            ctx.db
                .insert_macro_user_link(
                    &spec.user_id(delegate),
                    &spec.user_id(&account.owner),
                    link.id,
                )
                .await?;
            println!("  inbox `{key}` delegated to `{delegate}`");
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn build_thread(
    spec: &ScenarioSpec,
    account_key: &str,
    thread_key: &str,
    thread_spec: &super::spec::EmailThreadSpec,
    link_id: Uuid,
    owner_address: &str,
    sent_at: DateTime<Utc>,
) -> Thread {
    let thread_id = spec.email_thread_id(account_key, thread_key);
    let message_id = spec.email_message_id(account_key, thread_key);
    let provider_id = format!("seed-{}-{account_key}-{thread_key}", spec.scenario);

    let from_address = thread_spec
        .from
        .clone()
        .unwrap_or_else(|| "sender@example.com".to_string());
    let body_text = thread_spec.body.clone().unwrap_or_else(|| {
        format!(
            "{}\n\n(seeded by scenario `{}`)",
            thread_spec.subject, spec.scenario
        )
    });
    let snippet: String = body_text.chars().take(100).collect();

    let mut label_ids = vec!["INBOX".to_string(), "CATEGORY_PERSONAL".to_string()];
    if thread_spec.unread {
        label_ids.push("UNREAD".to_string());
    }
    let labels: Vec<Label> = label_ids
        .iter()
        .map(|lid| Label {
            id: None,
            link_id,
            provider_label_id: lid.clone(),
            name: Some(lid.clone()),
            created_at: sent_at,
            message_list_visibility: None,
            label_list_visibility: None,
            type_: None,
        })
        .collect();

    let message = Message {
        db_id: message_id,
        provider_id: Some(format!("{provider_id}-m0")),
        thread_db_id: thread_id,
        provider_thread_id: Some(provider_id.clone()),
        replying_to_id: None,
        global_id: None,
        link_id,
        subject: Some(thread_spec.subject.clone()),
        snippet: Some(snippet),
        provider_history_id: None,
        internal_date_ts: Some(sent_at),
        sent_at: Some(sent_at),
        size_estimate: None,
        is_read: !thread_spec.unread,
        is_starred: false,
        is_sent: false,
        is_draft: false,
        scheduled_send_time: None,
        has_attachments: false,
        from: Some(ContactInfo {
            email: from_address,
            name: None,
            photo_url: None,
        }),
        to: vec![ContactInfo {
            email: owner_address.to_string(),
            name: None,
            photo_url: None,
        }],
        cc: vec![],
        bcc: vec![],
        labels,
        body_text: Some(body_text.clone()),
        body_html_sanitized: Some(scenario_body_html_sanitized(
            thread_spec.body_html.as_deref(),
            &body_text,
        )),
        body_macro: None,
        attachments: vec![],
        attachments_draft: vec![],
        attachments_forwarded: vec![],
        headers_json: None,
        created_at: sent_at,
        updated_at: sent_at,
    };

    Thread {
        db_id: thread_id,
        provider_id: Some(provider_id),
        link_id,
        inbox_visible: true,
        is_read: !thread_spec.unread,
        latest_inbound_message_ts: Some(sent_at),
        latest_outbound_message_ts: None,
        latest_non_spam_message_ts: Some(sent_at),
        created_at: sent_at,
        updated_at: sent_at,
        messages: vec![message],
    }
}

async fn seed_messages(ctx: &SeedCliContext, spec: &ScenarioSpec) -> anyhow::Result<()> {
    if spec.messages.is_empty() {
        return Ok(());
    }
    println!("Seeding {} messages", spec.messages.len());

    for (index, message) in spec.messages.iter().enumerate() {
        let channel_id = spec.channel_id(&message.channel);
        let message_id = ctx
            .db
            .seed_message(SeedMessageOptions {
                message_id: spec.message_id(index),
                channel_id,
                sender_id: spec.user_id(&message.from),
                content: message.text.clone(),
                thread_id: None,
            })
            .await?;

        println!("  message #{index} in `{}`", message.channel);
        if message.mentions.is_empty() {
            continue;
        }

        let mentions: Vec<SimpleMention> = message
            .mentions
            .iter()
            .map(|mention| {
                let (entity_type, entity_id) = match EntityRef::parse(mention).expect("validated") {
                    EntityRef::User(user) => ("user", spec.user_id(&user)),
                    EntityRef::Document(doc) => ("document", spec.document_id(&doc)),
                    EntityRef::Project(project) => ("project", spec.project_id(&project)),
                    EntityRef::Chat(chat) => ("chat", spec.chat_id(&chat)),
                    EntityRef::Call(call) => ("call", spec.call_id(&call).to_string()),
                    other => unreachable!("validated mention, got {other:?}"),
                };
                SimpleMention {
                    entity_id,
                    entity_type: entity_type.to_string(),
                }
            })
            .collect();

        ctx.db
            .create_message_mentions(message_id, mentions.clone())
            .await?;

        for mention in &mentions {
            if mention.entity_type == "user"
                || ShareableItemType::from_str(&mention.entity_type).is_err()
            {
                continue;
            }
            ctx.db
                .upsert_channel_share_permission(
                    &mention.entity_id,
                    &mention.entity_type,
                    &channel_id.to_string(),
                    AccessLevel::View,
                )
                .await?;
        }
    }
    Ok(())
}

/// Map a `BTreeMap` share list into level lookups for matrix expectations.
pub(super) fn max_level(
    current: &mut BTreeMap<String, AccessLevel>,
    user: &str,
    level: AccessLevel,
) {
    current
        .entry(user.to_string())
        .and_modify(|existing| {
            if level > *existing {
                *existing = level;
            }
        })
        .or_insert(level);
}
