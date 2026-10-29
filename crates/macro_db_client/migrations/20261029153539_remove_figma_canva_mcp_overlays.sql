-- Figma and Canva advertise dynamic client registration but refuse Macro's
-- registration: Figma answers 403, and Canva rejects our callback URL as an
-- invalid redirect URI. Overlaid, these apps can never be connected, so hand
-- them back to Pipedream. No native connection could have been created for
-- them, so there is nothing else to clean up.
DELETE FROM mcp_overlays
WHERE app_slug IN ('figma', 'canva', 'canva_enterprise');
