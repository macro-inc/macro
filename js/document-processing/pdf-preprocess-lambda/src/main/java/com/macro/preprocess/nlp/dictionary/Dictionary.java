package com.macro.preprocess.nlp.dictionary;

import com.macro.preprocess.utils.CharUtils;

public abstract class Dictionary {
    public static String ROOT = "dictionary/";

    public Dictionary() {
    }

    public String[] tokenize(String s) {
        char[] lcs = s.toCharArray();
        String lower = CharUtils.toLowerCase(lcs) ? new String(lcs) : s;
        return this.tokenize(s, lower, lcs);
    }

    public abstract String[] tokenize(String var1, String var2, char[] var3);
}
