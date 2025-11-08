package com.macro.preprocess.component.logical.util;

/**
 * Contains utils used for definitions, references etc.
 *
 * @author Will Hutchinson
 */
public class Util {
  public static boolean isNonLetter(String str) {
    // The regular expression checks for only letter characters in the string
    String regex = "^[a-zA-Z]*$";

    // Test the string against the regular expression
    return !str.matches(regex);
  }
}
