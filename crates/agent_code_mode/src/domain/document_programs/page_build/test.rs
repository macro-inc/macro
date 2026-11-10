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
async fn a_page_without_programs_or_a_client_script_is_plain() {
    let toolchain = Toolchain::default();
    let html = r#"<script src="https://cdn.example.com/chart.js"></script><script type="module">go();</script>"#;

    let outcome = build(html, &toolchain, &toolchain).await.unwrap();

    assert_eq!(outcome, BuildOutcome::Plain);
    assert_eq!(toolchain.checks.load(Ordering::SeqCst), 0);
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

#[tokio::test]
async fn refuses_reserved_program_ids_and_an_empty_client() {
    let toolchain = Toolchain::default();
    let html = r#"
<script type="text/macro" id="run">export default async () => 1;</script>
<script type="text/macro" id="delete">export default async () => 1;</script>
<script type="module" lang="ts">  </script>
"#;

    let BuildOutcome::Failed(problems) = build(html, &toolchain, &toolchain).await.unwrap() else {
        panic!("reserved ids must fail the build");
    };

    let messages: Vec<&str> = problems.iter().map(|p| p.message.as_str()).collect();
    assert_eq!(
        messages,
        [
            "Program id `run` is a reserved word in JavaScript or `macro:programs`; rename it.",
            "Program id `delete` is a reserved word in JavaScript or `macro:programs`; rename it.",
            "The `<script type=\"module\" lang=\"ts\">` is empty; write the client script or remove it.",
        ]
    );
    assert_eq!(toolchain.checks.load(Ordering::SeqCst), 0);
}

/// A bundler whose program bundles exceed what a run accepts.
struct OversizedBundler;

#[async_trait]
impl ProgramBundler for OversizedBundler {
    async fn bundle(
        &self,
        _files: &[SourceFile],
        _entry: &str,
        _target: BundleTarget,
    ) -> Result<Bundle, CheckError> {
        Ok(Bundle::Code("x".repeat(65 * 1024)))
    }
}

#[tokio::test]
async fn refuses_a_program_bundle_a_run_would_refuse() {
    let html = r#"<script type="text/macro" id="tasks">export default async () => 1;</script>"#;

    let BuildOutcome::Failed(problems) = build(html, &Toolchain::default(), &OversizedBundler)
        .await
        .unwrap()
    else {
        panic!("an oversized bundle must fail the build");
    };

    assert_eq!(problems[0].file.as_deref(), Some("program tasks"));
    assert!(
        problems[0].message.contains("65 KiB") && problems[0].message.contains("64 KiB"),
        "{problems:?}"
    );
}

#[tokio::test]
async fn refuses_a_program_over_the_module_limit_by_name_before_checking() {
    let toolchain = Toolchain::default();
    let html = format!(
        r#"<script type="text/macro" id="big">export default async () => "{}";</script>"#,
        "x".repeat(70 * 1024)
    );

    let BuildOutcome::Failed(problems) = build(&html, &toolchain, &toolchain).await.unwrap() else {
        panic!("an oversized program must fail the build");
    };

    assert_eq!(problems[0].file.as_deref(), Some("program big"));
    assert!(
        problems[0].message.contains("71 KiB") && problems[0].message.contains("64 KiB"),
        "{problems:?}"
    );
    assert_eq!(toolchain.checks.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_page_with_programs_refuses_what_its_policy_cannot_stop() {
    let toolchain = Toolchain::default();
    let refused = r#"<meta http-equiv="Refresh" content="0;url=https://example.com/?d=1">
<link rel="stylesheet preconnect" href="https://example.com">
<link rel="DNS-Prefetch" href="https://example.com">
<link rel="stylesheet" href="data:text/css,">
<meta http-equiv="content-type" content="text/html">
<iframe srcdoc="<p>nested</p>"></iframe>"#;
    let html = format!(
        r#"{refused}<script type="text/macro" id="tasks">export default async () => 1;</script>"#
    );

    let BuildOutcome::Failed(problems) = build(&html, &toolchain, &toolchain).await.unwrap() else {
        panic!("a refresh, connection hints and a nested frame must fail the build");
    };

    assert_eq!(problems.len(), 4, "{problems:?}");
    assert!(problems[0].message.contains("http-equiv=\"refresh\""));
    assert!(problems[1].message.contains("rel=\"preconnect\""));
    assert!(problems[2].message.contains("rel=\"dns-prefetch\""));
    assert!(problems[3].message.contains("`<iframe>`"));
    assert_eq!(toolchain.checks.load(Ordering::SeqCst), 0);

    // A plain page runs no programs and gets no policy, so it keeps them.
    let plain = build(refused, &toolchain, &toolchain).await.unwrap();
    assert_eq!(plain, BuildOutcome::Plain);
}

#[test]
fn explains_shape_and_timer_problems_and_drops_generated_notes() {
    let ids = [ProgramId::try_new("tasks".to_owned()).unwrap()];
    let renamed = named(
        vec![
            Diagnostic {
                file: Some(arguments_file(0)),
                message: format!(
                    "TS2322 [ERROR]: Type '\"{NOT_A_PROGRAM}\"' is not assignable to type '\"ok\"'."
                ),
            },
            Diagnostic {
                file: Some(PROGRAMS_FILE.to_owned()),
                message:
                    "TS6236 [ERROR]: Arguments for the rest parameter 'args' were not provided."
                        .to_owned(),
            },
            Diagnostic {
                file: Some(program_file(0)),
                message: format!(
                    "TS2349 [ERROR]: This expression is not callable.\n  Type '{TIMERS_MARKER}' has no call signatures."
                ),
            },
        ],
        &ids,
    );

    assert_eq!(renamed.len(), 2, "{renamed:?}");
    assert_eq!(renamed[0].file.as_deref(), Some("program tasks"));
    assert!(
        renamed[0]
            .message
            .starts_with("Program `tasks` must take at most two parameters"),
        "{renamed:?}"
    );
    assert_eq!(renamed[1].file.as_deref(), Some("program tasks"));
    assert!(
        renamed[1].message.contains("can't sleep or poll"),
        "{renamed:?}"
    );
}

#[test]
fn names_the_macro_client_module_in_diagnostics() {
    let ids = [ProgramId::try_new("tasks".to_owned()).unwrap()];
    let renamed = named(
        vec![Diagnostic {
            file: Some(MACRO_CLIENT_FILE.to_owned()),
            message: "TS2345 at macro_client.ts:3:1 and client.ts:1:1".to_owned(),
        }],
        &ids,
    );

    assert_eq!(renamed[0].file.as_deref(), Some("macro:client"));
    assert_eq!(
        renamed[0].message,
        "TS2345 at macro:client:3:1 and client script:1:1"
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
    async fn a_program_whose_arguments_an_empty_object_satisfies_is_called_without_them() {
        let (_root, deno) = deno().await;
        let html = r#"<script type="text/macro" id="recent" lang="ts">
  export default async function (_args: {}, { macro }: ProgramContext) {
    return typeof macro.documents;
  }
</script>
<script type="text/macro" id="clock" lang="ts">
  export default async function () {
    return 1;
  }
</script>
<script type="module" lang="ts">
  import { clock, recent } from 'macro:programs';
  const kind: string = await recent();
  const tick: number = await clock();
  document.title = `${kind} ${tick}`;
</script>"#;

        let outcome = build(html, &deno, &deno).await.unwrap();

        assert!(matches!(outcome, BuildOutcome::Built { .. }), "{outcome:?}");
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn a_required_argument_cannot_be_left_out() {
        let (_root, deno) = deno().await;
        let html = format!(
            r#"{PROGRAM}<script type="module" lang="ts">
  import {{ tasks }} from 'macro:programs';
  await tasks();
</script>"#
        );

        let BuildOutcome::Failed(problems) = build(&html, &deno, &deno).await.unwrap() else {
            panic!("a missing required argument must fail the build");
        };

        assert_eq!(
            problems[0].file.as_deref(),
            Some("client script"),
            "{problems:?}"
        );
        assert!(problems[0].message.contains("TS2554"), "{problems:?}");
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn a_program_whose_first_parameter_is_not_an_object_fails_by_name() {
        let (_root, deno) = deno().await;
        let html = r#"<script type="text/macro" id="echo" lang="ts">
  export default async function (text: string) {
    return text;
  }
</script>"#;

        let BuildOutcome::Failed(problems) = build(html, &deno, &deno).await.unwrap() else {
            panic!("a non-object first parameter must fail the build");
        };

        assert_eq!(problems.len(), 1, "{problems:?}");
        assert_eq!(problems[0].file.as_deref(), Some("program echo"));
        assert!(
            problems[0]
                .message
                .starts_with("Program `echo`'s first parameter must be an object type"),
            "{problems:?}"
        );
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn the_client_receives_a_program_value_as_json() {
        let (_root, deno) = deno().await;
        let html = r#"<script type="text/macro" id="when" lang="ts">
  export default async function () {
    return { at: new Date(), format: () => 'x', labels: ['a'] };
  }
</script>
<script type="module" lang="ts">
  import { when } from 'macro:programs';
  const value = await when();
  const at: string = value.at;
  const labels: string[] = value.labels;
  // @ts-expect-error functions don't survive JSON
  value.format();
  document.title = `${at} ${labels.length}`;
</script>"#;

        let outcome = build(html, &deno, &deno).await.unwrap();

        assert!(matches!(outcome, BuildOutcome::Built { .. }), "{outcome:?}");
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn a_program_that_takes_more_than_its_context_fails_by_name() {
        let (_root, deno) = deno().await;
        let html = r#"<script type="text/macro" id="pair" lang="ts">
  export default async function (a: { x: number }, b: { y: number }, { macro }: ProgramContext) {
    return a.x + b.y + Number(Boolean(macro));
  }
</script>"#;

        let BuildOutcome::Failed(problems) = build(html, &deno, &deno).await.unwrap() else {
            panic!("a program the runtime can't call must fail the build");
        };

        assert_eq!(problems.len(), 1, "{problems:?}");
        assert_eq!(problems[0].file.as_deref(), Some("program pair"));
        assert!(
            problems[0]
                .message
                .starts_with("Program `pair` must take at most two parameters"),
            "{problems:?}"
        );
    }

    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn a_program_that_sleeps_fails_the_build() {
        let (_root, deno) = deno().await;
        let html = r#"<script type="text/macro" id="slow" lang="ts">
  export default async function () {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return 1;
  }
</script>"#;

        let BuildOutcome::Failed(problems) = build(html, &deno, &deno).await.unwrap() else {
            panic!("a timer call must fail the build");
        };

        assert_eq!(
            problems[0].file.as_deref(),
            Some("program slow"),
            "{problems:?}"
        );
        assert!(problems[0].message.contains("TS2349"), "{problems:?}");
        assert!(
            problems[0].message.contains("at program slow:3:"),
            "{problems:?}"
        );
        assert!(
            problems[0].message.contains("can't sleep or poll"),
            "{problems:?}"
        );
    }

    /// The demo pages in `demos/` build against the current SDK, so an SDK
    /// change that breaks one fails here.
    #[tokio::test]
    #[ignore = "requires pinned Deno runtime"]
    async fn every_demo_page_builds() {
        let (_root, deno) = deno().await;
        let demos = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("demos");
        let mut pages: Vec<std::path::PathBuf> = std::fs::read_dir(&demos)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.extension()
                    .is_some_and(|extension| extension == "html")
            })
            .collect();
        pages.sort();
        assert!(!pages.is_empty(), "no demo pages in {}", demos.display());

        let mut failures = Vec::new();
        for page in &pages {
            let html = std::fs::read_to_string(page).unwrap();
            if let BuildOutcome::Failed(problems) = build(&html, &deno, &deno).await.unwrap() {
                failures.push((page.file_name().unwrap().to_owned(), problems));
            }
        }

        assert!(failures.is_empty(), "{failures:#?}");
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
