use super::*;

#[tokio::test]
async fn only_parts_missing_from_s3_need_uploading() {
    let mut s3 = S3::default();
    s3.expect_exists()
        .withf(|key| key == "stored")
        .times(1)
        .returning(|_| Ok(true));
    s3.expect_exists()
        .withf(|key| key == "new")
        .times(1)
        .returning(|_| Ok(false));

    let missing = missing_shas(
        &s3,
        &[
            SaveBomPart {
                sha: "stored".to_string(),
                path: "word/document.xml".to_string(),
            },
            SaveBomPart {
                sha: "new".to_string(),
                path: "word/media/image1.png".to_string(),
            },
            SaveBomPart {
                sha: "new".to_string(),
                path: "word/media/image2.png".to_string(),
            },
        ],
    )
    .await
    .unwrap();

    assert_eq!(missing, vec!["new".to_string()]);
}

#[tokio::test]
async fn an_s3_error_fails_the_check() {
    let mut s3 = S3::default();
    s3.expect_exists()
        .withf(|key| key == "stored")
        .returning(|_| Ok(true));
    s3.expect_exists()
        .withf(|key| key == "unreadable")
        .times(1)
        .returning(|_| Err(anyhow::anyhow!("access denied")));

    let result = missing_shas(
        &s3,
        &[
            SaveBomPart {
                sha: "stored".to_string(),
                path: "word/document.xml".to_string(),
            },
            SaveBomPart {
                sha: "unreadable".to_string(),
                path: "word/styles.xml".to_string(),
            },
        ],
    )
    .await;

    assert!(result.is_err());
}
