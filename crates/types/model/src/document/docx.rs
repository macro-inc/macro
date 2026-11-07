use tracing::instrument;
use utoipa::ToSchema;

#[derive(
    sqlx::FromRow, serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, ToSchema,
)]
#[serde(rename_all = "snake_case")]
pub struct BomPart {
    /// The uuid of the bom part
    pub id: String,
    /// The sha of the bom part content
    /// There is an index on sha for more performant queries based on it.
    pub sha: String,
    /// The file path of the bom part content
    pub path: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BomPartWithContent {
    /// The uuid of the bom part
    pub id: String,
    /// The sha of the bom part content
    /// There is an index on sha for more performant queries based on it.
    pub sha: String,
    /// The file path of the bom part content
    pub path: String,
    /// The content of the bom part
    pub content: Vec<u8>,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct SaveBomPart {
    /// The sha of the bom part content
    /// There is an index on sha for more performant queries based on it.
    pub sha: String,
    /// The file path of the bom part content
    pub path: String,
}

impl SaveBomPart {
    #[instrument]
    /// Generate a diff between two BOMs returning only the new SaveBomParts
    /// that need to be uploaded to S3
    pub fn generate_diff(new_bom: Vec<SaveBomPart>, old_bom: Vec<BomPart>) -> Vec<SaveBomPart> {
        let old_bom_shas: std::collections::HashSet<String> =
            old_bom.into_iter().map(|b| b.sha).collect();

        new_bom
            .into_iter()
            .filter(|b| !old_bom_shas.contains(&b.sha))
            .collect::<Vec<SaveBomPart>>()
    }
}

impl From<BomPart> for SaveBomPart {
    fn from(bom_part: BomPart) -> Self {
        Self {
            sha: bom_part.sha,
            path: bom_part.path,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_boms() {
        let new_bom = vec![];
        let old_bom = vec![];

        let diff = SaveBomPart::generate_diff(new_bom, old_bom);
        assert!(diff.is_empty());
    }

    #[test]
    fn new_bom_empty() {
        let new_bom = vec![];
        let old_bom = vec![BomPart {
            id: "b1".to_string(),
            sha: "abc".to_string(),
            path: "path/to/old".to_string(),
        }];

        let diff = SaveBomPart::generate_diff(new_bom, old_bom);
        assert!(diff.is_empty());
    }
    #[test]
    fn old_bom_empty() {
        let new_bom = vec![SaveBomPart {
            sha: "xyz".to_string(),
            path: "path/to/new".to_string(),
        }];
        let old_bom = vec![];

        let diff = SaveBomPart::generate_diff(new_bom, old_bom);
        assert_eq!(diff.len(), 1);
        assert_eq!(diff[0].sha, "xyz");
    }

    #[test]
    fn no_difference() {
        let new_bom = vec![SaveBomPart {
            sha: "abc".to_string(),
            path: "path/to/new".to_string(),
        }];
        let old_bom = vec![BomPart {
            id: "b1".to_string(),
            sha: "abc".to_string(),
            path: "path/to/old".to_string(),
        }];

        let diff = SaveBomPart::generate_diff(new_bom, old_bom);
        assert!(diff.is_empty());
    }

    #[test]
    fn all_new_entries() {
        let new_bom = vec![SaveBomPart {
            sha: "xyz".to_string(),
            path: "path/to/new".to_string(),
        }];
        let old_bom = vec![BomPart {
            id: "b1".to_string(),
            sha: "abc".to_string(),
            path: "path/to/old".to_string(),
        }];

        let diff = SaveBomPart::generate_diff(new_bom, old_bom);
        assert_eq!(diff.len(), 1);
        assert_eq!(diff[0].sha, "xyz");
    }
    #[test]
    fn mixed_entries() {
        let new_bom = vec![
            SaveBomPart {
                sha: "abc".to_string(),
                path: "path/to/existing".to_string(),
            },
            SaveBomPart {
                sha: "new_sha".to_string(),
                path: "path/to/new".to_string(),
            },
        ];
        let old_bom = vec![BomPart {
            id: "b1".to_string(),
            sha: "abc".to_string(),
            path: "path/to/old".to_string(),
        }];

        let diff = SaveBomPart::generate_diff(new_bom, old_bom);
        assert_eq!(diff.len(), 1);
        assert_eq!(diff[0].sha, "new_sha");
    }
}
