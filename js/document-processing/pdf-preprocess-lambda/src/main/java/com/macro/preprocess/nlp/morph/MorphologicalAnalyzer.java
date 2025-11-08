package com.macro.preprocess.nlp.morph;

import com.macro.preprocess.utils.Language;
import com.macro.preprocess.nlp.morph.english.EnglishMorphAnalyzer;
import com.macro.preprocess.nlp.NLPComponent;
import com.macro.preprocess.nlp.node.AbstractNLPNode;

import java.util.Iterator;
import java.util.List;

public class MorphologicalAnalyzer<N extends AbstractNLPNode<N>> implements NLPComponent<N> {
    private MorphAnalyzer analyzer = new EnglishMorphAnalyzer();

    public MorphologicalAnalyzer(Language language) {
    }

    public void process(N[] nodes) {
        for(int i = 1; i < nodes.length; ++i) {
            N node = nodes[i];
            node.setLemma(this.analyzer.lemmatize(node.getWordFormSimplified(), node.getPartOfSpeechTag()));
        }

    }

    public void process(List<N[]> document) {
        Iterator var2 = document.iterator();

        while(var2.hasNext()) {
            N[] nodes = (N[]) var2.next();
            this.process(nodes);
        }

    }
}