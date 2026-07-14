-- Create enum team_plan ordered from cheapest to most expensive
CREATE TYPE "team_plan" AS ENUM ('idea', 'pre_seed', 'seed', 'series_a', 'growth');

-- Create the nullable team plan in the team line
ALTER TABLE "team" ADD COLUMN plan "team_plan";
