package com.macro.preprocess.component.logical.ai;

import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Metadata for a text box in a page
 */
public class TextBoxData {
    private String text;
    private float y;
    private List<TextTokenData> textTokenDatas;

    private TextBoxData(Builder builder) {
        this.text = builder.text;
        this.y = builder.y;
        this.textTokenDatas = builder.textTokenDatas;
    }

    /**
     * @return the text in the text box
     */
    public String getText() {
        return text;
    }

    /**
     * @return the y offset of the text box in the page
     */
    public float getY() {
        return y;
    }

    /**
     * @return the list of text token metadata which make up the text box
     */
    public List<TextTokenData> getTextTokenDatas() {
        return textTokenDatas;
    }

    public Builder toBuilder() {
        return new Builder()
                .setText(text)
                .setY(y)
                .setTextTokenDatas(textTokenDatas);
    }

    public JSONObject toJson() {
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("text", text);
        jsonObject.put("y", y);
        JSONArray textTokenDatasJson = new JSONArray();
        for (TextTokenData textTokenDatum : textTokenDatas) {
            textTokenDatasJson.put(textTokenDatum.toJson());
        }
        jsonObject.put("textTokenDatas", textTokenDatasJson);
        return jsonObject;
    }

    public static TextBoxData fromJson(JSONObject jsonObject) {
        Builder builder = new Builder();
        builder.setText(jsonObject.getString("text"));
        builder.setY(jsonObject.getFloat("y"));
        JSONArray textTokenDatasJson = jsonObject.getJSONArray("textTokenDatas");
        for (int i = 0; i < textTokenDatasJson.length(); i++) {
            builder.addTextTokenData(TextTokenData.fromJson(textTokenDatasJson.getJSONObject(i)));
        }
        return builder.build();
    }

    public static class Builder {
        private String text;
        private float y;
        private List<TextTokenData> textTokenDatas = new java.util.ArrayList<>();

        public Builder setText(String text) {
            this.text = text;
            return this;
        }

        public Builder setY(float y) {
            this.y = y;
            return this;
        }

        public Builder setTextTokenDatas(List<TextTokenData> textTokenDatas) {
            this.textTokenDatas = textTokenDatas;
            return this;
        }

        public Builder addTextTokenData(TextTokenData textTokenData) {
            this.textTokenDatas.add(textTokenData);
            return this;
        }

        public TextBoxData build() {
            return new TextBoxData(this);
        }
    }
}
