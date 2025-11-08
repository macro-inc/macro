package com.macro.preprocess.nlp.dictionary;

import com.macro.preprocess.utils.DSUtils;
import com.macro.preprocess.utils.IOUtils;

import java.io.InputStream;
import java.util.Set;

public class Abbreviation {
    private Set<String> s_period;

    public Abbreviation() {
        String filename = Dictionary.ROOT + "abbreviation-period.txt";
        this.init(IOUtils.getInputStreamsFromResource(filename));
    }

    public Abbreviation(InputStream abbreviationPeriod) {
        this.init(abbreviationPeriod);
    }

    public void init(InputStream abbreviationPeriod) {
        this.s_period = DSUtils.createStringHashSet(abbreviationPeriod, true, true);
    }

    public boolean isAbbreviationEndingWithPeriod(String lower) {
        return this.s_period.contains(lower);
    }
}