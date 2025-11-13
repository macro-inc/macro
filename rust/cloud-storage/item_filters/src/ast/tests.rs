use std::str::FromStr;

use super::*;
use cool_asserts::assert_matches;
use model_file_type::FileType;
use serde_json::json;
use uuid::Uuid;

#[test]
fn it_works_with_file_type() {
    let res: Result<Vec<_>, _> = ["pdf", "md", "txt", "html"]
        .into_iter()
        .map(FileType::from_str)
        .collect();

    assert_matches!(
        res.unwrap(),
        [FileType::Pdf, FileType::Md, FileType::Txt, FileType::Html]
    );
}

#[test]
fn it_expands_filters() {
    let document_id = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    let f = EntityFilters {
        document_filters: DocumentFilters {
            file_types: vec!["pdf".to_string(), "txt".to_string()],
            document_ids: vec![document_id.to_string()],
            project_ids: vec![project_id.to_string()],
            owners: vec!["macro|hello@test.com".to_string()],
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(EntityFilterAst::new_from_filters(f).unwrap().inner)
        .unwrap()
        .document_filter
        .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    let exp = json!({
        "And": [
            {
                "And": [
                    {
                        "And": [
                            {
                                "Or": [
                                    {
                                        "Literal": {
                                            "FileType": "pdf",
                                        }
                                    },
                                    {
                                        "Literal": {
                                            "FileType": "txt"
                                        }
                                    }
                                ]
                            },
                            {
                                "Literal": {
                                    "Id": document_id
                                }
                            }
                        ]
                    },
                    {
                        "Literal": {
                            "ProjectId": project_id
                        }
                    }
                ]
            },
            {
                "Literal": {
                    "Owner": "macro|hello@test.com"
                }
            }
        ]
    });

    assert_eq!(json, exp);
}
