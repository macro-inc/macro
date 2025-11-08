package com.macro.preprocess.utils;

import com.macro.preprocess.nlp.constants.PatternConst;
import com.macro.preprocess.nlp.common.util.CharTokenizer;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class Splitter implements PatternConst {
    public static CharTokenizer T_UNDERSCORE = new CharTokenizer('_');
    public static CharTokenizer T_HYPHEN = new CharTokenizer('-');
    public static CharTokenizer T_SPACE = new CharTokenizer(' ');
    public static CharTokenizer T_COMMA = new CharTokenizer(',');
    public static CharTokenizer T_SEMICOLON = new CharTokenizer(';');
    public static CharTokenizer T_COLON = new CharTokenizer(':');
    public static CharTokenizer T_PLUS = new CharTokenizer('+');
    public static CharTokenizer T_PIPE = new CharTokenizer('|');
    public static CharTokenizer T_TAB = new CharTokenizer('\t');

    public Splitter() {
    }

    public static String[] split(String s, Pattern p) {
        return p.split(s);
    }

    public static String[] splitSpace(String s) {
        return T_SPACE.tokenize(s);
    }

    public static List<String> splitTabsToList(String s) {
        return T_TAB.tokenizeToList(s);
    }

    public static String[] splitTabs(String s) {
        return T_TAB.tokenize(s);
    }

    public static String[] splitUnderscore(String s) {
        return T_UNDERSCORE.tokenize(s);
    }

    public static String[] splitHyphens(String s) {
        return T_HYPHEN.tokenize(s);
    }

    public static String[] splitCommas(String s) {
        return T_COMMA.tokenize(s);
    }

    public static String[] splitCommas(String s, boolean includeEmpty) {
        return T_COMMA.tokenize(s, includeEmpty);
    }

    public static String[] splitSemiColons(String s) {
        return T_SEMICOLON.tokenize(s);
    }

    public static String[] splitColons(String s) {
        return T_COLON.tokenize(s);
    }

    public static String[] splitPlus(String s) {
        return T_PLUS.tokenize(s);
    }

    public static String[] splitPipes(String s) {
        return T_PIPE.tokenize(s);
    }

    public static List<String> splitIncludingMatches(Pattern p, String s) {
        ArrayList<String> list = new ArrayList();
        Matcher m = p.matcher(s);
        int last = 0;

        while(m.find()) {
            int curr = m.start();
            if (last < curr) {
                list.add(s.substring(last, curr));
            }

            last = m.end();
            list.add(m.group());
        }

        if (last < s.length()) {
            list.add(s.substring(last));
        }

        list.trimToSize();
        return list;
    }

    public static String[] split(String s, int... splitIndices) {
        int len = splitIndices.length;
        String[] t = new String[len + 1];
        int beginIndex = 0;

        int i;
        for(i = 0; i < len; ++i) {
            t[i] = s.substring(beginIndex, splitIndices[i]);
            beginIndex = splitIndices[i];
        }

        t[i] = s.substring(beginIndex);
        return t;
    }
}
