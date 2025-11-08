package com.macro.preprocess.nlp.node;
public class NLPNode extends AbstractNLPNode<NLPNode> {
    private static final long serialVersionUID = 5522467283393796925L;

    public NLPNode() {
    }

    public NLPNode(int id, String form) {
        super(id, form);
    }

    public NLPNode(int id, String form, String posTag) {
        super(id, form, posTag);
    }

    public NLPNode(int id, String form, String posTag, FeatMap feats) {
    }

    public NLPNode(int id, String form, String lemma, String posTag, FeatMap feats) {
        super(id, form, lemma, posTag, feats);
    }

    public NLPNode(int id, String form, String lemma, String posTag, String namentTag, FeatMap feats) {
        super(id, form, lemma, posTag, namentTag, feats);
    }

    public NLPNode(int id, String form, String lemma, String posTag, FeatMap feats, NLPNode dhead, String deprel) {
        super(id, form, lemma, posTag, feats, dhead, deprel);
    }

    public NLPNode(int id, String form, String lemma, String posTag, String namentTag, FeatMap feats, NLPNode dhead, String deprel) {
        super(id, form, lemma, posTag, feats, dhead, deprel);
    }

    public NLPNode(int id, String form, String lemma, String posTag, String namentTag, String answerTag, FeatMap feats, NLPNode dhead, String deprel) {
        super(id, form, lemma, posTag, namentTag, feats, dhead, deprel);
    }

    public NLPNode self() {
        return this;
    }
}
