use serde::Serialize;

/// Desktop update status, also exposed to the webview.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "status", content = "data")]
pub enum Status {
    Disabled,
    Idle,
    Checking,
    Downloading { version: String },
    Ready { version: String },
    Installing,
    Error { message: String },
}

/// Owns the verified download. Taking it for installation is a one-way transition.
pub struct State<T> {
    pub status: Status,
    ready: Option<T>,
    exiting: bool,
}

impl<T> State<T> {
    pub fn new(enabled: bool) -> Self {
        Self {
            status: if enabled {
                Status::Idle
            } else {
                Status::Disabled
            },
            ready: None,
            exiting: false,
        }
    }

    pub fn begin_check(&mut self) -> bool {
        if self.exiting || !matches!(self.status, Status::Idle | Status::Error { .. }) {
            return false;
        }
        self.status = Status::Checking;
        true
    }

    pub fn downloaded(&mut self, version: String, ready: T) {
        self.ready = Some(ready);
        self.status = Status::Ready { version };
    }

    pub fn begin_install(&mut self) -> Option<T> {
        let ready = self.ready.take()?;
        self.status = Status::Installing;
        Some(ready)
    }

    pub fn is_installing(&self) -> bool {
        !self.exiting && matches!(self.status, Status::Installing)
    }

    pub fn finish_exit(&mut self) {
        self.exiting = true;
    }
}

#[cfg(test)]
mod test;
