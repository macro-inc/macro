package com.macro.preprocess.nlp.dictionary;

import com.macro.preprocess.nlp.constants.StringConst;
import com.macro.preprocess.utils.DSUtils;
import com.macro.preprocess.utils.CharUtils;
import com.macro.preprocess.utils.IOUtils;
import com.macro.preprocess.utils.Splitter;

import java.io.InputStream;
import java.util.Iterator;
import java.util.Set;

public class Currency extends Dictionary {
    private Set<String> s_currency;
    private Set<String> s_dollar;

    public Currency() {
        InputStream currency = IOUtils.getInputStreamsFromResource(ROOT + "currency.txt");
        InputStream dollar = IOUtils.getInputStreamsFromResource(ROOT + "currency-dollar.txt");
        this.init(currency, dollar);
    }

    public Currency(InputStream currency, InputStream dollar) {
        this.init(currency, dollar);
    }

    public void init(InputStream currency, InputStream dollar) {
        this.s_currency = DSUtils.createStringHashSet(currency, true, true);
        this.s_dollar = DSUtils.createStringHashSet(dollar, true, true);
        Iterator var3 = this.s_dollar.iterator();

        while(var3.hasNext()) {
            String s = (String)var3.next();
            this.s_currency.add(s + StringConst.DOLLAR);
        }

    }

    public boolean isCurrencyDollar(String lower) {
        return this.s_dollar.contains(lower);
    }

    public boolean isCurrency(String lower) {
        return this.s_currency.contains(lower);
    }

    public String[] tokenize(String original, String lower, char[] lcs) {
        int len = original.length();
        Iterator var6 = this.s_currency.iterator();

        while(var6.hasNext()) {
            String currency = (String)var6.next();
            int i;
            if (lower.startsWith(currency)) {
                i = currency.length();
                if (i < len && CharUtils.isDigit(lcs[i])) {
                    return Splitter.split(original, new int[]{i});
                }
            } else if (lower.endsWith(currency)) {
                i = len - currency.length();
                if (0 <= i - 1 && CharUtils.isDigit(lcs[i - 1])) {
                    return Splitter.split(original, new int[]{i});
                }
            }
        }

        return null;
    }
}