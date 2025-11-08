package com.macro.preprocess.parse.ie;

import java.io.File;
import java.io.IOException;
import java.util.Calendar;
import java.util.Collection;
import java.util.TreeSet;

import org.apache.commons.io.FileUtils;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import com.macro.preprocess.component.physical.TextToken;
import com.macro.preprocess.parse.ExtractPhysical;
import com.macro.preprocess.parse.util.SafeWriter;

/**
 * Generates an AutoReview HTML file - a summary of the document in HTML form
 * 
 * @author Jacob
 */
public class AutoReviewGenerator {

	Collection<Result> results;
	Document document;
	public static final String version = "V1.0";
	ExtractPhysical ep;

	public AutoReviewGenerator(Collection<Result> results, ExtractPhysical ep) throws IOException {
		this.document = Jsoup.parse(new File("AutoReview/Main.html"), "UTF-8", "AutoReview");
		this.results = results;
		this.ep = ep;
	}

	public void generateReport(File f) throws IOException {
		setDate();
		setVersion();
		setTitlePage();
		setPreviewImage();
		setSummaries();
		FileUtils.writeStringToFile(f, this.document.outerHtml(), "UTF-8");
	}

	private void setDate() {
		String today = Calendar.getInstance().getTime().toString();
		document.getElementById("date").text(today);
	}

	private void setVersion() {
		document.getElementById("version").text(version);
	}

	private void setTitlePage() {
		TreeSet<TextToken> toks = ep.getAllTokensForPage(0);
		StringBuilder sb = new StringBuilder();
		int counter = 0;
		for (TextToken t : toks) {
			if (t.getY() < ep.document.getPage(0).getBBox().getHeight() * .125) { // ignore top bit of page
				continue;
			}
			if (counter > 200)
				break;
			sb.append(t.toString());
			if (t.isHasEndingSpace())
				sb.append(" ");
			counter++;
		}
		String safe = SafeWriter.safeStr(sb.toString());
		document.getElementById("titlePage").text(safe);
	}

	private void setPreviewImage() {
		Element img = document.getElementById("previewImage");
		img.attr("src", "0.svg");
	}

	private void setSummaries() {
		for (Result result : this.results) {
			String covType = result.getType().toString();
			Element table = this.document.getElementById(covType);
			Element row = document.createElement("tr");
			
			Element leftCell = document.createElement("td");
			leftCell.attr("class", "tg-lboi");
			leftCell.html("<b>" + result.getKey() + "</b>");
			Element rightCell = document.createElement("td");
			rightCell.attr("class", "tg-lboi");
			rightCell.html(result.getValue());
			
			row.appendChild(leftCell);
			row.appendChild(rightCell);
			table.appendChild(row);
		}
	}
}
