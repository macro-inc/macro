use crate::domain::ports::TaskSpawner;

/// Spawns detached updater tasks on Tauri's application-wide Tokio runtime.
#[derive(Debug, Clone, Copy, Default)]
pub struct TauriTaskSpawner;

impl TaskSpawner for TauriTaskSpawner {
    fn spawn(task: impl Future<Output = ()> + Send + 'static) {
        drop(tauri::async_runtime::spawn(task));
    }
}

#[cfg(test)]
mod test;
