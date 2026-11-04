use models_sfs::FileMetadata;

use super::{ProfilePictureFileError, validate_profile_picture_file};

const CALLER: &str = "macro|agent@example.com";

fn metadata(owner_id: &str, content_type: &str, is_uploaded: bool) -> FileMetadata {
    FileMetadata {
        file_id: "file".to_string(),
        content_type: content_type.to_string(),
        is_uploaded,
        extension_data: None,
        file_name: "avatar".to_string(),
        owner_id: owner_id.to_string(),
        s3_key: "key".to_string(),
    }
}

#[test]
fn the_callers_uploaded_image_is_accepted() {
    assert_eq!(
        validate_profile_picture_file(&metadata(CALLER, "image/png", true), CALLER),
        Ok(())
    );
}

#[test]
fn another_users_image_is_rejected() {
    assert_eq!(
        validate_profile_picture_file(
            &metadata("macro|other@example.com", "image/png", true),
            CALLER
        ),
        Err(ProfilePictureFileError::NotOwner)
    );
}

#[test]
fn an_unfinished_upload_is_rejected() {
    assert_eq!(
        validate_profile_picture_file(&metadata(CALLER, "image/png", false), CALLER),
        Err(ProfilePictureFileError::NotUploaded)
    );
}

#[test]
fn svg_and_other_files_are_rejected() {
    for content_type in ["image/svg+xml", "application/pdf"] {
        assert_eq!(
            validate_profile_picture_file(&metadata(CALLER, content_type, true), CALLER),
            Err(ProfilePictureFileError::NotAnImage)
        );
    }
}
