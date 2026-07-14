// @ts-ignore: untyped javascript worker file
import mod from 'pdfjs-dist/build/pdf.worker';

// @ts-nocheck this is a worker shim, this doesn't matter
// @ts-ignore
(typeof window !== 'undefined' ? window : {}).pdfjsWorker = mod;

export {};
