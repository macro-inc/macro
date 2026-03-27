use anyhow::Result;
use macro_user_id::user_id::MacroUserIdStr;
use model::item::{Item, ItemWithUserAccessLevel};
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{Pool, Postgres};

#[derive(Debug, Clone)]
pub struct ScribeProjectPreview(pub Vec<ItemWithUserAccessLevel>);

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
        for (i, item) in self.0.iter().enumerate() {
            writeln!(f, "{}.", i)?;
            format_item_with_access(item, f)?;
        }
        Ok(())
    }
}

pub struct ProjectFetcher<Content> {
    pub content: Content,
    pub id: String,
}

pub type NoData = ();

impl ProjectFetcher<NoData> {
    pub fn new(id: String) -> Self {
        Self { content: (), id }
    }

    pub async fn content(
        &self,
        db: &Pool<Postgres>,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<ProjectFetcher<ScribeProjectPreview>> {
        let items = macro_db_client::projects::get_project::get_project_content_v2(
            db,
            &self.id,
            user_id,
            AccessLevel::View,
        )
        .await?;

        Ok(ProjectFetcher {
            content: ScribeProjectPreview(items),
            id: self.id.clone(),
        })
    }
}

impl std::fmt::Display for ProjectFetcher<ScribeProjectPreview> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Items in project {}\n{}", self.id, self.content)
    }
}
