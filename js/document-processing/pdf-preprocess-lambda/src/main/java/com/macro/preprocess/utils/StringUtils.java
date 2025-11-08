package com.macro.preprocess.utils;

import com.macro.preprocess.nlp.constants.StringConst;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

public class StringUtils {
    private StringUtils() {
    }

    public static int getLCSLength(String[] x, String[] y) {
        int M = x.length;
        int N = y.length;
        int[][] counts = new int[M + 1][N + 1];

        for(int i = 1; i <= M; ++i) {
            for(int j = 1; j <= N; ++j) {
                counts[i][j] = x[i - 1].equals(y[j - 1]) ? counts[i - 1][j - 1] + 1 : Math.max(counts[i][j - 1], counts[i - 1][j]);
            }
        }

        return counts[M][N];
    }

    public static String removeAll(String original, char remove) {
        char[] cs = original.toCharArray();
        char[] ns = new char[cs.length];
        int i = 0;

        int j;
        for(j = 0; i < cs.length; ++i) {
            if (cs[i] != remove) {
                ns[j++] = cs[i];
            }
        }

        return i == j ? original : new String(ns, 0, j);
    }

    public static String spaces(int length) {
        StringBuilder build = new StringBuilder();

        for(int i = 0; i < length; ++i) {
            build.append(StringConst.SPACE);
        }

        return build.toString();
    }

    public static boolean startsWithAny(String str, String... suffixes) {
        String[] var2 = suffixes;
        int var3 = suffixes.length;

        for(int var4 = 0; var4 < var3; ++var4) {
            String suffix = var2[var4];
            if (str.startsWith(suffix)) {
                return true;
            }
        }

        return false;
    }

    public static boolean endsWithAny(String str, String... suffixes) {
        String[] var2 = suffixes;
        int var3 = suffixes.length;

        for(int var4 = 0; var4 < var3; ++var4) {
            String suffix = var2[var4];
            if (str.endsWith(suffix)) {
                return true;
            }
        }

        return false;
    }

    public static String trim(String s, int trimSize) {
        return s.substring(0, s.length() - trimSize);
    }

    public static String toUpperCase(String s) {
        if (s == null) {
            return null;
        } else {
            char[] array = s.toCharArray();
            boolean b = CharUtils.toUpperCase(array);
            return b ? new String(array) : s;
        }
    }

    public static String toLowerCase(String s) {
        if (s == null) {
            return null;
        } else {
            char[] array = s.toCharArray();
            boolean b = CharUtils.toLowerCase(array);
            return b ? new String(array) : s;
        }
    }

    public static String[] toUpperCase(String[] source) {
        int size = source.length;
        String[] target = new String[size];

        for(int i = 0; i < size; ++i) {
            target[i] = toUpperCase(source[i]);
        }

        return target;
    }

    public static String[] toLowerCase(String[] source) {
        int size = source.length;
        String[] target = new String[size];

        for(int i = 0; i < size; ++i) {
            target[i] = toLowerCase(source[i]);
        }

        return target;
    }

    public static String toSimplifiedForm(String s, boolean uncapitalize) {
        if (!MetaUtils.endsWithFileExtension(s) && !MetaUtils.containsHyperlink(s)) {
            s = generalizeSymbols(s);
            s = collapseDigits(s);
            s = collapsePunctuation(s);
            if (uncapitalize) {
                s = toLowerCase(s);
            }

            return s;
        } else {
            return "#hlink#";
        }
    }

    public static String generalizeSymbols(String s) {
        char[] cs = s.toCharArray();

        for(int i = 0; i < cs.length; ++i) {
            cs[i] = CharUtils.generalizeSymbol(cs[i]);
        }

        return new String(cs);
    }

    public static String toSimplifiedForm(String s) {
        return toSimplifiedForm(s, false);
    }

    public static String toUndigitalizedForm(String s) {
        return toUndigitalizedForm(s, false);
    }

    public static String toUndigitalizedForm(String s, boolean uncapitalize) {
        char[] cs = s.toCharArray();
        boolean b = false;

        for(int i = 0; i < cs.length; ++i) {
            if ('0' <= cs[i] && cs[i] <= '9') {
                cs[i] = '0';
                b = true;
            } else if (uncapitalize) {
                cs[i] = CharUtils.toLowerCase(cs[i]);
            }
        }

        return !b && !uncapitalize ? s : new String(cs);
    }

    /** @deprecated */
    @Deprecated
    public static String toLowerCaseSimplifiedForm(String s) {
        return toLowerCase(toSimplifiedForm(s));
    }

    public static String collapseDigits(String s) {
        StringBuilder build = new StringBuilder();
        char[] cs = s.toCharArray();
        int size = cs.length;
        char prev = 0;

        for(int i = 0; i < size; ++i) {
            i = collapseDigitsAux(cs, i);
            char curr = cs[i];
            if (curr == '%') {
                if (CharUtils.isDigit(prev)) {
                    continue;
                }
            } else {
                int j;
                if ((CharUtils.isPreDigitSymbol(curr) || curr == ',' || curr == ':' || curr == '/' || curr == '=') && i + 1 < size && CharUtils.isDigit(cs[j = collapseDigitsAux(cs, i + 1)])) {
                    if (i == 0) {
                        i = j;
                        curr = cs[j];
                    } else if (CharUtils.isDigit(prev)) {
                        i = j;
                        continue;
                    }
                }
            }

            if (CharUtils.isDigit(curr)) {
                if (!CharUtils.isDigit(prev)) {
                    build.append('0');
                }
            } else {
                build.append(curr);
            }

            prev = curr;
        }

        return build.toString();
    }

    private static int collapseDigitsAux(char[] cs, int index) {
        char curr = cs[index];
        return (curr == '$' || curr == '#') && index + 1 < cs.length && CharUtils.isDigit(cs[index + 1]) ? index + 1 : index;
    }

    public static String collapsePunctuation(String s) {
        StringBuilder build = new StringBuilder();
        char[] cs = s.toCharArray();
        int size = cs.length;

        for(int i = 0; i < size; ++i) {
            if (i <= 1 || !CharUtils.isPunctuation(cs[i]) || cs[i] != cs[i - 1] || cs[i] != cs[i - 2]) {
                build.append(cs[i]);
            }
        }

        return build.length() < size ? build.toString() : s;
    }

    public static List<String> stripPunctuation(List<String> tokens) {
        List<String> list = new ArrayList();
        Iterator var2 = tokens.iterator();

        while(var2.hasNext()) {
            String token = (String)var2.next();
            if (!containsPunctuationOnly(token)) {
                list.add(token);
            }
        }

        return list;
    }

    public static List<String> stripPunctuation(String[] tokens) {
        List<String> list = new ArrayList();
        String[] var2 = tokens;
        int var3 = tokens.length;

        for(int var4 = 0; var4 < var3; ++var4) {
            String token = var2[var4];
            if (!containsPunctuationOnly(token)) {
                list.add(token);
            }
        }

        return list;
    }

    public static boolean containsUpperCaseOnly(String s) {
        char[] cs = s.toCharArray();
        int size = cs.length;

        for(int i = 0; i < size; ++i) {
            if (!CharUtils.isUpperCase(cs[i])) {
                return false;
            }
        }

        return true;
    }

    public static boolean containsLowerCaseOnly(String s) {
        char[] cs = s.toCharArray();
        int size = cs.length;

        for(int i = 0; i < size; ++i) {
            if (!CharUtils.isLowerCase(cs[i])) {
                return false;
            }
        }

        return true;
    }

    public static boolean containsDigit(String s) {
        char[] cs = s.toCharArray();
        int size = cs.length;

        for(int i = 0; i < size; ++i) {
            if (CharUtils.isDigit(cs[i])) {
                return true;
            }
        }

        return false;
    }

    public static boolean containsDigitOnly(String s) {
        return CharUtils.containsDigitOnly(s.toCharArray());
    }

    public static boolean containsPunctuation(String s) {
        char[] cs = s.toCharArray();
        int size = cs.length;

        for(int i = 0; i < size; ++i) {
            if (CharUtils.isPunctuation(cs[i])) {
                return true;
            }
        }

        return false;
    }

    public static boolean containsPunctuationOnly(String s) {
        return CharUtils.containsPunctuationOnly(s.toCharArray());
    }

    public static boolean containsPunctuationOrWhiteSpacesOnly(String s) {
        return CharUtils.containsPunctuationOrWhiteSpacesOnly(s.toCharArray());
    }

    public static boolean containsPunctuationOrDigitsOrWhiteSpacesOnly(String s) {
        return CharUtils.containsPunctuationOrDigitsOrWhiteSpacesOnly(s.toCharArray());
    }

    public static boolean isDouble(String s) {
        char[] var1 = s.toCharArray();
        int var2 = var1.length;

        for(int var3 = 0; var3 < var2; ++var3) {
            char c = var1[var3];
            if (!Character.isDigit(c) && c != '.' && c != '-' && c != '+') {
                return false;
            }
        }

        return true;
    }

    public static String[] getPrefixes(String form, int n) {
        int length = form.length() - 1;
        if (length < n) {
            n = length;
        }

        String[] prefixes = new String[n];

        for(int i = 0; i < n; ++i) {
            prefixes[i] = form.substring(0, i + 1);
        }

        return prefixes;
    }

    public static String[] getSuffixes(String form, int n) {
        int length = form.length() - 1;
        if (length < n) {
            n = length;
        }

        String[] suffixes = new String[n];

        for(int i = 0; i < n; ++i) {
            suffixes[i] = form.substring(length - i);
        }

        return suffixes;
    }

    public static String getShape(String form, int maxRepetitions) {
        if (form == null) {
            return null;
        } else {
            StringBuilder build = new StringBuilder();
            char prev = 0;
            char[] cs = form.toCharArray();
            int len = cs.length;
            int repetition = 0;

            for(int i = 0; i < len; ++i) {
                char curr = cs[i];
                if (CharUtils.isUpperCase(curr)) {
                    curr = 'A';
                } else if (CharUtils.isLowerCase(curr)) {
                    curr = 'a';
                } else if (CharUtils.isDigit(curr)) {
                    curr = '1';
                } else if (CharUtils.isPunctuation(curr)) {
                    curr = '.';
                } else {
                    curr = 'x';
                }

                if (curr == prev) {
                    ++repetition;
                } else {
                    prev = (char) curr;
                    repetition = 0;
                }

                if (repetition < maxRepetitions) {
                    build.append(curr);
                }
            }

            return build.toString();
        }
    }
}
