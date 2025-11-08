use crate::{document::DocumentMetadata, response::PresignedUrl};
use std::collections::HashMap;

use crate::document::FileType;
use models_bulk_upload::S3ObjectInfo;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, ToSchema, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum S3Destination {
    External(PresignedUrl),
    Internal(S3ObjectInfo),
}

pub type S3DestinationMap = HashMap<String, S3Destination>;

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UploadFolderRequest {
    /// The content of the folder
    pub content: Vec<FolderItem>,
    /// The name of the folder you are uploading.
    ///
    /// This is used to help us generate the folder map more easily.
    pub root_folder_name: String,
    /// The upload request id
    pub upload_request_id: String,
    /// Optional parent project id to upload the folder into
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
}

pub struct UploadFolderWithIdsResponse {
    pub file_system: FileSystemNodeWithIds,
    pub project_ids: Vec<String>,
    pub documents: Vec<DocumentMetadata>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UploadFolderResponseData {
    /// file system with project ids and document ids
    pub file_system: FileSystemNodeWithIds,
    /// maps document id to presigned url (external) or s3 info (internal)
    pub destination_map: S3DestinationMap,
}

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FolderItem {
    /// The name of the file, without the extension
    pub name: String,
    /// The file type of the file
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<FileType>,
    /// The relative path of the file.
    ///
    /// This is the `webkitRelativePath` with the name of the file stripped at the end.
    pub relative_path: String,
    /// The sha of the file.
    pub sha: String,
}

pub struct Folder {
    pub files: Vec<FolderItem>,
    pub sub_folders: Vec<Folder>,
}

#[derive(Debug)]
pub enum FileSystemNode {
    // File item to insert
    File(FolderItem),
    // Folder which contains other nodes to insert
    Folder(HashMap<String, FileSystemNode>),
}

impl FileSystemNode {
    pub fn get_root_folder(&self, root_folder_name: &str) -> anyhow::Result<&FileSystemNode> {
        let item = match self {
            FileSystemNode::File(_) => {
                return Err(anyhow::anyhow!("Expected a folder node, found a file"));
            }
            FileSystemNode::Folder(folder) => folder,
        };

        let root_folder = item
            .get(root_folder_name)
            .ok_or(anyhow::anyhow!("Root folder not found"))?;

        Ok(root_folder)
    }
    pub fn build_file_system(
        root_folder_name: &str,
        content: Vec<FolderItem>,
    ) -> anyhow::Result<FileSystemNode> {
        let mut root = FileSystemNode::Folder(HashMap::from([(
            root_folder_name.to_string(),
            FileSystemNode::Folder(HashMap::new()),
        )]));

        for item in content {
            // Split the relative_path into components, including the root folder name
            let mut path_components: Vec<&str> = item
                .relative_path
                .split('/')
                .filter(|s| !s.is_empty())
                .collect();

            // Add the file name as the last component
            path_components.push(&item.name);

            let mut current_node = &mut root;

            for component in path_components {
                current_node = current_node
                    .as_folder_mut()?
                    .entry(component.to_string())
                    .or_insert_with(|| FileSystemNode::Folder(HashMap::new()));
            }

            // At this point, current_node is pointing to where the file should be
            *current_node = FileSystemNode::File(item.clone());
        }

        Ok(root)
    }
    fn as_folder_mut(&mut self) -> anyhow::Result<&mut HashMap<String, FileSystemNode>> {
        match self {
            FileSystemNode::Folder(folder) => Ok(folder),
            _ => Err(anyhow::anyhow!("Expected a folder node, found a file")),
        }
    }
}

// NOTE: will not work with the ToSchema macro due to recursive types
#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase", tag = "type")]
#[schema(no_recursion)]
pub enum FileSystemNodeWithIds {
    // File with document ID reference
    File {
        item: FolderItem,
        document_id: String,
    },
    // Folder with project ID reference and its contents
    Folder {
        // map folder name to node(s)
        content: HashMap<String, FileSystemNodeWithIds>,
        project_id: String,
    },
}

impl FileSystemNodeWithIds {
    pub fn as_folder_mut(&mut self) -> Option<&mut HashMap<String, FileSystemNodeWithIds>> {
        match self {
            FileSystemNodeWithIds::Folder { content, .. } => Some(content),
            _ => None,
        }
    }

    pub fn get_project_id(&self) -> Option<&String> {
        match self {
            FileSystemNodeWithIds::Folder { project_id, .. } => Some(project_id),
            _ => None,
        }
    }

    pub fn get_document_id(&self) -> Option<&String> {
        match self {
            FileSystemNodeWithIds::File { document_id, .. } => Some(document_id),
            _ => None,
        }
    }

    /// Returns a HashMap of document IDs to FolderItems for all files in this node and its children
    pub fn get_folder_items(&self) -> HashMap<String, FolderItem> {
        let mut items = HashMap::new();
        self.collect_folder_items(&mut items);
        items
    }

    /// Helper method to recursively collect all document IDs and folder items
    fn collect_folder_items(&self, items: &mut HashMap<String, FolderItem>) {
        match self {
            FileSystemNodeWithIds::File { item, document_id } => {
                // Add this file's document ID and item to the map
                items.insert(document_id.clone(), item.clone());
            }
            FileSystemNodeWithIds::Folder { content, .. } => {
                // Recursively process all children
                for node in content.values() {
                    node.collect_folder_items(items);
                }
            }
        }
    }
}
