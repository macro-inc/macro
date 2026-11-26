use serde::Serialize;

/// Desktop update status, also exposed to the webview.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
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

/// What the webview is told about desktop updates.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(flatten)]
    pub status: Status,
    /// The version the previous launch failed to install. It stays set for
    /// this launch, so the webview can say so and offer to try again once the
    /// update has downloaded again.
    pub failed_install_version: Option<String>,
}

impl Snapshot {
    pub fn disabled() -> Self {
        Self {
            status: Status::Disabled,
            failed_install_version: None,
        }
    }
}

/// Owns the verified download. Taking it for installation is a one-way transition.
pub struct State<T> {
    pub status: Status,
    pub failed_install_version: Option<String>,
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
            failed_install_version: None,
            ready: None,
            exiting: false,
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            status: self.status.clone(),
            failed_install_version: self.failed_install_version.clone(),
        }
    }

    /// Starts a check. A ready update stays ready and installable while the
    /// feed is checked again, until a newer one has downloaded to replace it;
    /// otherwise an app left open would install whichever update it
    /// downloaded first, however many releases came after it.
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

    /// Records a failed check, unless a ready update or an install owns the
    /// status.
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
