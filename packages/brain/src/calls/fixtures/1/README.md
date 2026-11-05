The ear tests synthesize 16 kHz mono WAV files in a temporary directory.
`expected.json` describes quiet noise-gated speech: three 300 ms bursts at
-40 dBFS in a floor of zeros and ±1, and a normal -21 dBFS phrase.
The recorded-call replay pipeline must answer every burst even when streaming
recognition returns empty finals. No real person's voice is committed.
