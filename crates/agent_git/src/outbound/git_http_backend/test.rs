use super::*;
use crate::domain::models::GitBody;
use crate::domain::ports::RepoStore;
use crate::domain::template::RenderedFile;
use crate::outbound::bare_repo_store::BareRepoStore;
use bytes::Bytes;
use macro_user_id::user_id::MacroUserIdStr;

async fn git(path: &std::path::Path, args: &[&str], input: &[u8]) -> std::process::Output {
    let mut command = git_command();
    command
        .current_dir(path)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().unwrap();
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(input).await.unwrap();
    drop(stdin);
    let output = child.wait_with_output().await.unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

async fn target(root: &std::path::Path) -> (RepoDirectories, MacroUserIdStr<'static>) {
    let directories = RepoDirectories::new(root.to_path_buf());
    let agent = MacroUserIdStr::try_from("macro|agent@example.com".to_owned()).unwrap();
    BareRepoStore::new(directories.clone())
        .create_repo(
            &agent,
            &[RenderedFile {
                path: "hello.txt",
                contents: "hello\n".to_owned(),
                executable: false,
            }],
        )
        .await
        .unwrap();
    (directories, agent)
}

fn push(oid: &str, pack: Vec<u8>) -> GitRequest {
    let line = format!(
        "{} {oid} refs/tags/security-test\0report-status\n",
        "0".repeat(40)
    );
    let mut body = format!("{:04x}{line}0000", line.len() + 4).into_bytes();
    body.extend(pack);
    GitRequest {
        endpoint: GitEndpoint::Rpc(GitService::ReceivePack),
        content_type: Some("application/x-git-receive-pack-request".to_owned()),
        content_encoding: None,
        git_protocol: None,
        body: Box::pin(futures::stream::iter([Ok(Bytes::from(body))])),
    }
}

async fn drain(mut body: GitBody) -> Vec<u8> {
    let mut bytes = Vec::new();
    while let Some(chunk) = body.next().await {
        bytes.extend(chunk.unwrap());
    }
    bytes
}

#[tokio::test]
async fn git_enforces_remaining_input_bytes_before_publishing_objects() {
    use rand::RngCore;
    let storage = tempfile::tempdir().unwrap();
    let (directories, agent) = target(storage.path()).await;
    let source = tempfile::tempdir().unwrap();
    git(source.path(), &["init", "--bare", "."], b"").await;
    let mut input = vec![0; 64 * 1024];
    rand::rng().fill_bytes(&mut input);
    let hash = git(source.path(), &["hash-object", "-w", "--stdin"], &input).await;
    let oid = String::from_utf8(hash.stdout).unwrap();
    let pack = git(source.path(), &["pack-objects", "--stdout"], oid.as_bytes())
        .await
        .stdout;
    assert!(pack.len() > 1024);
    let repo = AuthorizedRepo::new(agent.clone(), GitAccess::Push, Some(1024));
    let response = GitHttpBackend::new(directories.clone(), TaskTracker::new())
        .serve(&repo, push(oid.trim(), pack))
        .await
        .unwrap();
    let report = drain(response.body).await;
    assert!(!String::from_utf8_lossy(&report).contains("ok refs/tags/security-test"));
    let mut check = git_command();
    let exists = check
        .arg("--git-dir")
        .arg(directories.repo_path(&agent))
        .args(["cat-file", "-e", oid.trim()])
        .status()
        .await
        .unwrap();
    assert!(!exists.success());
}

#[tokio::test]
async fn git_fsck_refuses_a_commit_without_an_author() {
    let storage = tempfile::tempdir().unwrap();
    let (directories, agent) = target(storage.path()).await;
    let source = tempfile::tempdir().unwrap();
    git(
        source.path(),
        &[
            "clone",
            directories.repo_path(&agent).to_str().unwrap(),
            ".",
        ],
        b"",
    )
    .await;
    let tree = git(source.path(), &["rev-parse", "HEAD^{tree}"], b"").await;
    let commit = format!(
        "tree {}\ncommitter Test <test@example.com> 1 +0000\n\nmissing author\n",
        String::from_utf8(tree.stdout).unwrap().trim()
    );
    let hash = git(
        source.path(),
        &[
            "hash-object",
            "--literally",
            "-t",
            "commit",
            "-w",
            "--stdin",
        ],
        commit.as_bytes(),
    )
    .await;
    let oid = String::from_utf8(hash.stdout).unwrap();
    let pack = git(source.path(), &["pack-objects", "--stdout"], oid.as_bytes())
        .await
        .stdout;
    let repo = AuthorizedRepo::new(agent.clone(), GitAccess::Push, Some(1024 * 1024));
    let response = GitHttpBackend::new(directories.clone(), TaskTracker::new())
        .serve(&repo, push(oid.trim(), pack))
        .await
        .unwrap();
    let report = drain(response.body).await;
    assert!(!String::from_utf8_lossy(&report).contains("ok refs/tags/security-test"));
    let mut check = git_command();
    let exists = check
        .arg("--git-dir")
        .arg(directories.repo_path(&agent))
        .args(["cat-file", "-e", oid.trim()])
        .status()
        .await
        .unwrap();
    assert!(!exists.success());
}

#[tokio::test]
async fn shutdown_tracker_waits_for_the_request_pump() {
    use futures::FutureExt;

    let storage = tempfile::tempdir().unwrap();
    let (directories, agent) = target(storage.path()).await;
    let tasks = TaskTracker::new();
    let backend = GitHttpBackend::new(directories, tasks.clone());
    let (finish, finished) = tokio::sync::oneshot::channel();
    let response = backend
        .serve(
            &AuthorizedRepo::new(agent, GitAccess::Read, None),
            GitRequest {
                endpoint: GitEndpoint::Rpc(GitService::UploadPack),
                content_type: Some("application/x-git-upload-pack-request".to_owned()),
                content_encoding: None,
                git_protocol: None,
                body: Box::pin(futures::stream::once(async move {
                    finished.await.unwrap();
                    Ok(Bytes::from_static(b"0000"))
                })),
            },
        )
        .await
        .unwrap();
    tasks.close();
    assert!(tasks.wait().now_or_never().is_none());
    finish.send(()).unwrap();
    drain(response.body).await;
    tokio::time::timeout(std::time::Duration::from_secs(5), tasks.wait())
        .await
        .unwrap();
    assert!(tasks.is_empty());
}

#[tokio::test]
async fn completed_git_process_cancels_an_unfinished_input_pump() {
    let storage = tempfile::tempdir().unwrap();
    let (directories, agent) = target(storage.path()).await;
    let tasks = TaskTracker::new();
    let backend = GitHttpBackend::new(directories, tasks.clone());
    let response = backend
        .serve(
            &AuthorizedRepo::new(agent, GitAccess::Read, None),
            GitRequest {
                endpoint: GitEndpoint::InfoRefs(GitService::UploadPack),
                content_type: None,
                content_encoding: None,
                git_protocol: None,
                body: Box::pin(futures::stream::pending()),
            },
        )
        .await
        .unwrap();
    drain(response.body).await;
    tasks.close();
    tokio::time::timeout(std::time::Duration::from_secs(5), tasks.wait())
        .await
        .unwrap();
    assert!(tasks.is_empty());
}
