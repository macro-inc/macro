use lexical_conformance::{fixture::Fixture, ledger::Ledger, replay::Replayer};
use libtest_mimic::{Arguments, Trial};
use serde_json::json;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};
#[derive(Default)]
struct Counts {
    pass: usize,
    fail: usize,
    ledger: usize,
}
fn main() {
    let report_coverage = std::env::args().any(|arg| arg == "--report-coverage");
    let args = Arguments::from_iter(std::env::args().filter(|arg| arg != "--report-coverage"));
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../packages/lexical-conformance/fixtures/upstream");
    let ledger: Ledger =
        serde_json::from_str(include_str!("../ledger.json")).expect("ledger schema");
    let mut cases = Vec::new();
    for package in std::fs::read_dir(&root).expect("fixture directory") {
        let package = package.expect("package");
        if !package.path().is_dir() {
            continue;
        }
        for file in std::fs::read_dir(package.path()).expect("package directory") {
            let path = file.expect("fixture").path();
            if path.extension().is_none_or(|ext| ext != "json") {
                continue;
            }
            let fixture: Fixture =
                serde_json::from_str(&std::fs::read_to_string(&path).expect("fixture bytes"))
                    .expect("schema 2");
            cases.push((
                package.file_name().to_string_lossy().into_owned(),
                path,
                fixture,
            ));
        }
    }
    ledger
        .validate(&cases.iter().map(|(_, _, f)| f.clone()).collect::<Vec<_>>())
        .expect("valid ledger");
    let counts = Arc::new(Mutex::new(BTreeMap::<String, Counts>::new()));
    let blocked = Arc::new(Mutex::new(BTreeMap::<String, usize>::new()));
    let outcomes = Arc::new(Mutex::new(BTreeMap::new()));
    let mut trials = Vec::new();
    for (package, path, fixture) in cases {
        let id = path
            .file_stem()
            .expect("fixture file stem")
            .to_string_lossy();
        let name = format!(
            "upstream::{package}::{}::{}",
            id.escape_debug(),
            fixture.source.test.join(" > ").escape_debug()
        );
        let expected = ledger.entry(&fixture).cloned();
        let strict = ledger.strict_packages.contains(&package);
        let counts = counts.clone();
        let blocked = blocked.clone();
        let outcomes = outcomes.clone();
        let fixture_file = format!(
            "upstream/{}",
            path.strip_prefix(&root).expect("fixture path").display()
        );
        trials.push(Trial::test(name, move || {
            let mut replayer = Replayer::default();
            replayer.strict_keys = strict;
            let result = replayer.replay(&fixture);
            let status = match (&result, &expected) {
                (Ok(()), None) => "pass",
                (Err(error), Some(entry)) if entry.matches_failure(error) => "ledger",
                _ => "fail",
            };
            outcomes.lock().expect("outcomes lock").insert(
                fixture_file,
                json!({
                    "status": status,
                    "error": result.as_ref().err().map(ToString::to_string),
                }),
            );
            let mut all = counts.lock().expect("count lock");
            let totals = all.entry(package).or_default();
            match (result, expected) {
                (Ok(()), None) => {
                    totals.pass += 1;
                    Ok(())
                }
                (Err(error), Some(expected)) if expected.matches_failure(&error) => {
                    totals.ledger += 1;
                    *blocked
                        .lock()
                        .expect("coverage lock")
                        .entry(expected.failure)
                        .or_default() += 1;
                    Ok(())
                }
                (Ok(()), Some(_)) => {
                    totals.fail += 1;
                    Err("stale ledger: unexpected pass; remove the entry".into())
                }
                (Err(error), _) => {
                    totals.fail += 1;
                    Err(format!("{}: {error}", path.display()).into())
                }
            }
        }));
    }
    trials.sort_by(|a, b| a.name().cmp(b.name()));
    let conclusion = libtest_mimic::run(&args, trials);
    if args.list {
        conclusion.exit();
    }
    let counts = counts.lock().expect("counts");
    let report = counts
        .iter()
        .map(|(package, c)| {
            (
                package.clone(),
                json!({"pass":c.pass,"fail":c.fail,"ledger":c.ledger}),
            )
        })
        .collect::<serde_json::Map<_, _>>();
    println!("\nPackage                        pass  fail  ledger");
    for (package, c) in counts.iter() {
        println!("{package:30} {:4}  {:4}  {:6}", c.pass, c.fail, c.ledger);
    }
    if report_coverage {
        for (api, count) in blocked.lock().expect("coverage").iter() {
            println!("{count:4} {api}");
        }
    }
    let output =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../target/lexical-conformance");
    std::fs::create_dir_all(&output).expect("report directory");
    std::fs::write(
        output.join("results.json"),
        serde_json::to_vec_pretty(&report).expect("report JSON"),
    )
    .expect("report bytes");
    std::fs::write(
        output.join("cases.json"),
        serde_json::to_vec_pretty(&*outcomes.lock().expect("outcomes lock")).expect("case JSON"),
    )
    .expect("case report bytes");
    conclusion.exit();
}
