use crate::{
    OpensearchClient, Result, delete,
    upsert::{
        self, BulkUpsertResult,
        call_record::{UpsertCallRecordSegmentArgs, bulk_upsert_call_record_segments},
    },
};

impl OpensearchClient {
    #[tracing::instrument(skip(self))]
    pub async fn upsert_call_record_segment(
        &self,
        args: &UpsertCallRecordSegmentArgs,
    ) -> Result<()> {
        upsert::call_record::upsert_call_record_segment(&self.inner, args).await
    }

    #[tracing::instrument(skip(self, segments))]
    pub async fn bulk_upsert_call_record_segments(
        &self,
        segments: &[UpsertCallRecordSegmentArgs],
    ) -> Result<BulkUpsertResult> {
        bulk_upsert_call_record_segments(&self.inner, segments).await
    }

    #[tracing::instrument(skip(self))]
    pub async fn delete_call_record(&self, call_id: &str) -> Result<()> {
        delete::call_record::delete_call_record_by_id(&self.inner, call_id).await
    }

    #[tracing::instrument(skip(self))]
    pub async fn delete_call_records_by_channel(&self, channel_id: &str) -> Result<()> {
        delete::call_record::delete_call_records_by_channel_id(&self.inner, channel_id).await
    }
}
