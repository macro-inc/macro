//! One small file kept beside a database, outside what a wipe removes.
//!
//! Turso never sees it. It is opened for one whole read or one checked append,
//! each with a sync handle of its own that is closed again before returning,
//! unless [`Sidecar::hold`] keeps one for all of them.

use super::{
    BusyDeadline, OpfsError, OpfsErrorKind, OwnerId, close_sync_handle, entry_error, is_not_found,
    js_error, open_sync_handle, owner_binding, remove_if_present, worker_root,
};
use std::cell::RefCell;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::{FileSystemReadWriteOptions, FileSystemSyncAccessHandle};

/// Reserved: no database identity may end with it.
pub(super) const SUFFIX: &str = "-salvage";

/// The side file of one database identity.
///
/// Every operation requires that the owner it came from still holds the
/// identity's exclusive Web Lock, in whatever phase its database is.
#[derive(Debug)]
pub struct Sidecar {
    owner: OwnerId,
    path: String,
    held: RefCell<Option<FileSystemSyncAccessHandle>>,
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        let _ = self.let_go();
    }
}

impl Sidecar {
    pub(super) fn new(owner: OwnerId, database_path: &str) -> Self {
        Self {
            owner,
            path: format!("{database_path}{SUFFIX}"),
            held: RefCell::new(None),
        }
    }

    /// Keeps the file open until this is dropped or the file removed, so that no
    /// other context can have it between two operations. Rejects when one has it
    /// now; a file that cannot be opened for another reason is left to them.
    pub async fn hold(self) -> Result<Self, OpfsError> {
        owner_binding(self.owner)?;
        match self.open(BusyDeadline::start()).await {
            Ok(handle) => *self.held.borrow_mut() = Some(handle),
            Err(error) if error.kind() == OpfsErrorKind::Busy => return Err(error),
            Err(_) => {}
        }
        Ok(self)
    }

    async fn open(&self, deadline: BusyDeadline) -> Result<FileSystemSyncAccessHandle, OpfsError> {
        if let Some(handle) = self.held.borrow().as_ref() {
            return Ok(handle.clone());
        }
        let root = worker_root()
            .await
            .map_err(|error| js_error(OpfsErrorKind::Open, "OPFS side file root", &error))?;
        let (handle, _) = open_sync_handle(&root, &self.path, deadline)
            .await
            .map_err(|error| entry_error(OpfsErrorKind::Open, "OPFS side file open", &error))?;
        Ok(handle)
    }

    /// Closes a handle no one holds, keeping an earlier failure over one of the close.
    fn close<T>(
        &self,
        handle: &FileSystemSyncAccessHandle,
        result: Result<T, OpfsError>,
    ) -> Result<T, OpfsError> {
        if self.held.borrow().is_some() {
            return result;
        }
        let closed = close_sync_handle(handle)
            .map_err(|error| js_error(OpfsErrorKind::Close, "OPFS side file close", &error));
        let value = result?;
        closed.map(|()| value)
    }

    fn let_go(&self) -> Result<(), JsValue> {
        self.held
            .borrow_mut()
            .take()
            .map_or(Ok(()), |handle| close_sync_handle(&handle))
    }

    /// Returns the whole file, empty when there is none.
    pub async fn read(&self) -> Result<Vec<u8>, OpfsError> {
        owner_binding(self.owner)?;
        let deadline = BusyDeadline::start();
        if self.held.borrow().is_none() {
            let root = worker_root()
                .await
                .map_err(|error| js_error(OpfsErrorKind::Open, "OPFS side file root", &error))?;
            match JsFuture::from(root.get_file_handle(&self.path)).await {
                Ok(_) => {}
                Err(error) if is_not_found(&error) => return Ok(Vec::new()),
                Err(error) => {
                    let failed = entry_error(OpfsErrorKind::Open, "OPFS side file open", &error);
                    return Err(failed);
                }
            }
        }
        let handle = self.open(deadline).await?;
        let read = read_all(&handle)
            .map_err(|error| js_error(OpfsErrorKind::Read, "OPFS side file read", &error));
        self.close(&handle, read)
    }

    /// Writes `bytes` at `offset`, ending the file there, and flushes it.
    /// Reports success only once the bytes are durable.
    pub async fn write_tail(&self, offset: u64, bytes: &[u8]) -> Result<(), OpfsError> {
        owner_binding(self.owner)?;
        self.write_tail_by(BusyDeadline::start(), offset, bytes)
            .await
    }

    /// Writes `bytes` over the start, ends the file behind them, and flushes it.
    /// Cut short between the two, what was there still follows `bytes`.
    pub async fn replace(&self, bytes: &[u8]) -> Result<(), OpfsError> {
        owner_binding(self.owner)?;
        let handle = self.open(BusyDeadline::start()).await?;
        let written = write_at(&handle, 0, bytes)
            .and_then(|()| handle.truncate_with_f64(bytes.len() as f64))
            .and_then(|()| handle.flush())
            .map_err(|error| js_error(OpfsErrorKind::Write, "OPFS side file write", &error));
        self.close(&handle, written)
    }

    async fn write_tail_by(
        &self,
        deadline: BusyDeadline,
        offset: u64,
        bytes: &[u8],
    ) -> Result<(), OpfsError> {
        let handle = self.open(deadline).await?;
        let written = write_tail(&handle, offset, bytes)
            .map_err(|error| js_error(OpfsErrorKind::Write, "OPFS side file write", &error));
        self.close(&handle, written)
    }

    /// Removes the file, or empties one that cannot be removed.
    pub async fn remove(&self) -> Result<(), OpfsError> {
        owner_binding(self.owner)?;
        let deadline = BusyDeadline::start();
        self.let_go()
            .map_err(|error| js_error(OpfsErrorKind::Close, "OPFS side file close", &error))?;
        let root = worker_root()
            .await
            .map_err(|error| js_error(OpfsErrorKind::Remove, "OPFS side file root", &error))?;
        match remove_if_present(&root, &self.path, false, deadline).await {
            Err(_) => self.write_tail_by(deadline, 0, &[]).await,
            removed => removed,
        }
    }
}

fn read_all(handle: &FileSystemSyncAccessHandle) -> Result<Vec<u8>, JsValue> {
    let mut bytes = vec![0; handle.get_size()? as usize];
    let mut filled = 0;
    while filled < bytes.len() {
        let options = FileSystemReadWriteOptions::new();
        options.set_at(filled as f64);
        let read = handle.read_with_u8_array_and_options(&mut bytes[filled..], &options)? as usize;
        if read == 0 {
            break;
        }
        filled += read;
    }
    bytes.truncate(filled);
    Ok(bytes)
}

fn write_tail(
    handle: &FileSystemSyncAccessHandle,
    offset: u64,
    bytes: &[u8],
) -> Result<(), JsValue> {
    handle.truncate_with_f64(offset as f64)?;
    write_at(handle, offset, bytes)?;
    handle.flush()
}

fn write_at(handle: &FileSystemSyncAccessHandle, offset: u64, bytes: &[u8]) -> Result<(), JsValue> {
    let mut written = 0;
    while written < bytes.len() {
        let options = FileSystemReadWriteOptions::new();
        options.set_at(offset as f64 + written as f64);
        let count = handle.write_with_u8_array_and_options(&bytes[written..], &options)? as usize;
        if count == 0 {
            return Err(js_sys::Error::new("short write").unchecked_into());
        }
        written += count;
    }
    Ok(())
}
