-- Overlaid apps connect through Macro's own OAuth client on the vendor's MCP
-- server. These servers advertised dynamic registration or a client metadata
-- document when seeded, but refuse Macro in practice, so connecting them always
-- fails. Hand them back to Pipedream. No native connection could have been
-- created for any of them, so there is nothing else to clean up.
--
-- Found by replaying start_authorization (rmcp discovery, then CIMD or DCR with
-- Macro's production callback) against every overlay, then opening the
-- authorization URL once. Each app below failed repeatedly; transient network
-- failures were retried and kept. Cloudflare bot challenges on the browser
-- consent page were not counted as failures.
DELETE FROM mcp_overlays
WHERE app_slug IN (
    -- No OAuth authorization server discovered.
    'aircall', 'breezy_hr', 'capturekit', 'enrow', 'hypeauditor',
    'ipinfo_io', 'product_hunt', 'streamtime', 'trackvia', 'trainual',
    'userlist',
    -- Registration refused: redirect URI not allowed, client not approved,
    -- dynamic registration unsupported, or the endpoint errors.
    'air', 'alegra', 'alpha_vantage', 'appcues', 'appsflyer', 'asana',
    'benzinga', 'browserless', 'browser_use', 'caspio', 'circleci', 'coda',
    'contacts', 'diffbot', 'domo', 'dreamdata', 'dropbox', 'easyship',
    'echtpost_postcards', 'engagebay', 'figma', 'frame', 'gamma', 'gleap',
    'gong', 'instantly', 'intercom', 'knocommerce', 'leadfeeder',
    'linearb', 'lusha', 'mapulus', 'octave', 'olostep', 'omnisend',
    'onfleet', 'outseta', 'partnerize', 'pipefy', 'printify', 'prismic',
    'proposify', 'qase', 'relevance_ai', 'retool', 'returnless',
    'richpanel', 'rudderstack', 'runpod', 'salesflare', 'salesloft',
    'semrush', 'sign_plus', 'simplero', 'skyciv', 'square', 'stripo',
    'travel_code', 'voice', 'weglot',
    -- Registered or CIMD-identified, but the authorization endpoint rejects
    -- the client, redirect URI or resource, errors, or never answers.
    'alchemy', 'autom', 'bubble', 'bugbug', 'callrail', 'campaignhq',
    'canva', 'canva_enterprise', 'checkout_com', 'clevertap', 'clockodo',
    'coinbase', 'crowdstrike_falcon', 'data247', 'decodo', 'elastic_email',
    'envoy', 'float', 'flowla', 'gatherup', 'hygraph', 'implisense_api',
    'jibble', 'kiyoh', 'leadboxer', 'logo_dev', 'miro_custom_app',
    'new_relic', 'nexudus', 'paddle', 'piloterr', 'pumble', 'qwilr',
    'radar', 'rebrandly', 'rydoo', 'scoro', 'sendcloud', 'shiphero',
    'shipstation', 'survey_monkey', 'tapfiliate', 'vimeo', 'wati',
    'webcrawler_api', 'writesonic'
);
