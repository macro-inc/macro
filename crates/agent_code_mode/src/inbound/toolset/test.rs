use super::*;

#[test]
fn entity_catalog_is_compact_and_exact_lookup_has_real_sdk_signatures() {
    let catalog = DescribeCodeTools {
        names: vec![],
        topics: vec![],
    }
    .describe()
    .unwrap();
    assert!(catalog.tools.len() > 15);
    assert!(catalog.tools.iter().all(|doc| doc.documentation.is_none()));
    let docs = DescribeCodeTools {
        names: vec!["documents".into(), "email".into()],
        topics: vec![],
    }
    .describe()
    .unwrap();
    assert!(
        docs.tools[0]
            .documentation
            .as_ref()
            .unwrap()
            .contains("AsyncGenerator")
    );
    assert!(
        docs.tools[0]
            .documentation
            .as_ref()
            .unwrap()
            .contains("Document")
    );
    assert!(
        docs.tools[1]
            .documentation
            .as_ref()
            .unwrap()
            .contains("Email")
    );
    assert!(
        DescribeCodeTools {
            names: vec!["NameSearch".into()],
            topics: vec![]
        }
        .describe()
        .is_err()
    );
}

#[test]
fn guide_only_discovery_omits_catalog_and_limits_are_enforced() {
    let response = DescribeCodeTools {
        names: vec![],
        topics: vec![CodeGuideTopic::Examples],
    }
    .describe()
    .unwrap();
    assert!(response.tools.is_empty());
    assert_eq!(
        response.guides[0].markdown,
        include_str!("../../../SKILL.md")
    );
    assert!(
        DescribeCodeTools {
            names: vec!["documents".into(); 6],
            topics: vec![]
        }
        .describe()
        .is_err()
    );
    assert!(
        DescribeCodeTools {
            names: vec![],
            topics: vec![CodeGuideTopic::Search; 5]
        }
        .describe()
        .is_err()
    );
}
