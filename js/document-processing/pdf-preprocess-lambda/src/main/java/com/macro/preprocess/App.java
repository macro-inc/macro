package com.macro.preprocess;

import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.json.JSONObject;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.fasterxml.jackson.databind.ObjectMapper;

import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.core.async.AsyncResponseTransformer;
import software.amazon.awssdk.services.lambda.LambdaClient;
import software.amazon.awssdk.services.lambda.model.InvokeRequest;
import software.amazon.awssdk.services.lambda.model.InvokeResponse;
import software.amazon.awssdk.services.lambda.model.LambdaException;
import software.amazon.awssdk.services.s3.S3AsyncClient;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;

public class App implements RequestHandler<Map<String, Object>, Map<String, Object>> {
  private final LambdaClient lambdaClient;
  private final S3AsyncClient s3Client;
  private final ObjectMapper objectMapper;
  private static String webSocketResponseLambda = "";
  private static String jobId = null;
  private static String documentId = null;
  private static String jobType = "pdf_preprocess";
  private static Logger logger;

  public App() {
    lambdaClient = DependencyFactory.lambdaClient();
    s3Client = DependencyFactory.s3Client();
    objectMapper = DependencyFactory.objectMapper();
    webSocketResponseLambda = System.getenv("WEB_SOCKET_RESPONSE_LAMBDA");
  }

  public static Integer TIMEOUT_MINUTES = System.getenv("TIMEOUT_MINUTES") == null ? 14
      : Integer.parseInt(System.getenv("TIMEOUT_MINUTES"));

  @Override
  @SuppressWarnings("unchecked")
  public Map<String, Object> handleRequest(final Map<String, Object> input, final Context context) {
    logger = new Logger(context, input);
    Connection databaseConnection = null;

    // Start timeout thread
    Thread timeoutThread = new Thread(() -> {
      try {
        Thread.sleep(TIMEOUT_MINUTES * 60 * 1000);
        // If the timeout thread wasn't interrupted, it means the lambda is about to
        // timeout
        if (!Thread.currentThread().isInterrupted()) {
          logger.error("lambda execution timed out after " + TIMEOUT_MINUTES + " minutes");
          handleResponse(new Response(true, "lambda execution timed out", null));
          // Force exit to prevent lambda from continuing
          System.exit(1);
        }
      } catch (InterruptedException e) {
        // Thread was interrupted
        Thread.currentThread().interrupt();
      }
    });
    timeoutThread.setDaemon(true);
    timeoutThread.start();

    String sIncludeDocumentData = System.getenv("INCLUDE_DOCUMENT_DATA");
    boolean includeDocumentData = sIncludeDocumentData == null ? false : Boolean.parseBoolean(sIncludeDocumentData);

    boolean isS3Event = !input.containsKey("jobId");

    String key = null;
    String bucket = null;

    // Parse out the necessary fields from the input event
    if (isS3Event) {
      List<Map<String, Object>> recordsList = (List<Map<String, Object>>) input.get("Records");
      if (recordsList == null || recordsList.isEmpty()) {
        logger.error("no records found");
        timeoutThread.interrupt();
        return handleResponse(new Response(true, "no records found", null));
      }

      Map<String, Object> s3 = (Map<String, Object>) recordsList.get(0).get("s3");
      Map<String, Object> bucketObject = (Map<String, Object>) s3.get("bucket");
      Map<String, Object> s3Object = (Map<String, Object>) s3.get("object");

      bucket = bucketObject.get("name").toString();
      key = s3Object.get("key").toString();
      key = URLDecoder.decode(s3Object.get("key").toString(), StandardCharsets.UTF_8);

      String[] parts = key.split("/");
      // The key is formatted userid/documentId/{documentVersionId|converted}.pdf
      documentId = parts[1];
      try {
        databaseConnection = DatabaseUtils.databaseConnection();
        jobId = DatabaseUtils.getJobIdFromUploadJob(databaseConnection, documentId);
      } catch (Exception e) {
        logger.error("unable to get jobId from upload job " + e.getMessage());
        timeoutThread.interrupt();
        return handleResponse(new Response(true, "unable to get jobId from upload job", null));
      } finally {
        if (databaseConnection != null) {
          try {
            databaseConnection.close();
          } catch (SQLException e) {
            logger.error("error closing database connection: " + e.getMessage());
          }
        }
      }

    } else {
      bucket = input.get("bucket").toString();
      key = input.get("key").toString();
      documentId = input.get("documentId").toString();
      jobId = input.get("jobId").toString();
    }

    logger.setBucket(bucket);
    logger.setKey(key);
    logger.setDocumentId(documentId);
    logger.setJobId(jobId);

    logger.info("request initiated");

    // Validate request
    if (bucket == null || key == null || documentId == null) {
      logger.error("missing required fields");
      timeoutThread.interrupt();
      return handleResponse(new Response(true, "missing required fields", null));
    }

    try (
        InputStream fileInput = getObject(bucket, key).get();
        PDDocument document = PDDocument
            .load(fileInput);) {
      logger.info("generating preprocess data");
      String response = ProcessPDF.process(document, true /* include log times */,
          /* includeDocumentData */includeDocumentData, logger);

      logger.info("got parse response");

      // Initialize db connection only before we start using it
      databaseConnection = DatabaseUtils.databaseConnection();
      int documentProcessResultId = DatabaseUtils.insertDocumentProcessResult(databaseConnection, documentId,
          response, logger);

      // If we don't have a successful insert, we need to close the connection
      // and return an error
      if (documentProcessResultId == -1) {
        logger.error("unable to save parse response to database");
        databaseConnection.close();
        timeoutThread.interrupt();
        return handleResponse(new Response(true, "unable to save parse response to database", null));
      }

      // We only want to insert a result into JobToDocumentProcessResult if the jobId
      // is present
      if (jobId != null) {
        int result = DatabaseUtils.insertJobToDocumentProcessResult(databaseConnection, jobId,
            documentProcessResultId);

        if (result != 1) {
          logger.error("unable to save job to document process result");
          timeoutThread.interrupt();
          return handleResponse(new Response(true, "unable to save job to document process result", null));
        }
      }

      // Close the database connection
      databaseConnection.close();

    } catch (Exception e) {
      logger.error("unable to process job " + e.getMessage());
      timeoutThread.interrupt();
      return handleResponse(new Response(true, "unable to process file " + e.getMessage(), null));
    } catch (Throwable t) {
      logger.error("unable to process job " + t.getMessage());
      timeoutThread.interrupt();
      return handleResponse(new Response(true, "unable to process file " + t.getMessage(), null));
    }

    timeoutThread.interrupt();
    return handleResponse(new Response(false, "success", documentId));
  }

  /**
   * @description Since Java is amazing, if you return as an Object you get {}
   *              instead of the JSON object. If you return as a JSON string you
   *              get an unparseable
   *              string so all properties of the object are undefined. This is
   *              the only way.
   */
  @SuppressWarnings("unchecked")
  public Map<String, Object> handleResponse(Response response) {
    // If there is no jobId provided there is no point in sending a response to the
    // WS as it will not be sent anywhere
    if (jobId != null) {
      sendMessage(response);
    }

    return objectMapper.convertValue(response, Map.class);
  }

  public InvokeResponse sendMessage(Response response) {
    InvokeResponse res = null;
    try {
      JSONObject jsonObj = new JSONObject();
      jsonObj.put("jobId", jobId);
      String status = response.isError() ? "Failed" : "Completed";
      jsonObj.put("status", status);
      jsonObj.put("jobType", jobType);

      JSONObject data = new JSONObject();
      data.put("error", response.isError());
      if (!response.isError()) {
        JSONObject documentIdObj = new JSONObject();
        documentIdObj.put("documentId", documentId);
        data.put("data", documentIdObj);
      } else {
        data.put("message", response.getMessage());
      }

      jsonObj.put("data", data);

      String json = jsonObj.toString();
      SdkBytes payload = SdkBytes.fromUtf8String(json);

      // Only send to websocket if we are not running locally
      if (System.getenv("IS_LOCAL") != null && System.getenv("IS_LOCAL").toString().equals("true")) {
        logger.info("sending response to websocket " + json);
        return null;
      }
      // Invoke
      InvokeRequest request = InvokeRequest.builder()
          .functionName(webSocketResponseLambda)
          .payload(payload)
          .build();

      res = lambdaClient.invoke(request);
    } catch (LambdaException e) {
      logger.error("unable to invoke lambda function " + e.getMessage());
      System.err.println(e.getMessage());
      System.exit(1);
    }
    return res;
  }

  public CompletableFuture<InputStream> getObject(String bucketName, String key) {
    GetObjectRequest request = GetObjectRequest.builder()
        .bucket(bucketName)
        .key(key)
        .build();

    return s3Client.getObject(request, AsyncResponseTransformer.toBlockingInputStream())
        .thenApply(response -> response);
  }

  public CompletableFuture<byte[]> getObjectToBytes(String bucketName, String key) {
    GetObjectRequest request = GetObjectRequest.builder()
        .bucket(bucketName)
        .key(key)
        .build();

    return s3Client.getObject(request, AsyncResponseTransformer.toBytes())
        .thenApply(response -> response.asByteArray());
  }
}
