package com.macro.preprocess.nlp.constants;

import java.util.regex.Pattern;

public interface PatternConst {
    Pattern COMMA = Pattern.compile(StringConst.COMMA);
    Pattern COLON = Pattern.compile(StringConst.COLON);
    Pattern HYPHEN = Pattern.compile(StringConst.HYPHEN);
    Pattern SEMICOLON = Pattern.compile(StringConst.SEMICOLON);
    Pattern UNDERSCORE = Pattern.compile(StringConst.UNDERSCORE);
    Pattern SPACE = Pattern.compile(StringConst.SPACE);
    Pattern TAB = Pattern.compile(StringConst.TAB);
    Pattern WHITESPACES = Pattern.compile("\\s+");
    Pattern PUNCT = Pattern.compile("\\p{Punct}");
    Pattern PUNCT_ONLY = Pattern.compile("^\\p{Punct}+$");
    Pattern DIGITS = Pattern.compile("\\d+");
    Pattern DIGITS_ONLY = Pattern.compile("^\\d+$");
    Pattern PUNCT_FINALS = Pattern.compile("(\\.|\\?|\\!){2,}");
    Pattern PUNCT_SEPARATORS = Pattern.compile("\\*{2,}|-{2,}|={2,}|~{2,}|,{2,}|`{2,}|'{2,}");
    Pattern NUMBER = Pattern.compile("(-|\\+|\\.)?\\d+(,\\d{3})*(\\.\\d+)?");
    Pattern HTML_TAG = Pattern.compile("&([#]?\\p{Alnum}{2,}?);", 2);
    Pattern TWITTER_HASH_TAG = Pattern.compile("^\\p{Alpha}[\\p{Alnum}_]{1,138}$");
    Pattern TWITTER_USER_ID = Pattern.compile("^\\p{Alpha}[\\p{Alnum}_]{1,19}$");
}
