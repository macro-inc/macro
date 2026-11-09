use super::*;
use async_trait::async_trait;
use std::sync::atomic::{AtomicUsize, Ordering};

/// A toolchain that accepts everything, bundles each entry as a marker, and
/// counts what it was asked to do.
#[derive(Default)]
struct Toolchain {
    checks: AtomicUsize,
    bundles: AtomicUsize,
    client_code: Option<&'static str>,
}

#[async_trait]
impl ProgramChecker for Toolchain {
    fn sdk_fingerprint(&self) -> &str {
        "test"
    }

    async fn check_files(
        &self,
        _files: &[SourceFile],
        _declarations: &str,
    ) -> Result<Vec<Diagnostic>, CheckError> {
        self.checks.fetch_add(1, Ordering::SeqCst);
        Ok(Vec::new())
    }
}

#[async_trait]
impl ProgramBundler for Toolchain {
    async fn bundle(
        &self,
        files: &[SourceFile],
        entry: &str,
        _target: BundleTarget,
    ) -> Result<Bundle, CheckError> {
        self.bundles.fetch_add(1, Ordering::SeqCst);
        if entry == "client.ts"
            && let Some(code) = self.client_code
        {
            return Ok(Bundle::Code(code.to_owned()));
        }
        Ok(Bundle::Code(format!(
            "bundled {entry} from {}",
            files[0].name
        )))
    }
}

#[tokio::test]
async fn refuses_blocks_it_cannot_name_without_running_the_toolchain() {
    let toolchain = Toolchain::default();
    let html = r#"
<script type="text/macro">export default async () => 1;</script>
<script type="text/macro" id="2fast">export default async () => 1;</script>
<script type="text/macro" id="tasks">export default async () => 1;</script>
<script type="text/macro" id="tasks">export default async () => 2;</script>
<script type="text/macro" id="blank">   </script>
<script type="module" lang="ts">console.log(1);</script>
<script type="module" lang="ts">console.log(2);</script>
"#;

    let BuildOutcome::Failed(problems) = build(html, &toolchain, &toolchain).await.unwrap() else {
        panic!("invalid blocks must fail the build");
    };

    let messages: Vec<&str> = problems.iter().map(|p| p.message.as_str()).collect();
    assert_eq!(
        messages,
        [
            "A document may have one `<script type=\"module\" lang=\"ts\">`; merge them into one.",
            "Every `<script type=\"text/macro\">` needs an `id`.",
            "Program id `2fast` must be a JavaScript identifier: letters, digits and `_`, not starting with a digit.",
            "Two programs have the id `tasks`.",
            "Program `blank` is empty.",
        ]
    );
    assert_eq!(toolchain.checks.load(Ordering::SeqCst), 0);
    assert_eq!(toolchain.bundles.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn removes_programs_and_inlines_the_client_bundle() {
    let toolchain = Toolchain::default();
    let html = r#"<!doctype html><ul id="out"></ul>
<script type="text/macro" id="tasks" lang="ts">export default async () => ['a'];</script>
<script type="module" lang="ts">import { tasks } from 'macro:programs';</script>
<script>window.plain = true;</script>"#;

    let BuildOutcome::Built { html, programs } = build(html, &toolchain, &toolchain).await.unwrap()
    else {
        panic!("a valid document must build");
    };

    assert_eq!(
        html,
        "<!doctype html><ul id=\"out\"></ul>\n\n\
         <script type=\"module\">bundled client.ts from client.ts</script>\n\
         <script>window.plain = true;</script>"
    );
    assert_eq!(
        programs,
        BTreeMap::from([(
            ProgramId::try_new("tasks".to_owned()).unwrap(),
            "bundled entry.ts from program_0.ts".to_owned()
        )])
    );
    // Programs alone, then programs with the client.
    assert_eq!(toolchain.checks.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn refuses_a_client_bundle_that_would_close_its_own_script() {
    let toolchain = Toolchain {
        client_code: Some("const s = '</SCRIPT>';"),
        ..Toolchain::default()
    };
    let html = r#"<script type="module" lang="ts">const s = '</' + 'SCRIPT>';</script>"#;

    let outcome = build(html, &toolchain, &toolchain).await.unwrap();

    assert!(
        matches!(&outcome, BuildOutcome::Failed(problems) if problems[0].message.contains("</script")),
        "{outcome:?}"
    );
}

#[test]
fn source_hash_accepts_only_its_own_shape() {
    let hash = SourceHash::of("<p>hi</p>");
    assert_eq!(
        SourceHash::try_from(String::from(hash.clone())).unwrap(),
        hash
    );
    assert!(SourceHash::try_from("ABC".to_owned()).is_err());
    assert!(SourceHash::try_from(hash.as_ref().to_ascii_uppercase()).is_err());
}

mod with_deno {
    use super::*;
    use code_execution::outbound::deno::check::DenoChecker;

    async fn deno() -> (tempfile::TempDir, DenoChecker) {
        let root = tempfile::tempdir().unwrap();
        let binary = std::process::Command::new("which")
            .arg("deno")
            .output()
            .unwrap();
        assert!(binary.status.success(), "Deno 2.9.6 must be on PATH");
        let binary = std::path::PathBuf::from(String::from_utf8(binary.stdout).unwrap().trim());
        let checker = DenoChecker::new(binary, root.path().to_owned(), 2, 64 * 1024)
            .await
            .unwrap();
        (root, checker)
    }

    const PROGRAM: &str = r#"<script type="text/macro" id="tasks" lang="ts">
  export default async function ({ query }: { query: string }, { macro }: ProgramContext) {
    return [query, typeof macro.tasks];
  }
</script>"#;

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn builds_a_client_that_calls_its_program_typed() {
        let (_root, deno) = deno().await;
        let html = format!(
            r#"<ul id="out"></ul>{PROGRAM}
<script type="module" lang="ts">
  import {{ on }} from 'macro:client';
  import {{ tasks }} from 'macro:programs';
  const rows: string[] = await tasks({{ query: 'launch' }});
  document.getElementById('out')!.textContent = rows.join(',');
  on(['document.updated'], () => {{}});
</script>"#
        );

        let BuildOutcome::Built { html, programs } = build(&html, &deno, &deno).await.unwrap()
        else {
            panic!("the document should build");
        };

        assert!(!html.contains("text/macro"), "{html}");
        assert!(!html.contains("lang="), "{html}");
        assert!(
            !html.contains("typeof macro.tasks"),
            "program source leaked: {html}"
        );
        assert!(
            html.contains("\"tasks\"") || html.contains("'tasks'"),
            "{html}"
        );
        let program = &programs[&ProgramId::try_new("tasks".to_owned()).unwrap()];
        assert!(program.contains("async function main"), "{program}");
        assert!(program.contains("data:"), "{program}");
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn reports_a_wrong_argument_against_the_client_script() {
        let (_root, deno) = deno().await;
        let html = format!(
            r#"{PROGRAM}<script type="module" lang="ts">
  import {{ tasks }} from 'macro:programs';
  await tasks({{ query: 42 }});
</script>"#
        );

        let BuildOutcome::Failed(problems) = build(&html, &deno, &deno).await.unwrap() else {
            panic!("a wrong argument must fail the build");
        };

        assert_eq!(problems.len(), 1, "{problems:?}");
        assert_eq!(problems[0].file.as_deref(), Some("client script"));
        assert!(problems[0].message.contains("TS2322"), "{problems:?}");
        assert!(
            problems[0].message.contains("at client script:3:"),
            "{problems:?}"
        );
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn reports_a_program_error_by_its_id() {
        let (_root, deno) = deno().await;
        let html = r#"<script type="text/macro" id="broken" lang="ts">
  export default async function (_args: {}, { macro }: ProgramContext) {
    return macro.tasks.nope();
  }
</script>"#;

        let BuildOutcome::Failed(problems) = build(html, &deno, &deno).await.unwrap() else {
            panic!("a program type error must fail the build");
        };

        assert_eq!(
            problems[0].file.as_deref(),
            Some("program broken"),
            "{problems:?}"
        );
        assert!(problems[0].message.contains("'nope'"), "{problems:?}");
    }
}
