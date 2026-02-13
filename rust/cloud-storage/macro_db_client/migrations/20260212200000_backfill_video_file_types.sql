UPDATE "Document"
SET "fileType" = CASE
    WHEN "name" ILIKE '%.mkv' THEN 'mkv'
    WHEN "name" ILIKE '%.webm' THEN 'webm'
    WHEN "name" ILIKE '%.avi' THEN 'avi'
    WHEN "name" ILIKE '%.mov' THEN 'mov'
    WHEN "name" ILIKE '%.wmv' THEN 'wmv'
    WHEN "name" ILIKE '%.mpg' THEN 'mpg'
    WHEN "name" ILIKE '%.mpeg' THEN 'mpeg'
    WHEN "name" ILIKE '%.m4v' THEN 'm4v'
    WHEN "name" ILIKE '%.flv' THEN 'flv'
    WHEN "name" ILIKE '%.f4v' THEN 'f4v'
    WHEN "name" ILIKE '%.3gp' THEN '3gp'
END
WHERE "fileType" IS NULL
  AND ("name" ILIKE '%.mkv' OR "name" ILIKE '%.webm' OR "name" ILIKE '%.avi'
    OR "name" ILIKE '%.mov' OR "name" ILIKE '%.wmv' OR "name" ILIKE '%.mpg'
    OR "name" ILIKE '%.mpeg' OR "name" ILIKE '%.m4v' OR "name" ILIKE '%.flv'
    OR "name" ILIKE '%.f4v' OR "name" ILIKE '%.3gp');
