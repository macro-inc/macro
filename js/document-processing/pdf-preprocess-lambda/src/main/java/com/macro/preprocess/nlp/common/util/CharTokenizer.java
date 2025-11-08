package com.macro.preprocess.nlp.common.util;

import java.util.ArrayList;
import java.util.List;

public class CharTokenizer {
    private char c_delim;

    public CharTokenizer(char delim) {
        this.initDelimiter(delim);
    }

    public void initDelimiter(char delim) {
        this.c_delim = delim;
    }

    public List<String> tokenizeToList(String s) {
        return this.tokenizeToList(s, false);
    }

    public List<String> tokenizeToList(String s, boolean includeEmpty) {
        List<String> list = new ArrayList();
        int bIndex = 0;
        int len = s.length();
        char[] cs = s.toCharArray();

        for(int i = 0; i < len; ++i) {
            if (cs[i] == this.c_delim) {
                if (bIndex < i) {
                    list.add(s.substring(bIndex, i));
                } else if (includeEmpty) {
                    list.add("");
                }

                bIndex = i + 1;
            }
        }

        if (list.isEmpty()) {
            list.add(s);
            return list;
        } else {
            if (bIndex < len) {
                list.add(s.substring(bIndex));
            }

            return list;
        }
    }

    public String[] tokenize(String s, boolean includeEmpty) {
        List<String> list = this.tokenizeToList(s, includeEmpty);
        return (String[])list.toArray(new String[list.size()]);
    }

    public String[] tokenize(String s) {
        return this.tokenize(s, false);
    }
}
