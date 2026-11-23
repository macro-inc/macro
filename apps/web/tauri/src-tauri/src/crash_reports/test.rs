use minidump::Minidump;
use minidump::format::{CvSignature, PlatformId, ProcessorArchitecture};
use minidump_synth::{
    AnnotationValue, CrashpadInfo, DumpString, Exception, Memory, Module as SynthModule,
    ModuleCrashpadInfo, SynthMinidump, SystemInfo, Thread, amd64_context,
};
use test_assembler::{Endian, Section};

use super::panic::parse_backtrace;
use super::scrub::{Redactions, scrub_message, short_source_path};
use super::*;

fn launch(started_at_ms: u64, version: &str) -> Launch {
    Launch {
        started_at_ms,
        native_version: version.to_string(),
        native_build_time_ms: 1,
    }
}

fn temp_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("crash-reports-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn stored_panic(timestamp_ms: u64) -> StoredPanic {
    StoredPanic {
        timestamp_ms,
        launch: launch(timestamp_ms - 10, "2026.1123.1"),
        os_version: Some("15.1.0".to_string()),
        arch: "aarch64".to_string(),
        crash: PanicCrash {
            thread: Some("main".to_string()),
            message: "boom".to_string(),
            location: Some("src/lib.rs:1:2".to_string()),
            frames: vec![],
        },
    }
}

fn scrub(message: &str) -> String {
    scrub_message(
        message,
        &Redactions::new(Some("/Users/someone".to_string())),
    )
}

#[test]
fn scrubs_values_out_of_panic_messages() {
    assert_eq!(
        scrub(
            r#"called `Result::unwrap()` on an `Err` value: Error { path: "/Users/someone/Documents/q3.pdf", kind: NotFound }"#
        ),
        r#"called `Result::unwrap()` on an `Err` value: Error { path: "…", kind: NotFound }"#
    );
    assert_eq!(
        scrub("byte index 3 is not a char boundary; it is inside 'é' (bytes 2..4) of `café crème`"),
        "byte index 3 is not a char boundary; it is inside '…' (bytes 2..4) of `…`"
    );
    assert_eq!(
        scrub("byte index 10 is out of bounds of `hunter2` or `hunter2()` or `a::b`"),
        "byte index 10 is out of bounds of `…` or `…` or `…`"
    );
    assert_eq!(
        scrub(
            "request failed: Bearer sk-test-secret, api_key=abc, id 4f9c2b7e1a8d4c6f9e2b, key Ab3dEf6hIj9kLm2nOp5q"
        ),
        "request failed: Bearer <token>, api_key=…, id <number>, key <token>"
    );
    assert_eq!(
        scrub("GET https://192.168.1.10:8443/private and http://[::1]/x failed"),
        "GET https://<ip>/… and http://<ip>/… failed"
    );
    assert_eq!(
        scrub(
            "request to https://api.example.com/v1/users?token=abc failed for someone@example.com"
        ),
        "request to https://api.example.com/… failed for <email>"
    );
    assert_eq!(
        scrub(
            "url=https://example.com/a can't open /home/other/.config/app (os error 2), order 20261123"
        ),
        "url=https://example.com/… can't open <path> (os error 2), order <number>"
    );
    assert_eq!(
        scrub("error:\n/Users/someone/x\tpath=/srv/data file:/tmp/My Documents/Tax 2025.pdf"),
        "error:\n<path>\t<path> <path> <path> 2025.pdf"
    );
    assert_eq!(
        scrub("failed to open '/tmp/a b.pdf' for someone, users' files"),
        "failed to open '…' for <user>, users' files"
    );
    assert_eq!(
        scrub("invalid password: hunter2 for api_key: sk_live_abc, Authorization:Bearer abc"),
        "invalid password: <token> for api_key: <token>, Authorization:Bearer <token>"
    );
    assert_eq!(
        scrub("connect 10.0.0.5 failed; fe80::1 at app_lib::v2::h1"),
        "connect <ip> failed; <ip> at app_lib::v2::h1"
    );
    assert_eq!(
        scrub("(«https://x/y») —http://a/b éhttp://x/y"),
        "(«https://x/…) —http://a/… éhttp://x/…"
    );
    for message in [
        "assertion failed: buffer_len_v2_remaining_count > 0",
        "assertion failed: token_count==0",
        "unexpected token at line 3",
        "called `Option::unwrap()` on a `None` value",
        "assertion `left == right` failed\n  left: 1\n right: 2",
        "attempt to add with overflow",
    ] {
        assert_eq!(scrub(message), message);
    }
    assert_eq!(
        scrub("index out of bounds: the len is 3 but the index is 5"),
        "index out of bounds: the len is 3 but the index is 5"
    );
    assert_eq!(scrub(&"x".repeat(400)).chars().count(), 301);
}

#[test]
fn shortens_build_machine_source_paths() {
    assert_eq!(
        short_source_path(
            "/Users/runner/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tokio-1.47.1/src/runtime/park.rs"
        ),
        "tokio-1.47.1/src/runtime/park.rs"
    );
    assert_eq!(
        short_source_path(
            "/Users/runner/.cargo/git/checkouts/tauri-e7cd5df5cda0389f/4b8a46f/crates/tauri/src/app.rs"
        ),
        "crates/tauri/src/app.rs"
    );
    assert_eq!(
        short_source_path("/rustc/6f72b5dd5/library/core/src/option.rs"),
        "library/core/src/option.rs"
    );
    assert_eq!(
        short_source_path("/private/tmp/build/apps/web/tauri/src-tauri/src/lib.rs"),
        "src-tauri/src/lib.rs"
    );
    assert_eq!(short_source_path("src/lib.rs"), "src/lib.rs");
}

#[test]
fn keeps_the_frames_between_the_panic_and_the_thread_entry() {
    let backtrace = "   0: app_lib::crash_reports::panic::install::{{closure}}
   1: std::panicking::panic_with_hook
   2: std::panicking::panic_handler::{{closure}}
   3: std::sys::backtrace::__rust_end_short_backtrace
   4: __rustc::rust_begin_unwind
   5: core::panicking::panic_fmt
   6: core::panicking::panic_bounds_check
   7: app_lib::diagnostics::Diagnostics::read::h0123456789abcdef
             at ./src/diagnostics.rs:12:5
   8: <tokio::runtime::task::Task<app_lib::Thing> as core::future::Future>::poll
   9: <app_lib::Worker as core::ops::Fn>::call
  10: std::panicking::catch_unwind::do_call
  11: std::sys::backtrace::__rust_begin_short_backtrace
  12: std::thread::lifecycle::spawn_unchecked::{{closure}}
  13: start_thread
";
    let frames = parse_backtrace(backtrace);
    let functions: Vec<_> = frames.iter().map(|frame| frame.function.as_str()).collect();
    assert_eq!(
        functions,
        [
            "app_lib::diagnostics::Diagnostics::read",
            "<tokio::runtime::task::Task<app_lib::Thing> as core::future::Future>::poll",
            "<app_lib::Worker as core::ops::Fn>::call",
            "std::panicking::catch_unwind::do_call",
        ]
    );
    assert_eq!(frames[0].file.as_deref(), Some("./src/diagnostics.rs"));
    assert_eq!(frames[0].line, Some(12));
    let in_app: Vec<_> = frames.iter().map(|frame| frame.in_app).collect();
    assert_eq!(in_app, [true, false, true, false]);
}

#[inline(never)]
fn panic_with_a_path() {
    let path = std::path::Path::new("/Users/someone/secret.txt");
    panic!("could not read {}", path.display());
}

#[test]
fn the_hook_records_a_real_panic() {
    let dir = temp_dir();
    let context = panic::Context {
        launch: launch(1, "2026.1123.1"),
        os_version: Some("15.1.0".to_string()),
        redactions: Redactions::default(),
    };
    panic::install(dir.clone(), context);
    let result = std::thread::Builder::new()
        .name("crash-report-test".to_string())
        .spawn(panic_with_a_path)
        .unwrap()
        .join();
    // Back to the default hook; other tests' panics may also have been recorded.
    drop(std::panic::take_hook());
    assert!(result.is_err());

    let reports = CrashReports::new(dir.clone(), None).take();
    let report = reports
        .iter()
        .find(|report| matches!(&report.crash, Crash::Panic(panic) if panic.thread.as_deref() == Some("crash-report-test")))
        .expect("the test thread's panic");
    let Crash::Panic(panic) = &report.crash else {
        unreachable!()
    };
    assert_eq!(panic.message, "could not read <path>");
    assert!(
        panic
            .location
            .as_deref()
            .unwrap()
            .contains("src/crash_reports/test.rs:")
    );
    assert_eq!(
        report.launch.as_ref().unwrap().native_version,
        "2026.1123.1"
    );
    assert!(!serde_json::to_string(report).unwrap().contains("someone"));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn reports_are_offered_once_and_deleted_when_acked() {
    let dir = temp_dir();
    for (name, timestamp) in [("panic-b", 200), ("panic-a", 100)] {
        write_atomically(
            &dir.join(format!("{name}.json")),
            &serde_json::to_vec(&stored_panic(timestamp)).unwrap(),
        )
        .unwrap();
    }
    fs::write(dir.join("panic-broken.json"), b"{").unwrap();
    fs::write(dir.join("unrelated.json"), b"{}").unwrap();

    let reports = CrashReports::new(dir.clone(), None);
    let taken = reports.take();
    let ids: Vec<_> = taken.iter().map(|report| report.id.as_str()).collect();
    assert_eq!(ids, ["panic-a", "panic-b"]);
    assert!(!dir.join("panic-broken.json").exists());
    assert!(dir.join("unrelated.json").exists());
    // A reloaded document or a second window is not handed them again.
    assert!(reports.take().is_empty());

    reports.ack(&["panic-a".to_string(), "../unrelated".to_string()]);
    assert!(!dir.join("panic-a.json").exists());
    assert!(dir.join("panic-b.json").exists());
    assert!(dir.join("unrelated.json").exists());

    // The unacked one returns on the next launch.
    let next_launch = CrashReports::new(dir.clone(), None);
    let ids: Vec<_> = next_launch
        .take()
        .into_iter()
        .map(|report| report.id)
        .collect();
    assert_eq!(ids, ["panic-b"]);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn the_launch_ledger_dates_crashes_and_keeps_the_latest() {
    let dir = temp_dir();
    for started in 1..=MAX_LAUNCHES as u64 + 2 {
        record_launch(&dir, &launch(started * 1000, &format!("v{started}"))).unwrap();
    }
    let launches = read_launches(&dir);
    assert_eq!(launches.len(), MAX_LAUNCHES);
    assert_eq!(launches[0].native_version, "v3");
    assert_eq!(launch_at(&launches, 1_000), None);
    fs::remove_dir_all(dir).unwrap();

    // Minidump times have whole seconds.
    let launches = [launch(10_500, "old"), launch(20_000, "new")];
    let version = |at| launch_at(&launches, at).map(|launch| launch.native_version);
    assert_eq!(version(15_000), Some("old".to_string()));
    assert_eq!(version(20_000), Some("new".to_string()));
    // The first launch started during this second: nothing older to confuse.
    assert_eq!(version(10_000), Some("old".to_string()));
    // The second launch started during 19_000..20_000; either could have crashed.
    let launches = [launch(10_500, "old"), launch(19_500, "new")];
    assert_eq!(launch_at(&launches, 19_000), None);
}

/// A Crashpad renderer crash in a macOS framework, like CEF writes.
fn renderer_dump() -> Vec<u8> {
    let endian = Endian::Little;
    let framework_base = 0x1_0000_0000;
    let instruction = framework_base + 0x4321;
    let context = amd64_context(endian, instruction, 0x7000_0000);
    let stack = Memory::with_section(
        Section::with_endian(endian).append_repeated(0, 0x100),
        0x7000_0000,
    );
    let thread = Thread::new(endian, 7, &stack, &context);
    let name = DumpString::new(
        "/Users/someone/Applications/Macro.app/Contents/Frameworks/Chromium Embedded Framework.framework/Versions/A/Chromium Embedded Framework",
        endian,
    );
    let cv_record = Section::with_endian(endian)
        .D32(CvSignature::Pdb70 as u32)
        .D32(0xaabbccdd)
        .D16(0xeeff)
        .D16(0x0011)
        .append_bytes(b"\x22\x33\x44\x55\x66\x77\x88\x99")
        .D32(0)
        .append_bytes(b"Chromium Embedded Framework\0");
    let module = SynthModule::new(endian, framework_base, 0x10_0000, &name, 0, 0, None)
        .cv_record(&cv_record);
    let system_info = SystemInfo::new(endian)
        .set_processor_architecture(ProcessorArchitecture::PROCESSOR_ARCHITECTURE_AMD64 as u16)
        .set_platform_id(PlatformId::MacOs as u32);
    let mut exception = Exception::new(endian);
    exception.thread_id = 7;
    // EXC_BAD_ACCESS / KERN_INVALID_ADDRESS, faulting on a data address.
    exception.exception_record.exception_code = 1;
    exception.exception_record.exception_flags = 1;
    exception.exception_record.exception_address = 0x10;
    let crashpad = CrashpadInfo::new(endian)
        .add_simple_annotation("prod", "Macro_Mac")
        .add_module(
            ModuleCrashpadInfo::new(0, endian)
                .add_annotation_object("ptype", AnnotationValue::String("renderer".to_string()))
                .add_annotation_object(
                    "url-chunk-1",
                    AnnotationValue::String("https://example.com/secret".to_string()),
                ),
        );
    SynthMinidump::with_endian(endian)
        .add_system_info(system_info)
        .add_exception(exception)
        .add_thread(thread)
        .add(context)
        .add_memory(stack)
        .add_module(module)
        .add(name)
        .add(cv_record)
        .add_crashpad_info(crashpad)
        .finish()
        .unwrap()
}

#[test]
fn a_minidump_yields_only_its_signature() {
    let dump = Minidump::read(renderer_dump()).unwrap();
    let signature = dump_signature::signature(&dump);
    assert_eq!(
        signature.crash,
        NativeCrash {
            process_type: "renderer".to_string(),
            exception: "EXC_BAD_ACCESS / KERN_INVALID_ADDRESS".to_string(),
            dumped_without_crashing: false,
            instruction_address: Some("0x100004321".to_string()),
            module: Some(CrashModule {
                name: "Chromium Embedded Framework".to_string(),
                debug_id: Some("aabbccdd-eeff-0011-2233-445566778899".to_string()),
                code_id: Some("aabbccddeeff00112233445566778899".to_string()),
                base_address: "0x100000000".to_string(),
                size: 0x10_0000,
                offset: "0x4321".to_string(),
            }),
        }
    );
    assert_eq!(signature.arch.as_deref(), Some("x86_64"));
    let serialized =
        serde_json::to_string(&signature.into_report("minidump-1".into(), &[])).unwrap();
    assert!(!serialized.contains("someone"));
    assert!(!serialized.contains("secret"));
}

#[test]
fn crashpad_dumps_are_reported_and_deleted_with_their_attachments() {
    let dir = temp_dir();
    let database = dir.join("cef");
    for sub in ["new", "pending", "completed", "attachments/aaaa"] {
        fs::create_dir_all(database.join(sub)).unwrap();
    }
    fs::write(database.join("pending/aaaa.dmp"), renderer_dump()).unwrap();
    fs::write(database.join("attachments/aaaa/log.txt"), b"attachment").unwrap();
    fs::write(database.join("completed/bbbb.dmp"), b"not a minidump").unwrap();
    // Still being written by Crashpad.
    fs::write(database.join("new/cccc.dmp"), renderer_dump()).unwrap();
    fs::write(database.join("pending/aaaa.lock"), b"").unwrap();
    record_launch(&dir, &launch(1, "2026.1123.1")).unwrap();

    let reports = CrashReports::new(dir.clone(), Some(database.clone()));
    let mut taken = reports.take();
    taken.sort_by(|a, b| a.id.cmp(&b.id));
    let ids: Vec<_> = taken.iter().map(|report| report.id.as_str()).collect();
    assert_eq!(ids, ["minidump-aaaa", "minidump-bbbb"]);
    let Crash::Native(renderer) = &taken[0].crash else {
        panic!("expected a native crash");
    };
    assert_eq!(renderer.process_type, "renderer");
    let Crash::Native(unreadable) = &taken[1].crash else {
        panic!("expected a native crash");
    };
    assert_eq!(unreadable.exception, "unreadable minidump");
    assert_eq!(
        taken[1]
            .launch
            .as_ref()
            .map(|launch| launch.native_version.as_str()),
        Some("2026.1123.1")
    );

    reports.ack(&["minidump-aaaa".to_string(), "minidump-bbbb".to_string()]);
    assert!(!database.join("pending/aaaa.dmp").exists());
    assert!(!database.join("attachments/aaaa").exists());
    assert!(!database.join("completed/bbbb.dmp").exists());
    assert!(database.join("new/cccc.dmp").exists());
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_main_thread_panic_and_its_abort_dump_are_one_report() {
    let dir = temp_dir();
    let database = dir.join("cef");
    fs::create_dir_all(database.join("pending")).unwrap();
    let endian = Endian::Little;
    // Minidump headers carry seconds; 1_000_000 s is the panic's time below.
    let dump = SynthMinidump::with_endian(endian)
        .flags(0)
        .add_crashpad_info(CrashpadInfo::new(endian).add_simple_annotation("ptype", "browser"))
        .finish()
        .unwrap();
    let mut dump = dump;
    // MINIDUMP_HEADER.time_date_stamp is at byte 20.
    dump[20..24].copy_from_slice(&1_000_000u32.to_le_bytes());
    fs::write(database.join("pending/abort.dmp"), dump).unwrap();
    write_atomically(
        &dir.join("panic-main.json"),
        &serde_json::to_vec(&stored_panic(1_000_000_000 - 200)).unwrap(),
    )
    .unwrap();

    let reports = CrashReports::new(dir.clone(), Some(database.clone()));
    let ids: Vec<_> = reports.take().into_iter().map(|report| report.id).collect();
    assert_eq!(ids, ["panic-main"]);
    reports.ack(&["panic-main".to_string()]);
    assert!(!database.join("pending/abort.dmp").exists());
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn the_browser_process_is_the_main_process() {
    let endian = Endian::Little;
    let dump = SynthMinidump::with_endian(endian)
        .add_crashpad_info(CrashpadInfo::new(endian).add_simple_annotation("ptype", "browser"))
        .finish()
        .unwrap();
    let signature = dump_signature::signature(&Minidump::read(dump).unwrap());
    assert_eq!(signature.crash.process_type, "main");
    assert_eq!(signature.crash.exception, "no exception");
    assert_eq!(signature.crash.module, None);
}

/// UPDATE_NATIVE_DIAGNOSTIC_TYPES=1 cargo test ... diagnostic_wire_types
#[test]
fn native_crash_diagnostic_wire_types() {
    let generated = specta_typescript::Typescript::default()
        .export(
            &specta::Types::default().register::<CrashReport>(),
            specta_serde::Format,
        )
        .expect("export crash report wire types");
    let generated = generated
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let output = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../src/observability/generated/native-crashes.ts");
    if std::env::var_os("UPDATE_NATIVE_DIAGNOSTIC_TYPES").is_some() {
        fs::write(&output, &generated).expect("write types");
    }
    assert_eq!(
        fs::read_to_string(output).expect("generated types"),
        generated
    );
}
