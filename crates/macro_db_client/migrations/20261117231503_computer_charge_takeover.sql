-- The timer that hands a just-bought computer's charge to the billing worker
-- when the purchase request that runs it never answered.
ALTER TYPE computer_timer_kind ADD VALUE IF NOT EXISTS 'charge_unsettled';
