package com.macro.preprocess.utils;

import com.macro.preprocess.nlp.collection.tuple.Pair;
import com.macro.preprocess.nlp.constants.PatternConst;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class PatternUtils implements PatternConst {
    private static final List<Pair<Pattern, String>> L_BRACKETS = new ArrayList<Pair<Pattern, String>>(6) {
        {
            this.add(new Pair(Pattern.compile("-LRB-"), "("));
            this.add(new Pair(Pattern.compile("-RRB-"), ")"));
            this.add(new Pair(Pattern.compile("-LSB-"), "["));
            this.add(new Pair(Pattern.compile("-RSB-"), "]"));
            this.add(new Pair(Pattern.compile("-LCB-"), "{"));
            this.add(new Pair(Pattern.compile("-RCB-"), "}"));
        }
    };

    public PatternUtils() {
    }

    public static Pattern createClosedPattern(String regex) {
        return Pattern.compile("^(" + regex + ")$");
    }

    public static Pattern createClosedORPattern(String... regex) {
        return createClosedPattern(createORString(regex));
    }

    public static Pattern createORPattern(String... regex) {
        return Pattern.compile(createORString(regex));
    }

    public static String createORString(String... regex) {
        StringBuilder build = new StringBuilder();
        String[] var2 = regex;
        int var3 = regex.length;

        for(int var4 = 0; var4 < var3; ++var4) {
            String r = var2[var4];
            build.append("|");
            build.append(r);
        }

        return build.substring(1);
    }

    public static String getGroup(Pattern pattern, String str, int index) {
        Matcher m = pattern.matcher(str);
        return m.find() ? m.group(index) : null;
    }

    public static boolean containsPunctuation(String s) {
        return PUNCT.matcher(s).find();
    }

    public static String revertBrackets(String form) {
        Pair p;
        for(Iterator var1 = L_BRACKETS.iterator(); var1.hasNext(); form = ((Pattern)p.o1).matcher(form).replaceAll((String)p.o2)) {
            p = (Pair)var1.next();
        }

        return form;
    }

    public static String replaceAll(Pattern p, String s, String replacement) {
        Matcher m = p.matcher(s);
        return m.replaceAll(replacement);
    }
}