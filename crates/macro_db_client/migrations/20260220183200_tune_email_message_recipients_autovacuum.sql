ALTER TABLE public.email_message_recipients SET (
  autovacuum_vacuum_cost_delay = 10,
  autovacuum_vacuum_cost_limit = 200,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_analyze_threshold = 5000
);
