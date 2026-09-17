use crate::api::context::{ApiContext, AuthorizationService};
use activity::{Actor, Attribution};
use axum::{
    extract::State,
    response::{IntoResponse, Json, Response},
};
use channels::domain::{models::CreateEntityMentionOptions, ports::ChannelService};
use documents_hex::domain::{
    create::{MarkdownSubtype, NewDocumentMetadata, NewMarkdownTextDocument},
    models::{DocumentError, PropertyInput},
    starter::seed_starter_documents,
};
use entity_access::domain::{
    models::{BotAccessScope, EditAccessLevel, ViewAccessLevel},
    ports::EntityAccessService,
};
use favorites::domain::ports::FavoritesService;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_user_id::user_id::MacroUserIdStr;
use model::document_storage_service_internal::{
    InitializeStarterDocsResponse, StarterDocHowToGuide,
};
use model::response::GenericResponse;
use model_entity::EntityType;
use models_properties::api::{AddPropertyOptionRequest, AddStringOptionRequest, SetPropertyValue};
use models_properties::service::property_option::PropertyOptionValue;
use properties::{PropertiesService as _, domain::model::TagScope};
use reqwest::StatusCode;
use system_properties::{PriorityOption, StatusOption, SystemPropertyKey};

/// Also the name `get_starter_docs` resolves the guide by, so the two stay in
/// sync from one definition.
pub(in crate::api) const HOW_TO_GUIDE_NAME: &str = "Macro how to guide";
const HOW_TO_GUIDE_TEMPLATE: &str = include_str!("./template/macro_how_to_guide.md");

/// A starter task the templates can mention. Mention tags embed the target's
/// document id and name, which don't exist at authoring time, so templates
/// carry the placeholder strings instead: `id_placeholder` inside
/// `documentId` fields and `name_placeholder` inside `documentName` fields
/// of `<m-document-mention>`/`<m-document-card>` tags. Each user gets
/// deterministic ids substituted at creation time.
struct StarterTask {
    name: &'static str,
    template: &'static str,
    id_placeholder: &'static str,
    name_placeholder: &'static str,
    /// Initial priority, so the reading order (High → Low) shows
    /// in the default priority-sorted task list.
    priority: PriorityOption,
}

const STARTER_TASKS: [StarterTask; 3] = [
    StarterTask {
        name: "Intro to tasks",
        template: include_str!("./template/learn_about_tasks.md"),
        id_placeholder: "LEARN_ABOUT_TASKS_ID",
        name_placeholder: "LEARN_ABOUT_TASKS_NAME",
        priority: PriorityOption::High,
    },
    StarterTask {
        name: "Advanced task features",
        template: include_str!("./template/advanced_task_features.md"),
        id_placeholder: "ADVANCED_TASK_FEATURES_ID",
        name_placeholder: "ADVANCED_TASK_FEATURES_NAME",
        priority: PriorityOption::Medium,
    },
    StarterTask {
        name: "How we use tasks at Macro",
        template: include_str!("./template/how_we_use_tasks.md"),
        id_placeholder: "HOW_WE_USE_TASKS_ID",
        name_placeholder: "HOW_WE_USE_TASKS_NAME",
        priority: PriorityOption::Low,
    },
];

/// Gateway push sent after each attempt publishes its available starter content,
/// including the guide favorite when available. Signup seeding is fire-and-forget,
/// so a fresh account's app is often already open with empty Soup and favorites
/// lists cached; the
/// web client invalidates those lists and provisioned properties on this
/// message.
const STARTER_DOCS_INITIALIZED_MESSAGE_TYPE: &str = "starter_docs_initialized";

/// Label of the personal tag applied to every starter doc.
const DOCS_TAG_LABEL: &str = "docs";
/// Blue from the fixed tag palette (`tagColors.ts` / the properties toolset
/// `TagColor`) — options with colors outside the palette won't render in the
/// tag picker.
const DOCS_TAG_COLOR: &str = "#0091FF";

/// Fixed namespace for deriving deterministic per-user starter-document ids.
const STARTER_DOC_ID_NAMESPACE: uuid::Uuid =
    uuid::Uuid::from_u128(0x3d1c_5f86_9e4b_45d2_a7c8_6b0e_2f9a_1d47);

/// Deterministic id for one of a user's starter documents (UUIDv5 over the
/// user id and document name). Every retry — including a concurrent
/// duplicate webhook delivery — computes the same id, so the primary key
/// dedupes creation instead of a rerun seeding a document twice.
pub(in crate::api) fn starter_doc_id(
    user_id: &MacroUserIdStr<'_>,
    document_name: &str,
) -> uuid::Uuid {
    uuid::Uuid::new_v5(
        &STARTER_DOC_ID_NAMESPACE,
        format!("{}:{document_name}", user_id.as_ref()).as_bytes(),
    )
}

/// Find-or-create the user's personal "docs" tag, returning its
/// `(property_definition_id, option_id)`. Provisions the personal tag set on
/// first use. Tags are matched by label, so a pre-existing "docs" tag (or a
/// rerun that got this far before failing) is reused, never duplicated.
async fn resolve_docs_tag(
    state: &ApiContext,
    user_id: &MacroUserIdStr<'_>,
) -> Option<(uuid::Uuid, uuid::Uuid)> {
    let tag_set = state
        .properties_service
        .ensure_tag_set(user_id, None, TagScope::User)
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to provision personal tag set"))
        .ok()?;
    let Some(definition_id) = tag_set.definition.as_ref().map(|definition| definition.id) else {
        tracing::error!("provisioned personal tag set has no definition");
        return None;
    };

    if let Some(existing) = tag_set.options.iter().find(|option| {
        matches!(&option.value, PropertyOptionValue::String(label) if label == DOCS_TAG_LABEL)
    }) {
        return Some((definition_id, existing.id));
    }

    state
        .properties_service
        .get_or_create_property_option(
            user_id,
            None,
            definition_id,
            &AddPropertyOptionRequest::SelectString {
                option: AddStringOptionRequest {
                    display_order: tag_set.options.len() as i32,
                    value: DOCS_TAG_LABEL.to_string(),
                    color: Some(DOCS_TAG_COLOR.to_string()),
                },
            },
        )
        .await
        .inspect_err(|e| tracing::error!(error=?e, "failed to create personal docs tag"))
        .ok()
        .map(|option| (definition_id, option.id))
}

fn internal_error(message: &str) -> Response {
    GenericResponse::builder()
        .message(message)
        .is_error(true)
        .send(StatusCode::INTERNAL_SERVER_ERROR)
}

/// Creates the user's starter content — the "Macro how to guide" markdown
/// document plus the starter tasks it links to — records the mention
/// backlinks between them, and pins the guide to the user's sidebar
/// favorites. Called by the authentication service when a new user signs up.
/// Safe to retry: deterministic per-user ids dedupe concurrent duplicate
/// deliveries, and a create conflict means that document was already seeded.
#[tracing::instrument(skip(state, user_context), fields(user_id=?user_context.authorization.user.macro_user_id))]
pub async fn handler(
    State(state): State<ApiContext>,
    user_context: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, Response> {
    tracing::info!("initialize starter docs");

    let user_id = &user_context.authorization.user.macro_user_id;
    let system_for_user = Attribution::delegated(
        Actor::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID),
        user_id.clone(),
    );

    // Resolve every starter document's deterministic id up front so the
    // templates can cross-link before any document has been created.
    let task_ids: Vec<String> = STARTER_TASKS
        .iter()
        .map(|task| starter_doc_id(user_id, task.name).to_string())
        .collect();
    let guide_id = starter_doc_id(user_id, HOW_TO_GUIDE_NAME).to_string();

    // The guide needs real tag IDs; independent tasks can still be created
    // if resolution fails. Report incomplete seeding only after publishing
    // the content that was successfully created, so the caller can retry.
    let docs_tag = resolve_docs_tag(&state, user_id).await;
    let mut incomplete = docs_tag.is_none();
    let fill = |template: &str| {
        let mut filled = template.to_string();
        if let Some((tag_definition_id, tag_option_id)) = docs_tag {
            filled = filled
                .replace("DOCS_TAG_OPTION_ID", &tag_option_id.to_string())
                .replace("DOCS_TAG_DEFINITION_ID", &tag_definition_id.to_string())
                .replace("DOCS_TAG_LABEL", DOCS_TAG_LABEL)
                .replace("DOCS_TAG_COLOR", DOCS_TAG_COLOR);
        }
        for (task, id) in STARTER_TASKS.iter().zip(&task_ids) {
            filled = filled
                .replace(task.id_placeholder, id)
                .replace(task.name_placeholder, task.name);
        }
        filled
    };

    let organization_id = user_context
        .authorization
        .user
        .user_context
        .organization_id
        .map(i64::from);
    // Await each tag attempt before the next create, but do not let a tag
    // failure prevent the remaining documents from becoming available.
    let state_ref = &state;
    let tag_document = |id: uuid::Uuid| async move {
        let state = state_ref;
        let document_id = id.to_string();
        let Some((tag_definition_id, tag_option_id)) = docs_tag else {
            return Err(DocumentError::Internal(anyhow::anyhow!(
                "failed to resolve starter doc tag"
            )));
        };
        let receipt = state
            .entity_access_service
            .generate_bot_entity_access_receipt::<EditAccessLevel>(
                bot_id::MACRO_SYSTEM_BOT_ID,
                BotAccessScope::User {
                    user_id: user_id.clone(),
                    user_org_id: organization_id,
                },
                &document_id,
                EntityType::Document,
            )
            .await
            .map_err(|e| {
                tracing::error!(error=?e, document_id, "failed to authorize starter doc tag");
                DocumentError::Internal(anyhow::anyhow!(e))
            })?;
        state
            .properties_service
            .add_entity_property_option(&receipt, tag_definition_id, tag_option_id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, document_id, "failed to tag starter doc");
                DocumentError::Internal(anyhow::anyhow!(e))
            })
    };

    let mut documents: Vec<_> = STARTER_TASKS
        .iter()
        .map(|task| {
            let id = starter_doc_id(user_id, task.name);
            (
                id,
                NewMarkdownTextDocument {
                    metadata: NewDocumentMetadata::builder(task.name)
                        .id(id)
                        .attribution(system_for_user.clone())
                        .build(),
                    markdown: fill(task.template),
                    subtype: MarkdownSubtype::Task {
                        // Providing properties replaces the task defaults, so include
                        // the normal assignee and status alongside the initial priority.
                        property_values: Some(vec![
                            PropertyInput {
                                property_id: SystemPropertyKey::ASSIGNEES_UUID.to_string(),
                                value: SetPropertyValue::MultiEntityReference {
                                    references: vec![models_properties::EntityReference {
                                        entity_id: user_id.as_ref().to_string(),
                                        entity_type: models_properties::EntityType::User,
                                        specific_message_id: None,
                                    }],
                                },
                            },
                            PropertyInput {
                                property_id: SystemPropertyKey::STATUS_UUID.to_string(),
                                value: SetPropertyValue::SelectOption {
                                    option_id: StatusOption::NotStarted.uuid(),
                                },
                            },
                            PropertyInput {
                                property_id: SystemPropertyKey::PRIORITY_UUID.to_string(),
                                value: SetPropertyValue::SelectOption {
                                    option_id: task.priority.uuid(),
                                },
                            },
                        ]),
                        share_with_team: false,
                        team_id: None,
                    },
                },
            )
        })
        .collect();
    let guide_uuid = starter_doc_id(user_id, HOW_TO_GUIDE_NAME);
    if docs_tag.is_some() {
        documents.push((
            guide_uuid,
            NewMarkdownTextDocument {
                metadata: NewDocumentMetadata::builder(HOW_TO_GUIDE_NAME)
                    .id(guide_uuid)
                    .attribution(system_for_user.clone())
                    .build(),
                markdown: fill(HOW_TO_GUIDE_TEMPLATE),
                subtype: MarkdownSubtype::Note,
            },
        ));
    }
    let seeded = seed_starter_documents(
        documents,
        |document| async move {
            state_ref
                .documents_state
                .creator
                .create_markdown_text(user_id.clone(), document)
                .await
                .map(|_| ())
        },
        tag_document,
    )
    .await;
    incomplete |= seeded.incomplete;
    let guide_available = seeded.available.contains(&guide_uuid);
    let created_now: std::collections::HashSet<_> = seeded
        .created
        .into_iter()
        .map(|id| id.to_string())
        .collect();

    // Record mention backlinks (the References panel) for the starter set.
    // The mention graph is derived from the templates themselves: a source
    // template containing a task's id placeholder mentions that task. Only
    // sources created by this call are recorded: `create_entity_mention`
    // does not dedupe, and the call that created a document is the only one
    // that records its backlinks. Best-effort — the mentions live in the
    // document text regardless; a failed row only means a missing
    // References entry.
    let mut mention_pairs: Vec<(String, String)> = Vec::new();
    for (target, target_id) in STARTER_TASKS.iter().zip(&task_ids) {
        if HOW_TO_GUIDE_TEMPLATE.contains(target.id_placeholder) && created_now.contains(&guide_id)
        {
            mention_pairs.push((guide_id.clone(), target_id.clone()));
        }
        for (source, source_id) in STARTER_TASKS.iter().zip(&task_ids) {
            if source_id != target_id
                && source.template.contains(target.id_placeholder)
                && created_now.contains(source_id)
            {
                mention_pairs.push((source_id.clone(), target_id.clone()));
            }
        }
    }
    for (source_id, target_id) in mention_pairs {
        let _ = state
            .channel_service
            .create_entity_mention(CreateEntityMentionOptions {
                source_entity_type: "document".to_string(),
                source_entity_id: source_id.clone(),
                entity_type: "document".to_string(),
                entity_id: target_id.to_string(),
                user_id: Some(user_context.authorization.user.user_context.user_id.clone()),
            })
            .await
            .inspect_err(|e| {
                tracing::error!(
                    error=?e,
                    source_id=%source_id,
                    target_id=%target_id,
                    "failed to record starter doc mention backlink"
                );
            });
    }

    // Runs on every call, not just document creation: `add_favorite` is an
    // upsert, and re-favoriting reconciles a prior attempt that created the
    // guide but failed before the favorite was written.
    if guide_available {
        let favorite_result = async {
            let how_to_guide_receipt = state
                .entity_access_service
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    user_id,
                    organization_id,
                    &guide_id,
                    EntityType::Document,
                )
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, "failed to authorize how to guide document favorite");
                    internal_error("failed to favorite how to guide document")
                })?;

            state
                .favorites_service
                .add_favorite(&how_to_guide_receipt)
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, "failed to favorite how to guide document");
                    internal_error("failed to favorite how to guide document")
                })?;
            Ok::<(), Response>(())
        }
        .await;
        if favorite_result.is_err() {
            incomplete = true;
        }
    }

    // Best-effort: a missed push just means the sidebar catches up on the
    // next favorites refetch instead of live.
    let _ = state
        .conn_gateway_client
        .send_message(
            EntityType::User
                .with_entity_str(user_context.authorization.user.macro_user_id.as_ref()),
            STARTER_DOCS_INITIALIZED_MESSAGE_TYPE.to_string(),
            serde_json::json!({}),
        )
        .await
        .inspect_err(|e| {
            tracing::warn!(error=?e, "failed to push starter docs initialized");
        });

    if incomplete {
        return Err(internal_error(
            "starter document initialization incomplete; retry required",
        ));
    }

    Ok((
        StatusCode::OK,
        Json(InitializeStarterDocsResponse {
            how_to_guide: Some(StarterDocHowToGuide {
                document_id: guide_id,
                document_name: HOW_TO_GUIDE_NAME.to_string(),
            }),
        }),
    )
        .into_response())
}
