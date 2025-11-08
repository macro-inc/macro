package com.macro.preprocess.nlp.decode;

import com.macro.preprocess.nlp.common.util.XMLUtils;
import com.macro.preprocess.nlp.component.template.config.NLPConfig;
import com.macro.preprocess.nlp.node.NLPNode;
import org.w3c.dom.Element;

import java.io.InputStream;

public class DecodeConfig extends NLPConfig<NLPNode> {
    private String part_of_speech_tagging;
    private String named_entity_recognition;
    private String dependency_parsing;
    private String semantic_role_labeling;

    public DecodeConfig() {
    }

    public DecodeConfig(InputStream in) {
        super(in);
        this.initComponents();
    }

    public void initComponents() {
        Element eModels = XMLUtils.getFirstElementByTagName(this.xml, "models");
        this.setPartOfSpeechTagging(XMLUtils.getTextContentFromFirstElementByTagName(eModels, "pos"));
        this.setNamedEntityRecognition(XMLUtils.getTextContentFromFirstElementByTagName(eModels, "ner"));
        this.setDependencyParsing(XMLUtils.getTextContentFromFirstElementByTagName(eModels, "dep"));
        this.setSemanticRoleLabeling(XMLUtils.getTextContentFromFirstElementByTagName(eModels, "srl"));
    }

    public String getPartOfSpeechTagging() {
        return this.part_of_speech_tagging;
    }

    public String getNamedEntityRecognition() {
        return this.named_entity_recognition;
    }

    public String getDependencyParsing() {
        return this.dependency_parsing;
    }

    public String getSemanticRoleLabeling() {
        return this.semantic_role_labeling;
    }

    public void setPartOfSpeechTagging(String filename) {
        this.part_of_speech_tagging = filename;
    }

    public void setNamedEntityRecognition(String filename) {
        this.named_entity_recognition = filename;
    }

    public void setDependencyParsing(String filename) {
        this.dependency_parsing = filename;
    }

    public void setSemanticRoleLabeling(String filename) {
        this.semantic_role_labeling = filename;
    }
}