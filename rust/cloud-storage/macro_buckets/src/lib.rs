macro_rules! bucket {
    (
        $(
            $(#[$attr:meta])*
            $v:vis struct $name:ident {
                local: $local:literal,
            }
        )*
    ) => {
        $(
            $(#[$attr])*
            $v struct $name;

            impl $name {
                $v const LOCAL: &'static str = $local;
            }
        )*
    };
}

bucket! {
    /// Bucket for email attachments.
    pub struct EmailAttachmentBucket {
        local: "macro-email-attachments",
    }

    /// Bucket for document storage.
    pub struct DocumentStorageBucket {
        local: "doc-storage",
    }

    /// Bucket for uploaded DOCX documents.
    pub struct DocxDocumentUploadBucket {
        local: "docx-upload",
    }

    /// Bucket for static-file-service objects.
    pub struct StaticFileStorageBucket {
        local: "static-file-storage",
    }

    /// Bucket for bulk-upload staging files.
    pub struct BulkUploadStagingBucket {
        local: "bulk-upload-staging",
    }

    /// Bucket for local call recordings.
    pub struct CallRecordingBucket {
        local: "macro-call-recording-local",
    }
}
