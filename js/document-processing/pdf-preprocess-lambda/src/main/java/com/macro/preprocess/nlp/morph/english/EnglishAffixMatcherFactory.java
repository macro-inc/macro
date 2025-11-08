package com.macro.preprocess.nlp.morph.english;

import com.macro.preprocess.nlp.common.util.XMLUtils;
import com.macro.preprocess.nlp.morph.util.AbstractAffixMatcher;
import com.macro.preprocess.nlp.morph.util.AbstractAffixReplacer;
import com.macro.preprocess.utils.Splitter;

import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

public class EnglishAffixMatcherFactory {
    final String ELEM_AFFIX = "affix";
    final String ELEM_RULE = "rule";
    final String ATTR_TYPE = "type";
    final String ATTR_FORM = "form";
    final String ATTR_POS = "pos";
    final String ATTR_ORG_POS = "org_pos";
    final String ATTR_BASE_POS = "base_pos";
    final String ATTR_AFFIX_FORM = "affix_form";
    final String ATTR_REPLACEMENTS = "replacements";
    final String ATTR_DOUBLE_CONSONANTS = "doubleConsonants";
    final String VAL_SUFFIX = "suffix";

    public EnglishAffixMatcherFactory() {
    }

    public List<AbstractAffixMatcher> createAffixMatchers(Element eAffixes) {
        List<AbstractAffixMatcher> affixes = new ArrayList();
        NodeList list = eAffixes.getElementsByTagName("affix");
        int size = list.getLength();

        for(int i = 0; i < size; ++i) {
            Element eAffix = (Element)list.item(i);
            affixes.add(this.createAffixMatcher(eAffix));
        }

        return affixes;
    }

    public AbstractAffixMatcher createAffixMatcher(Element eAffix) {
        String type = XMLUtils.getTrimmedAttribute(eAffix, "type");
        String form = XMLUtils.getTrimmedAttribute(eAffix, "form");
        String pos = XMLUtils.getTrimmedAttribute(eAffix, "pos");
        String orgPOS = XMLUtils.getTrimmedAttribute(eAffix, "org_pos");
        Pattern oPOS = orgPOS.equals("") ? null : Pattern.compile("^(" + orgPOS + ")$");
        boolean bSuffix = type.equals("suffix");
        if (bSuffix) {
            AbstractAffixMatcher matcher = new EnglishSuffixMatcher(form, pos, oPOS);
            NodeList list = eAffix.getElementsByTagName("rule");
            int size = list.getLength();

            for(int i = 0; i < size; ++i) {
                AbstractAffixReplacer replacer = this.getAffixReplacer(bSuffix, (Element)list.item(i));
                if (replacer != null) {
                    matcher.addReplacer(replacer);
                }
            }

            return matcher;
        } else {
            throw new IllegalArgumentException("Invalid affix type: " + type);
        }
    }

    private AbstractAffixReplacer getAffixReplacer(boolean bSuffix, Element eRule) {
        String basePOS = XMLUtils.getTrimmedAttribute(eRule, "base_pos");
        String affixForm = XMLUtils.getTrimmedAttribute(eRule, "affix_form");
        String[] replacements = Splitter.splitCommas(XMLUtils.getTrimmedAttribute(eRule, "replacements"), true);
        String dc = XMLUtils.getTrimmedAttribute(eRule, "doubleConsonants");
        boolean doubleConsonants = dc.equals("") ? false : Boolean.parseBoolean(dc);
        return bSuffix ? new EnglishSuffixReplacer(basePOS, affixForm, replacements, doubleConsonants) : null;
    }
}