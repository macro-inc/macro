# Connected-app execution binding proof

PR #11791: `754cb2ccf2f4ec682854510615f1af6406ab6c13`.

The stack runs behavior head `93e00a41072c304855367a355cfe9308aa09aee3` in integration `48ba8bfee7c`; the final PR head differs only in cancellation-save logging.

The video reviews the stored app result from an earlier real live A/B run and fetches its actual Tempo spans: A called its own connected app successfully, then used the same runtime credential for a POST and SDK list against B's execution. Both returned 403 while B was running before and after. The recording retry stalled before a vendor call; it is not counted as another successful execution. The video also captures a fresh real harness mention-token mint and Deno execution returning connected-app status 403, with DSS host input supplied by a labelled test client. This older mention mint is refused as uncorrelated; it is not the later NoSend channel-flow proof.

Real app, inference, harness, Deno, signed credentials, authorization, SDK, journal storage and Tempo. The external MCP vendor and its CA are local stand-ins. Model usage was $0.0801 at local configured prices, including rehearsals and the stalled retry; zero unpriced calls.

The screenshots show the start and end of this evidence review, not an unfixed production baseline. The terminal includes rehearsal history. No external account or production data was used.
