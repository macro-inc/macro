use crate::{
    OpensearchClient, Result, delete,
    retry::resend_on_lost_connection,
    upsert::{
        self, BulkUpsertResult,
        call_record::{UpsertCallRecordSegmentArgs, bulk_upsert_call_record_segments},
        properties::IndexedProperty,
    },
};

impl OpensearchClient {
    #[tracing::instrument(skip(self), err)]
    pub async fn upsert_call_record_segment(
        &self,
        args: &UpsertCallRecordSegmentArgs,
        index_override: Option<&str>,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            upsert::call_record::upsert_call_record_segment(&self.inner, args, index_override)
        })
        .await
    }

    #[tracing::instrument(skip(self, segments), err)]
    pub async fn bulk_upsert_call_record_segments(
        &self,
        segments: &[UpsertCallRecordSegmentArgs],
        index_override: Option<&str>,
    ) -> Result<BulkUpsertResult> {
        resend_on_lost_connection(|| {
            bulk_upsert_call_record_segments(&self.inner, segments, index_override)
        })
        .await
    }

    /// Refresh only the denormalized `properties` on an existing parent call doc.
    #[tracing::instrument(skip(self, properties))]
    pub async fn update_call_record_properties(
        &self,
        call_id: &str,
        properties: &[IndexedProperty],
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            upsert::call_record::update_call_record_properties(&self.inner, call_id, properties)
        })
        .await
    }

    #[tracing::instrument(skip(self))]
    pub async fn delete_call_record(
        &self,
        call_id: &str,
        index_override: Option<&str>,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            delete::call_record::delete_call_record_by_id(&self.inner, call_id, index_override)
        })
        .await
    }

    #[tracing::instrument(skip(self))]
    pub async fn delete_call_records_by_channel(
        &self,
        channel_id: &str,
        index_override: Option<&str>,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            delete::call_record::delete_call_records_by_channel_id(
                &self.inner,
                channel_id,
                index_override,
            )
        })
        .await
    }
}
