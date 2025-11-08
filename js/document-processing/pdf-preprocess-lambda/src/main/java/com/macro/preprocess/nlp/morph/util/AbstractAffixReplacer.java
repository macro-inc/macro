package com.macro.preprocess.nlp.morph.util;

import java.util.Map;
import java.util.Set;

public abstract class AbstractAffixReplacer {
    protected String s_basePOS;
    protected String s_affixForm;
    protected String[] s_replacements;

    public AbstractAffixReplacer(String basePOS, String affixForm, String[] replacements) {
        this.s_basePOS = basePOS;
        this.s_affixForm = affixForm;
        this.s_replacements = replacements;
    }

    public String getBasePOS() {
        return this.s_basePOS;
    }

    public abstract String getBaseForm(Map<String, Set<String>> var1, String var2);

    public abstract String getBaseForm(Set<String> var1, String var2);
}