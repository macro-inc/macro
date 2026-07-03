#![deny(missing_docs)]

//! Macro queue name values with per-environment defaults and environment
//! variable overrides.
//!
//! Use [`queue!`] to define a newtype whose default value is selected from
//! [`macro_env::Environment`]. The generated type also checks an override
//! environment variable derived from the type name. For example,
//! `EmailScheduledQueue` checks `OVERRIDE_EMAIL_SCHEDULED_QUEUE` before falling
//! back to its `local`, `dev`, or `prod` default.
//!
//! Queue values are opaque strings (SQS queue names or, in some cases, full
//! queue URLs); this crate does not parse or validate them.

use std::{borrow::Cow, fmt, ops::Deref};

#[doc(hidden)]
pub use macro_env;
#[doc(hidden)]
pub use paste;
#[doc(hidden)]
pub use serde;

#[cfg(test)]
mod test;

#[cfg(test)]
mod testing_harness {
    use std::cell::Cell;

    type MockValue = Cell<Option<Box<dyn Fn(&'static str) -> Result<String, std::env::VarError>>>>;

    thread_local! {
        static MOCK_VAR_GETTER: MockValue = const { Cell::new(None) };
    }

    struct ResetMockEnv;

    impl Drop for ResetMockEnv {
        fn drop(&mut self) {
            MOCK_VAR_GETTER.replace(None);
        }
    }

    #[doc(hidden)]
    #[allow(
        clippy::disallowed_methods,
        reason = "Test harness fallback used when no mock override is set"
    )]
    pub fn read_override_env(var_name: &'static str) -> Option<String> {
        let cur_getter = MOCK_VAR_GETTER.replace(None);
        match cur_getter {
            Some(mock) => {
                let out = mock(var_name);
                MOCK_VAR_GETTER.replace(Some(mock));
                out
            }
            None => std::env::var(var_name),
        }
        .ok()
    }

    pub(crate) fn with_mock_override_env<F, Cb, U>(f: F, cb: Cb) -> U
    where
        F: Fn(&'static str) -> Result<String, std::env::VarError> + 'static,
        Cb: FnOnce() -> U,
    {
        MOCK_VAR_GETTER.replace(Some(Box::new(f)));
        let _guard = ResetMockEnv;
        cb()
    }
}

#[cfg(test)]
#[doc(hidden)]
pub use testing_harness::read_override_env;

/// Read an override environment variable for a queue. Returns `None` if the
/// variable is unset or cannot be read.
#[cfg(not(test))]
#[doc(hidden)]
#[allow(
    clippy::disallowed_methods,
    reason = "Used when running locally to override queues"
)]
pub fn read_override_env(var_name: &'static str) -> Option<String> {
    std::env::var(var_name).ok()
}

/// A queue name string that can either borrow an existing string slice or own
/// a runtime override value.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Queue<'a>(Cow<'a, str>);

impl<'a> Queue<'a> {
    /// Create a queue that borrows a string slice.
    pub const fn borrowed(queue: &'a str) -> Self {
        Self(Cow::Borrowed(queue))
    }

    /// Create a queue that owns a runtime string.
    pub fn owned(queue: impl Into<String>) -> Queue<'static> {
        Queue(Cow::Owned(queue.into()))
    }

    /// Return the queue name as a string slice.
    pub fn as_str(&self) -> &str {
        self.0.as_ref()
    }

    /// Return a cheaply copied borrowed view of this queue.
    pub fn copied(&self) -> Queue<'_> {
        Queue(Cow::Borrowed(self.as_str()))
    }

    /// Convert this queue into an owned `'static` value.
    pub fn into_owned(self) -> Queue<'static> {
        Queue(Cow::Owned(self.0.into_owned()))
    }

    /// Convert this queue into its internal [`Cow`].
    pub fn into_cow(self) -> Cow<'a, str> {
        self.0
    }

    /// Return the borrowed string if this queue is currently borrowed.
    pub fn borrowed_inner(&self) -> Option<&'a str> {
        match &self.0 {
            Cow::Borrowed(queue) => Some(*queue),
            Cow::Owned(_) => None,
        }
    }

    /// Return the owned string if this queue is currently owned.
    pub fn owned_inner(&self) -> Option<&String> {
        match &self.0 {
            Cow::Borrowed(_) => None,
            Cow::Owned(queue) => Some(queue),
        }
    }
}

impl<'a> From<&'a str> for Queue<'a> {
    fn from(value: &'a str) -> Self {
        Self::borrowed(value)
    }
}

impl From<String> for Queue<'static> {
    fn from(value: String) -> Self {
        Self(Cow::Owned(value))
    }
}

impl<'a> From<Cow<'a, str>> for Queue<'a> {
    fn from(value: Cow<'a, str>) -> Self {
        Self(value)
    }
}

impl<'a> From<Queue<'a>> for String {
    fn from(value: Queue<'a>) -> Self {
        value.0.into_owned()
    }
}

impl<'a> Deref for Queue<'a> {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        self.as_str()
    }
}

impl<'a> AsRef<str> for Queue<'a> {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl<'a> fmt::Display for Queue<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Define typed queue name values with per-environment defaults and override
/// environment variables.
///
/// The override environment variable name is derived from the struct name:
/// `EmailScheduledQueue` checks `OVERRIDE_EMAIL_SCHEDULED_QUEUE`. If that
/// override is not set, [`macro_env::Environment`] selects one of the provided
/// `local`, `dev`, or `prod` defaults.
///
/// # Example
///
/// ```
/// macro_queues::queue! {
///     #[derive(Debug, Clone)]
///     pub struct ExampleQueue {
///         local: "example-queue",
///         dev: "example-queue-dev",
///         prod: "example-queue-prod",
///     }
/// }
///
/// let queue = ExampleQueue::new();
/// assert_eq!(queue.override_env_var_name(), "OVERRIDE_EXAMPLE_QUEUE");
/// ```
#[macro_export]
macro_rules! queue {
    (
        $(#[$attr:meta])*
        $v:vis struct $n:ident {
            local: $local:literal,
            dev: $dev:literal,
            prod: $prod:literal $(,)?
        }
    ) => {
        $crate::paste::paste! {
            #[doc = "Typed queue name loaded from `OVERRIDE_" $n:snake:upper "` or selected from per-environment defaults."]
            $(#[$attr])*
            $v struct $n($crate::Queue<'static>);

            impl $n {
                #[doc = "Override environment variable checked before falling back to per-environment defaults."]
                $v const OVERRIDE_ENV_VAR_NAME: &'static str = concat!("OVERRIDE_", stringify!([<$n:snake:upper>]));

                #[doc = "Default queue name for [`macro_env::Environment::Local`]."]
                $v const LOCAL: &'static str = $local;

                #[doc = "Default queue name for [`macro_env::Environment::Develop`]."]
                $v const DEV: &'static str = $dev;

                #[doc = "Default queue name for [`macro_env::Environment::Production`]."]
                $v const PROD: &'static str = $prod;

                #[doc = "Create a new instance of [`Self`], using the override env var if set and otherwise selecting a default from [`macro_env::Environment::new_or_prod`]."]
                #[allow(dead_code, clippy::new_without_default)]
                $v fn new() -> Self {
                    Self::new_for_environment($crate::macro_env::Environment::new_or_prod())
                }

                #[doc = "Create a new instance of [`Self`] for a specific environment, using the override env var if set."]
                #[allow(dead_code)]
                $v fn new_for_environment(environment: $crate::macro_env::Environment) -> Self {
                    if let Some(value) = $crate::read_override_env(Self::OVERRIDE_ENV_VAR_NAME) {
                        return Self($crate::Queue::owned(value));
                    }

                    Self::default_for_environment(environment)
                }

                #[doc = "Create a new instance of [`Self`] for a specific environment without checking the override env var."]
                #[allow(dead_code)]
                $v const fn default_for_environment(environment: $crate::macro_env::Environment) -> Self {
                    match environment {
                        $crate::macro_env::Environment::Local => Self::from_static(Self::LOCAL),
                        $crate::macro_env::Environment::Develop => Self::from_static(Self::DEV),
                        $crate::macro_env::Environment::Production => Self::from_static(Self::PROD),
                    }
                }

                #[doc = "Create a new instance of [`Self`] from the local default queue name."]
                #[allow(dead_code)]
                $v const fn local() -> Self {
                    Self::from_static(Self::LOCAL)
                }

                #[doc = "Create a new instance of [`Self`] from the dev default queue name."]
                #[allow(dead_code)]
                $v const fn dev() -> Self {
                    Self::from_static(Self::DEV)
                }

                #[doc = "Create a new instance of [`Self`] from the prod default queue name."]
                #[allow(dead_code)]
                $v const fn prod() -> Self {
                    Self::from_static(Self::PROD)
                }

                #[doc = "Create a new instance of [`Self`] from a static queue name."]
                #[allow(dead_code)]
                $v const fn from_static(queue: &'static str) -> Self {
                    Self($crate::Queue::borrowed(queue))
                }

                #[doc = "Create a new instance of [`Self`] from an owned runtime queue name."]
                #[allow(dead_code)]
                $v fn from_owned(queue: impl Into<String>) -> Self {
                    Self($crate::Queue::owned(queue))
                }

                #[doc = "Return the override environment variable name checked by [`Self::new`]."]
                #[allow(dead_code)]
                $v const fn override_env_var_name(&self) -> &'static str {
                    Self::OVERRIDE_ENV_VAR_NAME
                }

                #[doc = "Return the contained [`Queue`]."]
                #[allow(dead_code)]
                $v fn into_inner(self) -> $crate::Queue<'static> {
                    self.0
                }

                #[doc = "Return a reference to the contained [`Queue`]."]
                #[allow(dead_code)]
                $v fn inner(&self) -> &$crate::Queue<'static> {
                    &self.0
                }

                #[doc = "Return the queue name as a string slice."]
                #[allow(dead_code)]
                $v fn as_str(&self) -> &str {
                    self.0.as_str()
                }

                #[doc = "Return a cheaply copied borrowed view of this queue."]
                #[allow(dead_code)]
                $v fn copied(&self) -> $crate::Queue<'_> {
                    self.0.copied()
                }
            }

            impl std::ops::Deref for $n {
                type Target = str;

                fn deref(&self) -> &Self::Target {
                    self.as_str()
                }
            }

            impl std::convert::AsRef<str> for $n {
                fn as_ref(&self) -> &str {
                    self.as_str()
                }
            }

            impl std::fmt::Display for $n {
                fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                    f.write_str(self.as_str())
                }
            }

            impl std::convert::From<$crate::Queue<'static>> for $n {
                fn from(value: $crate::Queue<'static>) -> Self {
                    Self(value)
                }
            }

            impl std::convert::From<$n> for $crate::Queue<'static> {
                fn from(value: $n) -> Self {
                    value.0
                }
            }

            impl std::convert::From<String> for $n {
                fn from(value: String) -> Self {
                    Self::from_owned(value)
                }
            }

            impl std::convert::From<&'static str> for $n {
                fn from(value: &'static str) -> Self {
                    Self::from_static(value)
                }
            }

            impl<'de> $crate::serde::Deserialize<'de> for $n {
                fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
                where
                    D: $crate::serde::Deserializer<'de>,
                {
                    let value = <String as $crate::serde::Deserialize>::deserialize(deserializer)?;
                    Ok(Self($crate::Queue::owned(value)))
                }
            }
        }
    };
    (
        $(#[$attr:meta])*
        $v:vis struct $n:ident {
            $(
                $(#[$field_attr:meta])*
                $field_vis:vis $field_name:ident {
                    local: $field_local:literal,
                    dev: $field_dev:literal,
                    prod: $field_prod:literal $(,)?
                }
            ),* $(,)?
        }
    ) => {
        $crate::paste::paste! {
            $(
                $crate::queue!(
                    $(#[$field_attr])*
                    $field_vis struct $field_name {
                        local: $field_local,
                        dev: $field_dev,
                        prod: $field_prod,
                    }
                );
            )*

            #[doc = "A collection of typed queues."]
            $(#[$attr])*
            $v struct $n {
                $(
                    #[doc = "Typed queue loaded from `OVERRIDE_" $field_name:snake:upper "` or selected from per-environment defaults."]
                    $field_vis [<$field_name:snake>]: $field_name,
                )*
            }

            impl $n {
                #[doc = "Create a new instance of [`Self`] with all queues resolved for the current macro environment."]
                #[allow(dead_code, clippy::new_without_default)]
                $v fn new() -> Self {
                    let environment = $crate::macro_env::Environment::new_or_prod();
                    Self::new_for_environment(environment)
                }

                #[doc = "Create a new instance of [`Self`] with all queues resolved for a specific environment."]
                #[allow(dead_code)]
                $v fn new_for_environment(environment: $crate::macro_env::Environment) -> Self {
                    Self {
                        $(
                            [<$field_name:snake>]: $field_name::new_for_environment(environment),
                        )*
                    }
                }

                #[doc = "Create a new instance of [`Self`] with all queues set to environment defaults without checking overrides."]
                #[allow(dead_code)]
                $v const fn default_for_environment(environment: $crate::macro_env::Environment) -> Self {
                    Self {
                        $(
                            [<$field_name:snake>]: $field_name::default_for_environment(environment),
                        )*
                    }
                }
            }
        }
    };
}

queue! {
    /// Common SQS queues used by Macro services.
    ///
    /// Default values mirror what infrastructure provisions: `local` uses the
    /// bare queue names seen in `docker-compose.local-e2e.yml`, while `dev` and
    /// `prod` use the `{base}-queue-{stack}` names provisioned by Pulumi.
    pub struct Queues {
        /// Queue for document text extraction jobs.
        pub DocumentTextExtractorQueue {
            local: "document-text-extractor-lambda-queue",
            dev: "document-text-extractor-lambda-queue-dev",
            prod: "document-text-extractor-lambda-queue-prod",
        },
        /// Queue for chat delete jobs.
        pub ChatDeleteQueue {
            local: "delete-chat-handler-queue",
            dev: "delete-chat-handler-queue-dev",
            prod: "delete-chat-handler-queue-prod",
        },
        /// Queue for scheduled email sends.
        pub EmailScheduledQueue {
            local: "email-service-scheduled-queue",
            dev: "email-service-scheduled-queue-dev",
            prod: "email-service-scheduled-queue-prod",
        },
        /// Queue for async Gmail label/sync operations.
        pub GmailOpsQueue {
            local: "email-service-gmail-ops-queue",
            dev: "email-service-gmail-ops-queue-dev",
            prod: "email-service-gmail-ops-queue-prod",
        },
        /// Queue for retrying rate-limited Gmail operations.
        pub GmailOpsRetryQueue {
            local: "email-service-gmail-ops-retry-queue",
            dev: "email-service-gmail-ops-retry-queue-dev",
            prod: "email-service-gmail-ops-retry-queue-prod",
        },
        /// Queue for egress notification delivery.
        pub NotificationQueue {
            local: "notification-queue",
            dev: "notification-queue-dev",
            prod: "notification-queue-prod",
        },
        /// Queue for ingress notification creation.
        pub NotificationIngressQueue {
            local: "notification-ingress-queue",
            dev: "notification-ingress-queue-dev",
            prod: "notification-ingress-queue-prod",
        },
        /// Queue for search index events.
        pub SearchEventQueue {
            local: "search-event-queue",
            dev: "search-event-queue-dev",
            prod: "search-event-queue-prod",
        },
        /// Queue for AI projection materialization jobs.
        pub AiProjectionQueue {
            local: "ai-projection-queue",
            dev: "ai-projection-queue-dev",
            prod: "ai-projection-queue-prod",
        },
        /// Queue for document conversion jobs.
        pub ConvertQueue {
            local: "convert-service-queue",
            dev: "convert-service-queue-dev",
            prod: "convert-service-queue-prod",
        },
        /// Queue for document delete jobs.
        pub DocumentDeleteQueue {
            local: "delete-document-handler-queue",
            dev: "delete-document-handler-queue-dev",
            prod: "delete-document-handler-queue-prod",
        },
        /// Queue for static-file-service deletion messages.
        pub SfsDeleteQueue {
            local: "email-sfs-delete-queue",
            dev: "email-sfs-delete-queue-dev",
            prod: "email-sfs-delete-queue-prod",
        },
        /// Queue for static-file-service uploader jobs.
        pub SfsUploaderQueue {
            local: "email-service-sfs-mapper-queue",
            dev: "email-service-sfs-mapper-queue-dev",
            prod: "email-service-sfs-mapper-queue-prod",
        },
        /// Queue for the contacts service.
        pub ContactsQueue {
            local: "contacts-queue",
            dev: "contacts-queue-dev",
            prod: "contacts-queue-prod",
        },
        /// Queue for push notification delivery events.
        pub PushNotificationEventHandlerQueue {
            local: "push-delivery-queue",
            dev: "push-delivery-queue-dev",
            prod: "push-delivery-queue-prod",
        },
        /// Queue for static-file-service S3 upload event notifications.
        ///
        /// Note: this value is consumed as a full SQS URL in deployed
        /// environments (`queueQueue.url`), not a bare name. The bare name is
        /// baked here for consistency; see `queue-migration.md` for how the
        /// static-file-service migration must resolve the name to a URL.
        pub StaticFileServiceS3EventQueueUrl {
            local: "static-file-s3-event-notification-queue",
            dev: "static-file-s3-event-notification-queue-dev",
            prod: "static-file-s3-event-notification-queue-prod",
        },
        /// Queue for the email link manager / refresh handler.
        pub LinkManagerQueue {
            local: "email-service-refresh-queue",
            dev: "email-service-refresh-queue-dev",
            prod: "email-service-refresh-queue-prod",
        },
        /// Queue for Gmail inbox update processing.
        ///
        /// Note: the local queue name uses the `gmail-inbox-sync` base while
        /// dev/prod derive from the `gmail-webhook` base. This divergence is
        /// intentional and matches the existing infrastructure.
        pub GmailInboxSyncQueue {
            local: "email-service-gmail-inbox-sync-queue",
            dev: "email-service-gmail-webhook-queue-dev",
            prod: "email-service-gmail-webhook-queue-prod",
        },
        /// Queue for Gmail inbox update retries.
        ///
        /// Note: the local queue name uses the `gmail-inbox-retry` base while
        /// dev/prod derive from the `gmail-webhook-retry` base. This divergence
        /// is intentional and matches the existing infrastructure.
        pub GmailInboxSyncRetryQueue {
            local: "email-service-gmail-inbox-retry-queue",
            dev: "email-service-gmail-webhook-retry-queue-dev",
            prod: "email-service-gmail-webhook-retry-queue-prod",
        },
        /// Queue for the email backfill process (authentication_service
        /// `EMAIL_BACKFILL_QUEUE` and email_service `BACKFILL_QUEUE`).
        pub EmailBackfillQueue {
            local: "email-service-backfill-queue",
            dev: "email-service-backfill-queue-dev",
            prod: "email-service-backfill-queue-prod",
        },
        /// Queue for the bulk upload extractor lambda
        /// (upload_extractor_lambda_trigger `UPLOAD_EXTRACTOR_QUEUE`).
        pub UploadExtractorQueue {
            local: "bulk-upload-queue",
            dev: "bulk-upload-queue-dev",
            prod: "bulk-upload-queue-prod",
        },
        /// Queue for document upload finalization events.
        pub DocumentUploadFinalizerQueue {
            local: "document-upload-finalizer-queue",
            dev: "document-upload-finalizer-queue-dev",
            prod: "document-upload-finalizer-queue-prod",
        },
        /// Queue for the organization retention handler
        /// (organization_retention_trigger `ORGANIZATION_RETENTION_QUEUE`).
        pub OrganizationRetentionQueue {
            local: "organization-retention-handler-queue",
            dev: "organization-retention-handler-queue-dev",
            prod: "organization-retention-handler-queue-prod",
        },
    }
}
