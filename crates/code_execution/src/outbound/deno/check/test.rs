use super::*;

const CONTEXT: &str = r#"import type { Macro } from '@macro-inc/sdk';
declare global {
  interface StepContext { macro: Macro; trigger: Record<string, unknown> }
}
"#;

async fn checker() -> (tempfile::TempDir, DenoChecker) {
    let root = tempfile::tempdir().unwrap();
    let binary = Command::new("which").arg("deno").output().await.unwrap();
    assert!(binary.status.success(), "Deno 2.9.6 must be on PATH");
    let binary = PathBuf::from(String::from_utf8(binary.stdout).unwrap().trim());
    let checker = DenoChecker::new(binary, root.path().to_owned(), 2, 64 * 1024)
        .await
        .unwrap();
    (root, checker)
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn accepts_a_program_that_uses_the_sdk_as_typed() {
    let (_root, checker) = checker().await;
    let source = r#"
export async function main({ macro, trigger }: StepContext) {
  const decision = await macro.ai.decide({ input: trigger, questions: { invoice: 'Is this an invoice?' } });
  return { invoice: (decision.probabilities.invoice ?? 0) > 0.5 };
}
"#;
    assert_eq!(checker.check(source, CONTEXT).await.unwrap(), Vec::new());
    assert_eq!(checker.sdk_fingerprint(), sdk_fingerprint());
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn reports_sdk_misuse_at_its_line_without_host_paths() {
    let (root, checker) = checker().await;
    let source = r#"export async function main({ macro }: StepContext) {
  await macro.ai.classify({ input: 'x' });
  const count: number = 'many';
  return count;
}
"#;
    let diagnostics = checker.check(source, CONTEXT).await.unwrap();
    assert_eq!(diagnostics.len(), 2, "{diagnostics:?}");
    assert!(
        diagnostics[0]
            .message
            .contains("Property 'classify' does not exist")
    );
    assert!(diagnostics[0].message.contains("at main.ts:2:"));
    assert!(diagnostics[1].message.contains("TS2322"));
    let host = root.path().to_string_lossy();
    assert!(
        diagnostics
            .iter()
            .all(|d| !d.message.contains(host.as_ref()))
    );
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn untyped_main_is_an_error() {
    let (_root, checker) = checker().await;
    let source = "export async function main({ macro }) { return macro.users; }\n";
    let diagnostics = checker.check(source, CONTEXT).await.unwrap();
    assert!(
        diagnostics
            .iter()
            .any(|d| d.message.contains("implicitly has an 'any' type")),
        "{diagnostics:?}"
    );
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn cannot_read_files_outside_the_check() {
    let (_root, checker) = checker().await;
    let outside = tempfile::tempdir().unwrap();
    let secret = outside.path().join("secret.ts");
    tokio::fs::write(&secret, "fixture secret that is not typescript @@@")
        .await
        .unwrap();
    for import in [
        format!("import '{}';", secret.display()),
        format!("import 'file://{}';", secret.display()),
        format!("/// <reference path=\"{}\" />", secret.display()),
        format!("import '../../../../../../../..{}';", secret.display()),
    ] {
        let source = format!(
            "{import}\nexport async function main({{ macro }}: StepContext) {{ return 1; }}\n"
        );
        let diagnostics = checker.check(&source, CONTEXT).await.unwrap();
        assert!(!diagnostics.is_empty(), "{import}");
        assert!(
            diagnostics
                .iter()
                .all(|d| !d.message.contains("fixture secret")),
            "{import}: {diagnostics:?}"
        );
    }
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn rejects_empty_and_oversized_source() {
    let (_root, checker) = checker().await;
    assert!(matches!(
        checker.check("  ", CONTEXT).await,
        Err(CheckError::InvalidSource)
    ));
    assert!(matches!(
        checker.check(&"x".repeat(64 * 1024 + 1), CONTEXT).await,
        Err(CheckError::InvalidSource)
    ));
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn modules_checked_together_see_each_others_types_and_report_by_file() {
    let (_root, checker) = checker().await;
    let declarations = format!("{CONTEXT}\ndeclare global {{ type StepOutput<T> = T; }}\n");
    let first = SourceFile {
        name: "step_0.ts".into(),
        source: "export async function main() { return { count: 3 }; }\n".into(),
    };
    let second = |field: &str| SourceFile {
        name: "step_1.ts".into(),
        source: format!(
            "export async function main(steps: Steps) {{ return steps.read.{field} + 1; }}\ntype Steps = {{ read: StepOutput<Awaited<ReturnType<typeof import('./step_0.ts')['main']>>> }};\n"
        ),
    };
    assert_eq!(
        checker
            .check_files(&[first.clone(), second("count")], &declarations)
            .await
            .unwrap(),
        Vec::new()
    );
    let diagnostics = checker
        .check_files(&[first, second("total")], &declarations)
        .await
        .unwrap();
    assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
    assert_eq!(diagnostics[0].file.as_deref(), Some("step_1.ts"));
    assert!(
        diagnostics[0]
            .message
            .contains("Property 'total' does not exist")
    );
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn file_names_are_plain_typescript_modules() {
    let (_root, checker) = checker().await;
    for name in ["../escape.ts", "main.js", "Main.ts", ".ts"] {
        let file = SourceFile {
            name: name.into(),
            source: "export const x = 1;".into(),
        };
        assert!(matches!(
            checker.check_files(&[file], CONTEXT).await,
            Err(CheckError::InvalidSource)
        ));
    }
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn reports_problems_in_the_declarations() {
    let (_root, checker) = checker().await;
    let declarations = format!("{CONTEXT}\ndeclare global {{ type Broken = MissingName; }}\n");
    let source = "export async function main({ macro }: StepContext) { return 1; }\n";
    let diagnostics = checker.check(source, &declarations).await.unwrap();
    assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
    assert!(
        diagnostics[0]
            .message
            .contains("Cannot find name 'MissingName'")
    );
}

/// Checks skip declaration files, so this is where the SDK's are checked
/// under the pinned Deno.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn the_sdk_declarations_type_check() {
    let (root, checker) = checker().await;
    let output = Command::new(&checker.binary)
        .env_clear()
        .env("DENO_DIR", root.path().join("cache"))
        .env("HOME", root.path())
        .env("NO_COLOR", "1")
        .current_dir(&checker.types)
        .args(["check", "--quiet", "--no-config"])
        .args(OFFLINE)
        .arg("src/macro.d.ts")
        .output()
        .await
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
