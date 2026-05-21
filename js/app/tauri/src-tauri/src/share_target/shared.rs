#[cfg(target_os = "ios")]
use super::PendingShareFilesState;
use url::Url;

pub(super) const STAGED_SHARED_FILE_NOT_FOUND_ERROR: &str = "staged shared file not found";

pub(super) fn is_staged_shared_file_not_found_error(error: &str) -> bool {
    error == STAGED_SHARED_FILE_NOT_FOUND_ERROR
}

pub(super) fn sanitize_shared_filename(name: &str) -> Option<&str> {
    let path = std::path::Path::new(name);
    match path.file_name().and_then(|file_name| file_name.to_str()) {
        Some(file_name) if file_name == name && file_name.starts_with("share_") => Some(file_name),
        _ => None,
    }
}

pub(super) fn share_filenames_from_url(url: &Url) -> Vec<String> {
    url.query_pairs()
        .filter(|(key, _)| key == "files")
        .flat_map(|(_, value)| {
            value
                .split(',')
                .filter_map(|name| sanitize_shared_filename(name).map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn share_filenames_from_url_preserves_order() {
        let url = Url::parse("macro://share?files=share_one.jpg,share_two.mp4").unwrap();

        assert_eq!(
            share_filenames_from_url(&url),
            vec!["share_one.jpg".to_string(), "share_two.mp4".to_string()]
        );
    }

    #[test]
    fn share_filenames_from_url_rejects_invalid_names() {
        let url = Url::parse(
            "macro://share?files=share_ok.png,../bad.mov,not_shared.jpg,share_nested%2Fbad.mp4",
        )
        .unwrap();

        assert_eq!(
            share_filenames_from_url(&url),
            vec!["share_ok.png".to_string()]
        );
    }

    #[test]
    fn staged_shared_file_not_found_error_matches_helper() {
        assert!(is_staged_shared_file_not_found_error(
            STAGED_SHARED_FILE_NOT_FOUND_ERROR
        ));
        assert!(!is_staged_shared_file_not_found_error(
            "failed to read shared file staging directory"
        ));
    }
}
