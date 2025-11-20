use std::collections::HashMap;

use super::get_project::get_sub_items::get_all_sub_project_ids;
use crate::{
    history::add_user_history_for_project_tree, share_permission::create::create_project_permission,
};
use async_recursion::async_recursion;
use model::{
    document::{DocumentMetadata, FileType, FileTypeExt},
    folder::{FileSystemNode, FileSystemNodeWithIds, UploadFolderWithIdsResponse},
    project::Project,
};
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{Pool, Postgres, Transaction};

/// Given the root folder file system node, this will create all necessary projects/documents
/// to mimic the folder that a user uploaded. Returns the extended filesystem node with IDs.
#[tracing::instrument(skip(transaction, root_folder), fields(root_folder=?root_folder))]
pub async fn upload_folder_with_ids(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
    share_permission: &SharePermissionV2,
    root_folder: &FileSystemNode,
    root_folder_name: &str,
    upload_request_id: &str,
    parent_id: Option<&str>,
) -> anyhow::Result<UploadFolderWithIdsResponse> {
    // Create root project
    let root_project = create_project(
        transaction,
        user_id,
        share_permission,
        root_folder_name,
        parent_id.map(|s| s.to_string()),
        upload_request_id,
    )
    .await?;

    let mut result_project_ids: Vec<String> = Vec::new();
    let mut result_documents = Vec::new();

    result_project_ids.push(root_project.id.clone());

    match root_folder {
        FileSystemNode::File(_) => {
            anyhow::bail!("Expected a folder node, found a file")
        }
        FileSystemNode::Folder(folder_content) => {
            let mut extended_content = HashMap::new();
            for (name, node) in folder_content {
                let extended_node = traverse_with_ids(
                    transaction,
                    node,
                    user_id,
                    share_permission,
                    name,
                    Some((root_project.id.as_str(), root_project.name.as_str())),
                    &mut result_project_ids,
                    &mut result_documents,
                    upload_request_id,
                )
                .await?;

                extended_content.insert(name.clone(), extended_node);
            }

            let document_ids: Vec<String> = result_documents
                .iter()
                .map(|d| d.document_id.clone())
                .collect();
            let project_ids: Vec<String> = result_project_ids.clone();

            let result_node = FileSystemNodeWithIds::Folder {
                content: extended_content,
                project_id: root_project.id,
            };

            let result = UploadFolderWithIdsResponse {
                file_system: result_node,
                project_ids: result_project_ids,
                documents: result_documents,
            };

            add_user_history_for_project_tree(transaction, user_id, &project_ids, &document_ids)
                .await?;

            return Ok(result);
        }
    }
}

#[async_recursion]
#[expect(clippy::too_many_arguments, reason = "too annoying to fix")]
async fn traverse_with_ids(
    transaction: &mut Transaction<'_, Postgres>,
    node: &FileSystemNode,
    user_id: &str,
    share_permission: &SharePermissionV2,
    key: &str,
    parent_project: Option<(&str, &str)>, // id, name
    result_project_ids: &mut Vec<String>,
    result_documents: &mut Vec<DocumentMetadata>,
    upload_request_id: &str,
) -> anyhow::Result<FileSystemNodeWithIds> {
    match node {
        FileSystemNode::File(item) => {
            if let Some((project_id, project_name)) = parent_project {
                let document = crate::document::v2::create::create_document_txn(
                    transaction,
                    crate::document::v2::create::CreateDocumentArgs {
                        id: None,
                        sha: item.sha.as_str(),
                        document_name: &FileType::clean_document_name(&item.name)
                            .unwrap_or_else(|| item.name.clone()),
                        user_id,
                        file_type: item.file_type,
                        project_id: Some(project_id),
                        project_name: Some(project_name),
                        share_permission,
                        skip_history: true,
                        email_attachment_id: None,
                        created_at: None,
                    },
                )
                .await?;

                // Add document to the documents vector
                result_documents.push(document.clone());

                Ok(FileSystemNodeWithIds::File {
                    item: item.clone(),
                    document_id: document.document_id,
                })
            } else {
                tracing::warn!("No project present for file upload");
                Err(anyhow::anyhow!("No project present for file upload"))
            }
        }
        FileSystemNode::Folder(folder_content) => {
            if let Some((project_id, _)) = parent_project {
                let project = create_project(
                    transaction,
                    user_id,
                    share_permission,
                    key,
                    Some(project_id.to_string()),
                    upload_request_id,
                )
                .await?;

                result_project_ids.push(project.id.clone());

                let mut extended_content = HashMap::new();

                // Iterate over the folder's content and recurse into each node
                for (name, sub_node) in folder_content {
                    let extended_node = traverse_with_ids(
                        transaction,
                        sub_node,
                        user_id,
                        share_permission,
                        name,
                        Some((project.id.as_str(), project.name.as_str())),
                        result_project_ids,
                        result_documents,
                        upload_request_id,
                    )
                    .await?;

                    extended_content.insert(name.clone(), extended_node);
                }

                Ok(FileSystemNodeWithIds::Folder {
                    content: extended_content,
                    project_id: project.id,
                })
            } else {
                tracing::warn!("No project present for folder upload");
                Err(anyhow::anyhow!("No project present for folder upload"))
            }
        }
    }
}

/// Creates a project for the folder traversal
async fn create_project(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
    share_permission: &SharePermissionV2,
    name: &str,
    parent_id: Option<String>,
    upload_request_id: &str,
) -> anyhow::Result<Project> {
    let project = sqlx::query_as!(
        Project,
        r#"
        INSERT INTO "Project" ("name", "userId", "parentId", "createdAt", "updatedAt", "uploadPending", "uploadRequestId")
        VALUES ($1, $2, $3, NOW(), NOW(), TRUE, $4)
        RETURNING id, name, "userId"::text as user_id, "createdAt"::timestamptz as created_at, "deletedAt"::timestamptz as deleted_at,
        "updatedAt"::timestamptz as updated_at, "parentId" as parent_id
        "#,
        name,
        user_id,
        parent_id,
        upload_request_id
    )
    .fetch_one(transaction.as_mut())
    .await?;

    // Create share permission
    create_project_permission(transaction, &project.id, share_permission).await?;

    crate::item_access::insert::insert_user_item_access(
        transaction,
        user_id,
        &project.id,
        "project",
        AccessLevel::Owner,
        None,
    )
    .await?;

    Ok(project)
}

/// Recursively marks a project and all its child projects as no longer having uploadPending=true
/// Returns a list of all project IDs that were marked as uploaded
pub async fn mark_projects_uploaded(
    db: Pool<Postgres>,
    // TODO: remove user_id from this function, this was used for adding user history
    _user_id: &str,
    root_project_id: &str,
) -> anyhow::Result<Vec<String>> {
    let mut transaction = db.begin().await?;

    // Get all sub-project IDs of the root project (including the root itself)
    let project_ids = get_all_sub_project_ids(&mut transaction, root_project_id).await?;

    if project_ids.is_empty() {
        return Err(anyhow::anyhow!("Project not found: {}", root_project_id));
    }

    // Update all projects to set uploadPending to false
    sqlx::query!(
        r#"
        UPDATE "Project"
        SET "uploadPending" = false
        WHERE id = ANY($1)
        RETURNING id
        "#,
        &project_ids[..],
    )
    .fetch_all(transaction.as_mut())
    .await?;

    transaction.commit().await?;

    Ok(project_ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use model::{
        document::FileType,
        folder::{FileSystemNode, FolderItem},
    };
    use models_permissions::share_permission::SharePermissionV2;
    use sqlx::{Pool, Postgres};
    use std::collections::HashMap;
    use uuid::Uuid;

    async fn create_test_permission(pool: &Pool<Postgres>) -> anyhow::Result<SharePermissionV2> {
        // insert macro user into user table
        let _user = sqlx::query!(
            r#"
            INSERT INTO "User" ("id", "email") 
            VALUES ($1, $2)
            RETURNING id
            "#,
            "macro|user@user.com",
            "user@user.com"
        )
        .fetch_one(pool)
        .await?;

        Ok(SharePermissionV2 {
            is_public: false,
            id: Uuid::new_v4().to_string(),
            public_access_level: None,
            owner: "macro|user@user.com".to_string(),
            channel_share_permissions: None,
        })
    }

    /// Create a test folder structure with nested folders and files
    fn create_test_folder_structure() -> (FileSystemNode, String) {
        let root_folder_name = "Root Test Folder";

        // Create files for the root folder
        let root_file1 = FolderItem {
            name: "rootFile1".to_string(),
            full_name: "rootFile1.pdf".to_string(),
            file_type: Some(FileType::Pdf),
            sha: "sha123".to_string(),
            relative_path: "/Root Test Folder".to_string(),
        };

        let root_file2 = FolderItem {
            name: "rootFile2".to_string(),
            full_name: "rootFile2.docx".to_string(),
            file_type: Some(FileType::Docx),
            sha: "sha456".to_string(),
            relative_path: "/Root Test Folder".to_string(),
        };

        // Create a subfolder with its own files
        let subfolder1_file1 = FolderItem {
            name: "subfolder1File1".to_string(),
            full_name: "subfolder1File1.txt".to_string(),
            file_type: Some(FileType::Txt),
            sha: "sha789".to_string(),
            relative_path: "/Root Test Folder/subfolder1".to_string(),
        };

        let subfolder1_file2 = FolderItem {
            name: "subfolder1File2".to_string(),
            full_name: "subfolder1File2.pdf".to_string(),
            file_type: Some(FileType::Pdf),
            sha: "sha101".to_string(),
            relative_path: "/Root Test Folder/subfolder1".to_string(),
        };

        // Create a sub-subfolder with its own files
        let subsubfolder_file = FolderItem {
            name: "deepNestedFile".to_string(),
            full_name: "deepNestedFile.pdf".to_string(),
            file_type: Some(FileType::Pdf),
            sha: "sha202".to_string(),
            relative_path: "/Root Test Folder/subfolder1/nested".to_string(),
        };

        let mut subsubfolder_content = HashMap::new();
        subsubfolder_content.insert(
            "deepNestedFile.pdf".to_string(),
            FileSystemNode::File(subsubfolder_file),
        );

        // Create another subfolder with its own content
        let subfolder2_file = FolderItem {
            name: "subfolder2File".to_string(),
            full_name: "subfolder2File.txt".to_string(),
            file_type: Some(FileType::Txt),
            sha: "sha303".to_string(),
            relative_path: "/Root Test Folder/subfolder2".to_string(),
        };

        // ... rest of the structure creation remains the same ...

        // Build the subfolder 1 structure
        let mut subfolder1_content = HashMap::new();
        subfolder1_content.insert(
            "subfolder1File1.txt".to_string(),
            FileSystemNode::File(subfolder1_file1),
        );
        subfolder1_content.insert(
            "subfolder1File2.pdf".to_string(),
            FileSystemNode::File(subfolder1_file2),
        );
        subfolder1_content.insert(
            "nested".to_string(),
            FileSystemNode::Folder(subsubfolder_content),
        );

        // Build the subfolder 2 structure
        let mut subfolder2_content = HashMap::new();
        subfolder2_content.insert(
            "subfolder2File.txt".to_string(),
            FileSystemNode::File(subfolder2_file),
        );

        // Build the root folder structure
        let mut root_content = HashMap::new();
        root_content.insert(
            "rootFile1.pdf".to_string(),
            FileSystemNode::File(root_file1),
        );
        root_content.insert(
            "rootFile2.docx".to_string(),
            FileSystemNode::File(root_file2),
        );
        root_content.insert(
            "subfolder1".to_string(),
            FileSystemNode::Folder(subfolder1_content),
        );
        root_content.insert(
            "subfolder2".to_string(),
            FileSystemNode::Folder(subfolder2_content),
        );

        (
            FileSystemNode::Folder(root_content),
            root_folder_name.to_string(),
        )
    }

    #[sqlx::test]
    async fn test_upload_folder_preserves_structure(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Create test data
        let user_id = "macro|user@user.com";
        let upload_request_id = "upload_request_id";
        let (folder_tree, root_folder_name) = create_test_folder_structure();
        let share_permission = create_test_permission(&pool).await?;

        // Start a transaction
        let mut transaction = pool.begin().await?;

        // Upload the folder structure
        let UploadFolderWithIdsResponse {
            project_ids,
            documents,
            ..
        } = upload_folder_with_ids(
            &mut transaction,
            &user_id,
            &share_permission,
            &folder_tree,
            &root_folder_name,
            upload_request_id,
            None,
        )
        .await?;

        // IMPORTANT: Commit the transaction so the changes are visible in the database
        transaction.commit().await?;

        // Debug: Check if we have any projects created
        assert!(!project_ids.is_empty(), "No projects were created");

        // Print out document information for debugging
        println!("Created documents: {}", documents.len());
        for doc in &documents {
            tracing::info!(
                "Document: {} in project: {:?}",
                doc.document_name,
                doc.project_id
            );
        }

        let root_project_id = &project_ids[0];

        // Debug query to verify project existence
        let project = sqlx::query!(
            r#"
            SELECT name, id FROM "Project" WHERE id = $1
            "#,
            root_project_id
        )
        .fetch_one(&pool)
        .await?;

        println!("Root project: {} with ID: {}", project.name, project.id);
        assert_eq!(
            project.name, root_folder_name,
            "Root project name doesn't match"
        );

        // Debug query to list all documents in the project
        let all_docs = sqlx::query!(
            r#"
            SELECT id, name, "projectId" FROM "Document" WHERE "projectId" = $1
            "#,
            root_project_id
        )
        .fetch_all(&pool)
        .await?;

        println!(
            "Found {} documents in project {}",
            all_docs.len(),
            root_project_id
        );
        for doc in &all_docs {
            println!("DB Document: {} with ID: {}", doc.name, doc.id);
        }

        // Check for each expected document individually with more detailed output
        for doc_name in &["rootFile1", "rootFile2"] {
            let exists = sqlx::query!(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM "Document" 
                    WHERE "projectId" = $1 AND name = $2
                ) as "exists!"
                "#,
                root_project_id,
                doc_name
            )
            .fetch_one(&pool)
            .await?
            .exists;

            assert!(
                exists,
                "Document '{}' not found in database for project {}",
                doc_name, root_project_id
            );
        }

        // First verify we can find the child folders by querying them directly
        let child_folders = sqlx::query!(
            r#"
            SELECT id, name, "uploadPending" as upload_pending FROM "Project"
            WHERE "parentId" = $1
            "#,
            root_project_id
        )
        .fetch_all(&pool)
        .await?;

        // assert that the child folders are pending upload
        for folder in &child_folders {
            assert!(folder.upload_pending);
        }

        println!("Found {} child folders", child_folders.len());
        for folder in &child_folders {
            println!("Child folder: {} with ID: {}", folder.name, folder.id);
        }

        // Then verify the expected folders exist
        for folder_name in &["subfolder1", "subfolder2"] {
            let exists = sqlx::query!(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM "Project" 
                    WHERE "parentId" = $1 AND name = $2
                ) as "exists!"
                "#,
                root_project_id,
                folder_name
            )
            .fetch_one(&pool)
            .await?
            .exists;

            assert!(
                exists,
                "Child folder '{}' not found in database under parent {}",
                folder_name, root_project_id
            );
        }

        // Now verify the subfolder structure with better diagnostics
        let subfolder1 = sqlx::query!(
            r#"
            SELECT id FROM "Project" 
            WHERE "parentId" = $1 AND name = 'subfolder1'
            "#,
            root_project_id
        )
        .fetch_optional(&pool)
        .await?;

        if let Some(subfolder) = subfolder1 {
            let subfolder1_id = subfolder.id;
            println!("Found subfolder1 with ID: {}", subfolder1_id);

            // Check for nested folder
            let nested_exists = sqlx::query!(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM "Project" 
                    WHERE "parentId" = $1 AND name = 'nested'
                ) as "exists!"
                "#,
                subfolder1_id
            )
            .fetch_one(&pool)
            .await?
            .exists;

            assert!(
                nested_exists,
                "Nested folder 'nested' not found under 'subfolder1'"
            );

            // Verify subfolder1 has the correct documents
            let subfolder1_docs = sqlx::query!(
                r#"
                SELECT name FROM "Document" WHERE "projectId" = $1
                "#,
                subfolder1_id
            )
            .fetch_all(&pool)
            .await?;

            let doc_names: Vec<String> = subfolder1_docs.into_iter().map(|r| r.name).collect();
            println!("Documents in subfolder1: {:?}", doc_names);

            assert!(
                doc_names.contains(&"subfolder1File1".to_string()),
                "subfolder1File1.txt not found"
            );
            assert!(
                doc_names.contains(&"subfolder1File2".to_string()),
                "subfolder1File2.pdf not found"
            );
        } else {
            panic!("Could not find subfolder1 by direct query");
        }

        // Verify total numbers
        assert_eq!(
            documents.len(),
            6,
            "Expected 6 documents, found {}",
            documents.len()
        );
        assert_eq!(
            project_ids.len(),
            4,
            "Expected 4 projects, found {}",
            project_ids.len()
        );

        // Clean up by deleting the data (as the transaction is now committed)
        let mut cleanup_tx = pool.begin().await?;
        for project_id in &project_ids {
            let _ = sqlx::query!(r#"DELETE FROM "Project" WHERE id = $1"#, project_id)
                .execute(&mut *cleanup_tx)
                .await?;
        }
        cleanup_tx.commit().await?;

        Ok(())
    }

    #[sqlx::test]
    async fn test_upload_empty_folder(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Create an empty folder
        let root_folder_name = "Empty Root Folder";
        let empty_folder = FileSystemNode::Folder(HashMap::new());
        let upload_request_id = "upload_request_id";

        let user_id = "macro|user@user.com";
        let share_permission = create_test_permission(&pool).await?;

        // Start a transaction
        let mut transaction = pool.begin().await?;

        // Upload the empty folder
        let UploadFolderWithIdsResponse {
            project_ids,
            documents,
            ..
        } = upload_folder_with_ids(
            &mut transaction,
            &user_id,
            &share_permission,
            &empty_folder,
            &root_folder_name,
            upload_request_id,
            None,
        )
        .await?;

        // Commit transaction to make changes visible
        transaction.commit().await?;

        // Verify only the root project was created
        assert_eq!(project_ids.len(), 1, "Expected 1 project for empty folder");
        assert_eq!(documents.len(), 0, "Expected 0 documents for empty folder");

        // Clean up the created project
        let mut cleanup_tx = pool.begin().await?;
        for project_id in &project_ids {
            let _ = sqlx::query!(r#"DELETE FROM "Project" WHERE id = $1"#, project_id)
                .execute(&mut *cleanup_tx)
                .await?;
        }
        cleanup_tx.commit().await?;

        Ok(())
    }

    #[sqlx::test]
    async fn test_upload_deep_nested_structure(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Create a deeply nested folder structure
        let root_folder_name = "Deep Nested Structure";
        let upload_request_id = "upload_request_id";

        // Build a nested structure 5 levels deep
        let mut current_folder = HashMap::new();
        let deepest_file = FolderItem {
            name: "deepestFile".to_string(),
            full_name: "deepestFile.pdf".to_string(),
            file_type: Some(FileType::Pdf),
            sha: "sha_deepest".to_string(),
            relative_path: "/Deep Nested Structure/level1/level2/level3/level4/level5".to_string(),
        };

        current_folder.insert(
            "deepestFile.pdf".to_string(),
            FileSystemNode::File(deepest_file.clone()),
        );

        // Create 5 levels of nesting
        // We'll build the path as we go up the levels
        let folder_path = String::from("/Deep Nested Structure");
        let mut folder_struct = HashMap::new();

        for level in (1..=5).rev() {
            let current_path = if level == 5 {
                format!("{}/level1/level2/level3/level4/level5", folder_path)
            } else if level == 4 {
                format!("{}/level1/level2/level3/level4", folder_path)
            } else if level == 3 {
                format!("{}/level1/level2/level3", folder_path)
            } else if level == 2 {
                format!("{}/level1/level2", folder_path)
            } else {
                format!("{}/level1", folder_path)
            };

            let level_file = FolderItem {
                name: format!("file_level{}", level),
                full_name: format!("file_level{}.txt", level),
                file_type: Some(FileType::Txt),
                sha: format!("sha_level{}", level),
                relative_path: current_path.clone(),
            };

            if level == 5 {
                // Deepest level - rebuild with both files
                let mut deepest_folder = HashMap::new();
                deepest_folder.insert(
                    "deepestFile.pdf".to_string(),
                    FileSystemNode::File(deepest_file.clone()),
                );
                deepest_folder.insert(
                    format!("file_level{}.txt", level),
                    FileSystemNode::File(level_file),
                );
                folder_struct = deepest_folder;
            } else {
                // Create the current level and add the previous level as a subfolder
                let mut parent_folder = HashMap::new();
                parent_folder.insert(
                    format!("level{}", level + 1),
                    FileSystemNode::Folder(folder_struct),
                );

                // Add a file at this level too
                parent_folder.insert(
                    format!("file_level{}.txt", level),
                    FileSystemNode::File(level_file),
                );

                folder_struct = parent_folder;
            }
        }

        // Root level
        let mut root_content = HashMap::new();
        root_content.insert("level1".to_string(), FileSystemNode::Folder(folder_struct));

        // Add a file at the root level
        let root_file = FolderItem {
            name: "root_file".to_string(),
            full_name: "root_file.txt".to_string(),
            file_type: Some(FileType::Txt),
            sha: "sha_root".to_string(),
            relative_path: "/Deep Nested Structure".to_string(),
        };

        root_content.insert("root_file.txt".to_string(), FileSystemNode::File(root_file));

        let folder_tree = FileSystemNode::Folder(root_content);
        let user_id = "macro|user@user.com";
        let share_permission = create_test_permission(&pool).await?;

        // Start a transaction
        let mut transaction = pool.begin().await?;

        // Upload the folder structure
        let UploadFolderWithIdsResponse {
            project_ids,
            documents,
            ..
        } = upload_folder_with_ids(
            &mut transaction,
            &user_id,
            &share_permission,
            &folder_tree,
            &root_folder_name,
            upload_request_id,
            None,
        )
        .await?;

        // Commit the transaction so changes are visible
        transaction.commit().await?;

        // Debug output for created documents
        println!(
            "Deep structure test - Created documents: {}",
            documents.len()
        );
        for doc in &documents {
            println!(
                "Document: {} in project: {:?}",
                doc.document_name, doc.project_id
            );
        }

        // Verify the expected number of projects and documents
        assert_eq!(
            project_ids.len(),
            6,
            "Expected 6 projects (root + 5 nested levels)"
        );
        assert_eq!(
            documents.len(),
            7, // Updated from 6 to 7 to account for the root_file.txt we added
            "Expected 7 documents (1 per level + root file + deepest)"
        );

        // Check each level document individually with detailed output
        for level in 1..=5 {
            let doc_name = format!("file_level{}", level);
            let document_exists = sqlx::query!(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM "Document" 
                    WHERE name = $1
                ) as "exists!"
                "#,
                doc_name
            )
            .fetch_one(&pool)
            .await?
            .exists;

            assert!(
                document_exists,
                "Document at level {} ('{}') not found",
                level, doc_name
            );
        }

        // Verify the deepest file exists
        let deepest_exists = sqlx::query!(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM "Document" 
                WHERE name = $1
            ) as "exists!"
            "#,
            "deepestFile"
        )
        .fetch_one(&pool)
        .await?
        .exists;

        assert!(deepest_exists, "Deepest document not found");

        // Clean up by deleting the data
        let mut cleanup_tx = pool.begin().await?;
        for project_id in &project_ids {
            let _ = sqlx::query!(r#"DELETE FROM "Project" WHERE id = $1"#, project_id)
                .execute(&mut *cleanup_tx)
                .await?;
        }
        cleanup_tx.commit().await?;

        Ok(())
    }

    #[sqlx::test]
    async fn test_returned_filesystem_structure(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Create a simple but distinctive folder structure for testing
        let root_folder_name = "Test FileSystem Structure";
        let upload_request_id = "upload_request_id";

        // Create a root file
        let root_file = FolderItem {
            name: "root_document".to_string(),
            full_name: "root_document.pdf".to_string(),
            file_type: Some(FileType::Pdf),
            sha: "sha_root_doc".to_string(),
            relative_path: "/Test FileSystem Structure".to_string(),
        };

        // Create a subfolder with a file
        let subfolder_file = FolderItem {
            name: "subfolder_document".to_string(),
            full_name: "subfolder_document.txt".to_string(),
            file_type: Some(FileType::Txt),
            sha: "sha_subfolder_doc".to_string(),
            relative_path: "/Test FileSystem Structure/subfolder".to_string(),
        };

        // Build the subfolder
        let mut subfolder_content = HashMap::new();
        subfolder_content.insert(
            "subfolder_document.txt".to_string(),
            FileSystemNode::File(subfolder_file),
        );

        // Build the root folder
        let mut root_content = HashMap::new();
        root_content.insert(
            "root_document.pdf".to_string(),
            FileSystemNode::File(root_file),
        );
        root_content.insert(
            "subfolder".to_string(),
            FileSystemNode::Folder(subfolder_content),
        );

        let folder_tree = FileSystemNode::Folder(root_content);
        let user_id = "macro|user@user.com";
        let share_permission = create_test_permission(&pool).await?;

        // Start a transaction
        let mut transaction = pool.begin().await?;

        // Upload the folder structure
        let UploadFolderWithIdsResponse {
            file_system,
            project_ids,
            documents,
        } = upload_folder_with_ids(
            &mut transaction,
            &user_id,
            &share_permission,
            &folder_tree,
            &root_folder_name,
            &upload_request_id,
            None,
        )
        .await?;

        // Commit the transaction
        transaction.commit().await?;

        // Now verify the returned file_system structure

        // 1. First verify it's a folder node (root)
        match &file_system {
            FileSystemNodeWithIds::File { .. } => {
                panic!("Expected root node to be a folder, got a file");
            }
            FileSystemNodeWithIds::Folder {
                content,
                project_id,
            } => {
                // 2. Verify root project ID is present and matches first project ID
                assert_eq!(project_id, &project_ids[0], "Root project ID mismatch");

                // 3. Verify we have the expected content (1 file, 1 subfolder)
                assert_eq!(content.len(), 2, "Root folder should have 2 items");

                // 4. Check the root document
                let root_doc = content
                    .get("root_document.pdf")
                    .expect("Root document missing");
                match root_doc {
                    FileSystemNodeWithIds::File { item, document_id } => {
                        // Verify document ID is in the returned documents list
                        let doc = documents
                            .iter()
                            .find(|d| &d.document_id == document_id)
                            .expect("Document ID in file system not found in documents list");

                        assert_eq!(doc.document_name, "root_document", "Document name mismatch");
                        assert_eq!(item.name, "root_document", "Item name mismatch");
                        assert_eq!(
                            item.relative_path, "/Test FileSystem Structure",
                            "Item path mismatch"
                        );
                    }
                    _ => panic!("Expected root document to be a file node"),
                }

                // 5. Check the subfolder
                let subfolder = content.get("subfolder").expect("Subfolder missing");
                match subfolder {
                    FileSystemNodeWithIds::Folder {
                        content: subfolder_content,
                        project_id: subfolder_project_id,
                    } => {
                        // Verify subfolder project ID is in the project IDs list
                        assert!(
                            project_ids.contains(subfolder_project_id),
                            "Subfolder project ID not found in projects list"
                        );

                        // Verify subfolder has one file
                        assert_eq!(subfolder_content.len(), 1, "Subfolder should have 1 file");

                        // Check the subfolder document
                        let subfolder_doc = subfolder_content
                            .get("subfolder_document.txt")
                            .expect("Subfolder document missing");

                        match subfolder_doc {
                            FileSystemNodeWithIds::File { item, document_id } => {
                                // Verify document ID is in the returned documents list
                                let doc = documents
                                    .iter()
                                    .find(|d| &d.document_id == document_id)
                                    .expect("Subfolder document ID not found in documents list");

                                assert_eq!(
                                    doc.document_name, "subfolder_document",
                                    "Subfolder document name mismatch"
                                );
                                assert_eq!(
                                    item.name, "subfolder_document",
                                    "Subfolder item name mismatch"
                                );
                                assert_eq!(
                                    item.relative_path, "/Test FileSystem Structure/subfolder",
                                    "Subfolder item path mismatch"
                                );
                            }
                            _ => panic!("Expected subfolder document to be a file node"),
                        }
                    }
                    _ => panic!("Expected subfolder to be a folder node"),
                }
            }
        }

        // Verify overall counts
        assert_eq!(
            project_ids.len(),
            2,
            "Expected 2 projects (root + subfolder)"
        );
        assert_eq!(
            documents.len(),
            2,
            "Expected 2 documents (root file + subfolder file)"
        );

        // Clean up by deleting the data
        let mut cleanup_tx = pool.begin().await?;
        for project_id in &project_ids {
            let _ = sqlx::query!(r#"DELETE FROM "Project" WHERE id = $1"#, project_id)
                .execute(&mut *cleanup_tx)
                .await?;
        }
        cleanup_tx.commit().await?;

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("users", "projects")))]
    async fn test_mark_projects_uploaded(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // First, set all test projects to have uploadPending = true
        sqlx::query!(
            r#"
                UPDATE "Project"
                SET "uploadPending" = true
                WHERE id LIKE 'p%'
                "#,
        )
        .execute(&pool)
        .await?;

        // Verify the projects are marked as uploadPending
        let pending_before = sqlx::query!(
            r#"
                SELECT COUNT(*) as "count!"
                FROM "Project"
                WHERE "uploadPending" = true AND id LIKE 'p%'
                "#,
        )
        .fetch_one(&pool)
        .await?;

        assert!(
            pending_before.count > 0,
            "Test setup failed, no projects marked as pending"
        );

        // Test marking the root project and its children as uploaded
        let project_ids = mark_projects_uploaded(pool.clone(), "macro|user@user.com", "p1").await?;

        assert_eq!(project_ids.len(), 11, "(sub)folder count should match");

        // Verify the projects are no longer marked as uploadPending
        for project_id in &project_ids {
            let project = sqlx::query!(
                r#"
                    SELECT "uploadPending"
                    FROM "Project"
                    WHERE id = $1
                    "#,
                project_id
            )
            .fetch_one(&pool)
            .await?;

            assert!(
                !project.uploadPending,
                "Project {} should not be pending upload",
                project_id
            );
        }

        // Test with a non-existent project ID
        let result =
            mark_projects_uploaded(pool.clone(), "macro|user@user.com", "non_existent").await;
        assert!(
            result.is_err(),
            "Should return error for non-existent project"
        );

        Ok(())
    }

    #[sqlx::test]
    async fn test_upload_request_id_set_for_root_and_subprojects(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let user_id = "macro|user@user.com";
        let upload_request_id = "upload_request_test_id";
        let (folder_tree, root_folder_name) = create_test_folder_structure();
        let share_permission = create_test_permission(&pool).await?;

        // Start a transaction
        let mut transaction = pool.begin().await?;

        // Upload the folder structure
        let UploadFolderWithIdsResponse { project_ids, .. } = upload_folder_with_ids(
            &mut transaction,
            user_id,
            &share_permission,
            &folder_tree,
            &root_folder_name,
            upload_request_id,
            None,
        )
        .await?;

        // Commit transaction
        transaction.commit().await?;

        assert!(!project_ids.is_empty(), "No projects were created");

        // Check that all projects (root and subfolders) have the correct upload_request_id set
        for project_id in &project_ids {
            let project = sqlx::query!(
                r#"
            SELECT "uploadRequestId"
            FROM "Project"
            WHERE id = $1
            "#,
                project_id
            )
            .fetch_one(&pool)
            .await?;

            assert_eq!(
                project.uploadRequestId.as_deref(),
                Some(upload_request_id),
                "Project {} does not have correct upload_request_id set",
                project_id
            );
        }

        // Clean up
        let mut cleanup_tx = pool.begin().await?;
        for project_id in &project_ids {
            let _ = sqlx::query!(r#"DELETE FROM "Project" WHERE id = $1"#, project_id)
                .execute(&mut *cleanup_tx)
                .await?;
        }
        cleanup_tx.commit().await?;

        Ok(())
    }

    #[sqlx::test]
    async fn test_files_and_folders_with_same_name(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // This tests the scenario where you have both a file and folder with identical names
        // Example: "Report.pdf" (file) and "Report" (folder)

        let root_folder_name = "Conflicting Names Test";
        let upload_request_id = "conflict_test_123";
        let user_id = "macro|user@user.com";
        let share_permission = create_test_permission(&pool).await?;

        // Create a file called "Report.pdf"
        let report_file = FolderItem {
            name: "Report".to_string(),
            full_name: "Report.pdf".to_string(),
            file_type: Some(FileType::Pdf),
            sha: "sha_report_file".to_string(),
            relative_path: "/Conflicting Names Test".to_string(),
        };

        // Create a folder called "Report" with a file inside
        let report_folder_file = FolderItem {
            name: "contents".to_string(),
            full_name: "contents.txt".to_string(),
            file_type: Some(FileType::Txt),
            sha: "sha_report_folder_contents".to_string(),
            relative_path: "/Conflicting Names Test/Report".to_string(),
        };

        // Build the folder structure
        let mut report_folder_content = HashMap::new();
        report_folder_content.insert(
            "contents.txt".to_string(),
            FileSystemNode::File(report_folder_file),
        );

        let mut root_content = HashMap::new();
        root_content.insert("Report.pdf".to_string(), FileSystemNode::File(report_file));
        root_content.insert(
            "Report".to_string(),
            FileSystemNode::Folder(report_folder_content),
        );

        let folder_tree = FileSystemNode::Folder(root_content);

        // Start transaction
        let mut transaction = pool.begin().await?;

        // Upload the folder structure
        let UploadFolderWithIdsResponse {
            file_system,
            project_ids,
            documents,
            ..
        } = upload_folder_with_ids(
            &mut transaction,
            user_id,
            &share_permission,
            &folder_tree,
            root_folder_name,
            upload_request_id,
            None,
        )
        .await?;

        // Commit the transaction
        transaction.commit().await?;

        // Verify the structure was created correctly
        assert_eq!(
            project_ids.len(),
            2,
            "Expected 2 projects: root folder + Report subfolder"
        );
        assert_eq!(
            documents.len(),
            2,
            "Expected 2 documents: Report.pdf file + contents.txt inside Report folder"
        );

        // Verify the file system structure
        match &file_system {
            FileSystemNodeWithIds::File { .. } => {
                panic!("Expected root to be a folder");
            }
            FileSystemNodeWithIds::Folder { content, .. } => {
                // Should have both "Report.pdf" (file) and "Report" (folder)
                assert_eq!(content.len(), 2, "Root should have 2 items");

                // Verify the file exists
                let report_file_node = content
                    .get("Report.pdf")
                    .expect("Report.pdf file should exist");
                match report_file_node {
                    FileSystemNodeWithIds::File { item, document_id } => {
                        assert_eq!(item.name, "Report");
                        assert_eq!(item.full_name, "Report.pdf");
                        assert_eq!(item.file_type, Some(FileType::Pdf));

                        // Verify document was created
                        let doc = documents
                            .iter()
                            .find(|d| &d.document_id == document_id)
                            .expect("Report.pdf document should exist in documents list");
                        assert_eq!(doc.document_name, "Report");
                    }
                    _ => panic!("Report.pdf should be a file node"),
                }

                // Verify the folder exists
                let report_folder_node = content.get("Report").expect("Report folder should exist");
                match report_folder_node {
                    FileSystemNodeWithIds::Folder {
                        content: folder_content,
                        project_id,
                    } => {
                        assert_eq!(folder_content.len(), 1, "Report folder should have 1 file");

                        // Verify the file inside the folder
                        let contents_file = folder_content
                            .get("contents.txt")
                            .expect("contents.txt should exist in Report folder");
                        match contents_file {
                            FileSystemNodeWithIds::File { item, document_id } => {
                                assert_eq!(item.name, "contents");
                                assert_eq!(item.full_name, "contents.txt");
                                assert_eq!(item.relative_path, "/Conflicting Names Test/Report");

                                // Verify document was created
                                let doc = documents
                                    .iter()
                                    .find(|d| &d.document_id == document_id)
                                    .expect("contents.txt document should exist");
                                assert_eq!(doc.document_name, "contents");
                            }
                            _ => panic!("contents.txt should be a file node"),
                        }

                        // Verify the folder has a project_id
                        assert!(
                            project_ids.contains(project_id),
                            "Report folder project_id should be in the project list"
                        );
                    }
                    _ => panic!("Report should be a folder node"),
                }
            }
        }

        // Clean up
        let mut cleanup_tx = pool.begin().await?;
        for project_id in &project_ids {
            let _ = sqlx::query!(r#"DELETE FROM "Project" WHERE id = $1"#, project_id)
                .execute(&mut *cleanup_tx)
                .await?;
        }
        cleanup_tx.commit().await?;

        Ok(())
    }
}
