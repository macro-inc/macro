-- A column position is a fractional-index key, written as lowercase hex that
-- always ends in '80'. The Sales copy (20261007172435) stored Company, Stage,
-- and Owner at '20', '40', and '60'. Those are not keys, so reading a copied
-- Sales pipeline fails. Appending '80' gives '2080', '4080', and '6080'. They
-- are valid keys and keep the copied order ahead of Revenue at '80'.
UPDATE database_columns
SET position = position || '80'
WHERE position IN ('20', '40', '60');
