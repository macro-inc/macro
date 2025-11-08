package com.macro.preprocess;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;

public class ShaUtils {

  public static boolean validateSha(byte[] bytes, String expectedSha) throws NoSuchAlgorithmException {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");

    digest.update(bytes);

    byte[] hash = digest.digest();
    String encoded = Base64.getEncoder().encodeToString(hash);

    byte[] decodedExpectedBytes = hexStringToByteArray(expectedSha);

    String encodedExpectedSha = Base64.getEncoder().encodeToString(decodedExpectedBytes);

    return encoded.equals(encodedExpectedSha);
  }

  public static byte[] hexStringToByteArray(String hexString) {
    int len = hexString.length();
    byte[] data = new byte[len / 2];
    for (int i = 0; i < len; i += 2) {
      data[i / 2] = (byte) ((Character.digit(hexString.charAt(i), 16) << 4)
          + Character.digit(hexString.charAt(i + 1), 16));
    }
    return data;
  }
}
