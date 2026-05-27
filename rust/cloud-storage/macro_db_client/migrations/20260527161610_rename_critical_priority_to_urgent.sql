-- Rename the highest priority option label from "Critical" to "Urgent"
UPDATE property_options
SET string_value = 'Urgent'
WHERE id = '00000001-0000-0000-0003-000000000004'
    AND string_value = 'Critical';
