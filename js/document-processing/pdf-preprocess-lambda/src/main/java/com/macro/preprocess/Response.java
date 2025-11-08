package com.macro.preprocess;

import com.fasterxml.jackson.annotation.JsonProperty;

public class Response {
  @JsonProperty
  boolean error;

  @JsonProperty
  String message;

  @JsonProperty
  String data;

  public Response(boolean error, String message, String data) {
    this.error = error;
    this.message = message;
    this.data = data;
  }

  public boolean isError() {
    return error;
  }

  public String getMessage() {
    return message;
  }

  public String getData() {
    return data;
  }
}
