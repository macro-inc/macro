//! The signature of a Crashpad minidump. The dump holds the crashed process's
//! stacks and memory; only the fields read here leave the machine.

use std::ops::Deref;
use std::path::Path;

use minidump::{
    Minidump, MinidumpAnnotation, MinidumpCrashpadInfo, MinidumpException, MinidumpMiscInfo,
    MinidumpModuleList, MinidumpSystemInfo, MinidumpThreadList, Module,
};

use super::{Crash, CrashModule, CrashReport, Launch, NativeCrash, launch_at};

/// What a report needs from one dump.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Dump {
    pub timestamp_ms: u64,
    pub os_version: Option<String>,
    pub arch: Option<String>,
    pub crash: NativeCrash,
}

impl Dump {
    /// A dump that could not be parsed still counts as a crash.
    pub fn unreadable(timestamp_ms: u64) -> Self {
        Self {
            timestamp_ms,
            os_version: None,
            arch: None,
            crash: NativeCrash {
                process_type: "unknown".to_string(),
                exception: "unreadable minidump".to_string(),
                dumped_without_crashing: false,
                instruction_address: None,
                module: None,
            },
        }
    }

    pub fn into_report(self, id: String, launches: &[Launch]) -> CrashReport {
        CrashReport {
            id,
            launch: launch_at(launches, self.timestamp_ms),
            timestamp_ms: self.timestamp_ms,
            os: std::env::consts::OS.to_string(),
            os_version: self.os_version,
            arch: self.arch,
            crash: Crash::Native(self.crash),
        }
    }
}

pub(super) fn read(path: &Path) -> Result<Dump, minidump::Error> {
    Ok(signature(&Minidump::read_path(path)?))
}

pub(super) fn signature<'a, T>(dump: &'a Minidump<'a, T>) -> Dump
where
    T: Deref<Target = [u8]> + 'a,
{
    let system = dump.get_stream::<MinidumpSystemInfo>().ok();
    let misc = dump.get_stream::<MinidumpMiscInfo>().ok();
    let exception = dump.get_stream::<MinidumpException>().ok();
    let modules = dump.get_stream::<MinidumpModuleList>().ok();
    let crashpad = dump.get_stream::<MinidumpCrashpadInfo>().ok();
    let annotation = |key: &str| crashpad.as_ref().and_then(|info| annotation(info, key));

    let exception_name = match (&exception, &system) {
        (Some(exception), Some(system)) => exception
            .get_crash_reason(system.os, system.cpu)
            .to_string(),
        (Some(exception), None) => format!("{:#x}", exception.raw.exception_record.exception_code),
        (None, _) => "no exception".to_string(),
    };
    // The exception's own context is where the fault happened; the thread's
    // can already be inside the handler.
    let instruction = system.as_ref().and_then(|system| {
        let exception = exception.as_ref()?;
        exception
            .context(system, misc.as_ref())
            .map(|context| context.get_instruction_pointer())
            .or_else(|| {
                let threads = dump.get_stream::<MinidumpThreadList>().ok()?;
                let thread = threads.get_thread(exception.get_crashing_thread_id())?;
                let context = thread.context(system, misc.as_ref())?;
                Some(context.get_instruction_pointer())
            })
    });
    let module = instruction.and_then(|address| {
        let module = modules.as_ref()?.module_at_address(address)?;
        let path = module.code_file();
        Some(CrashModule {
            name: path
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or_default()
                .to_string(),
            debug_id: module.debug_identifier().map(|id| id.to_string()),
            code_id: module.code_identifier().map(|id| id.to_string()),
            base_address: format!("{:#x}", module.base_address()),
            size: module.size(),
            offset: format!("{:#x}", address - module.base_address()),
        })
    });
    let process_type = match annotation("ptype").as_deref() {
        None | Some("") | Some("browser") => "main".to_string(),
        Some(other) => other.to_string(),
    };

    Dump {
        timestamp_ms: u64::from(dump.header.time_date_stamp) * 1000,
        os_version: system.as_ref().map(|system| match system.os_parts() {
            (version, Some(build)) => format!("{version} ({build})"),
            (version, None) => version,
        }),
        arch: system.as_ref().map(|system| {
            match system.cpu.to_string().as_str() {
                // Match `std::env::consts::ARCH`, which panics report.
                "amd64" => "x86_64".to_string(),
                "arm64" => "aarch64".to_string(),
                other => other.to_string(),
            }
        }),
        crash: NativeCrash {
            process_type,
            exception: exception_name,
            dumped_without_crashing: annotation("is-dump-process-without-crashing").is_some(),
            instruction_address: instruction.map(|address| format!("{address:#x}")),
            module,
        },
    }
}

/// A Crashpad annotation: process-wide, or a crash key of any module.
fn annotation(info: &MinidumpCrashpadInfo, key: &str) -> Option<String> {
    if let Some(value) = info.simple_annotations.get(key) {
        return Some(value.clone());
    }
    info.module_list.iter().find_map(|module| {
        module.simple_annotations.get(key).cloned().or_else(|| {
            match module.annotation_objects.get(key)? {
                MinidumpAnnotation::String(value) => Some(value.clone()),
                _ => None,
            }
        })
    })
}
