package com.macro.preprocess.nlp.dictionary;

import com.macro.preprocess.utils.CharUtils;
import com.macro.preprocess.utils.Splitter;

public class EnglishApostrophe extends Dictionary {
    private final String[] APOSTROPHE_SUFFIXES = new String[]{"d", "m", "s", "t", "z", "ll", "nt", "re", "ve"};

    public EnglishApostrophe() {
    }

    public String[] tokenize(String original, String lower, char[] lcs) {
        String[] var5 = this.APOSTROPHE_SUFFIXES;
        int var6 = var5.length;

        for(int var7 = 0; var7 < var6; ++var7) {
            String suffix = var5[var7];
            int i = this.isApostropheSuffix(lower, lcs, suffix);
            if (i > 0) {
                return Splitter.split(original, new int[]{i});
            }
        }

        return null;
    }

    private int isApostropheSuffix(String lower, char[] lcs, String suffix) {
        if (lower.endsWith(suffix)) {
            int i;
            if (suffix.equals("t")) {
                i = lower.length() - suffix.length() - 2;
                if (0 < i && lcs[i] == 'n' && CharUtils.isApostrophe(lcs[i + 1])) {
                    return i;
                }
            } else {
                i = lower.length() - suffix.length() - 1;
                if (0 < i && CharUtils.isApostrophe(lcs[i])) {
                    return suffix.equals("s") && CharUtils.isDigit(lcs[i - 1]) ? -1 : i;
                }
            }
        }

        return -1;
    }
}