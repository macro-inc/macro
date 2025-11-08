package com.macro.preprocess.web;

import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;
import org.jsoup.nodes.Document;

/**
 * Wrap up multiple files into a .coparse specification
 * @author Jacob
 */
public class Bundler {

    private String title;
    private String toc;
    private String defs;
    private JSONObject bookmarkState;
    private List<Document> pages;
    private String storedCoParseNotepad;
    private JSONArray anomalies;
    private String storedPinnedTermsNames;
    private JSONObject documentData;

    private Bundler() {
    }

    public static class Builder {
        private String title;
        private String toc;
        private String defs;
        private JSONObject bookmarkState;
        private List<Document> pages;
        private String storedCoParseNotepad;
        private JSONArray anomalies;
        private String storedPinnedTermsNames;
        private JSONObject documentData;

        public Builder setTitle(String title) {
            this.title = title;
            return this;
        }

        public Builder setToc(String toc) {
            this.toc = toc;
            return this;
        }

        public Builder setDefs(String defs) {
            this.defs = defs;
            return this;
        }

        public Builder setBookmarkState(JSONObject bookmarkState) {
            this.bookmarkState = bookmarkState;
            return this;
        }

        public Builder setPages(List<Document> pages) {
            this.pages = pages;
            return this;
        }

        public Builder setStoredCoParseNotepad(String storedCoParseNotepad) {
            this.storedCoParseNotepad = storedCoParseNotepad;
            return this;
        }

        public Builder setAnomalies(JSONArray anomalies) {
            this.anomalies = anomalies;
            return this;
        }

        public Builder setStoredPinnedTermsNames(String storedPinnedTermsNames) {
            this.storedPinnedTermsNames = storedPinnedTermsNames;
            return this;
        }

		public Builder setDocumentData(JSONObject documentData) {
			this.documentData = documentData;
			return this;
		}

        public Bundler build() {
            Bundler bundler = new Bundler();
            bundler.title = this.title;
            bundler.toc = this.toc;
            bundler.defs = this.defs;
            bundler.bookmarkState = this.bookmarkState;
            bundler.pages = this.pages;
            bundler.storedCoParseNotepad = this.storedCoParseNotepad;
            bundler.anomalies = this.anomalies;
            bundler.storedPinnedTermsNames = this.storedPinnedTermsNames;
			bundler.documentData = this.documentData;
            return bundler;
        }
    }

	/**
	 * @return the .coparse uncompressed
	 */
    public String get() {
        JSONObject toret = new JSONObject();
        toret.put("title", this.title);
        toret.put("toc", this.toc);
        toret.put("defs", this.defs);
        JSONArray overlays = new JSONArray();
        for (Document d : this.pages) {
            overlays.put(d.outerHtml());
        }
        toret.put("overlays", overlays);
        toret.put("bookmarkState", this.bookmarkState);
        toret.put("version", 7);
        toret.put("notepad", storedCoParseNotepad);
        toret.put("anomalies", anomalies);
        toret.put("pinnedTermsNames", storedPinnedTermsNames);
		toret.put("documentData", documentData);
        return toret.toString();
    }
}
