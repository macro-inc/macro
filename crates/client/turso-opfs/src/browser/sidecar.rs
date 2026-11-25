//! One small file kept beside a database, outside what a wipe removes.
//!
//! Turso never sees it. It is opened for one whole read or one checked append,
//! each with a sync handle of its own that is closed again before returning.

use super::{
    BusyDeadline, OpfsError, OpfsErrorKind, OwnerId, close_sync_handle, entry_error, is_not_found,
    js_error, open_sync_handle, owner_binding, remove_if_present, worker_root,
};
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::{FileSystemReadWriteOptions, FileSystemSyncAccessHandle};

/// Reserved: no database identity may end with it.
pub(super) const SUFFIX: &str = "-salvage";

/// The side file of one database identity.
///
/// Every operation requires that the owner it came from still holds the
/// identity's exclusive Web Lock, in whatever phase its database is.
#[derive(Clone, Debug)]
pub struct Sidecar {
    owner: OwnerId,
    path: String,
}

impl Sidecar {
    pub(super) fn new(owner: OwnerId, database_path: &str) -> Self {
        Self {
            owner,
            path: format!("{database_path}{SUFFIX}"),
        }
    }

    /// Returns the whole file, empty when there is none.
    pub async fn read(&self) -> Result<Vec<u8>, OpfsError> {
        owner_binding(self.owner)?;
        let deadline = BusyDeadline::start();
        let root = worker_root()
            .await
            .map_err(|error| js_error(OpfsErrorKind::Open, "OPFS side file root", &error))?;
        let file = match JsFuture::from(root.get_file_handle(&self.path)).await {
            Ok(_) => open_sync_handle(&root, &self.path, deadline).await,
            Err(error) if is_not_found(&error) => return Ok(Vec::new()),
            Err(error) => Err(error),
        };
        let (handle, _) =
            file.map_err(|error| entry_error(OpfsErrorKind::Open, "OPFS side file open", &error))?;
        let read = read_all(&handle)
            .map_err(|error| js_error(OpfsErrorKind::Read, "OPFS side file read", &error));
        close(&handle, read)
    }

    /// Writes `bytes` at `offset`, ending the file there, and flushes it.
    /// Reports success only once the bytes are durable.
    pub async fn write_tail(&self, offset: u64, bytes: &[u8]) -> Result<(), OpfsError> {
        owner_binding(self.owner)?;
        self.write_tail_by(BusyDeadline::start(), offset, bytes)
            .await
    }

    /// Writes `bytes` over the start, ends the file behind them, and flushes it.
    /// Cut short, the file starts with all of `bytes` or with what was there.
    pub async fn replace(&self, bytes: &[u8]) -> Result<(), OpfsError> {
        owner_binding(self.owner)?;
        let root = worker_root()
            .await
            .map_err(|error| js_error(OpfsErrorKind::Open, "OPFS side file root", &error))?;
        let (handle, _) = open_sync_handle(&root, &self.path, BusyDeadline::start())
            .await
            .map_err(|error| entry_error(OpfsErrorKind::Open, "OPFS side file open", &error))?;
        let written = write_at(&handle, 0, bytes)
            .and_then(|()| handle.truncate_with_f64(bytes.len() as f64))
            .and_then(|()| handle.flush())
            .map_err(|error| js_error(OpfsErrorKind::Write, "OPFS side file write", &error));
        close(&handle, written)
    }

    async fn write_tail_by(
        &self,
        deadline: BusyDeadline,
        offset: u64,
        bytes: &[u8],
    ) -> Result<(), OpfsError> {
        let root = worker_root()
            .await
            .map_err(|error| js_error(OpfsErrorKind::Open, "OPFS side file root", &error))?;
        let (handle, _) = open_sync_handle(&root, &self.path, deadline)
            .await
            .map_err(|error| entry_error(OpfsErrorKind::Open, "OPFS side file open", &error))?;
        let written = write_tail(&handle, offset, bytes)
            .map_err(|error| js_error(OpfsErrorKind::Write, "OPFS side file write", &error));
        close(&handle, written)
    }

    /// Removes the file, or empties one that cannot be removed.
    pub async fn remove(&self) -> Result<(), OpfsError> {
        owner_binding(self.owner)?;
        let deadline = BusyDeadline::start();
        let root = worker_root()
            .await
            .map_err(|error| js_error(OpfsErrorKind::Remove, "OPFS side file root", &error))?;
        match remove_if_present(&root, &self.path, false, deadline).await {
            Err(_) => self.write_tail_by(deadline, 0, &[]).await,
            removed => removed,
        }
    }
}

/// Closes `handle`, keeping an earlier failure over one of the close.
fn close<T>(
    handle: &FileSystemSyncAccessHandle,
    result: Result<T, OpfsError>,
) -> Result<T, OpfsError> {
    let closed = close_sync_handle(handle)
        .map_err(|error| js_error(OpfsErrorKind::Close, "OPFS side file close", &error));
    let value = result?;
    closed.map(|()| value)
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
