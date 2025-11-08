package com.macro.preprocess.parse.ie;

import java.io.FileNotFoundException;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;

import com.macro.preprocess.DocType;
import com.macro.preprocess.parse.ExtractPhysical;
import com.macro.preprocess.parse.PDFDOM;
import com.macro.preprocess.parse.ie.credit.*;

public class ExtractorWidgetDispatcher {
	
	private Set<ExtractorWidget> extractors;
	final static int cores = Runtime.getRuntime().availableProcessors();
	BlockingQueue<Result> results;
	public ThreadPoolExecutor tpe;

	public ExtractorWidgetDispatcher(DocType type, PDFDOM dom, ExtractPhysical ep) {
		this.extractors = new HashSet<ExtractorWidget>();
		this.results = new LinkedBlockingQueue<Result>();
		switch (type) {
			case NUMBERED_PDF:
				this.extractors.add(new LeverageRatio(dom, results, ep));
				this.extractors.add(new RestrictedPayment(dom, results));
				this.extractors.add(new Indebtedness(dom, results));
				this.extractors.add(new Liens(dom, results));
		};
	}

	public Collection<Result> runExtractors() {
		tpe = (ThreadPoolExecutor) Executors.newFixedThreadPool(cores);
		for (ExtractorWidget ew : this.extractors) {
			tpe.execute(ew);
		}
		tpe.shutdown();
		return this.results;
	}
	
	public void extractorExport(String xmlname) throws FileNotFoundException {
		/*SafeWriter sw = new SafeWriter(new File(xmlname));
		sw.println("<xml>");
		for (String extractor : )
		sw.println("</xml>");*/
	}
}
