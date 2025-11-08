package com.macro.preprocess.parse.util;

import java.util.Arrays;
import java.util.Collection;

public class TitleCase {
	
	public static String titleCase(String str) {
		if (str == null || str.length() == 0) return "";
	    Collection<String> nonCapWords = Arrays.asList(
	    	"a",
	    	"an",
	    	"the",
	    	"and",
	    	"but",
	    	"or",
	    	"nor",
	    	"as",
	    	"at",
	    	"by",
	    	"for",
	    	"in",
	    	"of",
	    	"on",
	    	"per",
	    	"to",
	    	"via",
	    	"its"
	    );
	    // 1. Upper case first letter in each word in the string
	    String[] lowercaseWords = str.toLowerCase().split(" ");
	    for (int i = 0; i < lowercaseWords.length; i++) {
	    	String word = lowercaseWords[i];
	    	if (!nonCapWords.contains(word) || i == 0 || lowercaseWords[i - 1].equals("/")) {	    		
	    		lowercaseWords[i] = word.substring(0, 1).toUpperCase() + word.substring(1);
	    	}
	    }
	    String upperCaseImportantFirstLetters = String.join(" ", lowercaseWords);

	    // 2. Check if original string was in all caps
	    boolean isAllCapitalized = str.equals(str.toUpperCase());
	    if (isAllCapitalized) {
	      return upperCaseImportantFirstLetters;
	    }
	    
	    
	    // 3. Upper case previously upper-case letters
	    char[] upperCasedChars = upperCaseImportantFirstLetters.toCharArray();
	    for (int i = 0; i < upperCasedChars.length; i++) {
	    	char originalChar = str.charAt(i);
	    	if (originalChar == Character.toUpperCase(originalChar)) {
	    		upperCasedChars[i] = originalChar;
	    	}
	    }
	    return new String(upperCasedChars);
	}
}
