//! A Windows Job Object holding the ACP child and everything it spawns: the
//! Windows counterpart of the Unix process group. Terminating the job reaches
//! the real agent behind a wrapper launcher (`npx.cmd`, `uvx`), and closing its
//! last handle kills whatever is left, so even a crashed daemon leaves no
//! orphans.
//!
//! The child is assigned right after it starts, so a process it spawns before
//! that moment escapes the job. Wrapper launchers take far longer than that to
//! start the agent.

use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle, RawHandle};

use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_BASIC_LIMIT_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
};

pub(super) struct Job(OwnedHandle);

impl Job {
    /// A kill-on-close job containing `process`.
    pub(super) fn containing(process: RawHandle) -> std::io::Result<Self> {
        // SAFETY: both pointers may be null: no security attributes, no name.
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: `handle` is a fresh job handle that nothing else owns.
        let job = Self(unsafe { OwnedHandle::from_raw_handle(handle) });

        let limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
            BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION {
                LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                ..Default::default()
            },
            ..Default::default()
        };
        // SAFETY: `limits` is the struct this information class names, and
        // the length passed is its size.
        let set = unsafe {
            SetInformationJobObject(
                job.0.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&limits).cast(),
                u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>())
                    .map_err(std::io::Error::other)?,
            )
        };
        if set == 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: both handles are live: the job is owned here, and the
        // caller holds the child whose handle `process` is.
        if unsafe { AssignProcessToJobObject(job.0.as_raw_handle(), process) } == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(job)
    }

    /// Kill every process in the job. Failure means they are already gone.
    pub(super) fn terminate(&self) {
        // SAFETY: the job handle is owned by `self` and still open.
        let _terminated = unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) };
    }
}
