package com.macro.preprocess.nlp;

import com.macro.preprocess.nlp.node.AbstractNLPNode;

import java.util.List;

public interface NLPComponent<N extends AbstractNLPNode<N>> {
    void process(N[] var1);

    void process(List<N[]> var1);
}