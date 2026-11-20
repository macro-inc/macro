// DO NOT EDIT — regenerate with `cargo x workflows` (from the repository root).
// Source: tooling/xtask/crates/xtask_workflows/actions.lock, actions/*.yml and src/workflows/composite

//! Typed steps for the third-party actions in `actions.lock` and our
//! composite actions in `workflows/composite`, and typed calls of our
//! reusable workflows.

use gh_workflow::expr::typed::{StepOutput, Str};
use gh_workflow::{CallJob, Input, Step, Use};
use serde_json::Value;

/// `actions/cache/restore` v5.0.5: Restore Cache artifacts like dependencies and build outputs to improve workflow execution time
#[must_use]
pub struct ActionsCacheRestore(Step<Use>);

impl ActionsCacheRestore {
    /// A step named `name` that runs `actions/cache/restore@27d5ce7f107fe9357f9df03efb73ab90386fccae`, with its required inputs set.
    pub fn new(name: &str, path: impl ToString, key: impl ToString) -> Self {
        let step = Step::new(name).uses("actions", "cache/restore", "27d5ce7f107fe9357f9df03efb73ab90386fccae");
        Self(step)
            .with("path", path)
            .with("key", key)
    }

    /// An ordered multiline string listing the prefix-matched keys, that are used for restoring stale cache if no cache hit occurred for key. Note `cache-hit` returns false in this case.
    pub fn restore_keys(self, value: impl ToString) -> Self {
        self.with("restore-keys", value)
    }

    /// An optional boolean when enabled, allows windows runners to restore caches that were saved on other platforms
    ///
    /// Default: `false`.
    pub fn enable_cross_os_archive(self, value: impl ToString) -> Self {
        self.with("enableCrossOsArchive", value)
    }

    /// Fail the workflow if cache entry is not found
    ///
    /// Default: `false`.
    pub fn fail_on_cache_miss(self, value: impl ToString) -> Self {
        self.with("fail-on-cache-miss", value)
    }

    /// Check if a cache entry exists for the given input(s) (key, restore-keys) without downloading the cache
    ///
    /// Default: `false`.
    pub fn lookup_only(self, value: impl ToString) -> Self {
        self.with("lookup-only", value)
    }

    /// Output `cache-hit` of the step with id `step`: A boolean value to indicate an exact match was found for the primary key
    pub const fn cache_hit_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "cache-hit")
    }

    /// Output `cache-primary-key` of the step with id `step`: A resolved cache key for which cache match was attempted
    pub const fn cache_primary_key_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "cache-primary-key")
    }

    /// Output `cache-matched-key` of the step with id `step`: Key of the cache that was restored, it could either be the primary key on cache-hit or a partial/complete match of one of the restore keys
    pub const fn cache_matched_key_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "cache-matched-key")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<ActionsCacheRestore> for Step<Use> {
    fn from(action: ActionsCacheRestore) -> Self {
        action.step()
    }
}

/// `actions/cache/save` v5.0.5: Save Cache artifacts like dependencies and build outputs to improve workflow execution time
#[must_use]
pub struct ActionsCacheSave(Step<Use>);

impl ActionsCacheSave {
    /// A step named `name` that runs `actions/cache/save@27d5ce7f107fe9357f9df03efb73ab90386fccae`, with its required inputs set.
    pub fn new(name: &str, path: impl ToString, key: impl ToString) -> Self {
        let step = Step::new(name).uses("actions", "cache/save", "27d5ce7f107fe9357f9df03efb73ab90386fccae");
        Self(step)
            .with("path", path)
            .with("key", key)
    }

    /// The chunk size used to split up large files during upload, in bytes
    pub fn upload_chunk_size(self, value: impl ToString) -> Self {
        self.with("upload-chunk-size", value)
    }

    /// An optional boolean when enabled, allows windows runners to save caches that can be restored on other platforms
    ///
    /// Default: `false`.
    pub fn enable_cross_os_archive(self, value: impl ToString) -> Self {
        self.with("enableCrossOsArchive", value)
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<ActionsCacheSave> for Step<Use> {
    fn from(action: ActionsCacheSave) -> Self {
        action.step()
    }
}

/// `actions/checkout` v6.0.3: Checkout a Git repository at a particular version
#[must_use]
pub struct ActionsCheckout(Step<Use>);

impl ActionsCheckout {
    /// A step named `name` that runs `actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses("actions", "checkout", "df4cb1c069e1874edd31b4311f1884172cec0e10");
        Self(step)
    }

    /// Repository name with owner. For example, actions/checkout
    ///
    /// Default: `${{ github.repository }}`.
    pub fn repository(self, value: impl ToString) -> Self {
        self.with("repository", value)
    }

    /// The branch, tag or SHA to checkout. When checking out the repository that triggered a workflow, this defaults to the reference or SHA for that event.  Otherwise, uses the default branch.
    pub fn r#ref(self, value: impl ToString) -> Self {
        self.with("ref", value)
    }

    /// Personal access token (PAT) used to fetch the repository. The PAT is configured with the local git config, which enables your scripts to run authenticated git commands. The post-job step removes the PAT.
    ///
    /// We recommend using a service account with the least permissions necessary. Also when generating a new PAT, select the least scopes necessary.
    ///
    /// [Learn more about creating and using encrypted secrets](https://help.github.com/en/actions/automating-your-workflow-with-github-actions/creating-and-using-encrypted-secrets)
    ///
    ///
    /// Default: `${{ github.token }}`.
    pub fn token(self, value: impl ToString) -> Self {
        self.with("token", value)
    }

    /// SSH key used to fetch the repository. The SSH key is configured with the local git config, which enables your scripts to run authenticated git commands. The post-job step removes the SSH key.
    ///
    /// We recommend using a service account with the least permissions necessary.
    ///
    /// [Learn more about creating and using encrypted secrets](https://help.github.com/en/actions/automating-your-workflow-with-github-actions/creating-and-using-encrypted-secrets)
    pub fn ssh_key(self, value: impl ToString) -> Self {
        self.with("ssh-key", value)
    }

    /// Known hosts in addition to the user and global host key database. The public SSH keys for a host may be obtained using the utility `ssh-keyscan`. For example, `ssh-keyscan github.com`. The public key for github.com is always implicitly added.
    pub fn ssh_known_hosts(self, value: impl ToString) -> Self {
        self.with("ssh-known-hosts", value)
    }

    /// Whether to perform strict host key checking. When true, adds the options `StrictHostKeyChecking=yes` and `CheckHostIP=no` to the SSH command line. Use the input `ssh-known-hosts` to configure additional hosts.
    ///
    ///
    /// Default: `true`.
    pub fn ssh_strict(self, value: impl ToString) -> Self {
        self.with("ssh-strict", value)
    }

    /// The user to use when connecting to the remote SSH host. By default 'git' is used.
    ///
    ///
    /// Default: `git`.
    pub fn ssh_user(self, value: impl ToString) -> Self {
        self.with("ssh-user", value)
    }

    /// Whether to configure the token or SSH key with the local git config
    ///
    /// Default: `true`.
    pub fn persist_credentials(self, value: impl ToString) -> Self {
        self.with("persist-credentials", value)
    }

    /// Relative path under $GITHUB_WORKSPACE to place the repository
    pub fn path(self, value: impl ToString) -> Self {
        self.with("path", value)
    }

    /// Whether to execute `git clean -ffdx && git reset --hard HEAD` before fetching
    ///
    /// Default: `true`.
    pub fn clean(self, value: impl ToString) -> Self {
        self.with("clean", value)
    }

    /// Partially clone against a given filter. Overrides sparse-checkout if set.
    pub fn filter(self, value: impl ToString) -> Self {
        self.with("filter", value)
    }

    /// Do a sparse checkout on given patterns. Each pattern should be separated with new lines.
    pub fn sparse_checkout(self, value: impl ToString) -> Self {
        self.with("sparse-checkout", value)
    }

    /// Specifies whether to use cone-mode when doing a sparse checkout.
    ///
    ///
    /// Default: `true`.
    pub fn sparse_checkout_cone_mode(self, value: impl ToString) -> Self {
        self.with("sparse-checkout-cone-mode", value)
    }

    /// Number of commits to fetch. 0 indicates all history for all branches and tags.
    ///
    /// Default: `1`.
    pub fn fetch_depth(self, value: impl ToString) -> Self {
        self.with("fetch-depth", value)
    }

    /// Whether to fetch tags, even if fetch-depth > 0.
    ///
    /// Default: `false`.
    pub fn fetch_tags(self, value: impl ToString) -> Self {
        self.with("fetch-tags", value)
    }

    /// Whether to show progress status output when fetching.
    ///
    /// Default: `true`.
    pub fn show_progress(self, value: impl ToString) -> Self {
        self.with("show-progress", value)
    }

    /// Whether to download Git-LFS files
    ///
    /// Default: `false`.
    pub fn lfs(self, value: impl ToString) -> Self {
        self.with("lfs", value)
    }

    /// Whether to checkout submodules: `true` to checkout submodules or `recursive` to recursively checkout submodules.
    ///
    /// When the `ssh-key` input is not provided, SSH URLs beginning with <address> are converted to HTTPS.
    ///
    ///
    /// Default: `false`.
    pub fn submodules(self, value: impl ToString) -> Self {
        self.with("submodules", value)
    }

    /// Add repository path as safe.directory for Git global config by running `git config --global --add safe.directory <path>`
    ///
    /// Default: `true`.
    pub fn set_safe_directory(self, value: impl ToString) -> Self {
        self.with("set-safe-directory", value)
    }

    /// The base URL for the GitHub instance that you are trying to clone from, will use environment defaults to fetch from the same instance that the workflow is running from unless specified. Example URLs are https://github.com or https://my-ghes-server.example.com
    pub fn github_server_url(self, value: impl ToString) -> Self {
        self.with("github-server-url", value)
    }

    /// Output `ref` of the step with id `step`: The branch, tag or SHA that was checked out
    pub const fn ref_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "ref")
    }

    /// Output `commit` of the step with id `step`: The commit SHA that was checked out
    pub const fn commit_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "commit")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        crate::workflows::steps::abort_stalled_fetch(self.0)
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<ActionsCheckout> for Step<Use> {
    fn from(action: ActionsCheckout) -> Self {
        action.step()
    }
}

/// `actions/download-artifact` v5.0.0: Download a build artifact that was previously uploaded in the workflow by the upload-artifact action
#[must_use]
pub struct ActionsDownloadArtifact(Step<Use>);

impl ActionsDownloadArtifact {
    /// A step named `name` that runs `actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses("actions", "download-artifact", "634f93cb2916e3fdff6788551b99b062d0335ce0");
        Self(step)
    }

    /// Name of the artifact to download. If unspecified, all artifacts for the run are downloaded.
    pub fn name(self, value: impl ToString) -> Self {
        self.with("name", value)
    }

    /// IDs of the artifacts to download, comma-separated. Either inputs `artifact-ids` or `name` can be used, but not both.
    pub fn artifact_ids(self, value: impl ToString) -> Self {
        self.with("artifact-ids", value)
    }

    /// Destination path. Supports basic tilde expansion. Defaults to $GITHUB_WORKSPACE
    pub fn path(self, value: impl ToString) -> Self {
        self.with("path", value)
    }

    /// A glob pattern matching the artifacts that should be downloaded. Ignored if name is specified.
    pub fn pattern(self, value: impl ToString) -> Self {
        self.with("pattern", value)
    }

    /// When multiple artifacts are matched, this changes the behavior of the destination directories. If true, the downloaded artifacts will be in the same directory specified by path. If false, the downloaded artifacts will be extracted into individual named directories within the specified path.
    ///
    /// Default: `false`.
    pub fn merge_multiple(self, value: impl ToString) -> Self {
        self.with("merge-multiple", value)
    }

    /// The GitHub token used to authenticate with the GitHub API. This is required when downloading artifacts from a different repository or from a different workflow run. If this is not specified, the action will attempt to download artifacts from the current repository and the current workflow run.
    pub fn github_token(self, value: impl ToString) -> Self {
        self.with("github-token", value)
    }

    /// The repository owner and the repository name joined together by "/". If github-token is specified, this is the repository that artifacts will be downloaded from.
    ///
    /// Default: `${{ github.repository }}`.
    pub fn repository(self, value: impl ToString) -> Self {
        self.with("repository", value)
    }

    /// The id of the workflow run where the desired download artifact was uploaded from. If github-token is specified, this is the run that artifacts will be downloaded from.
    ///
    /// Default: `${{ github.run_id }}`.
    pub fn run_id(self, value: impl ToString) -> Self {
        self.with("run-id", value)
    }

    /// Output `download-path` of the step with id `step`: Path of artifact download
    pub const fn download_path_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "download-path")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<ActionsDownloadArtifact> for Step<Use> {
    fn from(action: ActionsDownloadArtifact) -> Self {
        action.step()
    }
}

/// `actions/github-script` v7.1.0: Run simple scripts using the GitHub client
#[must_use]
pub struct ActionsGithubScript(Step<Use>);

impl ActionsGithubScript {
    /// A step named `name` that runs `actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b`, with its required input set.
    pub fn new(name: &str, script: impl ToString) -> Self {
        let step = Step::new(name).uses("actions", "github-script", "f28e40c7f34bde8b3046d885e986cb6290c5673b");
        Self(step)
            .with("script", script)
    }

    /// The GitHub token used to create an authenticated client
    ///
    /// Default: `${{ github.token }}`.
    pub fn github_token(self, value: impl ToString) -> Self {
        self.with("github-token", value)
    }

    /// Whether to tell the GitHub client to log details of its requests. true or false. Default is to run in debug mode when the GitHub Actions step debug logging is turned on.
    ///
    /// Default: `${{ runner.debug == '1' }}`.
    pub fn debug(self, value: impl ToString) -> Self {
        self.with("debug", value)
    }

    /// An optional user-agent string
    ///
    /// Default: `actions/github-script`.
    pub fn user_agent(self, value: impl ToString) -> Self {
        self.with("user-agent", value)
    }

    /// A comma-separated list of GraphQL API previews to accept
    pub fn previews(self, value: impl ToString) -> Self {
        self.with("previews", value)
    }

    /// Either "string" or "json" (default "json")—how the result will be encoded
    ///
    /// Default: `json`.
    pub fn result_encoding(self, value: impl ToString) -> Self {
        self.with("result-encoding", value)
    }

    /// The number of times to retry a request
    ///
    /// Default: `0`.
    pub fn retries(self, value: impl ToString) -> Self {
        self.with("retries", value)
    }

    /// A comma separated list of status codes that will NOT be retried e.g. "400,500". No effect unless `retries` is set
    ///
    /// Default: `400,401,403,404,422`.
    pub fn retry_exempt_status_codes(self, value: impl ToString) -> Self {
        self.with("retry-exempt-status-codes", value)
    }

    /// An optional GitHub REST API URL to connect to a different GitHub instance. For example, https://my.github-enterprise-server.com/api/v3
    pub fn base_url(self, value: impl ToString) -> Self {
        self.with("base-url", value)
    }

    /// Output `result` of the step with id `step`: The return value of the script, stringified with `JSON.stringify`
    pub const fn result_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "result")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<ActionsGithubScript> for Step<Use> {
    fn from(action: ActionsGithubScript) -> Self {
        action.step()
    }
}

/// `actions/setup-node` v4.4.0: Setup a Node.js environment by adding problem matchers and optionally downloading and adding it to the PATH.
#[must_use]
pub struct ActionsSetupNode(Step<Use>);

impl ActionsSetupNode {
    /// A step named `name` that runs `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses("actions", "setup-node", "49933ea5288caeca8642d1e84afbd3f7d6820020");
        Self(step)
    }

    /// Set always-auth in npmrc.
    ///
    /// Default: `false`.
    pub fn always_auth(self, value: impl ToString) -> Self {
        self.with("always-auth", value)
    }

    /// Version Spec of the version to use. Examples: 12.x, 10.15.1, >=10.15.0.
    pub fn node_version(self, value: impl ToString) -> Self {
        self.with("node-version", value)
    }

    /// File containing the version Spec of the version to use.  Examples: package.json, .nvmrc, .node-version, .tool-versions.
    pub fn node_version_file(self, value: impl ToString) -> Self {
        self.with("node-version-file", value)
    }

    /// Target architecture for Node to use. Examples: x86, x64. Will use system architecture by default.
    pub fn architecture(self, value: impl ToString) -> Self {
        self.with("architecture", value)
    }

    /// Set this option if you want the action to check for the latest available version that satisfies the version spec.
    ///
    /// Default: `false`.
    pub fn check_latest(self, value: impl ToString) -> Self {
        self.with("check-latest", value)
    }

    /// Optional registry to set up for auth. Will set the registry in a project level .npmrc and .yarnrc file, and set up auth to read in from env.NODE_AUTH_TOKEN.
    pub fn registry_url(self, value: impl ToString) -> Self {
        self.with("registry-url", value)
    }

    /// Optional scope for authenticating against scoped registries. Will fall back to the repository owner when using the GitHub Packages registry (https://npm.pkg.github.com/).
    pub fn scope(self, value: impl ToString) -> Self {
        self.with("scope", value)
    }

    /// Used to pull node distributions from node-versions. Since there's a default, this is typically not supplied by the user. When running this action on github.com, the default value is sufficient. When running on GHES, you can pass a personal access token for github.com if you are experiencing rate limiting.
    ///
    /// Default: `${{ github.server_url == 'https://github.com' && github.token || '' }}`.
    pub fn token(self, value: impl ToString) -> Self {
        self.with("token", value)
    }

    /// Used to specify a package manager for caching in the default directory. Supported values: npm, yarn, pnpm.
    pub fn cache(self, value: impl ToString) -> Self {
        self.with("cache", value)
    }

    /// Used to specify the path to a dependency file: package-lock.json, yarn.lock, etc. Supports wildcards or a list of file names for caching multiple dependencies.
    pub fn cache_dependency_path(self, value: impl ToString) -> Self {
        self.with("cache-dependency-path", value)
    }

    /// Used to specify an alternative mirror to downlooad Node.js binaries from
    pub fn mirror(self, value: impl ToString) -> Self {
        self.with("mirror", value)
    }

    /// The token used as Authorization header when fetching from the mirror
    pub fn mirror_token(self, value: impl ToString) -> Self {
        self.with("mirror-token", value)
    }

    /// Output `cache-hit` of the step with id `step`: A boolean value to indicate if a cache was hit.
    pub const fn cache_hit_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "cache-hit")
    }

    /// Output `node-version` of the step with id `step`: The installed node version.
    pub const fn node_version_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "node-version")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<ActionsSetupNode> for Step<Use> {
    fn from(action: ActionsSetupNode) -> Self {
        action.step()
    }
}

/// `actions/upload-artifact` v4.6.2: Upload a build artifact that can be used by subsequent workflow steps
#[must_use]
pub struct ActionsUploadArtifact(Step<Use>);

impl ActionsUploadArtifact {
    /// A step named `name` that runs `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`, with its required input set.
    pub fn new(name: &str, path: impl ToString) -> Self {
        let step = Step::new(name).uses("actions", "upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02");
        Self(step)
            .with("path", path)
    }

    /// Artifact name
    ///
    /// Default: `artifact`.
    pub fn name(self, value: impl ToString) -> Self {
        self.with("name", value)
    }

    /// The desired behavior if no files are found using the provided path.
    /// Available Options:
    ///   warn: Output a warning but do not fail the action
    ///   error: Fail the action with an error message
    ///   ignore: Do not output any warnings or errors, the action does not fail
    ///
    ///
    /// Default: `warn`.
    pub fn if_no_files_found(self, value: impl ToString) -> Self {
        self.with("if-no-files-found", value)
    }

    /// Duration after which artifact will expire in days. 0 means using default retention.
    /// Minimum 1 day. Maximum 90 days unless changed from the repository settings page.
    pub fn retention_days(self, value: impl ToString) -> Self {
        self.with("retention-days", value)
    }

    /// The level of compression for Zlib to be applied to the artifact archive. The value can range from 0 to 9: - 0: No compression - 1: Best speed - 6: Default compression (same as GNU Gzip) - 9: Best compression Higher levels will result in better compression, but will take longer to complete. For large files that are not easily compressed, a value of 0 is recommended for significantly faster uploads.
    ///
    ///
    /// Default: `6`.
    pub fn compression_level(self, value: impl ToString) -> Self {
        self.with("compression-level", value)
    }

    /// If true, an artifact with a matching name will be deleted before a new one is uploaded. If false, the action will fail if an artifact for the given name already exists. Does not fail if the artifact does not exist.
    ///
    ///
    /// Default: `false`.
    pub fn overwrite(self, value: impl ToString) -> Self {
        self.with("overwrite", value)
    }

    /// If true, hidden files will be included in the artifact. If false, hidden files will be excluded from the artifact.
    ///
    ///
    /// Default: `false`.
    pub fn include_hidden_files(self, value: impl ToString) -> Self {
        self.with("include-hidden-files", value)
    }

    /// Output `artifact-id` of the step with id `step`: A unique identifier for the artifact that was just uploaded. Empty if the artifact upload failed.
    /// This ID can be used as input to other APIs to download, delete or get more information about an artifact: https://docs.github.com/en/rest/actions/artifacts
    pub const fn artifact_id_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "artifact-id")
    }

    /// Output `artifact-url` of the step with id `step`: A download URL for the artifact that was just uploaded. Empty if the artifact upload failed.
    /// This download URL only works for requests Authenticated with GitHub. Anonymous downloads will be prompted to first login.  If an anonymous download URL is needed than a short time restricted URL can be generated using the download artifact API: https://docs.github.com/en/rest/actions/artifacts#download-an-artifact
    /// This URL will be valid for as long as the artifact exists and the workflow run and repository exists. Once an artifact has expired this URL will no longer work. Common uses cases for such a download URL can be adding download links to artifacts in descriptions or comments on pull requests or issues.
    pub const fn artifact_url_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "artifact-url")
    }

    /// Output `artifact-digest` of the step with id `step`: SHA-256 digest for the artifact that was just uploaded. Empty if the artifact upload failed.
    pub const fn artifact_digest_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "artifact-digest")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<ActionsUploadArtifact> for Step<Use> {
    fn from(action: ActionsUploadArtifact) -> Self {
        action.step()
    }
}

/// `aws-actions/configure-aws-credentials` v6.2.0: Configures AWS credentials for use in subsequent steps in a GitHub Action workflow
#[must_use]
pub struct AwsActionsConfigureAwsCredentials(Step<Use>);

impl AwsActionsConfigureAwsCredentials {
    /// A step named `name` that runs `aws-actions/configure-aws-credentials@e7f100cf4c008499ea8adda475de1042d6975c7b`, with its required input set.
    pub fn new(name: &str, aws_region: impl ToString) -> Self {
        let step = Step::new(name).uses("aws-actions", "configure-aws-credentials", "e7f100cf4c008499ea8adda475de1042d6975c7b");
        Self(step)
            .with("aws-region", aws_region)
    }

    /// Name of the AWS profile to configure. When provided, credentials are written to ~/.aws/credentials and ~/.aws/config files instead of env variables (unless output-env-credentials is manually set to true). Name cannot contain whitespace, square brackets, or slashes.
    pub fn aws_profile(self, value: impl ToString) -> Self {
        self.with("aws-profile", value)
    }

    /// Overwrite the given AWS profile if it already exists. Requires aws-profile. When set to false or not set, an error will be thrown if the profile already exists.
    pub fn overwrite_aws_profile(self, value: impl ToString) -> Self {
        self.with("overwrite-aws-profile", value)
    }

    /// The Amazon Resource Name (ARN) of the role to assume. Use the provided credentials to assume an IAM role and configure the Actions environment with the assumed role credentials rather than with the provided credentials.
    pub fn role_to_assume(self, value: impl ToString) -> Self {
        self.with("role-to-assume", value)
    }

    /// AWS Access Key ID. Provide this key if you want to assume a role using access keys rather than a web identity token.
    pub fn aws_access_key_id(self, value: impl ToString) -> Self {
        self.with("aws-access-key-id", value)
    }

    /// AWS Secret Access Key. Required if aws-access-key-id is provided.
    pub fn aws_secret_access_key(self, value: impl ToString) -> Self {
        self.with("aws-secret-access-key", value)
    }

    /// AWS Session Token.
    pub fn aws_session_token(self, value: impl ToString) -> Self {
        self.with("aws-session-token", value)
    }

    /// Use the web identity token file from the provided file system path in order to assume an IAM role using a web identity, e.g. from within an Amazon EKS worker node.
    pub fn web_identity_token_file(self, value: impl ToString) -> Self {
        self.with("web-identity-token-file", value)
    }

    /// Use existing credentials from the environment to assume a new role, rather than providing credentials as input.
    pub fn role_chaining(self, value: impl ToString) -> Self {
        self.with("role-chaining", value)
    }

    /// The audience to use for the OIDC provider
    ///
    /// Default: `sts.amazonaws.com`.
    pub fn audience(self, value: impl ToString) -> Self {
        self.with("audience", value)
    }

    /// Proxy to use for the AWS SDK agent
    pub fn http_proxy(self, value: impl ToString) -> Self {
        self.with("http-proxy", value)
    }

    /// Hosts to skip for the proxy configuration
    pub fn no_proxy(self, value: impl ToString) -> Self {
        self.with("no-proxy", value)
    }

    /// Whether to mask the AWS account ID for these credentials as a secret value. By default the account ID will not be masked
    pub fn mask_aws_account_id(self, value: impl ToString) -> Self {
        self.with("mask-aws-account-id", value)
    }

    /// Role duration in seconds. Default is one hour.
    pub fn role_duration_seconds(self, value: impl ToString) -> Self {
        self.with("role-duration-seconds", value)
    }

    /// The external ID of the role to assume.
    pub fn role_external_id(self, value: impl ToString) -> Self {
        self.with("role-external-id", value)
    }

    /// Role session name (default: GitHubActions)
    pub fn role_session_name(self, value: impl ToString) -> Self {
        self.with("role-session-name", value)
    }

    /// Skip session tagging during role assumption
    pub fn role_skip_session_tagging(self, value: impl ToString) -> Self {
        self.with("role-skip-session-tagging", value)
    }

    /// Define a list of transitive tag keys to pass when assuming a role
    pub fn transitive_tag_keys(self, value: impl ToString) -> Self {
        self.with("transitive-tag-keys", value)
    }

    /// Define an inline session policy to use when assuming a role
    pub fn inline_session_policy(self, value: impl ToString) -> Self {
        self.with("inline-session-policy", value)
    }

    /// Define a list of managed session policies to use when assuming a role
    pub fn managed_session_policies(self, value: impl ToString) -> Self {
        self.with("managed-session-policies", value)
    }

    /// Whether to set credentials as step output
    pub fn output_credentials(self, value: impl ToString) -> Self {
        self.with("output-credentials", value)
    }

    /// Whether to export credentials as environment variables. If you set this to false, you probably want to use output-credentials.
    pub fn output_env_credentials(self, value: impl ToString) -> Self {
        self.with("output-env-credentials", value)
    }

    /// Whether to unset the existing credentials in your runner. May be useful if you run this action multiple times in the same job
    pub fn unset_current_credentials(self, value: impl ToString) -> Self {
        self.with("unset-current-credentials", value)
    }

    /// Whether to disable the retry and backoff mechanism when the assume role call fails. By default the retry mechanism is enabled
    pub fn disable_retry(self, value: impl ToString) -> Self {
        self.with("disable-retry", value)
    }

    /// The maximum number of attempts it will attempt to retry the assume role call. By default it will retry 12 times
    pub fn retry_max_attempts(self, value: impl ToString) -> Self {
        self.with("retry-max-attempts", value)
    }

    /// Some environments do not support special characters in AWS_SECRET_ACCESS_KEY. This option will retry fetching credentials until the secret access key does not contain special characters. This option overrides disable-retry and retry-max-attempts. This option is disabled by default
    pub fn special_characters_workaround(self, value: impl ToString) -> Self {
        self.with("special-characters-workaround", value)
    }

    /// When enabled, this option will check if there are already valid credentials in the environment. If there are, new credentials will not be fetched. If there are not, the action will run as normal.
    pub fn use_existing_credentials(self, value: impl ToString) -> Self {
        self.with("use-existing-credentials", value)
    }

    /// An option comma-delimited list of expected AWS account IDs. The action will fail if we receive credentials for the wrong account.
    pub fn allowed_account_ids(self, value: impl ToString) -> Self {
        self.with("allowed-account-ids", value)
    }

    /// When enabled, this option will skip using GitHub OIDC provider even if the id-token permission is set. This is sometimes useful when using IAM instance credentials.
    pub fn force_skip_oidc(self, value: impl ToString) -> Self {
        self.with("force-skip-oidc", value)
    }

    /// A global timeout in seconds for the action. When the timeout is reached, the action immediately exits. The default is to run without a timeout.
    pub fn action_timeout_s(self, value: impl ToString) -> Self {
        self.with("action-timeout-s", value)
    }

    /// Additional tags to apply to the assumed role session. Must be a JSON object provided as a string.
    pub fn custom_tags(self, value: impl ToString) -> Self {
        self.with("custom-tags", value)
    }

    /// Custom STS endpoint URL. Use this to point to an STS-compatible API (e.g. MinIO, LocalStack) instead of the default AWS STS endpoint for the region.
    pub fn sts_endpoint(self, value: impl ToString) -> Self {
        self.with("sts-endpoint", value)
    }

    /// Output `aws-account-id` of the step with id `step`: The AWS account ID for the provided credentials
    pub const fn aws_account_id_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "aws-account-id")
    }

    /// Output `aws-access-key-id` of the step with id `step`: The AWS access key ID for the provided credentials
    pub const fn aws_access_key_id_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "aws-access-key-id")
    }

    /// Output `aws-secret-access-key` of the step with id `step`: The AWS secret access key for the provided credentials
    pub const fn aws_secret_access_key_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "aws-secret-access-key")
    }

    /// Output `aws-session-token` of the step with id `step`: The AWS session token for the provided credentials
    pub const fn aws_session_token_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "aws-session-token")
    }

    /// Output `aws-expiration` of the step with id `step`: The expiration time for the provided credentials
    pub const fn aws_expiration_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "aws-expiration")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<AwsActionsConfigureAwsCredentials> for Step<Use> {
    fn from(action: AwsActionsConfigureAwsCredentials) -> Self {
        action.step()
    }
}

/// `denoland/setup-deno` v2.0.5: Setup Deno by installing, downloading, and adding it to the path.
#[must_use]
pub struct DenolandSetupDeno(Step<Use>);

impl DenolandSetupDeno {
    /// A step named `name` that runs `denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses("denoland", "setup-deno", "22d081ff2d3a40755e97629de92e3bcbfa7cf2ed");
        Self(step)
    }

    /// The Deno version to install. Can be a semver version of a stable release, "canary" for the latest canary, "lts" for the latest LTS, or the Git hash of a specific canary release.
    ///
    /// Default: `2.x`.
    pub fn deno_version(self, value: impl ToString) -> Self {
        self.with("deno-version", value)
    }

    /// File containing the Deno version to install such as .dvmrc or .tool-versions.
    pub fn deno_version_file(self, value: impl ToString) -> Self {
        self.with("deno-version-file", value)
    }

    /// The name to use for the binary.
    ///
    /// Default: `deno`.
    pub fn deno_binary_name(self, value: impl ToString) -> Self {
        self.with("deno-binary-name", value)
    }

    /// Cache downloaded modules & packages automatically in GitHub Actions cache.
    ///
    /// Default: `false`.
    pub fn cache(self, value: impl ToString) -> Self {
        self.with("cache", value)
    }

    /// A hash used as part of the cache key, which defaults to a hash of the deno.lock files.
    pub fn cache_hash(self, value: impl ToString) -> Self {
        self.with("cache-hash", value)
    }

    /// Output `cache-hit` of the step with id `step`: A boolean indicating whether the cache was hit.
    pub const fn cache_hit_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "cache-hit")
    }

    /// Output `deno-version` of the step with id `step`: The Deno version that was installed.
    pub const fn deno_version_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "deno-version")
    }

    /// Output `release-channel` of the step with id `step`: The release channel of the installed version.
    pub const fn release_channel_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "release-channel")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<DenolandSetupDeno> for Step<Use> {
    fn from(action: DenolandSetupDeno) -> Self {
        action.step()
    }
}

/// `docker/setup-buildx-action` v3.12.0: Set up Docker Buildx
#[must_use]
pub struct DockerSetupBuildxAction(Step<Use>);

impl DockerSetupBuildxAction {
    /// A step named `name` that runs `docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses("docker", "setup-buildx-action", "8d2750c68a42422c14e847fe6c8ac0403b4cbd6f");
        Self(step)
    }

    /// Buildx version. (eg. v0.3.0)
    pub fn version(self, value: impl ToString) -> Self {
        self.with("version", value)
    }

    /// Sets the builder driver to be used
    ///
    /// Default: `docker-container`.
    pub fn driver(self, value: impl ToString) -> Self {
        self.with("driver", value)
    }

    /// List of additional driver-specific options. (eg. image=moby/buildkit:master)
    pub fn driver_opts(self, value: impl ToString) -> Self {
        self.with("driver-opts", value)
    }

    /// BuildKit daemon flags
    pub fn buildkitd_flags(self, value: impl ToString) -> Self {
        self.with("buildkitd-flags", value)
    }

    /// BuildKit daemon config file
    pub fn buildkitd_config(self, value: impl ToString) -> Self {
        self.with("buildkitd-config", value)
    }

    /// Inline BuildKit daemon config
    pub fn buildkitd_config_inline(self, value: impl ToString) -> Self {
        self.with("buildkitd-config-inline", value)
    }

    /// Switch to this builder instance
    ///
    /// Default: `true`.
    pub fn r#use(self, value: impl ToString) -> Self {
        self.with("use", value)
    }

    /// Name of the builder. If not specified, one will be generated or if it already exists, it will be used instead of creating a new one.
    pub fn name(self, value: impl ToString) -> Self {
        self.with("name", value)
    }

    /// Optional address for docker socket or context from `docker context ls`
    pub fn endpoint(self, value: impl ToString) -> Self {
        self.with("endpoint", value)
    }

    /// Fixed platforms for current node. If not empty, values take priority over the detected ones
    pub fn platforms(self, value: impl ToString) -> Self {
        self.with("platforms", value)
    }

    /// Append additional nodes to the builder
    pub fn append(self, value: impl ToString) -> Self {
        self.with("append", value)
    }

    /// Keep BuildKit state on cleanup. This is only useful on persistent self-hosted runners.
    ///
    /// Default: `false`.
    pub fn keep_state(self, value: impl ToString) -> Self {
        self.with("keep-state", value)
    }

    /// Cache buildx binary to GitHub Actions cache backend
    ///
    /// Default: `true`.
    pub fn cache_binary(self, value: impl ToString) -> Self {
        self.with("cache-binary", value)
    }

    /// Cleanup temp files and remove builder at the end of a job
    ///
    /// Default: `true`.
    pub fn cleanup(self, value: impl ToString) -> Self {
        self.with("cleanup", value)
    }

    /// BuildKit daemon config file
    #[deprecated = "Use buildkitd-config instead"]
    pub fn config(self, value: impl ToString) -> Self {
        self.with("config", value)
    }

    /// Inline BuildKit daemon config
    #[deprecated = "Use buildkitd-config-inline instead"]
    pub fn config_inline(self, value: impl ToString) -> Self {
        self.with("config-inline", value)
    }

    /// Sets up docker build command as an alias to docker buildx build
    ///
    /// Default: `false`.
    #[deprecated = "\"docker buildx install\" command is deprecated and will be removed in a future release, use BUILDX_BUILDER environment variable instead"]
    pub fn install(self, value: impl ToString) -> Self {
        self.with("install", value)
    }

    /// Output `name` of the step with id `step`: Builder name
    pub const fn name_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "name")
    }

    /// Output `driver` of the step with id `step`: Builder driver
    pub const fn driver_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "driver")
    }

    /// Output `platforms` of the step with id `step`: Builder node platforms (preferred or available)
    pub const fn platforms_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "platforms")
    }

    /// Output `nodes` of the step with id `step`: Builder nodes metadata
    pub const fn nodes_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "nodes")
    }

    /// Output `endpoint` of the step with id `step`: Builder node endpoint (deprecated, use nodes output instead)
    pub const fn endpoint_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "endpoint")
    }

    /// Output `status` of the step with id `step`: Builder node status (deprecated, use nodes output instead)
    pub const fn status_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "status")
    }

    /// Output `flags` of the step with id `step`: Builder node flags (deprecated, use nodes output instead)
    pub const fn flags_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "flags")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<DockerSetupBuildxAction> for Step<Use> {
    fn from(action: DockerSetupBuildxAction) -> Self {
        action.step()
    }
}

/// `dorny/paths-filter` v3.0.3: Execute your workflow steps only if relevant files are modified.
#[must_use]
pub struct DornyPathsFilter(Step<Use>);

impl DornyPathsFilter {
    /// A step named `name` that runs `dorny/paths-filter@d1c1ffe0248fe513906c8e24db8ea791d46f8590`, with its required input set.
    pub fn new(name: &str, filters: impl ToString) -> Self {
        let step = Step::new(name).uses("dorny", "paths-filter", "d1c1ffe0248fe513906c8e24db8ea791d46f8590");
        Self(step)
            .with("filters", filters)
    }

    /// GitHub Access Token
    ///
    /// Default: `${{ github.token }}`.
    pub fn token(self, value: impl ToString) -> Self {
        self.with("token", value)
    }

    /// Relative path under $GITHUB_WORKSPACE where the repository was checked out.
    pub fn working_directory(self, value: impl ToString) -> Self {
        self.with("working-directory", value)
    }

    /// Git reference (e.g. branch name) from which the changes will be detected.
    /// This option is ignored if action is triggered by pull_request event.
    pub fn r#ref(self, value: impl ToString) -> Self {
        self.with("ref", value)
    }

    /// Git reference (e.g. branch name) against which the changes will be detected. Defaults to repository default branch (e.g. master).
    /// If it references same branch it was pushed to, changes are detected against the most recent commit before the push.
    /// This option is ignored if action is triggered by pull_request event.
    pub fn base(self, value: impl ToString) -> Self {
        self.with("base", value)
    }

    /// Enables listing of files matching the filter:
    ///   'none'  - Disables listing of matching files (default).
    ///   'csv'   - Coma separated list of filenames.
    ///             If needed it uses double quotes to wrap filename with unsafe characters.
    ///   'json'  - Serialized as JSON array.
    ///   'shell' - Space delimited list usable as command line argument list in linux shell.
    ///             If needed it uses single or double quotes to wrap filename with unsafe characters.
    ///   'escape'- Space delimited list usable as command line argument list in linux shell.
    ///             Backslash escapes every potentially unsafe character.
    ///
    ///
    /// Default: `none`.
    pub fn list_files(self, value: impl ToString) -> Self {
        self.with("list-files", value)
    }

    /// How many commits are initially fetched from base branch.
    /// If needed, each subsequent fetch doubles the previously requested number of commits
    /// until the merge-base is found or there are no more commits in the history.
    /// This option takes effect only when changes are detected using git against different base branch.
    ///
    ///
    /// Default: `100`.
    pub fn initial_fetch_depth(self, value: impl ToString) -> Self {
        self.with("initial-fetch-depth", value)
    }

    /// allows to override the "at least one pattern" behavior to make it so that all of the patterns have to match or otherwise the file is excluded.
    ///
    ///
    /// Default: `some`.
    pub fn predicate_quantifier(self, value: impl ToString) -> Self {
        self.with("predicate-quantifier", value)
    }

    /// Output `changes` of the step with id `step`: JSON array with names of all filters matching any of changed files
    pub const fn changes_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "changes")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<DornyPathsFilter> for Step<Use> {
    fn from(action: DornyPathsFilter) -> Self {
        action.step()
    }
}

/// `google-github-actions/auth` v3.0.0: Authenticate to Google Cloud from GitHub Actions via Workload Identity
/// Federation or service account keys.
#[must_use]
pub struct GoogleGithubActionsAuth(Step<Use>);

impl GoogleGithubActionsAuth {
    /// A step named `name` that runs `google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses("google-github-actions", "auth", "7c6bc770dae815cd3e89ee6cdf493a5fab2cc093");
        Self(step)
    }

    /// ID of the default project to use for future API calls and invocations. If
    /// unspecified, this action will attempt to extract the value from other
    /// inputs such as "service_account" or "credentials_json".
    pub fn project_id(self, value: impl ToString) -> Self {
        self.with("project_id", value)
    }

    /// The full identifier of the Workload Identity Provider, including the
    /// project number, pool name, and provider name. If provided, this must be
    /// the full identifier which includes all parts, for example:
    /// "projects/123456789/locations/global/workloadIdentityPools/my-pool/providers/my-provider".
    /// This is mutually exclusive with "credentials_json".
    pub fn workload_identity_provider(self, value: impl ToString) -> Self {
        self.with("workload_identity_provider", value)
    }

    /// Email address or unique identifier of the Google Cloud service account for
    /// which to generate credentials. This is required if
    /// "workload_identity_provider" is specified.
    pub fn service_account(self, value: impl ToString) -> Self {
        self.with("service_account", value)
    }

    /// The value for the audience (aud) parameter in GitHub's generated OIDC
    /// token. This value defaults to the value of "workload_identity_provider",
    /// which is also the default value Google Cloud expects for the audience
    /// parameter on the token.
    ///
    /// Default: ``.
    pub fn audience(self, value: impl ToString) -> Self {
        self.with("audience", value)
    }

    /// The Google Cloud JSON service account key to use for authentication. This
    /// is mutually exclusive with "workload_identity_provider".
    pub fn credentials_json(self, value: impl ToString) -> Self {
        self.with("credentials_json", value)
    }

    /// If true, the action will securely generate a credentials file which can be
    /// used for authentication via gcloud and Google Cloud SDKs.
    ///
    /// Default: `true`.
    pub fn create_credentials_file(self, value: impl ToString) -> Self {
        self.with("create_credentials_file", value)
    }

    /// If true, the action will export common environment variables which are
    /// known to be consumed by popular downstream libraries and tools, including:
    ///
    /// - CLOUDSDK_PROJECT
    /// - CLOUDSDK_CORE_PROJECT
    /// - GCP_PROJECT
    /// - GCLOUD_PROJECT
    /// - GOOGLE_CLOUD_PROJECT
    ///
    /// If "create_credentials_file" is true, additional environment variables are
    /// exported:
    ///
    /// - CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE
    /// - GOOGLE_APPLICATION_CREDENTIALS
    /// - GOOGLE_GHA_CREDS_PATH
    ///
    /// If false, the action will not export any environment variables, meaning
    /// future steps are unlikely to be automatically authenticated to Google
    /// Cloud.
    ///
    /// Default: `true`.
    pub fn export_environment_variables(self, value: impl ToString) -> Self {
        self.with("export_environment_variables", value)
    }

    /// Output format for the generated authentication token. For OAuth 2.0 access
    /// tokens, specify "access_token". For OIDC tokens, specify "id_token". To
    /// skip token generation, leave this value empty.
    ///
    /// Default: ``.
    pub fn token_format(self, value: impl ToString) -> Self {
        self.with("token_format", value)
    }

    /// List of additional service account emails or unique identities to use for
    /// impersonation in the chain.
    ///
    /// Default: ``.
    pub fn delegates(self, value: impl ToString) -> Self {
        self.with("delegates", value)
    }

    /// The Google Cloud universe to use for constructing API endpoints. The
    /// default universe is "googleapis.com", which corresponds to
    /// https://cloud.google.com. Trusted Partner Cloud and Google Distributed
    /// Hosted Cloud should set this to their universe address.
    ///
    /// Default: `googleapis.com`.
    pub fn universe(self, value: impl ToString) -> Self {
        self.with("universe", value)
    }

    /// An optional Reason Request System Parameter for each API call made by the
    /// GitHub Action. This will inject the "X-Goog-Request-Reason" HTTP header,
    /// which will provide user-supplied information in Google Cloud audit logs.
    pub fn request_reason(self, value: impl ToString) -> Self {
        self.with("request_reason", value)
    }

    /// If true, the action will remove any created credentials from the
    /// filesystem upon completion. This only applies if "create_credentials_file"
    /// is true.
    ///
    /// Default: `true`.
    pub fn cleanup_credentials(self, value: impl ToString) -> Self {
        self.with("cleanup_credentials", value)
    }

    /// Desired lifetime duration of the access token, in seconds. This must be
    /// specified as the number of seconds with a trailing "s" (e.g. 30s). This is
    /// only valid when "token_format" is "access_token".
    ///
    /// Default: `3600s`.
    pub fn access_token_lifetime(self, value: impl ToString) -> Self {
        self.with("access_token_lifetime", value)
    }

    /// List of OAuth 2.0 access scopes to be included in the generated token.
    /// This is only valid when "token_format" is "access_token".
    ///
    /// Default: `https://www.googleapis.com/auth/cloud-platform`.
    pub fn access_token_scopes(self, value: impl ToString) -> Self {
        self.with("access_token_scopes", value)
    }

    /// Email address of a user to impersonate for Domain-Wide Delegation Access
    /// tokens created for Domain-Wide Delegation cannot have a lifetime beyond 1
    /// hour. This is only valid when "token_format" is "access_token".
    ///
    /// Default: ``.
    pub fn access_token_subject(self, value: impl ToString) -> Self {
        self.with("access_token_subject", value)
    }

    /// The audience (aud) for the generated Google Cloud ID Token. This is only
    /// valid when "token_format" is "id_token".
    ///
    /// Default: ``.
    pub fn id_token_audience(self, value: impl ToString) -> Self {
        self.with("id_token_audience", value)
    }

    /// Optional parameter of whether to include the service account email in the
    /// generated token. If true, the token will contain "email" and
    /// "email_verified" claims. This is only valid when "token_format" is
    /// "id_token".
    ///
    /// Default: `false`.
    pub fn id_token_include_email(self, value: impl ToString) -> Self {
        self.with("id_token_include_email", value)
    }

    /// Output `project_id` of the step with id `step`: Provided or extracted value for the Google Cloud project ID.
    pub const fn project_id_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "project_id")
    }

    /// Output `credentials_file_path` of the step with id `step`: Path on the local filesystem where the generated credentials file resides.
    /// This is only available if "create_credentials_file" was set to true.
    pub const fn credentials_file_path_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "credentials_file_path")
    }

    /// Output `auth_token` of the step with id `step`: The intermediate authentication token, which could be used to call other
    /// Google Cloud APIs, depending on how you configured IAM.
    pub const fn auth_token_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "auth_token")
    }

    /// Output `access_token` of the step with id `step`: The Google Cloud access token for calling other Google Cloud APIs. This is
    /// only available when "token_format" is "access_token".
    pub const fn access_token_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "access_token")
    }

    /// Output `id_token` of the step with id `step`: The Google Cloud ID token. This is only available when "token_format" is
    /// "id_token".
    pub const fn id_token_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "id_token")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<GoogleGithubActionsAuth> for Step<Use> {
    fn from(action: GoogleGithubActionsAuth) -> Self {
        action.step()
    }
}

/// `grafana/grafana-github-actions/gha-otel-export` main: Export GitHub Actions workflow runs as OpenTelemetry traces
#[must_use]
pub struct GrafanaGrafanaGithubActionsGhaOtelExport(Step<Use>);

impl GrafanaGrafanaGithubActionsGhaOtelExport {
    /// A step named `name` that runs `grafana/grafana-github-actions/gha-otel-export@b1c422726cc4ff4adb0838ebca67586f24babb42`, with its required input set.
    pub fn new(name: &str, github_token: impl ToString) -> Self {
        let step = Step::new(name).uses("grafana", "grafana-github-actions/gha-otel-export", "b1c422726cc4ff4adb0838ebca67586f24babb42");
        Self(step)
            .with("github-token", github_token)
    }

    /// Glob pattern to match GitHub artifact(s) containing trace files in JSONL format (output of OTEL logging provider)
    pub fn trace_artifacts_glob(self, value: impl ToString) -> Self {
        self.with("trace-artifacts-glob", value)
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<GrafanaGrafanaGithubActionsGhaOtelExport> for Step<Use> {
    fn from(action: GrafanaGrafanaGithubActionsGhaOtelExport) -> Self {
        action.step()
    }
}

/// `namespacelabs/nscloud-cache-action` v1.4.3: Cache artifacts like dependencies and build outputs to a Namespace Cloud cache volume to improve workflow execution time.
#[must_use]
pub struct NamespacelabsNscloudCacheAction(Step<Use>);

impl NamespacelabsNscloudCacheAction {
    /// A step named `name` that runs `namespacelabs/nscloud-cache-action@15799a6b54e5765f85b2aac25b3f0df43ed571c0`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses("namespacelabs", "nscloud-cache-action", "15799a6b54e5765f85b2aac25b3f0df43ed571c0");
        Self(step)
    }

    /// Version of spacectl CLI to use (e.g., '0.1.0' or 'latest'). If not specified, uses existing binary or fetches latest.
    pub fn spacectl_version(self, value: impl ToString) -> Self {
        self.with("spacectl-version", value)
    }

    /// Whether to use an existing spacectl binary. Options: 'prefer' (default), 'require', 'ignore'.
    pub fn spacectl_system_binary(self, value: impl ToString) -> Self {
        self.with("spacectl-system-binary", value)
    }

    /// GitHub token for API requests to fetch space releases
    ///
    /// Default: `${{ github.token }}`.
    pub fn github_token(self, value: impl ToString) -> Self {
        self.with("github-token", value)
    }

    /// Fail the workflow if cache entry is not found
    ///
    /// Default: `false`.
    pub fn fail_on_cache_miss(self, value: impl ToString) -> Self {
        self.with("fail-on-cache-miss", value)
    }

    /// A list of cache modes you want to enable, only if detected. Set to 'true' to detect all available cache modes based on the environment. See `cache` for a list of available cache modes.
    pub fn detect(self, value: impl ToString) -> Self {
        self.with("detect", value)
    }

    /// A list of cache modes to enable. Supported options are 'apt,brew,bun,cocoapods,composer,deno,go,golangci-lint,gradle,maven,mise,nix,playwright,pnpm,poetry,python,ruby,rust,swiftpm,uv,xcode,yarn'
    pub fn cache(self, value: impl ToString) -> Self {
        self.with("cache", value)
    }

    /// A list of files, directories, and wildcard patterns to cache and restore
    pub fn path(self, value: impl ToString) -> Self {
        self.with("path", value)
    }

    /// Output `cache-hit` of the step with id `step`: A boolean value to indicate an exact match was found for the primary key
    pub const fn cache_hit_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "cache-hit")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<NamespacelabsNscloudCacheAction> for Step<Use> {
    fn from(action: NamespacelabsNscloudCacheAction) -> Self {
        action.step()
    }
}

/// `namespacelabs/nscloud-setup-buildx-action` v0.0.23: Configure buildx to use the Namespace Cloud build cluster
#[must_use]
pub struct NamespacelabsNscloudSetupBuildxAction(Step<Use>);

impl NamespacelabsNscloudSetupBuildxAction {
    /// A step named `name` that runs `namespacelabs/nscloud-setup-buildx-action@d059ed7184f0bc7c8b27e8810cea153d02bcc6dd`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses("namespacelabs", "nscloud-setup-buildx-action", "d059ed7184f0bc7c8b27e8810cea153d02bcc6dd");
        Self(step)
    }

    /// The name of the local Docker build driver to be configured.
    ///
    /// Default: ``.
    pub fn builder_name(self, value: impl ToString) -> Self {
        self.with("builder-name", value)
    }

    /// Whether to load images to local docker engine
    ///
    /// Default: `true`.
    pub fn load_to_docker(self, value: impl ToString) -> Self {
        self.with("load-to-docker", value)
    }

    /// If true, creates the build clusters eagerly and waits for them to be available
    ///
    /// Default: `false`.
    pub fn wait_for_builder(self, value: impl ToString) -> Self {
        self.with("wait-for-builder", value)
    }

    /// A set of experimental configurations passed to builder configuration.
    ///
    /// Default: ``.
    pub fn experimental(self, value: impl ToString) -> Self {
        self.with("experimental", value)
    }

    /// If set, select this named builder. Contact <address> to get access.
    ///
    /// Default: ``.
    pub fn tag(self, value: impl ToString) -> Self {
        self.with("tag", value)
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<NamespacelabsNscloudSetupBuildxAction> for Step<Use> {
    fn from(action: NamespacelabsNscloudSetupBuildxAction) -> Self {
        action.step()
    }
}

/// `oven-sh/setup-bun` v2.2.0: Download, install, and setup Bun to your path.
#[must_use]
pub struct OvenShSetupBun(Step<Use>);

impl OvenShSetupBun {
    /// A step named `name` that runs `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses("oven-sh", "setup-bun", "0c5077e51419868618aeaa5fe8019c62421857d6");
        Self(step)
    }

    /// The version of Bun to install. (e.g. "latest", "canary", "1.0.0", "1.0.x", <sha>)
    pub fn bun_version(self, value: impl ToString) -> Self {
        self.with("bun-version", value)
    }

    /// The version of Bun to install from file. (e.g. "package.json", ".bun-version", ".tool-versions")
    pub fn bun_version_file(self, value: impl ToString) -> Self {
        self.with("bun-version-file", value)
    }

    /// Override the URL to download Bun from. This skips version resolution and verifying AVX2 support.
    pub fn bun_download_url(self, value: impl ToString) -> Self {
        self.with("bun-download-url", value)
    }

    /// List of package registries with authentication support. Format:
    /// - Default registry: https://registry.npmjs.org/
    /// - Default with token: https://registry.npmjs.org/|token
    /// - Scoped registry: @scope:https://registry.example.com/
    /// - Scoped with token: @scope:https://registry.example.com/|token
    /// - Scoped with credentials: @scope:https://user:pass@registry.example.com/
    pub fn registries(self, value: impl ToString) -> Self {
        self.with("registries", value)
    }

    /// The URL of the package registry to use for installing Bun. Set the $BUN_AUTH_TOKEN environment variable to authenticate with the registry.
    #[deprecated = "Use 'registries' input instead."]
    pub fn registry_url(self, value: impl ToString) -> Self {
        self.with("registry-url", value)
    }

    /// The scope for authenticating with the package registry.
    #[deprecated = "Use 'registries' input instead."]
    pub fn scope(self, value: impl ToString) -> Self {
        self.with("scope", value)
    }

    /// Disable caching of bun executable.
    ///
    /// Default: `false`.
    pub fn no_cache(self, value: impl ToString) -> Self {
        self.with("no-cache", value)
    }

    /// Personal access token (PAT) used to fetch tags from oven-sh/bun repository. Recommended for resolving wildcard/range versions to avoid GitHub API rate limiting. When running this action on github.com, the default value is sufficient. When running on GHES, you can pass a personal access token for github.com if you are experiencing rate limiting.
    ///
    /// Default: `${{ github.server_url == 'https://github.com' && github.token || '' }}`.
    pub fn token(self, value: impl ToString) -> Self {
        self.with("token", value)
    }

    /// Output `bun-version` of the step with id `step`: The version of Bun that was installed.
    pub const fn bun_version_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "bun-version")
    }

    /// Output `bun-revision` of the step with id `step`: The revision of Bun that was installed.
    pub const fn bun_revision_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "bun-revision")
    }

    /// Output `bun-path` of the step with id `step`: The path to the Bun executable.
    pub const fn bun_path_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "bun-path")
    }

    /// Output `bun-download-url` of the step with id `step`: The URL from which Bun was downloaded.
    pub const fn bun_download_url_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "bun-download-url")
    }

    /// Output `cache-hit` of the step with id `step`: If the version of Bun was cached.
    pub const fn cache_hit_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "cache-hit")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<OvenShSetupBun> for Step<Use> {
    fn from(action: OvenShSetupBun) -> Self {
        action.step()
    }
}

/// `pulumi/actions` v7.0.0: Pulumi's GitHub Actions deploy apps and infrastructure to your cloud of choice, using just your favorite language and GitHub.
#[must_use]
pub struct PulumiActions(Step<Use>);

impl PulumiActions {
    /// A step named `name` that runs `pulumi/actions@8e5e406f4007fca908480587cb9893c07090f58d`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses("pulumi", "actions", "8e5e406f4007fca908480587cb9893c07090f58d");
        Self(step)
    }

    /// Pulumi command to run, eg. up
    pub fn command(self, value: impl ToString) -> Self {
        self.with("command", value)
    }

    /// Which stack you want to apply to, eg. dev
    pub fn stack_name(self, value: impl ToString) -> Self {
        self.with("stack-name", value)
    }

    /// Install a specific version of the Pulumi CLI
    pub fn pulumi_version(self, value: impl ToString) -> Self {
        self.with("pulumi-version", value)
    }

    /// File containing the version of the Pulumi CLI to install. Example: .pulumi.version
    pub fn pulumi_version_file(self, value: impl ToString) -> Self {
        self.with("pulumi-version-file", value)
    }

    /// Location of your Pulumi files. Defaults to ./
    ///
    /// Default: `./`.
    pub fn work_dir(self, value: impl ToString) -> Self {
        self.with("work-dir", value)
    }

    /// If true, a comment will be created with results
    ///
    /// Default: `false`.
    pub fn comment_on_pr(self, value: impl ToString) -> Self {
        self.with("comment-on-pr", value)
    }

    /// Overrides the PR used to comment on
    pub fn comment_on_pr_number(self, value: impl ToString) -> Self {
        self.with("comment-on-pr-number", value)
    }

    /// If true, a comment on the GitHub step summary will be created
    ///
    /// Default: `false`.
    pub fn comment_on_summary(self, value: impl ToString) -> Self {
        self.with("comment-on-summary", value)
    }

    /// Github Token
    ///
    /// Default: `${{ github.token }}`.
    pub fn github_token(self, value: impl ToString) -> Self {
        self.with("github-token", value)
    }

    /// A cloud URL to log in to
    pub fn cloud_url(self, value: impl ToString) -> Self {
        self.with("cloud-url", value)
    }

    /// The type of the provider that should be used to encrypt and decrypt secrets. Possible choices: default, passphrase, awskms, azurekeyvault, gcpkms, hashivault
    pub fn secrets_provider(self, value: impl ToString) -> Self {
        self.with("secrets-provider", value)
    }

    /// Allow P resource operations to run in parallel at once (1 for no parallelism). Defaults to unbounded.
    pub fn parallel(self, value: impl ToString) -> Self {
        self.with("parallel", value)
    }

    /// Optional message to associate with the update operation
    pub fn message(self, value: impl ToString) -> Self {
        self.with("message", value)
    }

    /// Config to use during the operations
    pub fn config_map(self, value: impl ToString) -> Self {
        self.with("config-map", value)
    }

    /// Return an error if any changes occur during this update
    ///
    /// Default: `false`.
    pub fn expect_no_changes(self, value: impl ToString) -> Self {
        self.with("expect-no-changes", value)
    }

    /// Display operation as a rich diff showing the overall change
    ///
    /// Default: `false`.
    pub fn diff(self, value: impl ToString) -> Self {
        self.with("diff", value)
    }

    /// Specify resources to replace. Multiple resources can be specified one per line
    pub fn replace(self, value: impl ToString) -> Self {
        self.with("replace", value)
    }

    /// Specify a single resource URN to ignore. Multiple resources can be specified one per line
    pub fn exclude(self, value: impl ToString) -> Self {
        self.with("exclude", value)
    }

    /// Allows ignoring of dependent targets discovered but not specified in exclude.
    ///
    /// Default: `false`.
    pub fn exclude_dependents(self, value: impl ToString) -> Self {
        self.with("exclude-dependents", value)
    }

    /// Specify a single resource URN to update. Other resources will not be updated. Multiple resources can be specified one per line
    pub fn target(self, value: impl ToString) -> Self {
        self.with("target", value)
    }

    /// Allows updating of dependent targets discovered but not specified in target.
    ///
    /// Default: `false`.
    pub fn target_dependents(self, value: impl ToString) -> Self {
        self.with("target-dependents", value)
    }

    /// Run one or more policy packs as part of this update.
    pub fn policy_packs(self, value: impl ToString) -> Self {
        self.with("policyPacks", value)
    }

    /// Path to JSON file containing the config for the policy pack of the corresponding "--policy-pack" flag.
    pub fn policy_pack_configs(self, value: impl ToString) -> Self {
        self.with("policyPackConfigs", value)
    }

    /// Execute the operation with the `--refresh` option
    ///
    /// Default: `false`.
    pub fn refresh(self, value: impl ToString) -> Self {
        self.with("refresh", value)
    }

    /// Create the stack if it currently does not exist
    ///
    /// Default: `false`.
    pub fn upsert(self, value: impl ToString) -> Self {
        self.with("upsert", value)
    }

    /// Delete the stack after a destroy operation
    ///
    /// Default: `false`.
    pub fn remove(self, value: impl ToString) -> Self {
        self.with("remove", value)
    }

    /// Edit previous PR comment instead of posting new one
    ///
    /// Default: `true`.
    pub fn edit_pr_comment(self, value: impl ToString) -> Self {
        self.with("edit-pr-comment", value)
    }

    /// Colorize output. Choices are: always, never, raw, auto
    ///
    /// Default: `auto`.
    pub fn color(self, value: impl ToString) -> Self {
        self.with("color", value)
    }

    /// Skip destroying protected resources. Only valid when command is destroy.
    ///
    /// Default: `false`.
    pub fn exclude_protected(self, value: impl ToString) -> Self {
        self.with("exclude-protected", value)
    }

    /// Where to either save an Update Plan or read an Update Plan from
    pub fn plan(self, value: impl ToString) -> Self {
        self.with("plan", value)
    }

    /// Suppress display of stack outputs (in case they contain sensitive values).
    ///
    /// Default: `false`.
    pub fn suppress_outputs(self, value: impl ToString) -> Self {
        self.with("suppress-outputs", value)
    }

    /// Suppress display of periodic progress dots to limit logs length
    ///
    /// Default: `false`.
    pub fn suppress_progress(self, value: impl ToString) -> Self {
        self.with("suppress-progress", value)
    }

    /// If comments must be trimmed, trim them from the front. This ensures the resources summary is always included in the comment
    ///
    /// Default: `false`.
    pub fn always_include_summary(self, value: impl ToString) -> Self {
        self.with("always-include-summary", value)
    }

    /// Continue running the update even if an error is encountered
    ///
    /// Default: `false`.
    pub fn continue_on_error(self, value: impl ToString) -> Self {
        self.with("continue-on-error", value)
    }

    /// Enable verbose logging (1-11; >3 is very verbose)
    pub fn log_verbosity(self, value: impl ToString) -> Self {
        self.with("log-verbosity", value)
    }

    /// Flow log settings to child processes (like plugins)
    ///
    /// Default: `false`.
    pub fn log_flow(self, value: impl ToString) -> Self {
        self.with("log-flow", value)
    }

    /// Print detailed debugging output during resource operations
    ///
    /// Default: `false`.
    pub fn debug(self, value: impl ToString) -> Self {
        self.with("debug", value)
    }

    /// Output `output` of the step with id `step`: Output from running command
    pub const fn output_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "output")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<PulumiActions> for Step<Use> {
    fn from(action: PulumiActions) -> Self {
        action.step()
    }
}

/// `r0adkll/upload-google-play` v1.1.5: An action to upload a signed Android release (.apk or .aab) to the Google Play Store Developer Console
#[must_use]
pub struct R0adkllUploadGooglePlay(Step<Use>);

impl R0adkllUploadGooglePlay {
    /// A step named `name` that runs `r0adkll/upload-google-play@e738b9dd8f2476ea806d921b64aacd24f34515a5`, with its required input set.
    pub fn new(name: &str, package_name: impl ToString) -> Self {
        let step = Step::new(name).uses("r0adkll", "upload-google-play", "e738b9dd8f2476ea806d921b64aacd24f34515a5");
        Self(step)
            .with("packageName", package_name)
    }

    /// The service account json private key file to authorize the upload request
    pub fn service_account_json(self, value: impl ToString) -> Self {
        self.with("serviceAccountJson", value)
    }

    /// The raw json text of the service account private key to authorize the upload request
    pub fn service_account_json_plain_text(self, value: impl ToString) -> Self {
        self.with("serviceAccountJsonPlainText", value)
    }

    /// The Android release file to upload (.apk or .aab)
    pub fn release_file(self, value: impl ToString) -> Self {
        self.with("releaseFile", value)
    }

    /// The Android release file(s) to upload (.apk or .aab). Separated by  a ',' for multiple artifacts. Supports glob
    pub fn release_files(self, value: impl ToString) -> Self {
        self.with("releaseFiles", value)
    }

    /// The name of this release. If not set it's generated automatically from the APKs versionName
    pub fn release_name(self, value: impl ToString) -> Self {
        self.with("releaseName", value)
    }

    /// The track in which you want to assign the uploaded app.
    pub fn track(self, value: impl ToString) -> Self {
        self.with("track", value)
    }

    /// The track(s) in which you want to assign the uploaded app.
    pub fn tracks(self, value: impl ToString) -> Self {
        self.with("tracks", value)
    }

    /// In-app update priority of the release. All newly added APKs in the release will be considered at this priority. Can take values in the range [0, 5], with 5 the highest priority. Defaults to 0.
    ///
    /// Default: `0`.
    pub fn in_app_update_priority(self, value: impl ToString) -> Self {
        self.with("inAppUpdatePriority", value)
    }

    /// Portion of users who should get the staged version of the app. Accepts values between 0.0 and 1.0 (exclusive-exclusive).
    pub fn user_fraction(self, value: impl ToString) -> Self {
        self.with("userFraction", value)
    }

    /// Release status. This can be set to 'draft' to complete the release at some other time.
    ///
    /// Default: `completed`.
    pub fn status(self, value: impl ToString) -> Self {
        self.with("status", value)
    }

    /// The directory of localized whats new files
    pub fn whats_new_directory(self, value: impl ToString) -> Self {
        self.with("whatsNewDirectory", value)
    }

    /// The mapping.txt file used to de-obfuscate your stack traces from crash reports
    pub fn mapping_file(self, value: impl ToString) -> Self {
        self.with("mappingFile", value)
    }

    /// The native-debug-symbols.zip file or folder that contains your debug symbols
    pub fn debug_symbols(self, value: impl ToString) -> Self {
        self.with("debugSymbols", value)
    }

    /// Indicates that the changes in this edit will not be reviewed until they are explicitly sent for review from the Google Play Console
    ///
    /// Default: `false`.
    pub fn changes_not_sent_for_review(self, value: impl ToString) -> Self {
        self.with("changesNotSentForReview", value)
    }

    /// The ID of an existing edit that has not been completed. If this is supplied, the action will append information to that rather than creating an edit
    pub fn existing_edit_id(self, value: impl ToString) -> Self {
        self.with("existingEditId", value)
    }

    /// Version codes to retain from previous releases. Separated by a ','.
    pub fn version_codes_to_retain(self, value: impl ToString) -> Self {
        self.with("versionCodesToRetain", value)
    }

    /// Output `internalSharingDownloadUrl` of the step with id `step`: The internal app sharing download url if track was 'internalsharing'
    pub const fn internal_sharing_download_url_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "internalSharingDownloadUrl")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<R0adkllUploadGooglePlay> for Step<Use> {
    fn from(action: R0adkllUploadGooglePlay) -> Self {
        action.step()
    }
}

/// `runs-on/cache/restore` v4: Restore Cache artifacts like dependencies and build outputs to improve workflow execution time
#[must_use]
pub struct RunsOnCacheRestore(Step<Use>);

impl RunsOnCacheRestore {
    /// A step named `name` that runs `runs-on/cache/restore@a5f51d6f3fece787d03b7b4e981c82538a0654ed`, with its required inputs set.
    pub fn new(name: &str, path: impl ToString, key: impl ToString) -> Self {
        let step = Step::new(name).uses("runs-on", "cache/restore", "a5f51d6f3fece787d03b7b4e981c82538a0654ed");
        Self(step)
            .with("path", path)
            .with("key", key)
    }

    /// An ordered multiline string listing the prefix-matched keys, that are used for restoring stale cache if no cache hit occurred for key. Note `cache-hit` returns false in this case.
    pub fn restore_keys(self, value: impl ToString) -> Self {
        self.with("restore-keys", value)
    }

    /// An optional boolean when enabled, allows windows runners to restore caches that were saved on other platforms
    ///
    /// Default: `false`.
    pub fn enable_cross_os_archive(self, value: impl ToString) -> Self {
        self.with("enableCrossOsArchive", value)
    }

    /// Fail the workflow if cache entry is not found
    ///
    /// Default: `false`.
    pub fn fail_on_cache_miss(self, value: impl ToString) -> Self {
        self.with("fail-on-cache-miss", value)
    }

    /// Check if a cache entry exists for the given input(s) (key, restore-keys) without downloading the cache
    ///
    /// Default: `false`.
    pub fn lookup_only(self, value: impl ToString) -> Self {
        self.with("lookup-only", value)
    }

    /// Output `cache-hit` of the step with id `step`: A boolean value to indicate an exact match was found for the primary key
    pub const fn cache_hit_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "cache-hit")
    }

    /// Output `cache-primary-key` of the step with id `step`: A resolved cache key for which cache match was attempted
    pub const fn cache_primary_key_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "cache-primary-key")
    }

    /// Output `cache-matched-key` of the step with id `step`: Key of the cache that was restored, it could either be the primary key on cache-hit or a partial/complete match of one of the restore keys
    pub const fn cache_matched_key_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "cache-matched-key")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<RunsOnCacheRestore> for Step<Use> {
    fn from(action: RunsOnCacheRestore) -> Self {
        action.step()
    }
}

/// `runs-on/cache/save` v4: Save Cache artifacts like dependencies and build outputs to improve workflow execution time
#[must_use]
pub struct RunsOnCacheSave(Step<Use>);

impl RunsOnCacheSave {
    /// A step named `name` that runs `runs-on/cache/save@a5f51d6f3fece787d03b7b4e981c82538a0654ed`, with its required inputs set.
    pub fn new(name: &str, path: impl ToString, key: impl ToString) -> Self {
        let step = Step::new(name).uses("runs-on", "cache/save", "a5f51d6f3fece787d03b7b4e981c82538a0654ed");
        Self(step)
            .with("path", path)
            .with("key", key)
    }

    /// The chunk size used to split up large files during upload, in bytes
    pub fn upload_chunk_size(self, value: impl ToString) -> Self {
        self.with("upload-chunk-size", value)
    }

    /// An optional boolean when enabled, allows windows runners to save caches that can be restored on other platforms
    ///
    /// Default: `false`.
    pub fn enable_cross_os_archive(self, value: impl ToString) -> Self {
        self.with("enableCrossOsArchive", value)
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<RunsOnCacheSave> for Step<Use> {
    fn from(action: RunsOnCacheSave) -> Self {
        action.step()
    }
}

/// `softprops/action-gh-release` v2.6.2: Github Action for creating Github Releases
#[must_use]
pub struct SoftpropsActionGhRelease(Step<Use>);

impl SoftpropsActionGhRelease {
    /// A step named `name` that runs `softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses("softprops", "action-gh-release", "3bb12739c298aeb8a4eeaf626c5b8d85266b0e65");
        Self(step)
    }

    /// Note-worthy description of changes in release
    pub fn body(self, value: impl ToString) -> Self {
        self.with("body", value)
    }

    /// Path to load note-worthy description of changes in release from
    pub fn body_path(self, value: impl ToString) -> Self {
        self.with("body_path", value)
    }

    /// Gives the release a custom name. Defaults to tag name
    pub fn name(self, value: impl ToString) -> Self {
        self.with("name", value)
    }

    /// Gives a tag name. Defaults to github.ref_name. refs/tags/<name> values are normalized to <name>.
    pub fn tag_name(self, value: impl ToString) -> Self {
        self.with("tag_name", value)
    }

    /// Keeps the release as a draft. Defaults to false. When reusing an existing draft release, set this to true to keep it draft; omit it to publish after upload. On immutable-release repositories, use this for prereleases that upload assets and publish the draft later.
    pub fn draft(self, value: impl ToString) -> Self {
        self.with("draft", value)
    }

    /// Identify the release as a prerelease. Defaults to false
    pub fn prerelease(self, value: impl ToString) -> Self {
        self.with("prerelease", value)
    }

    /// Upload artifacts sequentially in the provided order. This does not control the final display order GitHub uses for release assets.
    pub fn preserve_order(self, value: impl ToString) -> Self {
        self.with("preserve_order", value)
    }

    /// Newline-delimited list of path globs for asset files to upload. Escape glob metacharacters when matching literal filenames that contain them. `~/...` expands to the runner home directory. On Windows, both \ and / path separators are accepted. GitHub may normalize raw asset filenames that contain special characters; the action restores the asset label when possible, but the final download name remains GitHub-controlled.
    pub fn files(self, value: impl ToString) -> Self {
        self.with("files", value)
    }

    /// Base directory to resolve 'files' globs against. Defaults to the workspace root used by the action step.
    pub fn working_directory(self, value: impl ToString) -> Self {
        self.with("working_directory", value)
    }

    /// Overwrite existing files with the same name. Defaults to true
    ///
    /// Default: `true`.
    pub fn overwrite_files(self, value: impl ToString) -> Self {
        self.with("overwrite_files", value)
    }

    /// Fails if any of the `files` globs match nothing. Defaults to false
    pub fn fail_on_unmatched_files(self, value: impl ToString) -> Self {
        self.with("fail_on_unmatched_files", value)
    }

    /// Repository to make releases against, in <owner>/<repo> format
    pub fn repository(self, value: impl ToString) -> Self {
        self.with("repository", value)
    }

    /// Authorized GitHub token or PAT. Defaults to github.token when omitted. A non-empty explicit token overrides GITHUB_TOKEN. Passing an empty string treats the token as unset.
    ///
    /// Default: `${{ github.token }}`.
    pub fn token(self, value: impl ToString) -> Self {
        self.with("token", value)
    }

    /// Commitish value that determines where the Git tag is created from. Can be any branch or commit SHA. When creating a new tag for an older commit, `github.token` may not have permission to create the ref; use a PAT or another token with sufficient contents permissions if you hit 403 `Resource not accessible by integration`.
    pub fn target_commitish(self, value: impl ToString) -> Self {
        self.with("target_commitish", value)
    }

    /// If specified, a discussion of the specified category is created and linked to the release. The value must be a category that already exists in the repository. If there is already a discussion linked to the release, this parameter is ignored.
    pub fn discussion_category_name(self, value: impl ToString) -> Self {
        self.with("discussion_category_name", value)
    }

    /// Whether to automatically generate the name and body for this release. If name is specified, the specified name will be used; otherwise, a name will be automatically generated. If body is specified, the body will be pre-pended to the automatically generated notes.
    pub fn generate_release_notes(self, value: impl ToString) -> Self {
        self.with("generate_release_notes", value)
    }

    /// Optional. When generate_release_notes is enabled, use this tag as GitHub's previous_tag_name comparison base. If omitted, GitHub chooses the comparison base automatically.
    ///
    /// Default: ``.
    pub fn previous_tag(self, value: impl ToString) -> Self {
        self.with("previous_tag", value)
    }

    /// Append to existing body instead of overwriting it. Default is false.
    pub fn append_body(self, value: impl ToString) -> Self {
        self.with("append_body", value)
    }

    /// Specifies whether this release should be set as the latest release for the repository. Drafts and prereleases cannot be set as latest. Can be `true`, `false`, or `legacy`. Uses GitHub api default if not provided
    pub fn make_latest(self, value: impl ToString) -> Self {
        self.with("make_latest", value)
    }

    /// Output `url` of the step with id `step`: URL to the Release HTML Page
    pub const fn url_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "url")
    }

    /// Output `id` of the step with id `step`: Release ID
    pub const fn id_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "id")
    }

    /// Output `upload_url` of the step with id `step`: URL for uploading assets to the release
    pub const fn upload_url_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "upload_url")
    }

    /// Output `assets` of the step with id `step`: JSON array containing information about each uploaded asset, in the format given [here](https://docs.github.com/en/rest/reference/repos#upload-a-release-asset--code-samples) (minus the `uploader` field)
    pub const fn assets_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "assets")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<SoftpropsActionGhRelease> for Step<Use> {
    fn from(action: SoftpropsActionGhRelease) -> Self {
        action.step()
    }
}

/// `Swatinem/rust-cache` v2.9.3: A GitHub Action that implements smart caching for rust/cargo projects with sensible defaults.
#[must_use]
pub struct SwatinemRustCache(Step<Use>);

impl SwatinemRustCache {
    /// A step named `name` that runs `Swatinem/rust-cache@d1527c8f67ef9af357290475d4af4b0fab8f12e0`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses("Swatinem", "rust-cache", "d1527c8f67ef9af357290475d4af4b0fab8f12e0");
        Self(step)
    }

    /// The prefix cache key, this can be changed to start a new cache manually.
    ///
    /// Default: `v0-rust`.
    pub fn prefix_key(self, value: impl ToString) -> Self {
        self.with("prefix-key", value)
    }

    /// A cache key that is used instead of the automatic `job`-based key, and is stable over multiple jobs.
    pub fn shared_key(self, value: impl ToString) -> Self {
        self.with("shared-key", value)
    }

    /// An additional cache key that is added alongside the automatic `job`-based cache key and can be used to further differentiate jobs.
    pub fn key(self, value: impl ToString) -> Self {
        self.with("key", value)
    }

    /// If the automatic `job`-based cache key should include the job id. Defaults to true.
    ///
    /// Default: `true`.
    pub fn add_job_id_key(self, value: impl ToString) -> Self {
        self.with("add-job-id-key", value)
    }

    /// Weather the a hash of the rust environment should be included in the cache key. This includes a hash of all Cargo.toml/Cargo.lock files, rust-toolchain files, and .cargo/config.toml files (if present), as well as the specified 'env-vars'. Defaults to true.
    ///
    /// Default: `true`.
    pub fn add_rust_environment_hash_key(self, value: impl ToString) -> Self {
        self.with("add-rust-environment-hash-key", value)
    }

    /// Additional environment variables to include in the cache key, separated by spaces.
    pub fn env_vars(self, value: impl ToString) -> Self {
        self.with("env-vars", value)
    }

    /// Paths to multiple Cargo workspaces and their target directories, separated by newlines.
    pub fn workspaces(self, value: impl ToString) -> Self {
        self.with("workspaces", value)
    }

    /// Additional non workspace directories to be cached, separated by newlines.
    pub fn cache_directories(self, value: impl ToString) -> Self {
        self.with("cache-directories", value)
    }

    /// Determines whether workspace targets are cached. If `false`, only the cargo registry will be cached.
    ///
    /// Default: `true`.
    pub fn cache_targets(self, value: impl ToString) -> Self {
        self.with("cache-targets", value)
    }

    /// Cache even if the build fails. Defaults to false.
    pub fn cache_on_failure(self, value: impl ToString) -> Self {
        self.with("cache-on-failure", value)
    }

    /// Determines which crates are cached. If `true` all crates will be cached, otherwise only dependent crates will be cached.
    ///
    /// Default: `false`.
    pub fn cache_all_crates(self, value: impl ToString) -> Self {
        self.with("cache-all-crates", value)
    }

    /// Similar to cache-all-crates. If `true` the workspace crates will be cached.
    ///
    /// Default: `false`.
    pub fn cache_workspace_crates(self, value: impl ToString) -> Self {
        self.with("cache-workspace-crates", value)
    }

    /// Determiners whether the cache should be saved. If `false`, the cache is only restored.
    ///
    /// Default: `true`.
    pub fn save_if(self, value: impl ToString) -> Self {
        self.with("save-if", value)
    }

    /// Determines which provider to use for caching. Options are github, or warpbuild. Defaults to github.
    ///
    /// Default: `github`.
    pub fn cache_provider(self, value: impl ToString) -> Self {
        self.with("cache-provider", value)
    }

    /// Determines whether to cache ${CARGO_HOME}/bin.
    ///
    /// Default: `true`.
    pub fn cache_bin(self, value: impl ToString) -> Self {
        self.with("cache-bin", value)
    }

    /// Check if a cache entry exists without downloading the cache
    ///
    /// Default: `false`.
    pub fn lookup_only(self, value: impl ToString) -> Self {
        self.with("lookup-only", value)
    }

    /// A format string used to format commands to be run, i.e. `rustc` and `cargo`.
    ///
    /// Default: `{0}`.
    pub fn cmd_format(self, value: impl ToString) -> Self {
        self.with("cmd-format", value)
    }

    /// Output `cache-hit` of the step with id `step`: A boolean value that indicates an exact match was found.
    pub const fn cache_hit_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "cache-hit")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<SwatinemRustCache> for Step<Use> {
    fn from(action: SwatinemRustCache) -> Self {
        action.step()
    }
}

/// `technote-space/assign-author` v1.6.2: GitHub actions to assign author to issue or PR.
#[must_use]
pub struct TechnoteSpaceAssignAuthor(Step<Use>);

impl TechnoteSpaceAssignAuthor {
    /// A step named `name` that runs `technote-space/assign-author@9558557c5c4816f38bd06176fbc324ba14bb3160`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses("technote-space", "assign-author", "9558557c5c4816f38bd06176fbc324ba14bb3160");
        Self(step)
    }

    /// Secret GitHub API token to use for making API requests.
    ///
    /// Default: `${{ github.token }}`.
    pub fn github_token(self, value: impl ToString) -> Self {
        self.with("GITHUB_TOKEN", value)
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<TechnoteSpaceAssignAuthor> for Step<Use> {
    fn from(action: TechnoteSpaceAssignAuthor) -> Self {
        action.step()
    }
}

/// `tj-actions/changed-files` v47.0.0: Get all Added, Copied, Modified, Deleted, Renamed, Type changed, Unmerged, and Unknown files.
#[must_use]
pub struct TjActionsChangedFiles(Step<Use>);

impl TjActionsChangedFiles {
    /// A step named `name` that runs `tj-actions/changed-files@24d32ffd492484c1d75e0c0b894501ddb9d30d62`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses("tj-actions", "changed-files", "24d32ffd492484c1d75e0c0b894501ddb9d30d62");
        Self(step)
    }

    /// Split character for output strings.
    ///
    /// Default: ` `.
    pub fn separator(self, value: impl ToString) -> Self {
        self.with("separator", value)
    }

    /// Include `all_old_new_renamed_files` output. Note this can generate a large output See: #501.
    ///
    /// Default: `false`.
    pub fn include_all_old_new_renamed_files(self, value: impl ToString) -> Self {
        self.with("include_all_old_new_renamed_files", value)
    }

    /// Split character for old and new filename pairs.
    ///
    /// Default: `,`.
    pub fn old_new_separator(self, value: impl ToString) -> Self {
        self.with("old_new_separator", value)
    }

    /// Split character for old and new renamed filename pairs.
    ///
    /// Default: ` `.
    pub fn old_new_files_separator(self, value: impl ToString) -> Self {
        self.with("old_new_files_separator", value)
    }

    /// Source file(s) used to populate the `files` input.
    ///
    /// Default: ``.
    pub fn files_from_source_file(self, value: impl ToString) -> Self {
        self.with("files_from_source_file", value)
    }

    /// Separator used to split the `files_from_source_file` input.
    ///
    /// Default: `
    /// `.
    pub fn files_from_source_file_separator(self, value: impl ToString) -> Self {
        self.with("files_from_source_file_separator", value)
    }

    /// File and directory patterns used to detect changes (Defaults to the entire repo if unset).
    /// NOTE: Multiline file/directory patterns should not include quotes.
    ///
    ///
    /// Default: ``.
    pub fn files(self, value: impl ToString) -> Self {
        self.with("files", value)
    }

    /// Separator used to split the `files` input
    ///
    /// Default: `
    /// `.
    pub fn files_separator(self, value: impl ToString) -> Self {
        self.with("files_separator", value)
    }

    /// YAML used to define a set of file patterns to detect changes
    ///
    /// Default: ``.
    pub fn files_yaml(self, value: impl ToString) -> Self {
        self.with("files_yaml", value)
    }

    /// Source file(s) used to populate the `files_yaml` input. Example: https://github.com/tj-actions/changed-files/blob/main/test/changed-files.yml
    ///
    /// Default: ``.
    pub fn files_yaml_from_source_file(self, value: impl ToString) -> Self {
        self.with("files_yaml_from_source_file", value)
    }

    /// Separator used to split the `files_yaml_from_source_file` input
    ///
    /// Default: `
    /// `.
    pub fn files_yaml_from_source_file_separator(self, value: impl ToString) -> Self {
        self.with("files_yaml_from_source_file_separator", value)
    }

    /// YAML used to define a set of file patterns to ignore changes
    ///
    /// Default: ``.
    pub fn files_ignore_yaml(self, value: impl ToString) -> Self {
        self.with("files_ignore_yaml", value)
    }

    /// Source file(s) used to populate the `files_ignore_yaml` input. Example: https://github.com/tj-actions/changed-files/blob/main/test/changed-files.yml
    ///
    /// Default: ``.
    pub fn files_ignore_yaml_from_source_file(self, value: impl ToString) -> Self {
        self.with("files_ignore_yaml_from_source_file", value)
    }

    /// Separator used to split the `files_ignore_yaml_from_source_file` input
    ///
    /// Default: `
    /// `.
    pub fn files_ignore_yaml_from_source_file_separator(self, value: impl ToString) -> Self {
        self.with("files_ignore_yaml_from_source_file_separator", value)
    }

    /// Ignore changes to these file(s). NOTE: Multiline file/directory patterns should not include quotes.
    ///
    /// Default: ``.
    pub fn files_ignore(self, value: impl ToString) -> Self {
        self.with("files_ignore", value)
    }

    /// Separator used to split the `files_ignore` input
    ///
    /// Default: `
    /// `.
    pub fn files_ignore_separator(self, value: impl ToString) -> Self {
        self.with("files_ignore_separator", value)
    }

    /// Source file(s) used to populate the `files_ignore` input
    ///
    /// Default: ``.
    pub fn files_ignore_from_source_file(self, value: impl ToString) -> Self {
        self.with("files_ignore_from_source_file", value)
    }

    /// Separator used to split the `files_ignore_from_source_file` input
    ///
    /// Default: `
    /// `.
    pub fn files_ignore_from_source_file_separator(self, value: impl ToString) -> Self {
        self.with("files_ignore_from_source_file_separator", value)
    }

    /// Specify a different commit SHA or branch used for comparing changes
    pub fn sha(self, value: impl ToString) -> Self {
        self.with("sha", value)
    }

    /// Specify a different base commit SHA or branch used for comparing changes
    pub fn base_sha(self, value: impl ToString) -> Self {
        self.with("base_sha", value)
    }

    /// Get changed files for commits whose timestamp is older than the given time.
    ///
    /// Default: ``.
    pub fn since(self, value: impl ToString) -> Self {
        self.with("since", value)
    }

    /// Get changed files for commits whose timestamp is earlier than the given time.
    ///
    /// Default: ``.
    pub fn until(self, value: impl ToString) -> Self {
        self.with("until", value)
    }

    /// Specify a relative path under `$GITHUB_WORKSPACE` to locate the repository.
    ///
    /// Default: `.`.
    pub fn path(self, value: impl ToString) -> Self {
        self.with("path", value)
    }

    /// Use non-ASCII characters to match files and output the filenames completely verbatim by setting this to `false`
    ///
    /// Default: `true`.
    pub fn quotepath(self, value: impl ToString) -> Self {
        self.with("quotepath", value)
    }

    /// Exclude changes outside the current directory and show path names relative to it. NOTE: This requires you to specify the top-level directory via the `path` input.
    ///
    /// Default: `true`.
    pub fn diff_relative(self, value: impl ToString) -> Self {
        self.with("diff_relative", value)
    }

    /// Output unique changed directories instead of filenames. NOTE: This returns `.` for changed files located in the current working directory which defaults to `$GITHUB_WORKSPACE`.
    ///
    /// Default: `false`.
    pub fn dir_names(self, value: impl ToString) -> Self {
        self.with("dir_names", value)
    }

    /// Limit the directory output to a maximum depth e.g `test/test1/test2` with max depth of `2` returns `test/test1`.
    pub fn dir_names_max_depth(self, value: impl ToString) -> Self {
        self.with("dir_names_max_depth", value)
    }

    /// Exclude the current directory represented by `.` from the output when `dir_names` is set to `true`.
    ///
    /// Default: `false`.
    pub fn dir_names_exclude_current_dir(self, value: impl ToString) -> Self {
        self.with("dir_names_exclude_current_dir", value)
    }

    /// File and directory patterns to include in the output when `dir_names` is set to `true`. NOTE: This returns only the matching files and also the directory names.
    ///
    /// Default: ``.
    pub fn dir_names_include_files(self, value: impl ToString) -> Self {
        self.with("dir_names_include_files", value)
    }

    /// Separator used to split the `dir_names_include_files` input
    ///
    /// Default: `
    /// `.
    pub fn dir_names_include_files_separator(self, value: impl ToString) -> Self {
        self.with("dir_names_include_files_separator", value)
    }

    /// Include only directories that have been deleted as opposed to directory names of files that have been deleted in the `deleted_files` output when `dir_names` is set to `true`.
    ///
    /// Default: `false`.
    pub fn dir_names_deleted_files_include_only_deleted_dirs(self, value: impl ToString) -> Self {
        self.with("dir_names_deleted_files_include_only_deleted_dirs", value)
    }

    /// Output list of changed files in a JSON formatted string which can be used for matrix jobs. Example: https://github.com/tj-actions/changed-files/blob/main/.github/workflows/matrix-example.yml
    ///
    /// Default: `false`.
    pub fn json(self, value: impl ToString) -> Self {
        self.with("json", value)
    }

    /// Escape JSON output.
    ///
    /// Default: `true`.
    pub fn escape_json(self, value: impl ToString) -> Self {
        self.with("escape_json", value)
    }

    /// Apply sanitization to output filenames before being set as output.
    ///
    /// Default: `true`.
    pub fn safe_output(self, value: impl ToString) -> Self {
        self.with("safe_output", value)
    }

    /// Depth of additional branch history fetched. NOTE: This can be adjusted to resolve errors with insufficient history.
    ///
    /// Default: `25`.
    pub fn fetch_depth(self, value: impl ToString) -> Self {
        self.with("fetch_depth", value)
    }

    /// Skip initially fetching additional history to improve performance for shallow repositories.
    /// NOTE: This could lead to errors with missing history. It's intended to be used when you've fetched all necessary history to perform the diff.
    ///
    ///
    /// Default: `false`.
    pub fn skip_initial_fetch(self, value: impl ToString) -> Self {
        self.with("skip_initial_fetch", value)
    }

    /// Fetch additional history for submodules.
    ///
    /// Default: `false`.
    pub fn fetch_additional_submodule_history(self, value: impl ToString) -> Self {
        self.with("fetch_additional_submodule_history", value)
    }

    /// Use the last commit on the remote branch as the `base_sha`. Defaults to the last non-merge commit on the target branch for pull request events and the previous remote commit of the current branch for push events.
    ///
    /// Default: `false`.
    pub fn since_last_remote_commit(self, value: impl ToString) -> Self {
        self.with("since_last_remote_commit", value)
    }

    /// Write outputs to the `output_dir` defaults to `.github/outputs` folder. NOTE: This creates a `.txt` file by default and a `.json` file if `json` is set to `true`.
    ///
    /// Default: `false`.
    pub fn write_output_files(self, value: impl ToString) -> Self {
        self.with("write_output_files", value)
    }

    /// Directory to store output files.
    ///
    /// Default: `.github/outputs`.
    pub fn output_dir(self, value: impl ToString) -> Self {
        self.with("output_dir", value)
    }

    /// Output renamed files as deleted and added files.
    ///
    /// Default: `false`.
    pub fn output_renamed_files_as_deleted_and_added(self, value: impl ToString) -> Self {
        self.with("output_renamed_files_as_deleted_and_added", value)
    }

    /// Recover deleted files.
    ///
    /// Default: `false`.
    pub fn recover_deleted_files(self, value: impl ToString) -> Self {
        self.with("recover_deleted_files", value)
    }

    /// Recover deleted files to a new destination directory, defaults to the original location.
    ///
    /// Default: ``.
    pub fn recover_deleted_files_to_destination(self, value: impl ToString) -> Self {
        self.with("recover_deleted_files_to_destination", value)
    }

    /// File and directory patterns used to recover deleted files,
    /// defaults to the patterns provided via the `files`, `files_from_source_file`, `files_ignore` and `files_ignore_from_source_file` inputs
    /// or all deleted files if no patterns are provided.
    ///
    ///
    /// Default: ``.
    pub fn recover_files(self, value: impl ToString) -> Self {
        self.with("recover_files", value)
    }

    /// Separator used to split the `recover_files` input
    ///
    /// Default: `
    /// `.
    pub fn recover_files_separator(self, value: impl ToString) -> Self {
        self.with("recover_files_separator", value)
    }

    /// File and directory patterns to ignore when recovering deleted files.
    ///
    /// Default: ``.
    pub fn recover_files_ignore(self, value: impl ToString) -> Self {
        self.with("recover_files_ignore", value)
    }

    /// Separator used to split the `recover_files_ignore` input
    ///
    /// Default: `
    /// `.
    pub fn recover_files_ignore_separator(self, value: impl ToString) -> Self {
        self.with("recover_files_ignore_separator", value)
    }

    /// GitHub token used to fetch changed files from Github's API.
    ///
    /// Default: `${{ github.token }}`.
    pub fn token(self, value: impl ToString) -> Self {
        self.with("token", value)
    }

    /// Github API URL.
    ///
    /// Default: `${{ github.api_url }}`.
    pub fn api_url(self, value: impl ToString) -> Self {
        self.with("api_url", value)
    }

    /// Force the use of Github's REST API even when a local copy of the repository exists
    ///
    /// Default: `false`.
    pub fn use_rest_api(self, value: impl ToString) -> Self {
        self.with("use_rest_api", value)
    }

    /// Fail when the initial diff fails.
    ///
    /// Default: `false`.
    pub fn fail_on_initial_diff_error(self, value: impl ToString) -> Self {
        self.with("fail_on_initial_diff_error", value)
    }

    /// Fail when the submodule diff fails.
    ///
    /// Default: `false`.
    pub fn fail_on_submodule_diff_error(self, value: impl ToString) -> Self {
        self.with("fail_on_submodule_diff_error", value)
    }

    /// Apply the negation patterns first. NOTE: This affects how changed files are matched.
    ///
    /// Default: `false`.
    pub fn negation_patterns_first(self, value: impl ToString) -> Self {
        self.with("negation_patterns_first", value)
    }

    /// Output changed files in a format that can be used for matrix jobs. Alias for setting inputs `json` to `true` and `escape_json` to `false`.
    ///
    /// Default: `false`.
    pub fn matrix(self, value: impl ToString) -> Self {
        self.with("matrix", value)
    }

    /// Exclude changes to submodules.
    ///
    /// Default: `false`.
    pub fn exclude_submodules(self, value: impl ToString) -> Self {
        self.with("exclude_submodules", value)
    }

    /// Maximum number of retries to fetch missing history.
    ///
    /// Default: `20`.
    pub fn fetch_missing_history_max_retries(self, value: impl ToString) -> Self {
        self.with("fetch_missing_history_max_retries", value)
    }

    /// Use POSIX path separator `/` for output file paths on Windows.
    ///
    /// Default: `false`.
    pub fn use_posix_path_separator(self, value: impl ToString) -> Self {
        self.with("use_posix_path_separator", value)
    }

    /// Tags pattern to include.
    ///
    /// Default: `*`.
    pub fn tags_pattern(self, value: impl ToString) -> Self {
        self.with("tags_pattern", value)
    }

    /// Tags pattern to ignore.
    ///
    /// Default: ``.
    pub fn tags_ignore_pattern(self, value: impl ToString) -> Self {
        self.with("tags_ignore_pattern", value)
    }

    /// Output `added_files` of the step with id `step`: Returns only files that are Added (A).
    pub const fn added_files_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "added_files")
    }

    /// Output `added_files_count` of the step with id `step`: Returns the number of `added_files`
    pub const fn added_files_count_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "added_files_count")
    }

    /// Output `any_added` of the step with id `step`: Returns `true` when any of the filenames provided using the `files*` or `files_ignore*` inputs have been added.
    pub const fn any_added_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "any_added")
    }

    /// Output `copied_files` of the step with id `step`: Returns only files that are Copied (C).
    pub const fn copied_files_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "copied_files")
    }

    /// Output `copied_files_count` of the step with id `step`: Returns the number of `copied_files`
    pub const fn copied_files_count_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "copied_files_count")
    }

    /// Output `deleted_files` of the step with id `step`: Returns only files that are Deleted (D).
    pub const fn deleted_files_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "deleted_files")
    }

    /// Output `deleted_files_count` of the step with id `step`: Returns the number of `deleted_files`
    pub const fn deleted_files_count_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "deleted_files_count")
    }

    /// Output `modified_files` of the step with id `step`: Returns only files that are Modified (M).
    pub const fn modified_files_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "modified_files")
    }

    /// Output `modified_files_count` of the step with id `step`: Returns the number of `modified_files`
    pub const fn modified_files_count_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "modified_files_count")
    }

    /// Output `renamed_files` of the step with id `step`: Returns only files that are Renamed (R).
    pub const fn renamed_files_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "renamed_files")
    }

    /// Output `renamed_files_count` of the step with id `step`: Returns the number of `renamed_files`
    pub const fn renamed_files_count_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "renamed_files_count")
    }

    /// Output `all_old_new_renamed_files` of the step with id `step`: Returns only files that are Renamed and lists their old and new names. **NOTE:** This requires setting `include_all_old_new_renamed_files` to `true`. Also, keep in mind that this output is global and wouldn't be nested in outputs generated when the `*_yaml_*` input is used. (R)
    pub const fn all_old_new_renamed_files_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "all_old_new_renamed_files")
    }

    /// Output `all_old_new_renamed_files_count` of the step with id `step`: Returns the number of `all_old_new_renamed_files`
    pub const fn all_old_new_renamed_files_count_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "all_old_new_renamed_files_count")
    }

    /// Output `type_changed_files` of the step with id `step`: Returns only files that have their file type changed (T).
    pub const fn type_changed_files_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "type_changed_files")
    }

    /// Output `type_changed_files_count` of the step with id `step`: Returns the number of `type_changed_files`
    pub const fn type_changed_files_count_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "type_changed_files_count")
    }

    /// Output `unmerged_files` of the step with id `step`: Returns only files that are Unmerged (U).
    pub const fn unmerged_files_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "unmerged_files")
    }

    /// Output `unmerged_files_count` of the step with id `step`: Returns the number of `unmerged_files`
    pub const fn unmerged_files_count_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "unmerged_files_count")
    }

    /// Output `unknown_files` of the step with id `step`: Returns only files that are Unknown (X).
    pub const fn unknown_files_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "unknown_files")
    }

    /// Output `unknown_files_count` of the step with id `step`: Returns the number of `unknown_files`
    pub const fn unknown_files_count_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "unknown_files_count")
    }

    /// Output `all_changed_and_modified_files` of the step with id `step`: Returns all changed and modified files i.e. a combination of (ACMRDTUX)
    pub const fn all_changed_and_modified_files_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "all_changed_and_modified_files")
    }

    /// Output `all_changed_and_modified_files_count` of the step with id `step`: Returns the number of `all_changed_and_modified_files`
    pub const fn all_changed_and_modified_files_count_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "all_changed_and_modified_files_count")
    }

    /// Output `all_changed_files` of the step with id `step`: Returns all changed files i.e. a combination of all added, copied, modified and renamed files (ACMR)
    pub const fn all_changed_files_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "all_changed_files")
    }

    /// Output `all_changed_files_count` of the step with id `step`: Returns the number of `all_changed_files`
    pub const fn all_changed_files_count_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "all_changed_files_count")
    }

    /// Output `any_changed` of the step with id `step`: Returns `true` when any of the filenames provided using the `files*` or `files_ignore*` inputs have changed. This defaults to `true` when no patterns are specified. i.e. *includes a combination of all added, copied, modified and renamed files (ACMR)*.
    pub const fn any_changed_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "any_changed")
    }

    /// Output `only_changed` of the step with id `step`: Returns `true` when only files provided using the `files*` or `files_ignore*` inputs have changed. i.e. *includes a combination of all added, copied, modified and renamed files (ACMR)*.
    pub const fn only_changed_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "only_changed")
    }

    /// Output `other_changed_files` of the step with id `step`: Returns all other changed files not listed in the files input i.e. includes a combination of all added, copied, modified and renamed files (ACMR).
    pub const fn other_changed_files_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "other_changed_files")
    }

    /// Output `other_changed_files_count` of the step with id `step`: Returns the number of `other_changed_files`
    pub const fn other_changed_files_count_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "other_changed_files_count")
    }

    /// Output `all_modified_files` of the step with id `step`: Returns all changed files i.e. a combination of all added, copied, modified, renamed and deleted files (ACMRD).
    pub const fn all_modified_files_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "all_modified_files")
    }

    /// Output `all_modified_files_count` of the step with id `step`: Returns the number of `all_modified_files`
    pub const fn all_modified_files_count_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "all_modified_files_count")
    }

    /// Output `any_modified` of the step with id `step`: Returns `true` when any of the filenames provided using the `files*` or `files_ignore*` inputs have been modified. This defaults to `true` when no patterns are specified. i.e. *includes a combination of all added, copied, modified, renamed, and deleted files (ACMRD)*.
    pub const fn any_modified_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "any_modified")
    }

    /// Output `only_modified` of the step with id `step`: Returns `true` when only files provided using the `files*` or `files_ignore*` inputs have been modified. (ACMRD).
    pub const fn only_modified_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "only_modified")
    }

    /// Output `other_modified_files` of the step with id `step`: Returns all other modified files not listed in the files input i.e. a combination of all added, copied, modified, and deleted files (ACMRD)
    pub const fn other_modified_files_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "other_modified_files")
    }

    /// Output `other_modified_files_count` of the step with id `step`: Returns the number of `other_modified_files`
    pub const fn other_modified_files_count_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "other_modified_files_count")
    }

    /// Output `any_deleted` of the step with id `step`: Returns `true` when any of the filenames provided using the `files*` or `files_ignore*` inputs have been deleted. This defaults to `true` when no patterns are specified. (D)
    pub const fn any_deleted_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "any_deleted")
    }

    /// Output `only_deleted` of the step with id `step`: Returns `true` when only files provided using the `files*` or `files_ignore*` inputs have been deleted. (D)
    pub const fn only_deleted_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "only_deleted")
    }

    /// Output `other_deleted_files` of the step with id `step`: Returns all other deleted files not listed in the files input i.e. a combination of all deleted files (D)
    pub const fn other_deleted_files_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "other_deleted_files")
    }

    /// Output `other_deleted_files_count` of the step with id `step`: Returns the number of `other_deleted_files`
    pub const fn other_deleted_files_count_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "other_deleted_files_count")
    }

    /// Output `modified_keys` of the step with id `step`: Returns all modified YAML keys when the `files_yaml` input is used. i.e. key that contains any path that has either been added, copied, modified, and deleted (ACMRD)
    pub const fn modified_keys_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "modified_keys")
    }

    /// Output `changed_keys` of the step with id `step`: Returns all changed YAML keys when the `files_yaml` input is used. i.e. key that contains any path that has either been added, copied, modified, and renamed (ACMR)
    pub const fn changed_keys_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "changed_keys")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<TjActionsChangedFiles> for Step<Use> {
    fn from(action: TjActionsChangedFiles) -> Self {
        action.step()
    }
}

/// `./.github/actions/check-macro-db-migrations`, defined in `workflows/composite/check_macro_db_migrations.rs`: Fail unless every migration in the checked-out commit is applied to the environment's database. Applies nothing.
#[must_use]
pub struct LocalCheckMacroDbMigrations(Step<Use>);

impl LocalCheckMacroDbMigrations {
    /// A step named `name` that runs `./.github/actions/check-macro-db-migrations`, with its required input set.
    pub fn new(name: &str, environment: impl ToString) -> Self {
        let step = Step::new(name).uses_local(".github/actions/check-macro-db-migrations");
        Self(step)
            .with("environment", environment)
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<LocalCheckMacroDbMigrations> for Step<Use> {
    fn from(action: LocalCheckMacroDbMigrations) -> Self {
        action.step()
    }
}

/// `./.github/actions/deploy-cloud-storage-pulumi`, defined in `workflows/composite/deploy_cloud_storage_pulumi.rs`: Deploy a pulumi stack from cloud-storage pulumi
#[must_use]
pub struct LocalDeployCloudStoragePulumi(Step<Use>);

impl LocalDeployCloudStoragePulumi {
    /// A step named `name` that runs `./.github/actions/deploy-cloud-storage-pulumi`, with its required inputs set.
    pub fn new(name: &str, aws_access_key: impl ToString, aws_secret_key: impl ToString, pulumi_access_token: impl ToString, pulumi_service_name: impl ToString, dd_app_key: impl ToString, dd_api_key: impl ToString) -> Self {
        let step = Step::new(name).uses_local(".github/actions/deploy-cloud-storage-pulumi");
        Self(step)
            .with("aws-access-key", aws_access_key)
            .with("aws-secret-key", aws_secret_key)
            .with("pulumi-access-token", pulumi_access_token)
            .with("pulumi-service-name", pulumi_service_name)
            .with("dd-app-key", dd_app_key)
            .with("dd-api-key", dd_api_key)
    }

    /// Whether to setup docker
    ///
    /// Default: `true`.
    pub fn use_docker(self, value: impl ToString) -> Self {
        self.with("use-docker", value)
    }

    /// Use a Namespace remote Docker builder (persistent layer cache, so heavy bases like LibreOffice/Collabora stay warm across deploys). Requires the nsc CLI (preinstalled on Namespace runners); defaults to the stock docker/setup-buildx-action.
    ///
    /// Default: `false`.
    pub fn use_namespace_builder(self, value: impl ToString) -> Self {
        self.with("use-namespace-builder", value)
    }

    /// Whether to checkout LFS content
    ///
    /// Default: `false`.
    pub fn use_lfs(self, value: impl ToString) -> Self {
        self.with("use-lfs", value)
    }

    /// Environment to deploy to
    ///
    /// Default: `dev`.
    pub fn environment(self, value: impl ToString) -> Self {
        self.with("environment", value)
    }

    /// AWS region
    ///
    /// Default: `us-east-1`.
    pub fn aws_region(self, value: impl ToString) -> Self {
        self.with("aws-region", value)
    }

    /// Datadog host
    ///
    /// Default: `https://api.us5.datadoghq.com/`.
    pub fn dd_host(self, value: impl ToString) -> Self {
        self.with("dd-host", value)
    }

    /// Optional GitHub artifact containing prebuilt service binaries to copy into Docker images
    ///
    /// Default: ``.
    pub fn prebuilt_binaries_artifact(self, value: impl ToString) -> Self {
        self.with("prebuilt-binaries-artifact", value)
    }

    /// Optional GitHub artifact containing built Lambda artifacts under target/lambda
    ///
    /// Default: ``.
    pub fn lambda_artifacts(self, value: impl ToString) -> Self {
        self.with("lambda-artifacts", value)
    }

    /// Optional path to a prebuilt-binaries.tar.gz already present on disk (e.g. downloaded from Namespace artifact storage). When set, takes precedence over prebuilt-binaries-artifact and skips the GitHub artifact download.
    ///
    /// Default: ``.
    pub fn prebuilt_binaries_tar(self, value: impl ToString) -> Self {
        self.with("prebuilt-binaries-tar", value)
    }

    /// Optional path to a lambda-artifacts.tar.gz already present on disk (e.g. downloaded from Namespace artifact storage). When set, takes precedence over lambda-artifacts and skips the GitHub artifact download.
    ///
    /// Default: ``.
    pub fn lambda_artifacts_tar(self, value: impl ToString) -> Self {
        self.with("lambda-artifacts-tar", value)
    }

    /// Optional service key from .github/services-config.json; builds Lambda artifacts inline when lambda-artifacts is not provided
    ///
    /// Default: ``.
    pub fn cloud_storage_service_name(self, value: impl ToString) -> Self {
        self.with("cloud-storage-service-name", value)
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<LocalDeployCloudStoragePulumi> for Step<Use> {
    fn from(action: LocalDeployCloudStoragePulumi) -> Self {
        action.step()
    }
}

/// `./.github/actions/get-project-name`, defined in `workflows/composite/get_project_name.rs`: Get the Pulumi project name for a service from services-config.json
#[must_use]
pub struct LocalGetProjectName(Step<Use>);

impl LocalGetProjectName {
    /// A step named `name` that runs `./.github/actions/get-project-name`, with its required input set.
    pub fn new(name: &str, service_name: impl ToString) -> Self {
        let step = Step::new(name).uses_local(".github/actions/get-project-name");
        Self(step)
            .with("service-name", service_name)
    }

    /// Output `project-name` of the step with id `step`: The Pulumi project directory name
    pub const fn project_name_output(step: &'static str) -> StepOutput<Str> {
        StepOutput::new(step, "project-name")
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<LocalGetProjectName> for Step<Use> {
    fn from(action: LocalGetProjectName) -> Self {
        action.step()
    }
}

/// `./.github/actions/migrate-cloud-storage-db`, defined in `workflows/composite/migrate_cloud_storage_db.rs`: Run database migrations for cloud storage services
#[must_use]
pub struct LocalMigrateCloudStorageDb(Step<Use>);

impl LocalMigrateCloudStorageDb {
    /// A step named `name` that runs `./.github/actions/migrate-cloud-storage-db`, with its required input set.
    pub fn new(name: &str, environment: impl ToString) -> Self {
        let step = Step::new(name).uses_local(".github/actions/migrate-cloud-storage-db");
        Self(step)
            .with("environment", environment)
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<LocalMigrateCloudStorageDb> for Step<Use> {
    fn from(action: LocalMigrateCloudStorageDb) -> Self {
        action.step()
    }
}

/// `./.github/actions/preview-cloud-storage-pulumi`, defined in `workflows/composite/preview_cloud_storage_pulumi.rs`: Run pulumi preview (dry run) for a pulumi stack from cloud-storage
#[must_use]
pub struct LocalPreviewCloudStoragePulumi(Step<Use>);

impl LocalPreviewCloudStoragePulumi {
    /// A step named `name` that runs `./.github/actions/preview-cloud-storage-pulumi`, with its required inputs set.
    pub fn new(name: &str, aws_access_key: impl ToString, aws_secret_key: impl ToString, pulumi_access_token: impl ToString, pulumi_service_name: impl ToString, dd_app_key: impl ToString, dd_api_key: impl ToString) -> Self {
        let step = Step::new(name).uses_local(".github/actions/preview-cloud-storage-pulumi");
        Self(step)
            .with("aws-access-key", aws_access_key)
            .with("aws-secret-key", aws_secret_key)
            .with("pulumi-access-token", pulumi_access_token)
            .with("pulumi-service-name", pulumi_service_name)
            .with("dd-app-key", dd_app_key)
            .with("dd-api-key", dd_api_key)
    }

    /// Whether to setup docker
    ///
    /// Default: `true`.
    pub fn use_docker(self, value: impl ToString) -> Self {
        self.with("use-docker", value)
    }

    /// Whether to checkout LFS content
    ///
    /// Default: `false`.
    pub fn use_lfs(self, value: impl ToString) -> Self {
        self.with("use-lfs", value)
    }

    /// Environment to preview
    ///
    /// Default: `dev`.
    pub fn environment(self, value: impl ToString) -> Self {
        self.with("environment", value)
    }

    /// AWS region
    ///
    /// Default: `us-east-1`.
    pub fn aws_region(self, value: impl ToString) -> Self {
        self.with("aws-region", value)
    }

    /// Datadog host
    ///
    /// Default: `https://api.us5.datadoghq.com/`.
    pub fn dd_host(self, value: impl ToString) -> Self {
        self.with("dd-host", value)
    }

    /// GitHub token for PR comments
    ///
    /// Default: ``.
    pub fn github_token(self, value: impl ToString) -> Self {
        self.with("github-token", value)
    }

    /// Optional service key from .github/services-config.json; used to build Lambda artifacts before preview
    ///
    /// Default: ``.
    pub fn cloud_storage_service_name(self, value: impl ToString) -> Self {
        self.with("cloud-storage-service-name", value)
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<LocalPreviewCloudStoragePulumi> for Step<Use> {
    fn from(action: LocalPreviewCloudStoragePulumi) -> Self {
        action.step()
    }
}

/// `./.github/actions/setup-nix`, defined in `workflows/composite/setup_nix.rs`: Ensure a working Nix (flakes enabled, daemon running) is available on a runner that does not ship Nix preinstalled. Idempotent: when /nix is already populated from a cache volume it only re-initialises the daemon and config rather than reinstalling the store. Init-agnostic: uses systemd units when systemd is active (full VMs), otherwise starts nix-daemon directly as a background process (e.g. Namespace runners, where systemd is not active). Optionally configures a private S3 binary cache as a substituter: the daemon performs substitution, so it is started with the AWS credentials in its environment. All four cache inputs must be set for the substituter to be configured; otherwise the action behaves exactly as before.
#[must_use]
pub struct LocalSetupNix(Step<Use>);

impl LocalSetupNix {
    /// A step named `name` that runs `./.github/actions/setup-nix`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses_local(".github/actions/setup-nix");
        Self(step)
    }

    /// S3 store URL of the private nix binary cache (e.g. s3://macro-nix-cache?region=us-east-1). Empty disables.
    ///
    /// Default: ``.
    pub fn nix_cache_url(self, value: impl ToString) -> Self {
        self.with("nix-cache-url", value)
    }

    /// Public signing key the daemon should trust for that cache.
    ///
    /// Default: ``.
    pub fn nix_cache_public_key(self, value: impl ToString) -> Self {
        self.with("nix-cache-public-key", value)
    }

    /// AWS access key id for reading the private cache bucket.
    ///
    /// Default: ``.
    pub fn aws_access_key_id(self, value: impl ToString) -> Self {
        self.with("aws-access-key-id", value)
    }

    /// AWS secret access key for reading the private cache bucket.
    ///
    /// Default: ``.
    pub fn aws_secret_access_key(self, value: impl ToString) -> Self {
        self.with("aws-secret-access-key", value)
    }

    /// Namespace cache name holding a copy of /nix with the dev shell, restored when the volume is empty. Its writers are PR jobs, so only PR check jobs pass this, never jobs that deploy or hold deploy secrets. Empty disables.
    ///
    /// Default: ``.
    pub fn seed_cache(self, value: impl ToString) -> Self {
        self.with("seed-cache", value)
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<LocalSetupNix> for Step<Use> {
    fn from(action: LocalSetupNix) -> Self {
        action.step()
    }
}

/// `./.github/actions/setup-nix-dev-shell`, defined in `workflows/composite/setup_nix_dev_shell.rs`: Enter a repository Nix dev shell without configuring a cache provider.
#[must_use]
pub struct LocalSetupNixDevShell(Step<Use>);

impl LocalSetupNixDevShell {
    /// A step named `name` that runs `./.github/actions/setup-nix-dev-shell`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses_local(".github/actions/setup-nix-dev-shell");
        Self(step)
    }

    /// Flake `devShells` attribute to enter (e.g. `default`, `agent-daemon`).
    ///
    /// Default: `default`.
    pub fn shell(self, value: impl ToString) -> Self {
        self.with("shell", value)
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<LocalSetupNixDevShell> for Step<Use> {
    fn from(action: LocalSetupNixDevShell) -> Self {
        action.step()
    }
}

/// `./.github/actions/setup-reqs-web`, defined in `workflows/composite/setup_reqs_web.rs`: Checkout and Setup Prerequisite Dependencies for web app
#[must_use]
pub struct LocalSetupReqsWeb(Step<Use>);

impl LocalSetupReqsWeb {
    /// A step named `name` that runs `./.github/actions/setup-reqs-web`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses_local(".github/actions/setup-reqs-web");
        Self(step)
    }

    /// Install Playwright and cache
    ///
    /// Default: ``.
    pub fn playwright(self, value: impl ToString) -> Self {
        self.with("playwright", value)
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<LocalSetupReqsWeb> for Step<Use> {
    fn from(action: LocalSetupReqsWeb) -> Self {
        action.step()
    }
}

/// `./.github/actions/setup-rust`, defined in `workflows/composite/setup_rust.rs`: Installs Rust and configures cargo/sccache caching.
#[must_use]
pub struct LocalSetupRust(Step<Use>);

impl LocalSetupRust {
    /// A step named `name` that runs `./.github/actions/setup-rust`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses_local(".github/actions/setup-rust");
        Self(step)
    }

    /// Configure sccache as RUSTC_WRAPPER
    ///
    /// Default: `true`.
    pub fn sccache(self, value: impl ToString) -> Self {
        self.with("sccache", value)
    }

    /// Restore Swatinem/rust-cache Cargo target cache
    ///
    /// Default: `false`.
    pub fn rust_cache(self, value: impl ToString) -> Self {
        self.with("rust-cache", value)
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<LocalSetupRust> for Step<Use> {
    fn from(action: LocalSetupRust) -> Self {
        action.step()
    }
}

/// `./.github/actions/setup-sccache`, defined in `workflows/composite/setup_sccache.rs`: Install sccache and configure it as RUSTC_WRAPPER.
#[must_use]
pub struct LocalSetupSccache(Step<Use>);

impl LocalSetupSccache {
    /// A step named `name` that runs `./.github/actions/setup-sccache`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses_local(".github/actions/setup-sccache");
        Self(step)
    }

    /// sccache release version to install
    ///
    /// Default: `v0.15.0`.
    pub fn version(self, value: impl ToString) -> Self {
        self.with("version", value)
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }

    fn with(self, name: &str, value: impl ToString) -> Self {
        Self(self.0.add_with(Input::default().add(name, value.to_string())))
    }
}

impl From<LocalSetupSccache> for Step<Use> {
    fn from(action: LocalSetupSccache) -> Self {
        action.step()
    }
}

/// `./.github/actions/teardown-nix`, defined in `workflows/composite/teardown_nix.rs`: Stop the Nix daemon(s) so a /nix cache volume can be unmounted and committed. The Determinate Nix daemon runs out of /nix, which keeps the mount busy and can make the cache-volume commit fail with "target is busy". Run this as the final (always()) step of any job that mounts /nix as a cache volume.
#[must_use]
pub struct LocalTeardownNix(Step<Use>);

impl LocalTeardownNix {
    /// A step named `name` that runs `./.github/actions/teardown-nix`.
    pub fn new(name: &str) -> Self {
        let step = Step::new(name).uses_local(".github/actions/teardown-nix");
        Self(step)
    }

    /// The step, to set its id, condition or env.
    pub fn step(self) -> Step<Use> {
        self.0
    }
}

impl From<LocalTeardownNix> for Step<Use> {
    fn from(action: LocalTeardownNix) -> Self {
        action.step()
    }
}

/// Calls `./.github/workflows/observability_aws.yml` (Observability AWS layer), defined in `workflows/observability_aws.rs`.
#[must_use]
pub struct CallObservabilityAws(CallJob);

impl CallObservabilityAws {
    /// A job calling the workflow, with its required inputs set.
    pub fn new() -> Self {
        Self(CallJob::new("./.github/workflows/observability_aws.yml"))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }
}

impl From<CallObservabilityAws> for CallJob {
    fn from(call: CallObservabilityAws) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/observability_cluster.yml` (Observability cluster), defined in `workflows/observability_cluster.rs`.
#[must_use]
pub struct CallObservabilityCluster(CallJob);

impl CallObservabilityCluster {
    /// A job calling the workflow, with its required inputs set.
    pub fn new() -> Self {
        Self(CallJob::new("./.github/workflows/observability_cluster.yml"))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }
}

impl From<CallObservabilityCluster> for CallJob {
    fn from(call: CallObservabilityCluster) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/observability_image.yml` (Observability image), defined in `workflows/observability_image.rs`.
#[must_use]
pub struct CallObservabilityImage(CallJob);

impl CallObservabilityImage {
    /// A job calling the workflow, with its required inputs set.
    pub fn new() -> Self {
        Self(CallJob::new("./.github/workflows/observability_image.yml"))
    }

    /// JSON list of the checks PR CI accepted an attestation for, by id
    ///
    /// Default: `[]`.
    pub fn attested(self, value: impl Into<Value>) -> Self {
        self.with("attested", value)
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallObservabilityImage> for CallJob {
    fn from(call: CallObservabilityImage) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/test_macrod_update.yml` (Test macrod update), defined in `workflows/test_macrod_update.rs`.
#[must_use]
pub struct CallTestMacrodUpdate(CallJob);

impl CallTestMacrodUpdate {
    /// A job calling the workflow, with its required inputs set.
    pub fn new() -> Self {
        Self(CallJob::new("./.github/workflows/test_macrod_update.yml"))
    }

    /// JSON list of the checks PR CI accepted an attestation for, by id
    ///
    /// Default: `[]`.
    pub fn attested(self, value: impl Into<Value>) -> Self {
        self.with("attested", value)
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallTestMacrodUpdate> for CallJob {
    fn from(call: CallTestMacrodUpdate) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/build_appimage_on_tag.yml` (Build AppImage), defined in `workflows/build_appimage_on_tag.rs`.
#[must_use]
pub struct CallBuildAppimageOnTag(CallJob);

impl CallBuildAppimageOnTag {
    /// A job calling the workflow, with its required inputs set.
    pub fn new(r#ref: impl Into<Value>) -> Self {
        Self(CallJob::new("./.github/workflows/build_appimage_on_tag.yml"))
            .with("ref", r#ref)
    }

    /// Passes the secret `POSTHOG_API_KEY`: PostHog project API key inlined into the desktop bundle.
    pub fn secret_posthog_api_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("POSTHOG_API_KEY", value))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallBuildAppimageOnTag> for CallJob {
    fn from(call: CallBuildAppimageOnTag) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/build_dmg_on_tag.yml` (Build macOS DMG), defined in `workflows/build_dmg_on_tag.rs`.
#[must_use]
pub struct CallBuildDmgOnTag(CallJob);

impl CallBuildDmgOnTag {
    /// A job calling the workflow, with its required inputs set.
    pub fn new(r#ref: impl Into<Value>) -> Self {
        Self(CallJob::new("./.github/workflows/build_dmg_on_tag.yml"))
            .with("ref", r#ref)
    }

    /// Passes the secret `POSTHOG_API_KEY`: PostHog project API key inlined into the desktop bundle.
    pub fn secret_posthog_api_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("POSTHOG_API_KEY", value))
    }

    /// Passes the secret `MACOS_DEVELOPER_ID_CERTIFICATE_BASE64`: Developer ID certificate for signing the macOS app.
    pub fn secret_macos_developer_id_certificate_base64(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("MACOS_DEVELOPER_ID_CERTIFICATE_BASE64", value))
    }

    /// Passes the secret `MACOS_DEVELOPER_ID_CERTIFICATE_PASSWORD`: Password for the Developer ID certificate.
    pub fn secret_macos_developer_id_certificate_password(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("MACOS_DEVELOPER_ID_CERTIFICATE_PASSWORD", value))
    }

    /// Passes the secret `MACOS_DEVELOPER_ID_PROVISIONING_PROFILE_BASE64`: Developer ID provisioning profile for the notification entitlements.
    pub fn secret_macos_developer_id_provisioning_profile_base64(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("MACOS_DEVELOPER_ID_PROVISIONING_PROFILE_BASE64", value))
    }

    /// Passes the secret `MACOS_RELEASE_DOPPLER_TOKEN`: Doppler token for notarizing the macOS DMG.
    pub fn secret_macos_release_doppler_token(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("MACOS_RELEASE_DOPPLER_TOKEN", value))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallBuildDmgOnTag> for CallJob {
    fn from(call: CallBuildDmgOnTag) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/code_check_infra.yml` (infra code check), defined in `workflows/code_check_infra.rs`.
#[must_use]
pub struct CallCodeCheckInfra(CallJob);

impl CallCodeCheckInfra {
    /// A job calling the workflow, with its required inputs set.
    pub fn new() -> Self {
        Self(CallJob::new("./.github/workflows/code_check_infra.yml"))
    }

    /// JSON list of the checks PR CI accepted an attestation for, by id
    ///
    /// Default: `[]`.
    pub fn attested(self, value: impl Into<Value>) -> Self {
        self.with("attested", value)
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallCodeCheckInfra> for CallJob {
    fn from(call: CallCodeCheckInfra) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/build_web_app.yml` (Build Web App), defined in `workflows/build_web_app.rs`.
#[must_use]
pub struct CallBuildWebApp(CallJob);

impl CallBuildWebApp {
    /// A job calling the workflow, with its required inputs set.
    pub fn new(environment: impl Into<Value>) -> Self {
        Self(CallJob::new("./.github/workflows/build_web_app.yml"))
            .with("environment", environment)
    }

    /// Passes the secret `SEGMENT_WRITE_KEY`.
    pub fn secret_segment_write_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("SEGMENT_WRITE_KEY", value))
    }

    /// Passes the secret `POSTHOG_API_KEY`.
    pub fn secret_posthog_api_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("POSTHOG_API_KEY", value))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallBuildWebApp> for CallJob {
    fn from(call: CallBuildWebApp) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/cargo_deny.yml` (cargo deny check), defined in `workflows/cargo_deny.rs`.
#[must_use]
pub struct CallCargoDeny(CallJob);

impl CallCargoDeny {
    /// A job calling the workflow, with its required inputs set.
    pub fn new() -> Self {
        Self(CallJob::new("./.github/workflows/cargo_deny.yml"))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }
}

impl From<CallCargoDeny> for CallJob {
    fn from(call: CallCargoDeny) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/cargo_workspace_dependency_check.yml` (cargo workspace dependency check), defined in `workflows/cargo_workspace_dependency_check.rs`.
#[must_use]
pub struct CallCargoWorkspaceDependencyCheck(CallJob);

impl CallCargoWorkspaceDependencyCheck {
    /// A job calling the workflow, with its required inputs set.
    pub fn new() -> Self {
        Self(CallJob::new("./.github/workflows/cargo_workspace_dependency_check.yml"))
    }

    /// JSON list of the checks PR CI accepted an attestation for, by id
    ///
    /// Default: `[]`.
    pub fn attested(self, value: impl Into<Value>) -> Self {
        self.with("attested", value)
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallCargoWorkspaceDependencyCheck> for CallJob {
    fn from(call: CallCargoWorkspaceDependencyCheck) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/code_check_cloud_storage.yml` (cloud storage code check), defined in `workflows/code_check_cloud_storage.rs`.
#[must_use]
pub struct CallCodeCheckCloudStorage(CallJob);

impl CallCodeCheckCloudStorage {
    /// A job calling the workflow, with its required inputs set.
    pub fn new() -> Self {
        Self(CallJob::new("./.github/workflows/code_check_cloud_storage.yml"))
    }

    /// JSON list of the checks PR CI accepted an attestation for, by id
    ///
    /// Default: `[]`.
    pub fn attested(self, value: impl Into<Value>) -> Self {
        self.with("attested", value)
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallCodeCheckCloudStorage> for CallJob {
    fn from(call: CallCodeCheckCloudStorage) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/code_check_conventions.yml` (conventions code check), defined in `workflows/code_check_conventions.rs`.
#[must_use]
pub struct CallCodeCheckConventions(CallJob);

impl CallCodeCheckConventions {
    /// A job calling the workflow, with its required inputs set.
    pub fn new() -> Self {
        Self(CallJob::new("./.github/workflows/code_check_conventions.yml"))
    }

    /// JSON list of the checks PR CI accepted an attestation for, by id
    ///
    /// Default: `[]`.
    pub fn attested(self, value: impl Into<Value>) -> Self {
        self.with("attested", value)
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallCodeCheckConventions> for CallJob {
    fn from(call: CallCodeCheckConventions) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/deploy_ai_editing_worker.yml` (Deploy AI Editing Worker), defined in `workflows/deploy_ai_editing_worker.rs`.
#[must_use]
pub struct CallDeployAiEditingWorker(CallJob);

impl CallDeployAiEditingWorker {
    /// A job calling the workflow, with its required inputs set.
    pub fn new(environment: impl Into<Value>) -> Self {
        Self(CallJob::new("./.github/workflows/deploy_ai_editing_worker.yml"))
            .with("environment", environment)
    }

    /// Passes the secret `CLOUDFLARE_API_TOKEN`.
    pub fn secret_cloudflare_api_token(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("CLOUDFLARE_API_TOKEN", value))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallDeployAiEditingWorker> for CallJob {
    fn from(call: CallDeployAiEditingWorker) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/deploy_mcp_chatgpt_worker.yml` (Deploy MCP ChatGPT Worker), defined in `workflows/deploy_mcp_chatgpt_worker.rs`.
#[must_use]
pub struct CallDeployMcpChatgptWorker(CallJob);

impl CallDeployMcpChatgptWorker {
    /// A job calling the workflow, with its required inputs set.
    pub fn new(environment: impl Into<Value>) -> Self {
        Self(CallJob::new("./.github/workflows/deploy_mcp_chatgpt_worker.yml"))
            .with("environment", environment)
    }

    /// Passes the secret `CLOUDFLARE_API_TOKEN`.
    pub fn secret_cloudflare_api_token(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("CLOUDFLARE_API_TOKEN", value))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallDeployMcpChatgptWorker> for CallJob {
    fn from(call: CallDeployMcpChatgptWorker) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/deploy_all_services.yml` (Deploy All Services), defined in `workflows/deploy_all_services.rs`.
#[must_use]
pub struct CallDeployAllServices(CallJob);

impl CallDeployAllServices {
    /// A job calling the workflow, with its required inputs set.
    pub fn new(environment: impl Into<Value>) -> Self {
        Self(CallJob::new("./.github/workflows/deploy_all_services.yml"))
            .with("environment", environment)
    }

    /// Passes the secret `AWS_ACCESS_KEY`.
    pub fn secret_aws_access_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("AWS_ACCESS_KEY", value))
    }

    /// Passes the secret `AWS_SECRET_ACCESS_KEY`.
    pub fn secret_aws_secret_access_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("AWS_SECRET_ACCESS_KEY", value))
    }

    /// Passes the secret `PULUMI_ACCESS_TOKEN`.
    pub fn secret_pulumi_access_token(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("PULUMI_ACCESS_TOKEN", value))
    }

    /// Passes the secret `DD_APP_KEY`.
    pub fn secret_dd_app_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("DD_APP_KEY", value))
    }

    /// Passes the secret `DD_API_KEY`.
    pub fn secret_dd_api_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("DD_API_KEY", value))
    }

    /// Passes the secret `NIX_CACHE_SIGNING_KEY`.
    pub fn secret_nix_cache_signing_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("NIX_CACHE_SIGNING_KEY", value))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallDeployAllServices> for CallJob {
    fn from(call: CallDeployAllServices) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/deploy_sync_service.yml` (Deploy Sync Service), defined in `workflows/deploy_sync_service.rs`.
#[must_use]
pub struct CallDeploySyncService(CallJob);

impl CallDeploySyncService {
    /// A job calling the workflow, with its required inputs set.
    pub fn new(environment: impl Into<Value>) -> Self {
        Self(CallJob::new("./.github/workflows/deploy_sync_service.yml"))
            .with("environment", environment)
    }

    /// Passes the secret `CLOUDFLARE_API_TOKEN`.
    pub fn secret_cloudflare_api_token(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("CLOUDFLARE_API_TOKEN", value))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallDeploySyncService> for CallJob {
    fn from(call: CallDeploySyncService) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/deploy_web_app.yml` (Deploy Web App), defined in `workflows/deploy_web_app.rs`.
#[must_use]
pub struct CallDeployWebApp(CallJob);

impl CallDeployWebApp {
    /// A job calling the workflow, with its required inputs set.
    pub fn new(environment: impl Into<Value>) -> Self {
        Self(CallJob::new("./.github/workflows/deploy_web_app.yml"))
            .with("environment", environment)
    }

    pub fn notify(self, value: impl Into<Value>) -> Self {
        self.with("notify", value)
    }

    /// The caller already ran build_web_app.yml in this run
    ///
    /// Default: `false`.
    pub fn prebuilt(self, value: impl Into<Value>) -> Self {
        self.with("prebuilt", value)
    }

    /// Passes the secret `AWS_ACCESS_KEY`.
    pub fn secret_aws_access_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("AWS_ACCESS_KEY", value))
    }

    /// Passes the secret `AWS_SECRET_ACCESS_KEY`.
    pub fn secret_aws_secret_access_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("AWS_SECRET_ACCESS_KEY", value))
    }

    /// Passes the secret `PULUMI_ACCESS_TOKEN`.
    pub fn secret_pulumi_access_token(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("PULUMI_ACCESS_TOKEN", value))
    }

    /// Passes the secret `DD_APP_KEY`.
    pub fn secret_dd_app_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("DD_APP_KEY", value))
    }

    /// Passes the secret `DD_API_KEY`.
    pub fn secret_dd_api_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("DD_API_KEY", value))
    }

    /// Passes the secret `SEGMENT_WRITE_KEY`.
    pub fn secret_segment_write_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("SEGMENT_WRITE_KEY", value))
    }

    /// Passes the secret `POSTHOG_API_KEY`.
    pub fn secret_posthog_api_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("POSTHOG_API_KEY", value))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallDeployWebApp> for CallJob {
    fn from(call: CallDeployWebApp) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/deploy_website.yml` (Deploy Website), defined in `workflows/deploy_website.rs`.
#[must_use]
pub struct CallDeployWebsite(CallJob);

impl CallDeployWebsite {
    /// A job calling the workflow, with its required inputs set.
    pub fn new(environment: impl Into<Value>) -> Self {
        Self(CallJob::new("./.github/workflows/deploy_website.yml"))
            .with("environment", environment)
    }

    /// Passes the secret `AWS_ACCESS_KEY`.
    pub fn secret_aws_access_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("AWS_ACCESS_KEY", value))
    }

    /// Passes the secret `AWS_SECRET_ACCESS_KEY`.
    pub fn secret_aws_secret_access_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("AWS_SECRET_ACCESS_KEY", value))
    }

    /// Passes the secret `PULUMI_ACCESS_TOKEN`.
    pub fn secret_pulumi_access_token(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("PULUMI_ACCESS_TOKEN", value))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallDeployWebsite> for CallJob {
    fn from(call: CallDeployWebsite) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/ios-app-store-publish.yml` (iOS App Store Publish), defined in `workflows/ios_app_store_publish.rs`.
#[must_use]
pub struct CallIosAppStorePublish(CallJob);

impl CallIosAppStorePublish {
    /// A job calling the workflow, with its required inputs set.
    pub fn new() -> Self {
        Self(CallJob::new("./.github/workflows/ios-app-store-publish.yml"))
    }

    /// Passes the secret `IOS_RELEASE_DOPPLER_TOKEN`: Doppler service token for ios-release/prd.
    pub fn secret_ios_release_doppler_token(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("IOS_RELEASE_DOPPLER_TOKEN", value))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }
}

impl From<CallIosAppStorePublish> for CallJob {
    fn from(call: CallIosAppStorePublish) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/reusable_deploy_service.yml` (Reusable Deploy Service), defined in `workflows/reusable_deploy_service.rs`.
#[must_use]
pub struct CallReusableDeployService(CallJob);

impl CallReusableDeployService {
    /// A job calling the workflow, with its required inputs set.
    pub fn new(environment: impl Into<Value>, service_name: impl Into<Value>) -> Self {
        Self(CallJob::new("./.github/workflows/reusable_deploy_service.yml"))
            .with("environment", environment)
            .with("service-name", service_name)
    }

    /// Override pulumi stack name (defaults to service-name)
    pub fn pulumi_stack_name(self, value: impl Into<Value>) -> Self {
        self.with("pulumi-stack-name", value)
    }

    /// Whether to setup docker
    ///
    /// Default: `true`.
    pub fn use_docker(self, value: impl Into<Value>) -> Self {
        self.with("use-docker", value)
    }

    /// Whether to checkout LFS content
    ///
    /// Default: `false`.
    pub fn use_lfs(self, value: impl Into<Value>) -> Self {
        self.with("use-lfs", value)
    }

    /// Passes the secret `AWS_ACCESS_KEY`.
    pub fn secret_aws_access_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("AWS_ACCESS_KEY", value))
    }

    /// Passes the secret `AWS_SECRET_ACCESS_KEY`.
    pub fn secret_aws_secret_access_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("AWS_SECRET_ACCESS_KEY", value))
    }

    /// Passes the secret `PULUMI_ACCESS_TOKEN`.
    pub fn secret_pulumi_access_token(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("PULUMI_ACCESS_TOKEN", value))
    }

    /// Passes the secret `DD_APP_KEY`.
    pub fn secret_dd_app_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("DD_APP_KEY", value))
    }

    /// Passes the secret `DD_API_KEY`.
    pub fn secret_dd_api_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("DD_API_KEY", value))
    }

    /// Passes the secret `NIX_CACHE_SIGNING_KEY`.
    pub fn secret_nix_cache_signing_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("NIX_CACHE_SIGNING_KEY", value))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallReusableDeployService> for CallJob {
    fn from(call: CallReusableDeployService) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/reusable_preview_service.yml` (Reusable Preview Service), defined in `workflows/reusable_preview_service.rs`.
#[must_use]
pub struct CallReusablePreviewService(CallJob);

impl CallReusablePreviewService {
    /// A job calling the workflow, with its required inputs set.
    pub fn new(environment: impl Into<Value>, service_name: impl Into<Value>) -> Self {
        Self(CallJob::new("./.github/workflows/reusable_preview_service.yml"))
            .with("environment", environment)
            .with("service-name", service_name)
    }

    /// Override pulumi stack name (defaults to service-name)
    pub fn pulumi_stack_name(self, value: impl Into<Value>) -> Self {
        self.with("pulumi-stack-name", value)
    }

    /// Whether to setup docker
    ///
    /// Default: `true`.
    pub fn use_docker(self, value: impl Into<Value>) -> Self {
        self.with("use-docker", value)
    }

    /// Whether to checkout LFS content
    ///
    /// Default: `false`.
    pub fn use_lfs(self, value: impl Into<Value>) -> Self {
        self.with("use-lfs", value)
    }

    /// GitHub token for PR comments
    pub fn github_token(self, value: impl Into<Value>) -> Self {
        self.with("github-token", value)
    }

    /// Passes the secret `AWS_ACCESS_KEY`.
    pub fn secret_aws_access_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("AWS_ACCESS_KEY", value))
    }

    /// Passes the secret `AWS_SECRET_ACCESS_KEY`.
    pub fn secret_aws_secret_access_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("AWS_SECRET_ACCESS_KEY", value))
    }

    /// Passes the secret `PULUMI_ACCESS_TOKEN`.
    pub fn secret_pulumi_access_token(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("PULUMI_ACCESS_TOKEN", value))
    }

    /// Passes the secret `DD_APP_KEY`.
    pub fn secret_dd_app_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("DD_APP_KEY", value))
    }

    /// Passes the secret `DD_API_KEY`.
    pub fn secret_dd_api_key(self, value: impl ToString) -> Self {
        Self(self.0.add_secret("DD_API_KEY", value))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallReusablePreviewService> for CallJob {
    fn from(call: CallReusablePreviewService) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/check_node_modules_nix.yml` (check node_modules nix), defined in `workflows/check_node_modules_nix.rs`.
#[must_use]
pub struct CallCheckNodeModulesNix(CallJob);

impl CallCheckNodeModulesNix {
    /// A job calling the workflow, with its required inputs set.
    pub fn new() -> Self {
        Self(CallJob::new("./.github/workflows/check_node_modules_nix.yml"))
    }

    /// JSON list of the checks PR CI accepted an attestation for, by id
    ///
    /// Default: `[]`.
    pub fn attested(self, value: impl Into<Value>) -> Self {
        self.with("attested", value)
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallCheckNodeModulesNix> for CallJob {
    fn from(call: CallCheckNodeModulesNix) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/check_tauri_lockfiles.yml` (check tauri lockfiles), defined in `workflows/check_tauri_lockfiles.rs`.
#[must_use]
pub struct CallCheckTauriLockfiles(CallJob);

impl CallCheckTauriLockfiles {
    /// A job calling the workflow, with its required inputs set.
    pub fn new() -> Self {
        Self(CallJob::new("./.github/workflows/check_tauri_lockfiles.yml"))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }
}

impl From<CallCheckTauriLockfiles> for CallJob {
    fn from(call: CallCheckTauriLockfiles) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/check_generated.yml` (check generated workflows), defined in `workflows/check_generated.rs`.
#[must_use]
pub struct CallCheckGenerated(CallJob);

impl CallCheckGenerated {
    /// A job calling the workflow, with its required inputs set.
    pub fn new() -> Self {
        Self(CallJob::new("./.github/workflows/check_generated.yml"))
    }

    /// JSON list of the checks PR CI accepted an attestation for, by id
    ///
    /// Default: `[]`.
    pub fn attested(self, value: impl Into<Value>) -> Self {
        self.with("attested", value)
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallCheckGenerated> for CallJob {
    fn from(call: CallCheckGenerated) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/web-app-check-main.yml` (Web App Pr Checks), defined in `workflows/web_app_check_main.rs`.
#[must_use]
pub struct CallWebAppCheckMain(CallJob);

impl CallWebAppCheckMain {
    /// A job calling the workflow, with its required inputs set.
    pub fn new() -> Self {
        Self(CallJob::new("./.github/workflows/web-app-check-main.yml"))
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }
}

impl From<CallWebAppCheckMain> for CallJob {
    fn from(call: CallWebAppCheckMain) -> Self {
        call.0
    }
}

/// Calls `./.github/workflows/sdk-check.yml` (SDK Check), defined in `workflows/sdk_check.rs`.
#[must_use]
pub struct CallSdkCheck(CallJob);

impl CallSdkCheck {
    /// A job calling the workflow, with its required inputs set.
    pub fn new() -> Self {
        Self(CallJob::new("./.github/workflows/sdk-check.yml"))
    }

    /// JSON list of the checks PR CI accepted an attestation for, by id
    ///
    /// Default: `[]`.
    pub fn attested(self, value: impl Into<Value>) -> Self {
        self.with("attested", value)
    }

    /// Passes every secret the caller can read (`secrets: inherit`).
    pub fn inherit_secrets(self) -> Self {
        Self(self.0.inherit_secrets())
    }

    /// The job, to set its name, `needs`, condition or permissions.
    pub fn job(self) -> CallJob {
        self.0
    }

    fn with(self, name: &str, value: impl Into<Value>) -> Self {
        Self(self.0.add_with(name, value))
    }
}

impl From<CallSdkCheck> for CallJob {
    fn from(call: CallSdkCheck) -> Self {
        call.0
    }
}
