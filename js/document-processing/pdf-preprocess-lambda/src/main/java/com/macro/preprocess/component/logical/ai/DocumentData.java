package com.macro.preprocess.component.logical.ai;

import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Metadata for a document
 */
public class DocumentData {
    private int numPages;
    private List<PageData> pageDatas;

    private DocumentData(Builder builder) {
        this.numPages = builder.numPages;
        this.pageDatas = builder.pageDatas;
    }

    /**
     * @return the number of pages in the document
     */
    public int getNumPages() {
        return numPages;
    }

    /**
     * @return the list of page metadata which make up the document
     */
    public List<PageData> getPageDatas() {
        return pageDatas;
    }

    public Builder toBuilder() {
        return new Builder()
                .setNumPages(numPages)
                .setPageDatas(pageDatas);
    }

    public JSONObject toJson() {
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("numPages", numPages);
        JSONArray pageDatasJson = new JSONArray();
        for (PageData pageData : pageDatas) {
            pageDatasJson.put(pageData.toJson());
        }
        jsonObject.put("pageDatas", pageDatasJson);
        return jsonObject;
    }

    public static DocumentData fromJson(JSONObject jsonObject) {
        Builder builder = new Builder();
        builder.setNumPages(jsonObject.getInt("numPages"));
        JSONArray pageDatasJson = jsonObject.getJSONArray("pageDatas");
        for (int i = 0; i < pageDatasJson.length(); i++) {
            builder.addPageData(PageData.fromJson(pageDatasJson.getJSONObject(i)));
        }
        return builder.build();
    }

    public static class Builder {
        private int numPages;
        private List<PageData> pageDatas = new java.util.ArrayList<>();

        public Builder setNumPages(int numPages) {
            this.numPages = numPages;
            return this;
        }

        public Builder setPageDatas(List<PageData> pageDatas) {
            this.pageDatas = pageDatas;
            return this;
        }

        public Builder addPageData(PageData pageData) {
            this.pageDatas.add(pageData);
            return this;
        }

        public DocumentData build() {
            return new DocumentData(this);
        }
    }
    
}