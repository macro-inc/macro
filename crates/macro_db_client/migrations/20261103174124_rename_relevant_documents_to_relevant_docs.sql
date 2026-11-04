-- Shorten the task system property label so it fits the side panel label column
UPDATE property_definitions
SET display_name = 'Relevant Docs'
WHERE id = '00000001-0000-0000-0000-00000000000a'
    AND display_name = 'Relevant Documents';
