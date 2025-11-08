package com.macro.preprocess.nlp.morph.english;

import com.macro.preprocess.nlp.morph.util.AbstractAffixReplacer;

import java.util.Map;
import java.util.Set;

public class EnglishSuffixReplacer extends AbstractAffixReplacer {
    boolean b_doubleConsonants;

    public EnglishSuffixReplacer(String basePOS, String affixForm, String[] replacements, boolean doubleConsonants) {
        super(basePOS, affixForm, replacements);
        this.b_doubleConsonants = doubleConsonants;
    }

    public String getBaseForm(Map<String, Set<String>> baseMap, String form) {
        return this.getBaseForm((Set)baseMap.get(this.s_basePOS), form);
    }

    public String getBaseForm(Set<String> baseSet, String form) {
        if (!form.endsWith(this.s_affixForm)) {
            return null;
        } else {
            int subLen = form.length() - this.s_affixForm.length();
            String stem = form.substring(0, subLen);
            String base = this.getBaseFormAux(baseSet, stem);
            if (this.b_doubleConsonants && base == null && this.isDoubleConsonant(form, subLen)) {
                stem = form.substring(0, subLen - 1);
                base = this.getBaseFormAux(baseSet, stem);
            }

            return base;
        }
    }

    private String getBaseFormAux(Set<String> baseSet, String stem) {
        String[] var4 = this.s_replacements;
        int var5 = var4.length;

        for(int var6 = 0; var6 < var5; ++var6) {
            String replacement = var4[var6];
            String base = stem + replacement;
            if (baseSet.contains(base)) {
                return base;
            }
        }

        return null;
    }

    private boolean isDoubleConsonant(String form, int subLen) {
        return subLen >= 4 && form.charAt(subLen - 2) == form.charAt(subLen - 1);
    }
}