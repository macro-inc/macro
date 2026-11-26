use std::collections::HashMap;
use std::os::unix::fs::MetadataExt;

use firecracker_host_api::{
    GuestImage, ImageFileName, ImageFileSource, ImageState, Sha256Digest, SourceUrl, StageImage,
};
use sha2::{Digest, Sha256};
use tokio_util::task::TaskTracker;

use super::{ImageStaging, decompress};
use crate::outbound::layout::Layout;

fn sha256(bytes: &[u8]) -> Sha256Digest {
    Sha256Digest::from_bytes(Sha256::digest(bytes).into())
}

/// A rootfs that is mostly a hole, like the real one.
fn rootfs() -> Vec<u8> {
    let mut rootfs = vec![0; 8 << 20];
    rootfs[..5].copy_from_slice(b"ext4!");
    rootfs[(4 << 20) + 7] = 1;
    rootfs
}

fn contents() -> HashMap<ImageFileName, Vec<u8>> {
    HashMap::from([
        (ImageFileName::Vmlinux, b"kernel".to_vec()),
        (ImageFileName::RootfsExt4, rootfs()),
        (ImageFileName::BootArgs, b"console=ttyS0".to_vec()),
    ])
}

/// Serves each file zstd-compressed at `/<name>.zst`; the base URL.
async fn serve(files: &HashMap<ImageFileName, Vec<u8>>) -> String {
    let mut router = axum::Router::new();
    for (name, bytes) in files {
        let compressed = zstd::encode_all(bytes.as_slice(), 3).unwrap();
        router = router.route(
            &format!("/{name}.zst"),
            axum::routing::get(move || {
                let compressed = compressed.clone();
                async move { compressed }
            }),
        );
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await });
    format!("http://{address}")
}

fn request(base: &str, files: &HashMap<ImageFileName, Vec<u8>>) -> StageImage {
    StageImage {
        image: GuestImage::try_new("macro-box/2026-11-24a").unwrap(),
        files: files
            .iter()
            .map(|(name, bytes)| ImageFileSource {
                name: *name,
                url: SourceUrl(format!("{base}/{name}.zst")),
                sha256: sha256(bytes),
                bytes: bytes.len() as u64,
            })
            .collect(),
    }
}

struct Images {
    _directory: tempfile::TempDir,
    layout: Layout,
    staging: ImageStaging,
    tasks: TaskTracker,
}

fn images() -> Images {
    let directory = tempfile::tempdir().unwrap();
    let layout = Layout::new(
        directory.path().join("durable"),
        directory.path().join("images"),
    );
    let tasks = TaskTracker::new();
    let staging = ImageStaging::new(layout.clone(), reqwest::Client::new(), tasks.clone());
    Images {
        _directory: directory,
        layout,
        staging,
        tasks,
    }
}

/// Stage `request` and wait for the background work to end.
async fn stage(images: &Images, request: StageImage) -> ImageState {
    let image = request.image.clone();
    assert_eq!(images.staging.stage(request).state, ImageState::Staging);
    images.tasks.close();
    images.tasks.wait().await;
    images.tasks.reopen();
    images
        .staging
        .list()
        .into_iter()
        .find(|staged| staged.image == image)
        .unwrap()
        .state
}

#[test]
fn decompressing_hashes_the_contents_and_leaves_zeros_as_holes() {
    let directory = tempfile::tempdir().unwrap();
    let compressed = directory.path().join("rootfs.ext4.zst");
    let output = directory.path().join("rootfs.ext4");
    let rootfs = rootfs();
    std::fs::write(&compressed, zstd::encode_all(rootfs.as_slice(), 3).unwrap()).unwrap();

    let digest = decompress(&compressed, &output, rootfs.len() as u64).unwrap();

    assert_eq!(digest.sha256, sha256(&rootfs));
    assert_eq!(digest.bytes, rootfs.len() as u64);
    assert_eq!(std::fs::read(&output).unwrap(), rootfs);
    // Two 1 MiB blocks hold data; the other six are holes.
    let allocated = std::fs::metadata(&output).unwrap().blocks() * 512;
    assert!(allocated <= 3 << 20, "{allocated} bytes allocated");
}

#[tokio::test]
async fn a_staged_image_is_checked_then_put_in_place_read_only() {
    let images = images();
    let files = contents();
    let base = serve(&files).await;
    let request = request(&base, &files);

    let state = stage(&images, request.clone()).await;

    let ImageState::Ready {
        files: Some(digests),
    } = state
    else {
        panic!("not ready: {state:?}");
    };
    assert_eq!(digests.len(), 3);
    let directory = images.layout.image(&request.image);
    assert_eq!(
        std::fs::read(directory.join("rootfs.ext4")).unwrap(),
        rootfs()
    );
    assert!(
        std::fs::metadata(directory.join("vmlinux"))
            .unwrap()
            .permissions()
            .readonly()
    );
    // Nothing left in the staging area.
    let staging = images.layout.images().join(super::STAGING);
    assert_eq!(std::fs::read_dir(staging).unwrap().count(), 0);

    // A repeat answers at once.
    assert!(matches!(
        images.staging.stage(request).state,
        ImageState::Ready { files: Some(_) }
    ));
}

#[tokio::test]
async fn a_file_that_does_not_match_its_digest_fails_and_installs_nothing() {
    let images = images();
    let files = contents();
    let base = serve(&files).await;
    let mut request = request(&base, &files);
    for file in &mut request.files {
        if file.name == ImageFileName::RootfsExt4 {
            file.sha256 = sha256(b"something else");
        }
    }

    let state = stage(&images, request.clone()).await;

    assert!(
        matches!(&state, ImageState::Failed { reason } if reason.contains("rootfs.ext4")),
        "{state:?}"
    );
    assert!(!images.layout.image(&request.image).exists());
}

#[tokio::test]
async fn an_image_in_place_with_other_contents_is_a_conflict_and_left_alone() {
    let images = images();
    let files = contents();
    let request = request("http://127.0.0.1:9", &files);
    // Put there by hand: no digests file.
    let directory = images.layout.image(&request.image);
    std::fs::create_dir_all(&directory).unwrap();
    for (name, bytes) in &files {
        std::fs::write(directory.join(name.to_string()), bytes).unwrap();
    }
    std::fs::write(directory.join("boot_args"), b"console=hvc0").unwrap();

    let state = stage(&images, request).await;

    assert!(matches!(state, ImageState::Conflict { .. }), "{state:?}");
    assert_eq!(
        std::fs::read(directory.join("boot_args")).unwrap(),
        b"console=hvc0"
    );
}

#[tokio::test]
async fn an_image_in_place_by_hand_with_the_same_contents_is_ready_once_hashed() {
    let images = images();
    let files = contents();
    let request = request("http://127.0.0.1:9", &files);
    let directory = images.layout.image(&request.image);
    std::fs::create_dir_all(&directory).unwrap();
    for (name, bytes) in &files {
        std::fs::write(directory.join(name.to_string()), bytes).unwrap();
    }
    assert!(matches!(
        &images.staging.list()[0].state,
        ImageState::Ready { files: None }
    ));

    let state = stage(&images, request).await;

    assert!(
        matches!(state, ImageState::Ready { files: Some(_) }),
        "{state:?}"
    );
}

#[tokio::test]
async fn a_failed_download_never_reports_its_url() {
    let images = images();
    let files = contents();
    let base = serve(&files).await;
    let mut request = request(&base, &files);
    for file in &mut request.files {
        if file.name == ImageFileName::Vmlinux {
            file.url = SourceUrl(format!("{base}/missing.zst?X-Amz-Signature=secret"));
        }
    }

    let state = stage(&images, request).await;

    let ImageState::Failed { reason } = state else {
        panic!("not failed: {state:?}");
    };
    assert!(reason.contains("vmlinux"), "{reason}");
    assert!(!reason.contains("secret"), "{reason}");
    assert!(!reason.contains("missing.zst"), "{reason}");
}
