use firecracker_host_api::{
    GuestImage, ImageFileName, ImageFileSource, ImageState, Sha256Digest, SourceUrl, StageImage,
};

use super::super::test::{FakeMachines, FakeStore, Host, computer_id, create_request, host_with};
use crate::domain::service::HostError;

const NEXT: &str = "macro-box/2026-11-24a";

fn image(name: &str) -> GuestImage {
    GuestImage::try_new(name).unwrap()
}

async fn running_host() -> Host {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 2).await;
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();
    host
}

fn file(name: ImageFileName, url: &str) -> ImageFileSource {
    ImageFileSource {
        name,
        url: SourceUrl(url.to_owned()),
        sha256: Sha256Digest::try_new("a".repeat(64)).unwrap(),
        bytes: 1,
    }
}

fn request(files: Vec<ImageFileSource>) -> StageImage {
    StageImage {
        image: image(NEXT),
        files,
    }
}

#[tokio::test]
async fn an_image_with_its_three_files_over_https_is_staged() {
    let host = running_host().await;
    let staged = host
        .service
        .stage_image(request(vec![
            file(ImageFileName::Vmlinux, "https://bucket/vmlinux.zst"),
            file(ImageFileName::RootfsExt4, "https://bucket/rootfs.ext4.zst"),
            file(ImageFileName::BootArgs, "https://bucket/boot_args.zst"),
        ]))
        .unwrap();
    assert_eq!(staged.state, ImageState::Staging);
}

#[tokio::test]
async fn a_missing_or_repeated_file_or_plain_http_is_refused() {
    let host = running_host().await;
    for files in [
        vec![
            file(ImageFileName::Vmlinux, "https://bucket/a"),
            file(ImageFileName::RootfsExt4, "https://bucket/b"),
        ],
        vec![
            file(ImageFileName::Vmlinux, "https://bucket/a"),
            file(ImageFileName::Vmlinux, "https://bucket/a"),
            file(ImageFileName::BootArgs, "https://bucket/c"),
        ],
        vec![
            file(ImageFileName::Vmlinux, "http://bucket/a"),
            file(ImageFileName::RootfsExt4, "https://bucket/b"),
            file(ImageFileName::BootArgs, "https://bucket/c"),
        ],
    ] {
        let refused = host.service.stage_image(request(files)).unwrap_err();
        assert!(
            matches!(refused, HostError::InvalidRequest(_)),
            "{refused:?}"
        );
    }
}
