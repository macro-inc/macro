import { expect, test } from "bun:test";
import { encodeWav, frames, level, parseWav } from "../audio.ts";

const tone = (length: number, amplitude: number) =>
	Int16Array.from({ length }, (_, i) =>
		Math.round(amplitude * Math.sin(i / 5)),
	);

test("WAV round-trips", () => {
	const samples = tone(1600, 1000);
	const back = parseWav(encodeWav({ rate: 16000, samples }));
	expect(back.rate).toBe(16000);
	expect([...back.samples]).toEqual([...samples]);
});

test("a WAV cut off mid-write (header size 0) still parses", () => {
	const wav = encodeWav({ rate: 16000, samples: tone(320, 500) });
	new DataView(wav.buffer).setUint32(40, 0, true);
	expect(parseWav(wav).samples.length).toBe(320);
});

test("level reports peak, rms, dBFS", () => {
	expect(level(new Int16Array(10))).toEqual({ peak: 0, rms: 0, dbfs: -120 });
	const loud = level(Int16Array.from([3000, -3000]));
	expect(loud.peak).toBe(3000);
	expect(loud.dbfs).toBe(-21);
});

test("frames pads the tail", () => {
	const cut = [...frames(new Int16Array(500), 320)];
	expect(cut.map((frame) => frame.length)).toEqual([320, 320]);
});
