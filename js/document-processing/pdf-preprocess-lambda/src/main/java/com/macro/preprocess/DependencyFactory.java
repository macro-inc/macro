
package com.macro.preprocess;

import com.fasterxml.jackson.databind.ObjectMapper;

import software.amazon.awssdk.auth.credentials.EnvironmentVariableCredentialsProvider;
import software.amazon.awssdk.http.crt.AwsCrtAsyncHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3AsyncClient;
import software.amazon.awssdk.services.lambda.LambdaClient;

/**
 * The module containing all dependencies required by the {@link App}.
 */
public class DependencyFactory {

  private DependencyFactory() {
  }

  /**
   * @return an instance of S3AsyncClient
   */
  public static S3AsyncClient s3Client() {
    return S3AsyncClient.builder()
        .credentialsProvider(EnvironmentVariableCredentialsProvider.create())
        .region(Region.US_EAST_1)
        .httpClientBuilder(AwsCrtAsyncHttpClient.builder())
        .build();
  }

  public static LambdaClient lambdaClient() {
    return LambdaClient.builder()
        .region(Region.US_EAST_1)
        .build();
  }


  /**
   * @return an instance of ObjectMapper
   */
  public static ObjectMapper objectMapper() {
    return new ObjectMapper();
  }
}
