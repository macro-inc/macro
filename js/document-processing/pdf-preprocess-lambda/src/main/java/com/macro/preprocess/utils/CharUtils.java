package com.macro.preprocess.utils;

public class CharUtils {
    private CharUtils() {
    }

    public static boolean isRange(char c, int start, int end) {
        return start <= c && c <= end;
    }

    public static boolean regionMatches(char[] source, char[] target, int sIndex) {
        if (source.length < sIndex + target.length) {
            return false;
        } else {
            int len = target.length;

            for(int i = 0; i < len; ++i) {
                if (source[sIndex + i] != target[i]) {
                    return false;
                }
            }

            return true;
        }
    }

    public static boolean toUpperCase(char[] cs) {
        boolean b = false;

        for(int i = cs.length - 1; i >= 0; --i) {
            char c = toUpperCase(cs[i]);
            if (cs[i] != c) {
                cs[i] = c;
                b = true;
            }
        }

        return b;
    }

    public static char toUpperCase(char c) {
        if (('a' > c || c > 'z') && (224 > c || c > 254 || c == 247)) {
            if (c != 154 && c != 156 && c != 158) {
                return c == 255 ? '\u009f' : c;
            } else {
                return (char)(c - 16);
            }
        } else {
            return (char)(c - 32);
        }
    }

    public static boolean toLowerCase(char[] cs) {
        boolean b = false;

        for(int i = cs.length - 1; i >= 0; --i) {
            char c = toLowerCase(cs[i]);
            if (cs[i] != c) {
                cs[i] = c;
                b = true;
            }
        }

        return b;
    }

    public static char toLowerCase(char c) {
        if (('A' > c || c > 'Z') && (192 > c || c > 222 || c == 215)) {
            if (c != 138 && c != 140 && c != 142) {
                return c == 159 ? 'ÿ' : c;
            } else {
                return (char)(c + 16);
            }
        } else {
            return (char)(c + 32);
        }
    }

    public static boolean isWhiteSpace(char c) {
        return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == 160 || c == 8232 || c == 8233;
    }

    public static boolean isAlnum(char c) {
        return isAlphabet(c) || isDigit(c);
    }

    public static boolean isAlphabet(char c) {
        return isUpperCase(c) || isLowerCase(c);
    }

    public static boolean isUpperCase(char c) {
        return isRange(c, 65, 90);
    }

    public static boolean isLowerCase(char c) {
        return isRange(c, 97, 122);
    }

    public static boolean isVowel(char c) {
        return c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u' || c == 'A' || c == 'E' || c == 'I' || c == 'O' || c == 'U';
    }

    public static boolean isConsonant(char c) {
        return isAlphabet(c) && !isVowel(c);
    }

    public static boolean containsOnlyConsonants(String s) {
        return containsOnlyConsonants(s.toCharArray());
    }

    public static boolean containsOnlyConsonants(char[] cs) {
        for(int i = cs.length - 2; i >= 0; --i) {
            if (!isConsonant(cs[i])) {
                return false;
            }
        }

        char last = cs[cs.length - 1];
        return last != 'y' && last != 'Y' && isConsonant(last);
    }

    public static boolean isPunctuation(char c) {
        return isRange(c, 33, 47) || isRange(c, 58, 64) || isRange(c, 91, 96) || isRange(c, 123, 126);
    }

    public static boolean isGeneralPunctuation(char c) {
        return isRange(c, 8192, 8303);
    }

    public static boolean isCurrency(char c) {
        return c == '$' || isRange(c, 162, 165) || isRange(c, 8352, 8399);
    }

    public static boolean isArrow(char c) {
        return isRange(c, 8592, 8703) || isRange(c, 10224, 10239) || isRange(c, 10496, 10623);
    }

    public static boolean isCJKSymbol(char c) {
        return isRange(c, 12289, 12291) || isRange(c, 12296, 12319);
    }

    public static boolean isHyphen(char c) {
        return c == '-' || isRange(c, 8208, 8212);
    }

    public static boolean isApostrophe(char c) {
        return c == '\'' || c == 8217;
    }

    public static boolean isListMark(char c) {
        return c == '-' || c == 8226 || c == 8227 || c == 8251 || c == 8259;
    }

    public static boolean isFinalMark(char c) {
        return c == '.' || c == '?' || c == '!' || c == 8252 || isRange(c, 8263, 8265);
    }

    public static boolean isSeparatorMark(char c) {
        return c == ',' || c == ';' || c == ':' || c == '|' || c == '/' || c == '\\';
    }

    public static boolean isQuotationMark(char c) {
        return isSingleQuotationMark(c) || isDoubleQuotationMark(c);
    }

    public static boolean isSingleQuotationMark(char c) {
        return c == '\'' || isRange(c, 8216, 8219);
    }

    public static boolean isDoubleQuotationMark(char c) {
        return c == '"' || isRange(c, 8220, 8223);
    }

    public static char generalizeSymbol(char c) {
        if (isCurrency(c)) {
            return '$';
        } else if (isSingleQuotationMark(c)) {
            return '\'';
        } else if (isDoubleQuotationMark(c)) {
            return '"';
        } else if (isApostrophe(c)) {
            return '\'';
        } else {
            return !isListMark(c) && !isHyphen(c) ? c : '-';
        }
    }

    public static boolean isBracket(char c) {
        return isLeftBracket(c) || isRightgBracket(c);
    }

    public static boolean isLeftBracket(char c) {
        return c == '(' || c == '{' || c == '[' || c == '<';
    }

    public static boolean isRightgBracket(char c) {
        return c == ')' || c == '}' || c == ']' || c == '>';
    }

    public static boolean isDigit(char c) {
        return '0' <= c && c <= '9';
    }

    public static boolean isPreDigitSymbol(char c) {
        return c == '.' || c == '-' || c == '+' || c == 177 || isRange(c, 8722, 8723) || isRange(c, 8730, 8732);
    }

    public static boolean containsDigitPunctuationOnly(char[] cs, int beginIndex, int endIndex) {
        for(int i = beginIndex; i < endIndex; ++i) {
            if (!isDigit(cs[i]) && !isPunctuation(cs[i])) {
                return false;
            }
        }

        return true;
    }

    public static boolean containsDigitOnly(char[] cs) {
        char[] var1 = cs;
        int var2 = cs.length;

        for(int var3 = 0; var3 < var2; ++var3) {
            char c = var1[var3];
            if (!isDigit(c)) {
                return false;
            }
        }

        return true;
    }

    public static boolean containsPunctuationOnly(char[] cs) {
        char[] var1 = cs;
        int var2 = cs.length;

        for(int var3 = 0; var3 < var2; ++var3) {
            char c = var1[var3];
            if (!isPunctuation(c)) {
                return false;
            }
        }

        return true;
    }

    public static boolean containsPunctuationOrWhiteSpacesOnly(char[] cs) {
        char[] var1 = cs;
        int var2 = cs.length;

        for(int var3 = 0; var3 < var2; ++var3) {
            char c = var1[var3];
            if (!isPunctuation(c) && !isWhiteSpace(c)) {
                return false;
            }
        }

        return true;
    }

    public static boolean containsPunctuationOrDigitsOrWhiteSpacesOnly(char[] cs) {
        char[] var1 = cs;
        int var2 = cs.length;

        for(int var3 = 0; var3 < var2; ++var3) {
            char c = var1[var3];
            if (!isPunctuation(c) && !isDigit(c) && !isWhiteSpace(c)) {
                return false;
            }
        }

        return true;
    }
}
