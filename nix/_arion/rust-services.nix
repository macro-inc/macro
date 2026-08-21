{ lib }:
{
  authentication-service = lib.rustService {
    command = [ "/app/out/authentication_service" ];
    ports = [ "8080:8080" ];
    dependsOn = [
      "postgres"
      "fusionauth"
      "redis"
    ];
    networks = {
      auth = { };
      databases = { };
      services = { };
    };
  };

  connection_gateway = lib.rustService {
    command = [ "/app/out/connection_gateway_service" ];
    ports = [ "8082:8080" ];
    dependsOn = [ "redis" ];
    aliases = [ "connection-gateway" ];
  };

  contacts_service = lib.rustService {
    command = [ "/app/out/contacts_service" ];
    ports = [ "8083:8080" ];
    aliases = [ "contacts-service" ];
  };

  document_cognition_service = lib.rustService {
    command = [ "/app/out/document_cognition_service" ];
    ports = [ "8085:8080" ];
    dependsOn = [
      "document_storage_service"
      "email_service"
      "static_file_service"
      "sync_service"
      "lexical_service"
      "ai_editing_worker"
    ];
    environment = {
      OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL = "http://document-storage-service:8080";
      OVERRIDE_AI_EDITING_WORKER_URL = "http://ai-editing-worker:8933";
      OVERRIDE_SYNC_SERVICE_URL = "http://sync-service:8787";
      OVERRIDE_LEXICAL_SERVICE_URL = "http://lexical-service:8096";
      OVERRIDE_CONNECTION_GATEWAY_URL = "http://connection-gateway:8080";
    };
    aliases = [ "document-cognition-service" ];
  };

  document_storage_service = lib.rustService {
    command = [ "/app/out/document_storage_service" ];
    ports = [ "8086:8080" ];
    dependsOn = [
      "redis"
      "connection_gateway"
      "authentication-service"
      "sync_service"
      "lexical_service"
    ];
    environment = {
      OVERRIDE_SYNC_SERVICE_URL = "http://sync-service:8787";
      OVERRIDE_LEXICAL_SERVICE_URL = "http://lexical-service:8096";
    };
    aliases = [ "document-storage-service" ];
  };

  document_upload_finalizer = lib.rustService {
    command = [ "/app/out/document_upload_finalizer_local_worker" ];
    dependsOn = [
      "postgres"
      "sync_service"
      "lexical_service"
    ];
    environment = {
      LOCAL_AWS_URL = "http://localstack:4566";
      DOCUMENT_UPLOAD_FINALIZER_QUEUE_URL = "http://localstack:4566/000000000000/document-upload-finalizer-queue";
    };
    healthcheckPath = null;
  };

  email_service = lib.rustService {
    command = [ "/app/out/email_service" ];
    ports = [ "8087:8080" ];
    dependsOn = [
      "authentication-service"
      "document_storage_service"
      "connection_gateway"
      "static_file_service"
      "redis"
    ];
    aliases = [ "email-service" ];
  };

  email_pubsub_workers = lib.rustService {
    command = [ "/app/out/pubsub_workers" ];
    dependsOn = [
      "postgres"
      "redis"
      "authentication-service"
      "document_storage_service"
      "connection_gateway"
      "static_file_service"
      "email_service"
    ];
    healthcheckPath = null;
  };

  notification_service = lib.rustService {
    command = [ "/app/out/notification_service" ];
    ports = [ "8089:8080" ];
    dependsOn = [
      "redis"
      "document_cognition_service"
      "authentication-service"
      "connection_gateway"
      "document_storage_service"
    ];
    environment = {
      LAST_ONLINE_REDIS_URI = "redis://redis:6379";
      OVERRIDE_CONNECTION_GATEWAY_URL = "http://connection-gateway:8080";
    };
    aliases = [ "notification-service" ];
  };

  search_processing_service = lib.rustService {
    command = [ "/app/out/search_processing_service" ];
    ports = [ "8092:8080" ];
    dependsOn = [
      "email_service"
      "lexical_service"
    ];
    environment = {
      OVERRIDE_LEXICAL_SERVICE_URL = "http://lexical-service:8096";
    };
    aliases = [ "search-processing-service" ];
  };

  agent_harness_service = lib.rustService {
    command = [ "/app/out/agent_harness_service" ];
    dependsOn = [
      "postgres"
      "kafka"
      "connection_gateway"
    ];
    environment = {
      OVERRIDE_CONNECTION_GATEWAY_URL = "http://connection-gateway:8080";
    };
    restart = "on-failure";
    healthcheckPath = null;
  };

  static_file_service = lib.rustService {
    command = [ "/app/out/static_file_service" ];
    ports = [ "8094:8080" ];
    aliases = [ "static-file-service" ];
    healthcheckPath = "/api/health";
  };

  unfurl_service = lib.rustService {
    command = [ "/app/out/unfurl_service" ];
    ports = [ "8095:8080" ];
    aliases = [ "unfurl-service" ];
    networks = {
      services = { };
    };
  };

  image_proxy_service = lib.rustService {
    command = [ "/app/out/image_proxy_service" ];
    ports = [ "8097:8080" ];
    aliases = [ "image-proxy-service" ];
    networks = {
      services = { };
    };
  };
}
