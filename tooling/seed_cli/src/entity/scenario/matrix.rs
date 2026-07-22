//! Matrix: the scenario's expected access matrix, verified against the real
//! authorization service.
//!
//! Expected levels are computed purely from the config; actual levels come
//! from `entity_access`'s domain service running over the local database —
//! the same code production uses — so a mismatch means either the seeder or
//! the access model changed.

#[cfg(test)]
mod test;

use std::collections::BTreeMap;

use entity_access::domain::ports::EntityAccessService;
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;

use super::apply;
use super::spec::{ScenarioSpec, ShareLevel};

/// One row of the matrix: an entity and the level each user should have.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpectedRow {
    /// `kind:key` label of the entity.
    pub label: String,
    /// Entity id as text (what the access service is asked about).
    pub entity_id: String,
    /// Entity type for the access service.
    pub entity_type: EntityType,
    /// Expected level per user key; absent means no access.
    pub levels: BTreeMap<String, AccessLevel>,
}

fn share_level_to_access(level: ShareLevel) -> AccessLevel {
    match level {
        ShareLevel::View => AccessLevel::View,
        ShareLevel::Comment => AccessLevel::Comment,
        ShareLevel::Edit => AccessLevel::Edit,
    }
}

/// The channel/team/user source ids a user resolves to, as text.
fn user_sources(spec: &ScenarioSpec, user_key: &str) -> Vec<String> {
    let mut sources = vec![spec.user_id(user_key)];
    if let Some(team) = spec.team_of(user_key) {
        sources.push(spec.team_id(team).to_string());
    }
    for channel_key in spec.channels.keys() {
        if spec
            .channel_members(channel_key)
            .contains(&user_key.to_string())
        {
            sources.push(spec.channel_id(channel_key).to_string());
        }
    }
    sources
}

fn levels_from_rows(
    spec: &ScenarioSpec,
    rows: &[apply::AccessRow],
    public: Option<ShareLevel>,
) -> BTreeMap<String, AccessLevel> {
    let mut levels: BTreeMap<String, AccessLevel> = BTreeMap::new();
    for user_key in spec.users.keys() {
        let sources = user_sources(spec, user_key);
        for row in rows {
            if sources.contains(&row.source_id) {
                apply::max_level(&mut levels, user_key, row.access_level);
            }
        }
        if let Some(level) = public {
            apply::max_level(&mut levels, user_key, share_level_to_access(level));
        }
    }
    levels
}

fn owner_row(spec: &ScenarioSpec, owner_key: &str) -> apply::AccessRow {
    apply::AccessRow {
        source_id: spec.user_id(owner_key),
        source_type: entity_access_db_utils::EntityAccessSourceType::User,
        access_level: AccessLevel::Owner,
        granted_from_project_id: None,
    }
}

/// Channel view rows granted by message mentions of `kind:key`, mirroring
/// the mention-sharing that seeding messages performs.
fn mention_channel_rows(spec: &ScenarioSpec, kind: &str, key: &str) -> Vec<apply::AccessRow> {
    let reference = format!("{kind}:{key}");
    spec.messages
        .iter()
        .filter(|message| message.mentions.contains(&reference))
        .map(|message| apply::AccessRow {
            source_id: spec.channel_id(&message.channel).to_string(),
            source_type: entity_access_db_utils::EntityAccessSourceType::Channel,
            access_level: AccessLevel::View,
            granted_from_project_id: None,
        })
        .collect()
}

/// Compute the full expected matrix for a scenario.
pub fn expected_matrix(spec: &ScenarioSpec) -> Vec<ExpectedRow> {
    let mut rows = Vec::new();

    for channel_key in spec.channels.keys() {
        let mut levels = BTreeMap::new();
        for user_key in spec.users.keys() {
            if spec.channel_members(channel_key).contains(user_key) {
                levels.insert(user_key.clone(), AccessLevel::View);
            }
        }
        rows.push(ExpectedRow {
            label: format!("channel:{channel_key}"),
            entity_id: spec.channel_id(channel_key).to_string(),
            entity_type: EntityType::Channel,
            levels,
        });
    }

    for (project_key, project) in &spec.projects {
        let mut access_rows = apply::project_direct_rows(spec, project_key);
        if let Some(parent) = project.parent.as_deref() {
            access_rows.extend(apply::inherited_rows(spec, parent));
        }
        access_rows.extend(mention_channel_rows(spec, "project", project_key));
        rows.push(ExpectedRow {
            label: format!("project:{project_key}"),
            entity_id: spec.project_id(project_key),
            entity_type: EntityType::Project,
            levels: levels_from_rows(spec, &access_rows, project.public),
        });
    }

    for (document_key, document) in &spec.documents {
        let mut access_rows = vec![owner_row(spec, &document.owner)];
        access_rows.extend(document.share.iter().map(|s| apply::share_to_row(spec, s)));
        if let Some(project) = document.project.as_deref() {
            access_rows.extend(apply::inherited_rows(spec, project));
        }
        access_rows.extend(mention_channel_rows(spec, "document", document_key));
        rows.push(ExpectedRow {
            label: format!("document:{document_key}"),
            entity_id: spec.document_id(document_key),
            entity_type: EntityType::Document,
            levels: levels_from_rows(spec, &access_rows, document.public),
        });
    }

    for (task_key, task) in &spec.tasks {
        let mut access_rows = vec![owner_row(spec, &task.owner)];
        access_rows.extend(task.share.iter().map(|s| apply::share_to_row(spec, s)));
        if task.share_with_team
            && let Some(team) = spec.team_of(&task.owner)
        {
            access_rows.push(apply::AccessRow {
                source_id: spec.team_id(team).to_string(),
                source_type: entity_access_db_utils::EntityAccessSourceType::Team,
                access_level: AccessLevel::Comment,
                granted_from_project_id: None,
            });
        }
        if let Some(project) = task.project.as_deref() {
            access_rows.extend(apply::inherited_rows(spec, project));
        }
        rows.push(ExpectedRow {
            label: format!("task:{task_key}"),
            entity_id: spec.task_id(task_key),
            entity_type: EntityType::Document,
            levels: levels_from_rows(spec, &access_rows, None),
        });
    }

    for (chat_key, chat) in &spec.chats {
        let mut access_rows = vec![owner_row(spec, &chat.owner)];
        access_rows.extend(chat.share.iter().map(|s| apply::share_to_row(spec, s)));
        access_rows.extend(mention_channel_rows(spec, "chat", chat_key));
        rows.push(ExpectedRow {
            label: format!("chat:{chat_key}"),
            entity_id: spec.chat_id(chat_key),
            entity_type: EntityType::Chat,
            levels: levels_from_rows(spec, &access_rows, chat.public),
        });
    }

    for (call_key, call) in &spec.calls {
        let mut access_rows = vec![
            owner_row(spec, &call.created_by),
            apply::AccessRow {
                source_id: spec.channel_id(&call.channel).to_string(),
                source_type: entity_access_db_utils::EntityAccessSourceType::Channel,
                access_level: AccessLevel::Edit,
                granted_from_project_id: None,
            },
        ];
        if call.share_with_team
            && let Some(team) = spec.team_of(&call.created_by)
        {
            access_rows.push(apply::AccessRow {
                source_id: spec.team_id(team).to_string(),
                source_type: entity_access_db_utils::EntityAccessSourceType::Team,
                access_level: AccessLevel::View,
                granted_from_project_id: None,
            });
        }
        access_rows.extend(mention_channel_rows(spec, "call", call_key));
        rows.push(ExpectedRow {
            label: format!("call:{call_key}"),
            entity_id: spec.call_id(call_key).to_string(),
            entity_type: EntityType::Call,
            levels: levels_from_rows(spec, &access_rows, None),
        });
    }

    for (account_key, account) in &spec.emails {
        for (thread_key, thread) in &account.threads {
            let mut levels: BTreeMap<String, AccessLevel> = BTreeMap::new();
            levels.insert(account.owner.clone(), AccessLevel::Owner);
            for delegate in &account.delegated_to {
                levels.insert(delegate.clone(), AccessLevel::Owner);
            }
            let share_rows: Vec<apply::AccessRow> = thread
                .share
                .iter()
                .map(|s| apply::share_to_row(spec, s))
                .collect();
            for (user, level) in levels_from_rows(spec, &share_rows, None) {
                apply::max_level(&mut levels, &user, level);
            }
            rows.push(ExpectedRow {
                label: format!("email:{account_key}/{thread_key}"),
                entity_id: spec.email_thread_id(account_key, thread_key).to_string(),
                entity_type: EntityType::EmailThread,
                levels,
            });
        }
    }

    rows
}

fn level_cell(level: Option<AccessLevel>) -> &'static str {
    match level {
        Some(AccessLevel::Owner) => "owner",
        Some(AccessLevel::Edit) => "edit",
        Some(AccessLevel::Comment) => "comment",
        Some(AccessLevel::View) => "view",
        None => "-",
    }
}

/// Verify the expected matrix against the live database and print the diff.
/// Returns the number of mismatched cells.
pub async fn verify(pool: sqlx::PgPool, spec: &ScenarioSpec) -> anyhow::Result<usize> {
    let service = EntityAccessServiceImpl::new(PgAccessRepository::new(pool));
    let expected = expected_matrix(spec);
    let user_keys: Vec<&String> = spec.users.keys().collect();

    let mut user_ids = BTreeMap::new();
    for user_key in &user_keys {
        let user_id = spec.user_id(user_key);
        let parsed = MacroUserIdStr::parse_from_str(user_id.clone().leak())
            .map_err(|e| anyhow::anyhow!("invalid user id {user_id}: {e:?}"))?;
        user_ids.insert((*user_key).clone(), parsed);
    }

    let label_width = expected
        .iter()
        .map(|row| row.label.len())
        .chain(std::iter::once(spec.scenario.len()))
        .max()
        .unwrap_or(8)
        .max(8);
    let col_width = user_keys
        .iter()
        .map(|k| k.len())
        .max()
        .unwrap_or(5)
        .max("comment≠comment".len());

    let mut header = format!("{:label_width$}", spec.scenario);
    for user_key in &user_keys {
        header.push_str(&format!(" | {user_key:col_width$}"));
    }
    println!("{header}");
    println!("{}", "-".repeat(header.len()));

    let mut mismatches = 0usize;
    for row in &expected {
        let mut line = format!("{:label_width$}", row.label);
        for user_key in &user_keys {
            let parsed = &user_ids[*user_key];
            let actual = service
                .get_access_level(Some(&**parsed), &row.entity_id, row.entity_type)
                .await
                .map_err(|e| anyhow::anyhow!("access check failed for {}: {e}", row.label))?;
            let expected_level = row.levels.get(*user_key).copied();

            let cell = if actual == expected_level {
                level_cell(expected_level).to_string()
            } else {
                mismatches += 1;
                format!("{}≠{}", level_cell(expected_level), level_cell(actual))
            };
            line.push_str(&format!(" | {cell:col_width$}"));
        }
        println!("{line}");
    }

    if mismatches == 0 {
        println!(
            "\nAll {} entities match the expected access matrix.",
            expected.len()
        );
    } else {
        println!(
            "\n{mismatches} cell(s) differ from the expected matrix (shown as expected≠actual)."
        );
    }
    Ok(mismatches)
}

/// Print the expected matrix without touching the database.
pub fn print_expected(spec: &ScenarioSpec) {
    let expected = expected_matrix(spec);
    let user_keys: Vec<&String> = spec.users.keys().collect();

    let label_width = expected
        .iter()
        .map(|row| row.label.len())
        .max()
        .unwrap_or(8)
        .max(8);
    let col_width = user_keys.iter().map(|k| k.len()).max().unwrap_or(5).max(7);

    let mut header = format!("{:label_width$}", spec.scenario);
    for user_key in &user_keys {
        header.push_str(&format!(" | {user_key:col_width$}"));
    }
    println!("{header}");
    println!("{}", "-".repeat(header.len()));
    for row in &expected {
        let mut line = format!("{:label_width$}", row.label);
        for user_key in &user_keys {
            line.push_str(&format!(
                " | {:col_width$}",
                level_cell(row.levels.get(*user_key).copied())
            ));
        }
        println!("{line}");
    }
}
