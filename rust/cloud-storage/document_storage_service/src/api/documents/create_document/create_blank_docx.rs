use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::cloud_storage::ensure_access::project::ProjectBodyAccessLevelExtractor;
use models_permissions::share_permission::access_level::EditAccessLevel;

use crate::{api::context::ApiContext, model::request::documents::create::CreateBlankDocxRequest};
use model::{
    document::{DocumentMetadata, SaveBomPart},
    response::GenericErrorResponse,
    user::UserContext,
};

/// Creates a new blank docx file for the user
#[utoipa::path(
        post,
        path = "/documents/blank_docx",
        operation_id = "create_blank_docx",
        request_body = CreateBlankDocxRequest,
        responses(
            (status = 200, body=DocumentMetadata),
            (status = 401, body=GenericErrorResponse),
            (status = 403, body=GenericErrorResponse),
            (status = 400, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, project), fields(user_id=?user_context.user_id))]
pub(in crate::api) async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, CreateBlankDocxRequest>,
) -> Result<Response, Response> {
    let req = project.into_inner();

    // Hardcoded blank docx file that is broken into it's bom parts
    // TODO: we will need some sort of script to populate this for other envs in the future
    let blank_docx_bom_parts: Vec<SaveBomPart> = vec![
        SaveBomPart {
            path: "[Content_Types].xml".to_string(),
            sha: "bda1ffc7b056aa39e84d557fd224ff3a2e26099961c5133d6c7367208b1351dc".to_string(),
        },
        SaveBomPart {
            path: "_rels/.rels".to_string(),
            sha: "c30fe099dbcfed4ecc4ae544ccf82f432c8d3bb665e2a301df283738b196d803".to_string(),
        },
        SaveBomPart {
            path: "word/_rels/document.xml.rels".to_string(),
            sha: "b725d5476e76f555fc24ecb908474fd29b671687336e5e1177a5c4c35cb5939f".to_string(),
        },
        SaveBomPart {
            path: "word/document.xml".to_string(),
            sha: "64bdf246efebfe0f7356698fbbbe2e6d0662450bcbe17b2bb6dd38793cc258b1".to_string(),
        },
        SaveBomPart {
            path: "word/theme/theme1.xml".to_string(),
            sha: "fe83a235c1dfa45cc081c3b2ad60fe4416bf0d1e05e46b02bd2293bdc5f4bc68".to_string(),
        },
        SaveBomPart {
            path: "word/settings.xml".to_string(),
            sha: "aba5e632b6f7a92b179fa0366aa9d7b3c6d37bbdc66174da5f911d9cac937fda".to_string(),
        },
        SaveBomPart {
            path: "docProps/core.xml".to_string(),
            sha: "530df3afaf5a42dab8a9ac918cba19f5989ccced888d36090095a7e11328539c".to_string(),
        },
        SaveBomPart {
            path: "word/fontTable.xml".to_string(),
            sha: "287be69ef4600ea93a78f085ee0442c324ff124c0f1ee221a8ec8cf045645e6e".to_string(),
        },
        SaveBomPart {
            path: "docProps/custom.xml".to_string(),
            sha: "cc5d15cf09603a3325ce4ccd1bae9553b27b6722f6c5c027615300f970f3a573".to_string(),
        },
        SaveBomPart {
            path: "word/webSettings.xml".to_string(),
            sha: "c99d68045ebe2a916a8ff7997daa87efa2526650089c91c0e7529b73b2ea33c7".to_string(),
        },
        SaveBomPart {
            path: "word/styles.xml".to_string(),
            sha: "d6a5bd435203456c0e73baa643555292aaeb90a6b677cd8aaf5de84c82dc7880".to_string(),
        },
        SaveBomPart {
            path: "docProps/app.xml".to_string(),
            sha: "365d2edf78885ab0dbaa801ca8b63e930ddb8f35f6edc834d897153ee4588910".to_string(),
        },
    ];

    let shas = blank_docx_bom_parts
        .iter()
        .map(|b| b.sha.clone())
        .collect::<Vec<String>>();

    // Get the share permissions
    let share_permission = macro_share_permissions::share_permission::create_new_share_permission();

    let document_metadata: DocumentMetadata =
        macro_db_client::document::create_blank_docx::create_blank_docx(
            ctx.db.clone(),
            "New Document",
            &user_context.user_id,
            req.project_id.as_deref(),
            &share_permission,
            blank_docx_bom_parts,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to create blank docx document");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(GenericErrorResponse {
                    error: true,
                    message: "unable to create blank docx document".to_string(),
                }),
            )
                .into_response()
        })?;

    // Incr the SHA count
    if let Err(e) = ctx.redis_client.increment_counts(shas).await {
        // We don't actually care if this fails, the sha counts being messed
        // up is not the end of the world.
        tracing::error!(error=?e, "unable to increment sha ref count");
    }

    Ok((StatusCode::OK, Json(document_metadata)).into_response())
}
