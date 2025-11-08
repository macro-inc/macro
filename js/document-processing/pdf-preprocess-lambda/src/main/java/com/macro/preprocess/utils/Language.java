package com.macro.preprocess.utils;

public enum Language {
    ARABIC,
    CHINESE,
    ENGLISH,
    HINDI,
    KOREAN;

    private Language() {
    }

    public static Language getType(String s) {
        return valueOf(StringUtils.toUpperCase(s));
    }
}