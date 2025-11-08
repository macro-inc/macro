package com.macro.preprocess.nlp.morph.english;

import com.macro.preprocess.nlp.morph.util.AbstractAffixMatcher;

import java.util.Iterator;
import java.util.List;
import java.util.Set;

public class EnglishDerivation {
    List<AbstractAffixMatcher> suffix_matchers;

    public EnglishDerivation(List<AbstractAffixMatcher> affixMatchers) {
        this.init(affixMatchers);
    }

    private void init(List<AbstractAffixMatcher> affixMatchers) {
        this.suffix_matchers = affixMatchers;
        if (this.suffix_matchers == null) {
            throw new IllegalArgumentException("The suffix matcher list must not be null.");
        }
    }

    public List<AbstractAffixMatcher> getSuffixMatchers() {
        return this.suffix_matchers;
    }

    public String getBaseForm(String lemma, Set<String> baseSet) {
        Iterator var4 = this.suffix_matchers.iterator();

        String base;
        do {
            if (!var4.hasNext()) {
                return null;
            }

            AbstractAffixMatcher matcher = (AbstractAffixMatcher)var4.next();
            base = matcher.getBaseForm(baseSet, lemma);
        } while(base == null);

        return base;
    }
}