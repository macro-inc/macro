package com.macro.preprocess.nlp.component.template.feature;

public enum Field {
    word_form,
    word_form_lowercase,
    word_form_undigitalized,
    word_form_simplified,
    word_form_simplified_lowercase,
    word_shape,
    word_shape_lowercase,
    orthographic,
    orthographic_lowercase,
    prefix,
    suffix,
    lemma,
    feats,
    part_of_speech_tag,
    ambiguity_classes,
    named_entity_tag,
    dependency_label,
    dependent_set,
    distance,
    valency,
    word_clusters,
    word_embedding,
    named_entity_gazetteers,
    positional,
    bag_of_words,
    bag_of_words_norm,
    bag_of_words_count,
    bag_of_words_stopwords,
    bag_of_words_stopwords_norm,
    bag_of_words_stopwords_count,
    bag_of_clusters,
    bag_of_clusters_norm,
    bag_of_clusters_count,
    bag_of_clusters_stopwords,
    bag_of_clusters_stopwords_norm,
    bag_of_clusters_stopwords_count;

    private Field() {
    }
}
