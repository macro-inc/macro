package com.macro.preprocess.nlp.morph.english;

import com.macro.preprocess.nlp.constants.StringConst;
import com.macro.preprocess.nlp.morph.MorphAnalyzer;
import com.macro.preprocess.nlp.morph.util.AbstractAffixMatcher;
import com.macro.preprocess.utils.IOUtils;
import com.macro.preprocess.utils.Splitter;
import com.macro.preprocess.utils.StringUtils;
import com.macro.preprocess.nlp.common.util.XMLUtils;
import com.macro.preprocess.utils.DSUtils;
import org.w3c.dom.Element;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class EnglishMorphAnalyzer extends MorphAnalyzer {
    public static final String ROOT = "morph/english/";
    final String INFLECTION_SUFFIX = "morph/english/inflection_suffix.xml";
    final String ABBREVIATOIN_RULE = "morph/english/abbreviation.rule";
    final String CARDINAL_BASE = "morph/english/cardinal.base";
    final String ORDINAL_BASE = "morph/english/ordinal.base";
    final String DERIVATION_SUFFIX_N2V = "morph/english/derivation_suffix_n2v.xml";
    final String FIELD_DELIM;
    final String VERB;
    final String NOUN;
    final String ADJECTIVE;
    final String ADVERB;
    final String EXT_BASE;
    final String EXT_EXCEPTION;
    final String VERB_POS;
    final String NOUN_POS;
    final String ADJECTIVE_POS;
    final String ADVERB_POS;
    private EnglishInflection inf_verb;
    private EnglishInflection inf_noun;
    private EnglishInflection inf_adjective;
    private EnglishInflection inf_adverb;
    private EnglishDerivation der_n2v;
    private Map<String, String> rule_abbreviation;
    private Set<String> base_cardinal;
    private Set<String> base_ordinal;

    public EnglishMorphAnalyzer() {
        this.FIELD_DELIM = StringConst.UNDERSCORE;
        this.VERB = "verb";
        this.NOUN = "noun";
        this.ADJECTIVE = "adjective";
        this.ADVERB = "adverb";
        this.EXT_BASE = ".base";
        this.EXT_EXCEPTION = ".exc";
        this.VERB_POS = "VB";
        this.NOUN_POS = "NN";
        this.ADJECTIVE_POS = "JJ";
        this.ADVERB_POS = "RB";
        Element inflection = XMLUtils.getDocumentElement(IOUtils.getInputStreamsFromResource("morph/english/inflection_suffix.xml"));
        Element derivationN2V = XMLUtils.getDocumentElement(IOUtils.getInputStreamsFromResource("morph/english/derivation_suffix_n2v.xml"));

        try {
            this.inf_verb = this.getInflectionRules(inflection, "verb", "VB");
            this.inf_noun = this.getInflectionRules(inflection, "noun", "NN");
            this.inf_adjective = this.getInflectionRules(inflection, "adjective", "JJ");
            this.inf_adverb = this.getInflectionRules(inflection, "adverb", "RB");
            this.der_n2v = this.getDerivationalRules(derivationN2V, "noun");
            this.base_cardinal = DSUtils.createStringHashSet(IOUtils.getInputStreamsFromResource("morph/english/cardinal.base"));
            this.base_ordinal = DSUtils.createStringHashSet(IOUtils.getInputStreamsFromResource("morph/english/ordinal.base"));
            this.rule_abbreviation = this.getAbbreviationMap(IOUtils.getInputStreamsFromResource("morph/english/abbreviation.rule"));
        } catch (IOException var4) {
            var4.printStackTrace();
        }

    }

    private EnglishInflection getInflectionRules(Element eInflection, String type, String basePOS) throws IOException {
        Element eAffixes = XMLUtils.getFirstElementByTagName(eInflection, type);
        InputStream baseStream = IOUtils.getInputStreamsFromResource("morph/english/" + type + ".base");
        InputStream exceptionStream = IOUtils.getInputStreamsFromResource("morph/english/" + type + ".exc");
        return this.getInflection(baseStream, exceptionStream, eAffixes, basePOS);
    }

    private EnglishInflection getInflection(InputStream baseStream, InputStream exceptionStream, Element eAffixes, String basePOS) throws IOException {
        Map<String, String> exceptionMap = exceptionStream != null ? DSUtils.createStringHashMap(exceptionStream, Splitter.T_SPACE) : null;
        List<AbstractAffixMatcher> affixMatchers = (new EnglishAffixMatcherFactory()).createAffixMatchers(eAffixes);
        Set<String> baseSet = DSUtils.createStringHashSet(baseStream);
        return new EnglishInflection(basePOS, baseSet, exceptionMap, affixMatchers);
    }

    private EnglishDerivation getDerivationalRules(Element eDerivation, String type) throws IOException {
        Element eAffixes = XMLUtils.getFirstElementByTagName(eDerivation, type);
        return new EnglishDerivation((new EnglishAffixMatcherFactory()).createAffixMatchers(eAffixes));
    }

    private Map<String, String> getAbbreviationMap(InputStream stream) throws IOException {
        BufferedReader fin = new BufferedReader(new InputStreamReader(stream));
        Map<String, String> map = new HashMap();

        String line;
        while((line = fin.readLine()) != null) {
            String[] tmp = Splitter.splitSpace(line.trim());
            String abbr = tmp[0];
            String pos = tmp[1];
            String base = tmp[2];
            String key = abbr + this.FIELD_DELIM + pos;
            map.put(key, base);
        }

        return map;
    }

    public String lemmatize(String simplifiedWordForm, String pos) {
        String lemma = StringUtils.toLowerCase(simplifiedWordForm);
        String t;
        if ((t = this.getAbbreviation(lemma, pos)) != null || (t = this.getBaseFormFromInflection(lemma, pos)) != null) {
            lemma = t;
        }

        if (this.isCardinal(lemma)) {
            return "#crd#";
        } else {
            return this.isOrdinal(lemma) ? "#ord#" : lemma;
        }
    }

    private String getAbbreviation(String form, String pos) {
        String key = form + this.FIELD_DELIM + pos;
        return (String)this.rule_abbreviation.get(key);
    }

    private String getBaseFormFromInflection(String form, String pos) {
        if (pos.startsWith("VB")) {
            return this.inf_verb.getBaseForm(form, pos);
        } else if (pos.startsWith("NN")) {
            return this.inf_noun.getBaseForm(form, pos);
        } else if (pos.startsWith("JJ")) {
            return this.inf_adjective.getBaseForm(form, pos);
        } else {
            return pos.startsWith("RB") ? this.inf_adverb.getBaseForm(form, pos) : null;
        }
    }

    private boolean isCardinal(String lower) {
        return this.base_cardinal.contains(lower);
    }

    private boolean isOrdinal(String lower) {
        return lower.equals("0st") || lower.equals("0nd") || lower.equals("0rd") || lower.equals("0th") || this.base_ordinal.contains(lower);
    }

    public String toVerb(String lemma) {
        Set<String> verbSet = this.inf_verb.getBaseSet();
        return verbSet.contains(lemma) ? lemma : this.der_n2v.getBaseForm((String)null, (Set)null);
    }
}