package com.macro.preprocess.nlp.dictionary;

import com.macro.preprocess.utils.CharUtils;
import com.macro.preprocess.utils.DSUtils;
import com.macro.preprocess.utils.IOUtils;

import java.io.InputStream;
import java.util.Arrays;
import java.util.Set;

public class EnglishHyphen {
    private Set<String> s_prefix;
    private Set<String> s_suffix;

    public EnglishHyphen() {
        InputStream prefix = IOUtils.getInputStreamsFromResource(Dictionary.ROOT + "english-hyphen-prefix.txt");
        InputStream suffix = IOUtils.getInputStreamsFromResource(Dictionary.ROOT + "english-hyphen-suffix.txt");
        this.init(prefix, suffix);
    }

    public EnglishHyphen(InputStream prefix, InputStream suffix) {
        this.init(prefix, suffix);
    }

    public void init(InputStream prefix, InputStream suffix) {
        this.s_prefix = DSUtils.createStringHashSet(prefix, true, true);
        this.s_suffix = DSUtils.createStringHashSet(suffix, true, true);
    }

    public boolean isPrefix(String lower) {
        return this.s_prefix.contains(lower);
    }

    public boolean isSuffix(String lower) {
        return this.s_suffix.contains(lower);
    }

    public boolean preserveHyphen(char[] cs, int index) {
        if (CharUtils.isHyphen(cs[index]) && (index + 1 == cs.length || CharUtils.isAlphabet(cs[index + 1]))) {
            int len = cs.length;
            char[] tmp;
            if (index > 0) {
                tmp = Arrays.copyOfRange(cs, 0, index);
                CharUtils.toLowerCase(tmp);
                if (this.isPrefix(new String(tmp))) {
                    return true;
                }
            }

            if (index + 1 < len) {
                tmp = Arrays.copyOfRange(cs, index + 1, len);
                CharUtils.toLowerCase(tmp);
                if (this.isSuffix(new String(tmp))) {
                    return true;
                }
            }

            if (index + 2 < len && CharUtils.isVowel(cs[index + 1]) && CharUtils.isHyphen(cs[index + 2])) {
                return true;
            }

            if (0 <= index - 2 && CharUtils.isVowel(cs[index - 1]) && CharUtils.isHyphen(cs[index - 2])) {
                return true;
            }
        }

        return false;
    }
}