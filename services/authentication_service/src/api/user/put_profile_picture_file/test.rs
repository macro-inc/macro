use models_sfs::FileMetadata;

use super::{
    MAX_PROFILE_PICTURE_BYTES, ProfilePictureFileError, ProfilePictureUploadError,
    validate_profile_picture_file, validate_profile_picture_upload,
};

const CALLER: &str = "macro|agent@example.com";

fn metadata(owner_id: &str, content_type: &str) -> FileMetadata {
    FileMetadata {
        file_id: "file".to_string(),
        content_type: content_type.to_string(),
        is_uploaded: true,
        extension_data: None,
        file_name: "avatar".to_string(),
        owner_id: owner_id.to_string(),
        s3_key: "key".to_string(),
    }
}

#[test]
fn the_callers_uploaded_image_is_accepted() {
    assert_eq!(
        validate_profile_picture_file(&metadata(CALLER, "image/png"), CALLER),
        Ok(())
    );
}

#[test]
fn another_users_image_is_rejected() {
    assert_eq!(
        validate_profile_picture_file(&metadata("macro|other@example.com", "image/png"), CALLER),
        Err(ProfilePictureFileError::NotOwner)
    );
}

#[test]
fn svg_and_other_files_are_rejected() {
    for content_type in ["image/svg+xml", "application/pdf"] {
        assert_eq!(
            validate_profile_picture_file(&metadata(CALLER, content_type), CALLER),
            Err(ProfilePictureFileError::NotAnImage)
        );
    }
}

#[test]
fn an_image_at_the_size_limit_can_be_uploaded() {
    assert_eq!(
        validate_profile_picture_upload("image/png", MAX_PROFILE_PICTURE_BYTES),
        Ok(())
    );
}

#[test]
fn an_image_over_the_size_limit_is_rejected() {
    assert_eq!(
        validate_profile_picture_upload("image/png", MAX_PROFILE_PICTURE_BYTES + 1),
        Err(ProfilePictureUploadError::TooLarge)
    );
}

#[test]
fn an_empty_upload_is_rejected() {
    assert_eq!(
        validate_profile_picture_upload("image/png", 0),
        Err(ProfilePictureUploadError::Empty)
    );
}

#[test]
fn an_unsupported_type_is_rejected_before_its_size() {
    assert_eq!(
        validate_profile_picture_upload("image/svg+xml", MAX_PROFILE_PICTURE_BYTES + 1),
        Err(ProfilePictureUploadError::UnsupportedType)
    );
}
