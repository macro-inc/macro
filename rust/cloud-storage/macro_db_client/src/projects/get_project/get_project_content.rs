use sqlx::{Pool, Postgres};

use super::get_sub_items;
use model::item::{Item, ItemWithUserAccessLevel};
use models_permissions::share_permission::access_level::AccessLevel;

/// Gets the content of a project to a depth of 1.
/// This includes the projects sub-projects as well as the documents/chats in the project.
/// This returns in order of all projects, documents, then chats.
/// The user access level will be
#[tracing::instrument(skip(db))]
pub async fn get_project_content_v2(
    db: &Pool<Postgres>,
    project_id: &str,
    user_id: &str,
    project_user_access_level: AccessLevel,
) -> anyhow::Result<Vec<ItemWithUserAccessLevel>> {
    let mut transaction = db.begin().await?;

    let sub_projects = get_sub_items::get_sub_projects(&mut transaction, project_id).await?;
    let sub_projects: Vec<ItemWithUserAccessLevel> = sub_projects
        .into_iter()
        .map(|p| {
            let user_access_level = match p.user_id == user_id {
                true => AccessLevel::Owner,
                false => project_user_access_level,
            };
            ItemWithUserAccessLevel {
                item: Item::Project(p),
                user_access_level,
            }
        })
        .collect();

    let sub_documents = get_sub_items::get_sub_documents(&mut transaction, project_id).await?;
    let sub_documents: Vec<ItemWithUserAccessLevel> = sub_documents
        .into_iter()
        .map(|d| {
            let user_access_level = match d.owner == user_id {
                true => AccessLevel::Owner,
                false => project_user_access_level,
            };
            ItemWithUserAccessLevel {
                item: Item::Document(d),
                user_access_level,
            }
        })
        .collect();

    let sub_chats = get_sub_items::get_sub_chats(&mut transaction, project_id).await?;
    let sub_chats: Vec<ItemWithUserAccessLevel> = sub_chats
        .into_iter()
        .map(|c| {
            let user_access_level = match c.user_id == user_id {
                true => AccessLevel::Owner,
                false => project_user_access_level,
            };
            ItemWithUserAccessLevel {
                item: Item::Chat(c),
                user_access_level,
            }
        })
        .collect();

    let mut result: Vec<ItemWithUserAccessLevel> = vec![];
    result.extend(sub_projects);
    result.extend(sub_documents);
    result.extend(sub_chats);

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use model::item::Item;
    use models_permissions::share_permission::access_level::AccessLevel;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(
        path = "../../../fixtures",
        scripts("users", "projects", "documents", "chats")
    ))]
    async fn test_get_project_content_v2(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let result =
            get_project_content_v2(&pool, "p1", "macro|user@user.com", AccessLevel::View).await?;

        let mapped_result: Vec<(String, String)> = result
            .into_iter()
            .map(|p| match p.item {
                Item::Project(p) => (p.id, "project".to_string()),
                Item::Document(d) => (d.document_id, "document".to_string()),
                Item::Chat(c) => (c.id, "chat".to_string()),
            })
            .collect();

        assert_eq!(
            mapped_result,
            vec![
                ("p2".to_string(), "project".to_string()),
                ("p3".to_string(), "project".to_string()),
                ("p4".to_string(), "project".to_string()),
                ("p5".to_string(), "project".to_string()),
                ("d1".to_string(), "document".to_string()),
                ("d3".to_string(), "document".to_string()), // This is included in v2 because the user has access to the project so they'll have access to all items inside
                ("c1".to_string(), "chat".to_string()),
            ]
        );

        Ok(())
    }
}
