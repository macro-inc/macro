package com.macro.preprocess.nlp.morph.english;

import com.macro.preprocess.nlp.morph.util.AbstractAffixMatcher;

import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class EnglishInflection {
    String base_pos;
    Set<String> base_set;
    String exception_pos;
    Map<String, String> exception_map;
    List<AbstractAffixMatcher> suffix_matchers;

    public EnglishInflection(String basePOS, Set<String> baseSet, Map<String, String> exceptionMap, List<AbstractAffixMatcher> affixMatchers) {
        this.init(basePOS, baseSet, exceptionMap, affixMatchers);
    }

    private void init(String basePOS, Set<String> baseSet, Map<String, String> exceptionMap, List<AbstractAffixMatcher> affixMatchers) {
        this.base_pos = basePOS;
        this.base_set = baseSet;
        this.exception_map = exceptionMap;
        this.suffix_matchers = affixMatchers;
        if (this.base_set == null) {
            throw new IllegalArgumentException("The base set must not be null.");
        } else if (this.suffix_matchers == null) {
            throw new IllegalArgumentException("The suffix matcher list must not be null.");
        }
    }

    public String getBasePOS() {
        return this.base_pos;
    }

    public Set<String> getBaseSet() {
        return this.base_set;
    }

    public Map<String, String> getExceptionMap() {
        return this.exception_map;
    }

    public List<AbstractAffixMatcher> getSuffixMatchers() {
        return this.suffix_matchers;
    }

    public boolean isBaseForm(String form) {
        return this.base_set.contains(form);
    }

    public String getBaseForm(String form, String pos) {
        String token;
        if ((token = this.getBaseFormFromExceptions(form)) != null) {
            return token;
        } else {
            return (token = this.getBaseFormFromSuffixes(form, pos)) != null ? token : null;
        }
    }

    public String getBaseFormFromExceptions(String form) {
        String base;
        return this.exception_map != null && (base = (String) this.exception_map.get(form)) != null ? base : null;
    }

    public String getBaseFormFromSuffixes(String form, String pos) {
        Iterator var4 = this.suffix_matchers.iterator();

        String base;
        do {
            if (!var4.hasNext()) {
                return null;
            }

            AbstractAffixMatcher matcher = (AbstractAffixMatcher) var4.next();
            base = matcher.getBaseForm(this.base_set, form, pos);
        } while (base == null);

        return base;
    }
}