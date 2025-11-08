use crate::api::{context::ApiContext, util::count_occurrences};

use axum::{
    Extension,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::cloud_storage::ensure_access::project::ProjectAccessLevelExtractor;
use model::{
    project::BasicProject,
    response::{
        GenericErrorResponse, GenericResponse, GenericSuccessResponse, SuccessResponse,
        TypedSuccessResponse,
    },
    user::UserContext,
};
use models_permissions::share_permission::access_level::OwnerAccessLevel;
use sqs_client::search::{
    SearchQueueMessage, chat::RemoveChatMessage, document::DocumentId, project,
};
use tracing::Instrument;
use utoipa::ToSchema;

#[derive(serde::Deserialize)]
pub struct Params {
    pub id: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct ProjectDeleteResponseData {
    /// The ids of the project that were marked as deleted
    pub project_ids: Vec<String>,
    /// The ids of the documents that were marked as deleted
    pub document_ids: Vec<String>,
    /// The ids of the chats that were marked as deleted
    pub chat_ids: Vec<String>,
}

pub type ProjectDeleteResponse = TypedSuccessResponse<ProjectDeleteResponseData>;

/// Deletes a project.
/// Soft deletes the project and all of its children.
#[utoipa::path(
        tag = "project",
        delete,
        path = "/projects/{id}",
        params(
            ("id" = String, Path, description = "ID of the project")
        ),
        responses(
            (status = 200, body=inline(ProjectDeleteResponse)),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, id), fields(user_id=?user_context.user_id, project_id=?id))]
pub async fn delete_project_handler(
    access: ProjectAccessLevelExtractor<OwnerAccessLevel>,
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { id }): Path<Params>,
    project: Extension<BasicProject>,
) -> impl IntoResponse {
    tracing::info!("delete project");

    let (project_ids, document_ids, chat_ids) =
        match macro_db_client::projects::delete::soft_delete_project(&ctx.db, &id).await {
            Ok(result) => result,
            Err(e) => {
                tracing::error!(error=?e, "unable to delete project");
                return GenericResponse::builder()
                    .message("unable to delete project")
                    .is_error(true)
                    .send(StatusCode::INTERNAL_SERVER_ERROR);
            }
        };

    if let Some(parent_id) = &project.parent_id {
        tracing::info!(
            parent_id,
            "sending project update after deleting child project"
        );
        macro_project_utils::update_project_modified(
            &ctx.db,
            &ctx.macro_notify_client,
            macro_project_utils::ProjectModifiedArgs {
                project_id: None,
                old_project_id: Some(parent_id),
                user_id: user_context.user_id.clone(),
            },
        )
        .await;
    }

    let data = ProjectDeleteResponseData {
        project_ids,
        document_ids,
        chat_ids,
    };

    GenericResponse::builder().data(&data).send(StatusCode::OK)
}

/// Permanently deletes a project and all of it's children.
#[utoipa::path(
        tag = "project",
        delete,
        operation_id = "permanently_delete_project",
        path = "/projects/{id}/permanent",
        params(
            ("id" = String, Path, description = "ID of the project")
        ),
        responses(
            (status = 200, body=SuccessResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn permanently_delete_project_handler(
    access: ProjectAccessLevelExtractor<OwnerAccessLevel>,
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { id }): Path<Params>,
) -> Result<Response, Response> {
    tracing::info!("permanently_delete_project");

    let mut transaction = match ctx.db.begin().await {
        Ok(transaction) => transaction,
        Err(e) => {
            tracing::error!(error=?e, "unable to begin transaction");
            return Ok(GenericResponse::builder()
                .message("unable to begin transaction")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR));
        }
    };

    let project_ids =
        macro_db_client::projects::get_project::get_sub_items::get_all_deleted_sub_project_ids(
            &mut transaction,
            &id,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get all deleted sub-project ids");
            GenericResponse::builder()
                .message("unable to get all deleted sub-project ids")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR)
        })?;

    let project_ids = project_ids
        .into_iter()
        .map(|(id, _)| id)
        .collect::<Vec<String>>();
    tracing::debug!(project_ids=?project_ids, "deleting project(s)");

    let document_ids_and_owner = macro_db_client::projects::get_project::get_project_documents::get_deleted_documents_from_project_ids(&ctx.db, &project_ids).await.map_err(|e| {
        tracing::error!(error=?e, "unable to get deleted documents from project ids");
        GenericResponse::builder()
            .message("unable to get deleted documents from project ids")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR)
    })?;

    // using document ids, get all documents that are docx and get their sha counts for
    // decrementing via redis
    let document_ids = document_ids_and_owner
        .iter()
        .map(|(id, _)| id)
        .collect::<Vec<&String>>();

    let bom_parts =
        macro_db_client::document::get_bom_parts_bulk_tsx(&mut transaction, &document_ids)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to get bom parts for documents");
                GenericResponse::builder()
                    .message("unable to get bom parts for documents")
                    .is_error(true)
                    .send(StatusCode::INTERNAL_SERVER_ERROR)
            })?;

    if !bom_parts.is_empty() {
        tracing::trace!(bom_parts=?bom_parts, "decrementing sha count for bom parts");
        // Transform bom parts into Vec<(sha, count)>
        let sha_counts = count_occurrences(
            bom_parts
                .iter()
                .map(|bp| bp.sha.clone())
                .collect::<Vec<String>>(),
        );

        tracing::trace!("decrementing sha ref count");
        ctx.redis_client
            .decrement_counts(&sha_counts)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to decrement sha ref counts");
                GenericResponse::builder()
                    .message("unable to decrement sha ref counts")
                    .is_error(true)
                    .send(StatusCode::INTERNAL_SERVER_ERROR)
            })?;
    }

    tracing::debug!(document_ids=?document_ids, "deleting document(s)");
    macro_db_client::document::delete_document_bulk_tsx(&mut transaction, &document_ids)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to delete documents bulk");
            GenericResponse::builder()
                .message("unable to delete documents bulk")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR)
        })?;

    let chat_ids = macro_db_client::projects::get_project::get_project_chats::get_deleted_chats_from_project_ids(&ctx.db, &project_ids).await.map_err(|e| {
        tracing::error!(error=?e, "unable to get deleted chats from project ids");
        GenericResponse::builder()
            .message("unable to get deleted chats from project ids")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR)
    })?;
    let chat_ids = chat_ids
        .into_iter()
        .map(|(id, _)| id)
        .collect::<Vec<String>>();

    tracing::debug!(chat_ids=?chat_ids, "deleting chat(s)");
    macro_db_client::chat::delete::delete_chat_bulk_tsx(&mut transaction, &chat_ids)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to delete chats bulk");
            GenericResponse::builder()
                .message("unable to delete chats bulk")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR)
        })?;

    // Deletes all projects in bulk
    macro_db_client::projects::delete::delete_projects_bulk_tsx(&mut transaction, &project_ids)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to delete projects bulk");
            GenericResponse::builder()
                .message("unable to delete projects bulk")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR)
        })?;

    if let Err(e) = transaction.commit().await {
        tracing::error!(error=?e, "unable to commit transaction");
        return Err(GenericResponse::builder()
            .message("unable to commit transaction")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR));
    }

    if !chat_ids.is_empty() {
        tokio::spawn({
            let sqs_client = ctx.sqs_client.clone();
            let chat_ids = chat_ids.clone();
            async move {
                let _ = sqs_client
                    .bulk_send_message_to_search_event_queue(
                        chat_ids
                            .iter()
                            .map(|id| {
                                SearchQueueMessage::RemoveChatMessage(RemoveChatMessage {
                                    chat_id: id.to_string(),
                                    message_id: None,
                                })
                            })
                            .collect(),
                    )
                    .await
                    .inspect_err(
                        |e| tracing::error!(error=?e, "unable to enqueue delete chats for search"),
                    );
            }
        });
    }

    if !document_ids_and_owner.is_empty() {
        tokio::spawn({
            let sqs_client = ctx.sqs_client.clone();
            let document_ids_and_owner = document_ids_and_owner.clone();
            async move {
                let _ = sqs_client
                    .bulk_send_message_to_search_event_queue(
                        document_ids_and_owner
                            .iter()
                            .map(|(id, _)| {
                                SearchQueueMessage::RemoveDocument(DocumentId {
                                    document_id: id.to_string(),
                                })
                            })
                            .collect(),
                    )
                    .await
                    .inspect_err(|e| tracing::error!(error=?e, "unable to enqueue delete documents for search"));

                let _ = sqs_client
                    .bulk_enqueue_document_delete_with_owner(document_ids_and_owner)
                    .await
                    .inspect_err(
                        |e| tracing::error!(error=?e, "unable to enqueue delete documents"),
                    );
            }
        });
    }

    let response_data = GenericSuccessResponse { success: true };

    // delete projects from search
    // NOTE: project_ids should contain the root project in addition
    // to the other projects, so the deletion can be done in one call
    tokio::spawn({
        let sqs_client = ctx.sqs_client.clone();
        let project_ids = project_ids.clone();
        async move {
            tracing::trace!("sending message to search extractor queue");
            let _ = sqs_client
                .send_message_to_search_event_queue(SearchQueueMessage::BulkRemoveProjectMessage(
                    project::BulkRemoveProjectMessage { project_ids },
                ))
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "SEARCH_QUEUE unable to enqueue message");
                });
        }
        .in_current_span()
    });

    Ok(GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK))
}
