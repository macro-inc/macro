# LocalStack recipes for local AWS emulation
export AWS_PAGER := ""

# Start LocalStack for local AWS emulation
# Pinned to v4 — `latest` requires LOCALSTACK_AUTH_TOKEN for all features.
start_localstack:
  docker rm -f localstack 2>/dev/null || true
  docker run -d --name localstack \
    --network databases \
    -p 4566:4566 \
    -e SERVICES=sqs,dynamodb,s3 \
    localstack/localstack:4
  @echo "LocalStack started"
  @echo "Waiting for LocalStack to be ready..."
  @until curl -fsS http://localhost:4566/_localstack/health >/dev/null 2>&1; do sleep 1; done
  @echo "LocalStack ready"

# Create SQS queues in LocalStack
create_local_queues:
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name notification-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name notification-ingress-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name push-delivery-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-backfill-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name delete-chat-handler-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name contacts-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name convert-service-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name delete-document-handler-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name document-upload-finalizer-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name document-text-extractor-lambda-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-scheduled-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-gmail-inbox-sync-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-gmail-inbox-retry-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-gmail-ops-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-gmail-ops-retry-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-refresh-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name search-event-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-sfs-delete-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name email-service-sfs-mapper-queue || true
  aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name static-file-s3-event-notification-queue || true
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
  # Apply CORS configuration to all buckets
  for bucket in macro-email-attachments doc-storage docx-upload static-file-storage bulk-upload-staging; do \
    aws --endpoint-url=http://localhost:4566 s3api put-bucket-cors --bucket $bucket --cors-configuration '{"CORSRules":[{"AllowedOrigins":["http://localhost:3000","http://localhost:3001","http://localhost:3002","http://localhost:3003","http://localhost:3004","http://localhost:3005","http://localhost:3006","http://localhost:3007","http://localhost:3008","http://localhost:3009"],"AllowedMethods":["GET","PUT","POST","DELETE","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]}' || true; \
  done
  @echo "S3 buckets created"

# Wire document-storage ObjectCreated events to the local upload finalizer worker.
configure_document_upload_finalizer_notifications:
  #!/usr/bin/env bash
  set -euo pipefail
  queue_url="http://localhost:4566/000000000000/document-upload-finalizer-queue"
  queue_arn="arn:aws:sqs:us-east-1:000000000000:document-upload-finalizer-queue"
  policy=$(python3 - <<'PY'
  import json
  policy = {
      "Version": "2012-10-17",
      "Statement": [{
          "Effect": "Allow",
          "Principal": "*",
          "Action": "sqs:SendMessage",
          "Resource": "arn:aws:sqs:us-east-1:000000000000:document-upload-finalizer-queue",
          "Condition": {"ArnEquals": {"aws:SourceArn": "arn:aws:s3:::doc-storage"}},
      }],
  }
  print(json.dumps({"Policy": json.dumps(policy)}))
  PY
  )
  aws --endpoint-url=http://localhost:4566 sqs set-queue-attributes \
    --queue-url "$queue_url" \
    --attributes "$policy" || true
  aws --endpoint-url=http://localhost:4566 s3api put-bucket-notification-configuration \
    --bucket doc-storage \
    --notification-configuration "{\"QueueConfigurations\":[{\"Id\":\"document-upload-finalizer\",\"QueueArn\":\"$queue_arn\",\"Events\":[\"s3:ObjectCreated:*\"]}]}"
  echo "Document upload finalizer S3 notification configured"

# Full LocalStack setup
setup_localstack:
  just start_localstack
  just create_local_queues
  just create_local_tables
  just create_local_buckets
  just configure_document_upload_finalizer_notifications
