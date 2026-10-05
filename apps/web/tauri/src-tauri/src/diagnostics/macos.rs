//! macOS process memory. WebKit helpers are XPC services, not reliably children
//! of the app. Resolve their responsible app PID rather than matching all WebKit
//! processes or following PPIDs (which would include other apps / miss launchd).

use std::ffi::CStr;
use std::mem::{MaybeUninit, size_of};

use super::{FrontendStatus, MemorySample, ProcessMemory, ProcessRole};

type ResponsiblePid = unsafe extern "C" fn(libc::pid_t) -> libc::pid_t;

fn responsible_pid_api() -> Option<ResponsiblePid> {
    // This macOS SPI is optional, resolved at runtime. If it disappears, report
    // frontend coverage as unavailable; never replace it with process-name guesses.
    // Signature also used by chromium/base/process/process_info_mac.mm.
    let symbol = unsafe {
        libc::dlsym(
            libc::RTLD_DEFAULT,
            c"responsibility_get_pid_responsible_for_pid".as_ptr(),
        )
    };
    if symbol.is_null() {
        None
    } else {
        // SAFETY: the symbol has the C signature above and libSystem stays loaded.
        Some(unsafe { std::mem::transmute::<*mut libc::c_void, ResponsiblePid>(symbol) })
    }
}

fn memory(pid: u32, role: ProcessRole) -> std::io::Result<ProcessMemory> {
    let mut usage = MaybeUninit::<libc::rusage_info_v0>::zeroed();
    // SAFETY: libproc writes the v0 struct into this correctly sized/aligned buffer.
    let result = unsafe {
        libc::proc_pid_rusage(pid as i32, libc::RUSAGE_INFO_V0, usage.as_mut_ptr().cast())
    };
    if result != 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: a successful proc_pid_rusage initialized the buffer.
    let usage = unsafe { usage.assume_init() };
    Ok(ProcessMemory {
        pid,
        role,
        resident_bytes: usage.ri_resident_size,
        footprint_bytes: usage.ri_phys_footprint,
    })
}

fn process_ids() -> std::io::Result<Vec<i32>> {
    // SAFETY: null/0 asks libproc for the number of processes.
    let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    if count <= 0 {
        return Err(std::io::Error::last_os_error());
    }
    let mut pids = vec![0i32; count as usize + 128];
    // SAFETY: the writable buffer contains the advertised number of bytes.
    let count = unsafe {
        libc::proc_listallpids(
            pids.as_mut_ptr().cast(),
            (pids.len() * size_of::<i32>()) as i32,
        )
    };
    if count <= 0 {
        return Err(std::io::Error::last_os_error());
    }
    if count as usize >= pids.len() {
        return Err(std::io::Error::other(
            "process list changed during sampling",
        ));
    }
    pids.truncate(count as usize);
    Ok(pids)
}

fn webkit_role(pid: i32) -> Option<ProcessRole> {
    let mut path = [0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    // SAFETY: path is a writable byte buffer of the specified length.
    let size = unsafe { libc::proc_pidpath(pid, path.as_mut_ptr().cast(), path.len() as u32) };
    if size <= 0 {
        return None;
    }
    let path = CStr::from_bytes_until_nul(&path).ok()?.to_str().ok()?;
    role_for_path(path)
}

pub(super) fn role_for_path(path: &str) -> Option<ProcessRole> {
    let name = path.rsplit('/').next()?;
    if name == "com.apple.WebKit.WebContent" || name.starts_with("com.apple.WebKit.WebContent.") {
        Some(ProcessRole::WebContent)
    } else if name == "com.apple.WebKit.GPU" {
        Some(ProcessRole::Gpu)
    } else if name == "com.apple.WebKit.Networking" {
        Some(ProcessRole::Network)
    } else {
        None
    }
}

pub(super) fn sample(host_pid: u32) -> MemorySample {
    let mut sample = MemorySample {
        sequence: 0,
        timestamp_ms: 0,
        processes: Vec::new(),
        frontend_status: FrontendStatus::Unavailable,
        error: None,
    };
    match memory(host_pid, ProcessRole::Native) {
        Ok(memory) => sample.processes.push(memory),
        Err(error) => sample.error = Some(format!("native memory: {error}")),
    }
    let Some(responsible_pid) = responsible_pid_api() else {
        sample.error = Some("macOS process attribution unavailable".into());
        return sample;
    };
    let pids = match process_ids() {
        Ok(pids) => pids,
        Err(error) => {
            sample.error = Some(format!("process enumeration: {error}"));
            return sample;
        }
    };
    let mut failed = false;
    for pid in pids {
        if pid <= 0 || pid as u32 == host_pid {
            continue;
        }
        let Some(role) = webkit_role(pid) else {
            continue;
        };
        // SAFETY: function pointer was resolved from libSystem with its C signature.
        if unsafe { responsible_pid(pid) } != host_pid as i32 {
            continue;
        }
        match memory(pid as u32, role) {
            Ok(memory) => sample.processes.push(memory),
            Err(_) => failed = true, // Helpers may exit during enumeration.
        }
    }
    let has_frontend = sample
        .processes
        .iter()
        .any(|p| p.role == ProcessRole::WebContent);
    sample.frontend_status = match (has_frontend, failed) {
        (true, false) => FrontendStatus::Available,
        (true, true) => FrontendStatus::Partial,
        (false, _) => FrontendStatus::Unavailable,
    };
    if !has_frontend && sample.error.is_none() {
        sample.error = Some("No attributable WebContent process; launch the .app with open, not the executable from a terminal".into());
    }
    sample
}
