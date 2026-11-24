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

    /// Starts a check. A ready update keeps its status while the feed is
    /// checked again, so it can still be installed meanwhile; otherwise an
    /// app left open would install whichever update it downloaded first,
    /// however many releases came after it.
    pub fn begin_check(&mut self) -> bool {
        if self.exiting {
            return false;
        }
        match self.status {
            Status::Idle | Status::Error { .. } => {
                self.status = Status::Checking;
                true
            }
            Status::Ready { .. } => true,
            _ => false,
        }
    }

    /// The version of the update ready to install, if any.
    pub fn ready_version(&self) -> Option<&str> {
        match &self.status {
            Status::Ready { version } if self.ready.is_some() => Some(version),
            _ => None,
        }
    }

    /// Drops the ready update for `next`, when the feed offers a newer one or
    /// withdraws it. Fails once an install has taken the update.
    pub fn supersede(&mut self, next: Status) -> bool {
        if self.ready_version().is_none() {
            return false;
        }
        self.ready = None;
        self.status = next;
        true
    }

    /// Records a failed check, unless the check left a ready update in place
    /// or an install has started since.
    pub fn fail(&mut self, message: String) -> bool {
        if !matches!(self.status, Status::Checking | Status::Downloading { .. }) {
            return false;
        }
        self.status = Status::Error { message };
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
