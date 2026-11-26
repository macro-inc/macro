//! The entities the probe creates and deletes: markdown documents, messages
//! in a channel of its own, and projects.
//!
//! Channels, messages and projects send their own crates' request types. The
//! documents crate, which holds the document requests, is a whole service
//! domain the probe does not otherwise link, so those bodies are spelled out
//! here, named after the type each mirrors. Responses are read only for the
//! ids the probe needs.

use std::collections::HashSet;

use channels::domain::models::{ChannelType, CreateChannelRequest};
use messages::domain::models::PostMessage;
use messages::domain::ports::MessagePatch;
use model::project::request::{CreateProjectRequest, PatchProjectRequestV2};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::macro_api::{ApiError, Call, MacroApi, NO_BODY};
use crate::domain::model::{EntityId, EntityType, MARKER, Token};
use crate::domain::ports::{Body, CreatedWrites, Title, TitleOrBody};

#[cfg(test)]
mod test;

/// A delete that finds nothing has already done its work.
const GONE: &[StatusCode] = &[StatusCode::NOT_FOUND];

/// The token of `field` among `texts`, which hold one per field the type
/// declares.
fn token_of<F: PartialEq>(texts: &[(F, Token)], field: F) -> Option<Token> {
    texts
        .iter()
        .find(|(each, _)| *each == field)
        .map(|(_, token)| token.clone())
}

/// Mirrors `documents::domain::models::CreateMarkdownDocumentRequest`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateMarkdown<'a> {
    document_name: String,
    markdown: Option<&'a str>,
}

/// Mirrors `documents::domain::models::CreateMarkdownDocumentResponse`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatedMarkdown {
    document_id: Uuid,
}

/// Mirrors the markdown body route's response (`markdown_body.rs`).
#[derive(Deserialize)]
struct MarkdownBody {
    revision: String,
}

/// Mirrors the markdown body route's request (`markdown_body.rs`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplaceMarkdown<'a> {
    markdown: &'a str,
    expected_revision: String,
}

/// No link share and no team share: only the probe user can open the entity.
/// A new document or project starts with the owner's team's default link
/// share, which lets anyone in that team open it by id.
fn private() -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: Some(None),
        link_share_access_level: None,
        team_share_access_level: Some(None),
        channel_share_permissions: None,
    }
}

/// Mirrors `documents::domain::models::EditDocumentServiceArgs`'
/// `sharePermission` field.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShareDocument {
    share_permission: UpdateSharePermissionRequestV2,
}

/// Mirrors `documents::domain::models::EditDocumentServiceArgs`' name field.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenameDocument {
    document_name: String,
}

/// Creates a markdown document titled with `title`, holding `markdown`,
/// shared with no one. One that cannot be made private is deleted, and kept
/// in `unshared` if that fails too, for [`purge_unshared`] to retry.
pub(super) async fn create_markdown(
    api: &MacroApi,
    title: &Token,
    markdown: Option<&str>,
    unshared: &mut Vec<EntityId>,
) -> Result<EntityId, ApiError> {
    let created: CreatedMarkdown = api
        .json(
            Call::new(
                Method::POST,
                "/dss/documents/create_markdown",
                "/dss/documents/create_markdown".to_owned(),
            ),
            Some(&CreateMarkdown {
                document_name: title.title(),
                markdown,
            }),
        )
        .await?;
    let id = EntityId(created.document_id);

    let shared = api
        .send_done(
            Call::new(
                Method::PATCH,
                "/dss/documents/{document_id}",
                format!("/dss/documents/{id}"),
            ),
            Some(&ShareDocument {
                share_permission: private(),
            }),
            &[],
        )
        .await;
    if let Err(error) = shared {
        if let Err(purge) = purge_document(api, id).await {
            tracing::warn!(error = ?purge, entity_id = %id, "the probe could not delete a document it could not make private");
            unshared.push(id);
        }
        return Err(error);
    }
    Ok(id)
}

/// Deletes the documents in `unshared`, keeping the ones that fail again.
/// They still carry the team's default link share, so every create and
/// shutdown tries them first.
pub(super) async fn purge_unshared(api: &MacroApi, unshared: &mut Vec<EntityId>) {
    let mut kept = Vec::new();
    for id in std::mem::take(unshared) {
        if let Err(error) = purge_document(api, id).await {
            tracing::warn!(error = ?error, entity_id = %id, "the probe could not delete a document it could not make private");
            kept.push(id);
        }
    }
    *unshared = kept;
}

/// Deletes a document for good. A trashed document stays in the index.
pub(super) async fn purge_document(api: &MacroApi, id: EntityId) -> Result<(), ApiError> {
    api.send_done(
        Call::new(
            Method::DELETE,
            "/dss/documents/{document_id}/permanent",
            format!("/dss/documents/{id}/permanent"),
        ),
        NO_BODY,
        GONE,
    )
    .await
}

/// Markdown documents: the body is replaced through the same route as the
/// SDK's `setContent`, which reaches search only after the sync service saves
/// the new snapshot.
pub struct Documents {
    api: MacroApi,
    /// Documents it could neither make private nor delete.
    unshared: Vec<EntityId>,
}

impl Documents {
    /// Documents written through `api`.
    pub fn new(api: MacroApi) -> Self {
        Self {
            api,
            unshared: Vec::new(),
        }
    }

    async fn replace_body(&self, id: EntityId, token: &Token) -> Result<(), ApiError> {
        let route = "/dss/documents/{document_id}/markdown";
        let path = format!("/dss/documents/{id}/markdown");
        let current: MarkdownBody = self
            .api
            .json(Call::new(Method::GET, route, path.clone()), NO_BODY)
            .await?;
        self.api
            .send_done(
                Call::new(Method::PUT, route, path),
                Some(&ReplaceMarkdown {
                    markdown: token.as_str(),
                    expected_revision: current.revision,
                }),
                &[],
            )
            .await
    }
}

impl CreatedWrites for Documents {
    type Field = TitleOrBody;
    type Err = ApiError;

    const ENTITY_TYPE: EntityType = EntityType::Document;
    const FIELDS: &'static [TitleOrBody] = &[TitleOrBody::Body, TitleOrBody::Title];

    async fn create(&mut self, texts: &[(TitleOrBody, Token)]) -> Result<EntityId, ApiError> {
        let title = token_of(texts, TitleOrBody::Title).unwrap_or_else(Token::random);
        let body = token_of(texts, TitleOrBody::Body);
        purge_unshared(&self.api, &mut self.unshared).await;
        create_markdown(
            &self.api,
            &title,
            body.as_ref().map(Token::as_str),
            &mut self.unshared,
        )
        .await
    }

    async fn set(
        &mut self,
        id: EntityId,
        field: TitleOrBody,
        token: &Token,
    ) -> Result<(), ApiError> {
        match field {
            TitleOrBody::Body => self.replace_body(id, token).await,
            TitleOrBody::Title => {
                self.api
                    .send_done(
                        Call::new(
                            Method::PATCH,
                            "/dss/documents/{document_id}",
                            format!("/dss/documents/{id}"),
                        ),
                        Some(&RenameDocument {
                            document_name: token.title(),
                        }),
                        &[],
                    )
                    .await
            }
        }
    }

    async fn delete(&mut self, id: EntityId) -> Result<(), ApiError> {
        purge_document(&self.api, id).await
    }

    async fn close(&mut self) {
        purge_unshared(&self.api, &mut self.unshared).await;
    }
}

/// The id of a created channel or message.
#[derive(Deserialize)]
struct Created {
    id: Uuid,
}

/// Messages in a private channel only the probe user is in, made on the
/// first post and deleted at shutdown.
pub struct Messages {
    api: MacroApi,
    channel: Option<Uuid>,
}

impl Messages {
    /// Messages written through `api`.
    pub fn new(api: MacroApi) -> Self {
        Self { api, channel: None }
    }

    async fn channel(&mut self) -> Result<Uuid, ApiError> {
        if let Some(channel) = self.channel {
            return Ok(channel);
        }
        let created: Created = self
            .api
            .json(
                Call::new(Method::POST, "/dss/channels", "/dss/channels".to_owned()),
                Some(&CreateChannelRequest {
                    name: Some(MARKER.to_owned()),
                    channel_type: ChannelType::Private,
                    team_id: None,
                    auto_join_team: false,
                    participants: HashSet::new(),
                }),
            )
            .await?;
        self.channel = Some(created.id);
        Ok(created.id)
    }
}

impl CreatedWrites for Messages {
    type Field = Body;
    type Err = ApiError;

    const ENTITY_TYPE: EntityType = EntityType::Message;
    const FIELDS: &'static [Body] = &[Body];

    async fn create(&mut self, texts: &[(Body, Token)]) -> Result<EntityId, ApiError> {
        let channel = self.channel().await?;
        let content = token_of(texts, Body).unwrap_or_else(Token::random);
        let posted: Result<Created, ApiError> = self
            .api
            .json(
                Call::new(
                    Method::POST,
                    "/dss/messages/channel/{channel_id}",
                    format!("/dss/messages/channel/{channel}"),
                ),
                Some(&PostMessage {
                    attribution: Default::default(),
                    notification_policy: Default::default(),
                    id: None,
                    content: content.as_str().to_owned(),
                    thread_id: None,
                    anchor: None,
                    mentions: Vec::new(),
                    attachments: Vec::new(),
                    nonce: None,
                }),
            )
            .await;
        if let Err(ApiError::Status {
            status: StatusCode::NOT_FOUND | StatusCode::FORBIDDEN,
            ..
        }) = posted
        {
            // The channel is gone or no longer ours: make a new one next time.
            self.channel = None;
        }
        Ok(EntityId(posted?.id))
    }

    async fn set(&mut self, id: EntityId, _: Body, token: &Token) -> Result<(), ApiError> {
        let channel = self.channel().await?;
        self.api
            .send_done(
                Call::new(
                    Method::PATCH,
                    "/dss/messages/channel/{channel_id}/items/{message_id}",
                    format!("/dss/messages/channel/{channel}/items/{id}"),
                ),
                Some(&MessagePatch {
                    content: Some(token.as_str().to_owned()),
                    ..MessagePatch::default()
                }),
                &[],
            )
            .await
    }

    async fn delete(&mut self, id: EntityId) -> Result<(), ApiError> {
        let channel = self.channel().await?;
        self.api
            .send_done(
                Call::new(
                    Method::DELETE,
                    "/dss/messages/channel/{channel_id}/items/{message_id}",
                    format!("/dss/messages/channel/{channel}/items/{id}"),
                ),
                NO_BODY,
                GONE,
            )
            .await
    }

    async fn close(&mut self) {
        let Some(channel) = self.channel.take() else {
            return;
        };
        let deleted = self
            .api
            .send_done(
                Call::new(
                    Method::DELETE,
                    "/dss/channels/{channel_id}",
                    format!("/dss/channels/{channel}"),
                ),
                NO_BODY,
                GONE,
            )
            .await;
        if let Err(error) = deleted {
            tracing::warn!(error = ?error, channel_id = %channel, "the probe could not delete its channel at shutdown");
        }
    }
}

/// `{"data": {"id": ...}}`, how the projects routes wrap what they create.
#[derive(Deserialize)]
struct CreatedProject {
    data: Created,
}

/// Projects.
pub struct Projects {
    api: MacroApi,
    /// Projects it could neither make private nor delete.
    unshared: Vec<EntityId>,
}

impl Projects {
    /// Projects written through `api`.
    pub fn new(api: MacroApi) -> Self {
        Self {
            api,
            unshared: Vec::new(),
        }
    }

    /// Deletes the projects it could not make private, keeping the ones that
    /// fail again.
    async fn delete_unshared(&mut self) {
        for id in std::mem::take(&mut self.unshared) {
            if let Err(error) = self.delete(id).await {
                tracing::warn!(error = ?error, entity_id = %id, "the probe could not delete a project it could not make private");
                self.unshared.push(id);
            }
        }
    }
}

impl CreatedWrites for Projects {
    type Field = Title;
    type Err = ApiError;

    const ENTITY_TYPE: EntityType = EntityType::Project;
    const FIELDS: &'static [Title] = &[Title];

    async fn create(&mut self, texts: &[(Title, Token)]) -> Result<EntityId, ApiError> {
        self.delete_unshared().await;
        let name = token_of(texts, Title).unwrap_or_else(Token::random).title();
        let created: CreatedProject = self
            .api
            .json(
                Call::new(Method::POST, "/dss/projects", "/dss/projects".to_owned()),
                Some(&CreateProjectRequest {
                    name,
                    project_parent_id: None,
                }),
            )
            .await?;
        let id = EntityId(created.data.id);

        // Shared with no one, like the probe's documents; one that cannot be
        // made private is deleted.
        let shared = self
            .api
            .send_done(
                Call::new(
                    Method::PATCH,
                    "/dss/v2/projects/{project_id}",
                    format!("/dss/v2/projects/{id}"),
                ),
                Some(&PatchProjectRequestV2 {
                    name: None,
                    project_parent_id: None,
                    share_permission: Some(private()),
                }),
                &[],
            )
            .await;
        if let Err(error) = shared {
            if let Err(delete) = self.delete(id).await {
                tracing::warn!(error = ?delete, entity_id = %id, "the probe could not delete a project it could not make private");
                self.unshared.push(id);
            }
            return Err(error);
        }
        Ok(id)
    }

    async fn set(&mut self, id: EntityId, _: Title, token: &Token) -> Result<(), ApiError> {
        self.api
            .send_done(
                Call::new(
                    Method::PATCH,
                    "/dss/v2/projects/{project_id}",
                    format!("/dss/v2/projects/{id}"),
                ),
                Some(&PatchProjectRequestV2 {
                    name: Some(token.title()),
                    project_parent_id: None,
                    share_permission: None,
                }),
                &[],
            )
            .await
    }

    /// Trashes the project, then purges it: the purge route removes only a
    /// project already in the trash, and answers success on a live one.
    async fn delete(&mut self, id: EntityId) -> Result<(), ApiError> {
        self.api
            .send_done(
                Call::new(
                    Method::DELETE,
                    "/dss/projects/{project_id}",
                    format!("/dss/projects/{id}"),
                ),
                NO_BODY,
                GONE,
            )
            .await?;
        self.api
            .send_done(
                Call::new(
                    Method::DELETE,
                    "/dss/projects/{project_id}/permanent",
                    format!("/dss/projects/{id}/permanent"),
                ),
                NO_BODY,
                GONE,
            )
            .await
    }

    async fn close(&mut self) {
        self.delete_unshared().await;
    }
}
