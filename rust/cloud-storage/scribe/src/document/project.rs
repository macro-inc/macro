use anyhow::Result;
use document_storage_service_client::DocumentStorageServiceClient;
use model::item::{Item, ItemWithUserAccessLevel};
use model::project::response::GetProjectContentResponse;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct ScribeProjectPreview(pub GetProjectContentResponse);

pub fn format_item_with_access(
    item: &ItemWithUserAccessLevel,
    f: &mut std::fmt::Formatter<'_>,
) -> std::fmt::Result {
    if let Some(file_type) = item.item.file_type() {
        writeln!(f, "name: {} {}", item.item.name(), file_type)?;
    } else {
        writeln!(f, "name: {}", item.item.name())?;
    }
    writeln!(
        f,
        "id: {}",
        match &item.item {
            Item::Document(doc) => doc.document_id.as_str(),
            Item::Project(project) => project.id.as_str(),
            Item::Chat(chat) => chat.id.as_str(),
        }
    )?;
    writeln!(
        f,
        "type: {}",
        match &item.item {
            Item::Chat(_) => "Chat",
            Item::Project(_) => "Project",
            Item::Document(_) => "Document",
        }
    )?;
    writeln!(f, "access_level: {}", item.user_access_level)
}

impl std::fmt::Display for ScribeProjectPreview {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for (i, item) in self.0.data.iter().enumerate() {
            writeln!(f, "{}.", i)?;
            format_item_with_access(item, f)?;
        }
        Ok(())
    }
}

pub struct ProjectFetcher<Content> {
    inner_dss: Arc<DocumentStorageServiceClient>,
    pub content: Content,
    pub id: String,
    pub jwt: String,
}

pub type NoData = ();

impl ProjectFetcher<NoData> {
    pub fn new(client: Arc<DocumentStorageServiceClient>, id: String, jwt: String) -> Self {
        Self {
            content: (),
            id,
            jwt,
            inner_dss: client,
        }
    }

    pub async fn content(&mut self) -> Result<ProjectFetcher<ScribeProjectPreview>> {
        self.inner_dss
            .get_project(&self.id, &self.jwt)
            .await
            .map(|response| ProjectFetcher {
                content: ScribeProjectPreview(response),
                id: self.id.clone(),
                inner_dss: self.inner_dss.clone(),
                jwt: self.jwt.clone(),
            })
    }
}

impl std::fmt::Display for ProjectFetcher<ScribeProjectPreview> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Items in project {}\n{}", self.id, self.content)
    }
}
