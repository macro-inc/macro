# LocalStack recipes for local AWS emulation

# Start LocalStack for local AWS emulation
start_localstack:
  docker run -d --name localstack \
    --network databases \
    -p 4566:4566 \
    -e SERVICES=sqs,dynamodb,s3 \
    localstack/localstack 2>/dev/null || true
  @echo "LocalStack started"

# Create SQS queues in LocalStack
create_local_queues:
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name notification-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name push-delivery-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-backfill-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name delete-chat-handler-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name contacts-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name convert-service-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name delete-document-handler-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name document-text-extractor-lambda-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-scheduled-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-gmail-inbox-sync-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-gmail-inbox-retry-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-refresh-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name search-event-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-sfs-delete-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-sfs-mapper-queue || true
  @echo "SQS queues created"

# Create DynamoDB tables in LocalStack
create_local_tables:
  # bulk-upload table (PK + SK with GSI)
  aws --endpoint-url=http://localhost:4566 dynamodb create-table \
    --table-name bulk-upload \
    --attribute-definitions \
      AttributeName=PK,AttributeType=S \
      AttributeName=SK,AttributeType=S \
    --key-schema \
      AttributeName=PK,KeyType=HASH \
      AttributeName=SK,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST \
    --global-secondary-indexes '[{"IndexName":"DocumentPkIndex","KeySchema":[{"AttributeName":"SK","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]' \
    || true
  # connection-gateway table (PK + SK with GSI)
  aws --endpoint-url=http://localhost:4566 dynamodb create-table \
    --table-name connection-gateway-table \
    --attribute-definitions \
      AttributeName=PK,AttributeType=S \
      AttributeName=SK,AttributeType=S \
    --key-schema \
      AttributeName=PK,KeyType=HASH \
      AttributeName=SK,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST \
    --global-secondary-indexes '[{"IndexName":"ConnectionPkIndex","KeySchema":[{"AttributeName":"SK","KeyType":"HASH"},{"AttributeName":"PK","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
    || true
  # static-file-metadata table (simple key)
  aws --endpoint-url=http://localhost:4566 dynamodb create-table \
    --table-name static-file-metadata \
    --attribute-definitions \
      AttributeName=file_id,AttributeType=S \
    --key-schema \
      AttributeName=file_id,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    || true
  @echo "DynamoDB tables created"

# Create S3 buckets in LocalStack
create_local_buckets:
  aws --endpoint-url=http://localhost:4566 s3 mb s3://macro-email-attachments || true
  aws --endpoint-url=http://localhost:4566 s3 mb s3://doc-storage || true
  aws --endpoint-url=http://localhost:4566 s3 mb s3://docx-upload || true
  aws --endpoint-url=http://localhost:4566 s3 mb s3://static-file-storage || true
  aws --endpoint-url=http://localhost:4566 s3 mb s3://bulk-upload-staging || true
  @echo "S3 buckets created"

# Full LocalStack setup
setup_localstack:
  just start_localstack
  sleep 2
  just create_local_queues
  just create_local_tables
  just create_local_buckets
