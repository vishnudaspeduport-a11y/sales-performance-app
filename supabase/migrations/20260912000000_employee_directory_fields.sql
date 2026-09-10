-- Extra employee fields that come from the icku HR directory (da.employee_directory):
-- job title, department, work location, joining date, and where the manager mapping came from
-- ('directory' = icku, 'sheet' = Employee Data tab, 'none' = no manager known).
-- Run in Supabase → SQL Editor. Safe to run more than once.

alter table public.employees add column if not exists title          text;
alter table public.employees add column if not exists department     text;
alter table public.employees add column if not exists location       text;
alter table public.employees add column if not exists joined_on      date;
alter table public.employees add column if not exists mapping_source text;
