package com.macro.preprocess.nlp.morph.english;

import com.macro.preprocess.nlp.morph.util.AbstractAffixMatcher;
import com.macro.preprocess.nlp.morph.util.AbstractAffixReplacer;

import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

public class EnglishSuffixMatcher extends AbstractAffixMatcher {
    public EnglishSuffixMatcher(String affixCanonicalForm, String affixPOS, Pattern originalPOS) {
        super(affixCanonicalForm, affixPOS, originalPOS);
    }

    public String getBaseForm(Map<String, Set<String>> baseMap, String form, String pos) {
        if (!this.matchesOriginalPOS(pos)) {
            return null;
        } else {
            Iterator var5 = this.l_replacers.iterator();

            String base;
            do {
                if (!var5.hasNext()) {
                    return null;
                }

                AbstractAffixReplacer replacer = (AbstractAffixReplacer)var5.next();
                base = replacer.getBaseForm(baseMap, form);
            } while(base == null);

            return base;
        }
    }

    public String getBaseForm(Set<String> baseSet, String form, String pos) {
        return this.matchesOriginalPOS(pos) ? this.getBaseForm(baseSet, form) : null;
    }

    public String getBaseForm(Set<String> baseSet, String form) {
        Iterator var4 = this.l_replacers.iterator();

        String base;
        do {
            if (!var4.hasNext()) {
                return null;
            }

            AbstractAffixReplacer replacer = (AbstractAffixReplacer)var4.next();
            base = replacer.getBaseForm(baseSet, form);
        } while(base == null);

        return base;
    }
}
