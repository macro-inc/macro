package com.macro.preprocess.component.logical.ai;

import org.json.JSONObject;

/**
 * Metadata for a text token in a text box
 */
public class TextTokenData {
    private String text;
    private float y;

    private TextTokenData(Builder builder) {
        this.text = builder.text;
        this.y = builder.y;
    }

    /**
     * @return the text in the text token
     */
    public String getText() {
        return text;
    }

    /**
     * @return the y offset of the text token in the page
     */
    public float getY() {
        return y;
    }

    public Builder toBuilder() {
        return new Builder()
                .setText(text)
                .setY(y);
    }

    public JSONObject toJson() {
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("text", text);
        jsonObject.put("y", y);
        return jsonObject;
    }

    public static TextTokenData fromJson(JSONObject jsonObject) {
        return new Builder()
            .setText(jsonObject.getString("text"))
            .setY(jsonObject.getFloat("y"))
            .build();
    }

    public static class Builder {
        private String text;
        private float y;

        public Builder setText(String text) {
            this.text = text;
            return this;
        }

        public Builder setY(float y) {
            this.y = y;
            return this;
        }

        public TextTokenData build() {
            return new TextTokenData(this);
        }
    }
}
