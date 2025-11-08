package com.macro.preprocess.parse.util;

import java.io.InputStream;
import java.io.PushbackInputStream;
import java.util.zip.GZIPInputStream;

public class DecompressStream {
	
	// Source: https://stackoverflow.com/questions/4818468/how-to-check-if-inputstream-is-gzipped
	public static InputStream decompress(InputStream input) throws Exception {
		PushbackInputStream pb = new PushbackInputStream( input, 2 ); //we need a pushbackstream to look ahead
	    byte [] signature = new byte[2];
	    int len = pb.read( signature ); //read the signature
	    pb.unread( signature, 0, len ); //push back the signature to the stream
	    if( signature[ 0 ] == (byte) 0x1f && signature[ 1 ] == (byte) 0x8b ) //check if matches standard gzip magic number
	    	return new GZIPInputStream( pb );
	    else 
	    	return pb;
	}
}
