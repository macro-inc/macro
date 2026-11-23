-- Start dates go with the property, including any adopted from a team or
-- personal property named Start Date: which one each came from is not kept.
-- Those properties keep their " (custom)" names.
DELETE FROM entity_properties
WHERE property_definition_id = '00000001-0000-0000-0000-000000000015';

DELETE FROM property_definitions
WHERE id = '00000001-0000-0000-0000-000000000015';
