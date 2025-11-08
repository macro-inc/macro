package com.macro.preprocess.nlp.decode;

import com.macro.preprocess.nlp.node.NLPNode;

import java.io.InputStream;

public class NLPDecoder extends AbstractNLPDecoder<NLPNode> {
    public NLPDecoder() {
    }

    public NLPDecoder(DecodeConfig config) {
        super(config);
    }

    public NLPDecoder(InputStream configuration) {
        super(new DecodeConfig(configuration));
    }

    public NLPNode create() {
        return new NLPNode();
    }
}