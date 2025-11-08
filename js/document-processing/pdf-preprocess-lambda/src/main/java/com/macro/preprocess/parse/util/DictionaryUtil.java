package com.macro.preprocess.parse.util;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;


public class DictionaryUtil {
  public static Set<String> words = new HashSet<String>();
  // ./util/words_alpha.txt copied and modified from https://github.com/dwyl/english-words

  public DictionaryUtil(String fileName) throws IOException {
    populateDictionary(fileName);
  }

  public static void populateDictionary(String fileName) throws IOException {
    if (DictionaryUtil.words.size() == 0) {
      // String fileName = Server.LIB_PATH+"/words_alpha.txt";
      Path filePath = Paths.get(fileName);
      List<String> lines = Files.readAllLines(filePath);
      DictionaryUtil.words.addAll(lines);
    }
  }
}