package com.macro.preprocess.nlp.morph.util;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

public abstract class AbstractAffixMatcher {
    protected String s_affixCanonicalForm;
    protected String s_affixPOS;
    protected Pattern p_originalPOS;
    protected List<AbstractAffixReplacer> l_replacers;

    public AbstractAffixMatcher(String affixCanonicalForm, String affixPOS, Pattern originalPOS) {
        this.init(affixCanonicalForm, affixPOS, originalPOS);
    }

    private void init(String affixCanonicalForm, String affixPOS, Pattern originalPOS) {
        this.s_affixCanonicalForm = affixCanonicalForm;
        this.s_affixPOS = affixPOS;
        this.p_originalPOS = originalPOS;
        this.l_replacers = new ArrayList();
    }

    public boolean matchesOriginalPOS(String pos) {
        return this.p_originalPOS == null || this.p_originalPOS.matcher(pos).find();
    }

    public void addReplacer(AbstractAffixReplacer replacer) {
        this.l_replacers.add(replacer);
    }

    public abstract String getBaseForm(Map<String, Set<String>> var1, String var2, String var3);

    public abstract String getBaseForm(Set<String> var1, String var2, String var3);

    public abstract String getBaseForm(Set<String> var1, String var2);
}