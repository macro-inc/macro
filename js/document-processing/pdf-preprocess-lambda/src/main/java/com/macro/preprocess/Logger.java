package com.macro.preprocess;

import java.util.Map;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.LambdaLogger;

public class Logger {

  private final LambdaLogger logger;
  private final Map<String, Object> event;
  private String jobId;
  private String documentId;
  private String key;
  private String bucket;

  public Logger(Context context, Map<String, Object> event) {
    this.logger = context.getLogger();
    this.event = event;
    // TODO: use the event to populate fields
  }

  public void setJobId(String jobId) {
    this.jobId = jobId;
  }

  public void setDocumentId(String documentId) {
    this.documentId = documentId;
  }

  public void setKey(String key) {
    this.key = key;
  }

  public void setBucket(String bucket) {
    this.bucket = bucket;
  }

  public void log(String message, String level) {
    String logMessage = String.format(
        "{\"level\": \"%s\", \"document_id\": \"%s\", job_id: \"%s\", \"key\": \"%s\", bucket: \"%s\", \"job_type\": \"pdf_preprocess\", \"message\": \"%s\"}\n",
        level, this.documentId, this.jobId, this.key, this.bucket, message);
    logger.log(logMessage);
  }

  public void info(String message) {
    log(message, "INFO");
  }

  public void error(String message) {
    log(message, "ERROR");
  }

}
