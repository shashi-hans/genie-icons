-- How much the generator is used, for the admin dashboard. Apply after 0005.
--
-- WHY A FUNCTION AND NOT A VIEW OVER history
--
-- The numbers wanted are "how many people have generated an icon" and "which
-- names get generated". Both come from history, which is personal data: every
-- row carries a guest_id and the table sits in prune_personal_data with the
-- retention window that implies.
--
-- So nothing here returns a row of history. The function aggregates and returns
-- counts, and a count of distinct guest ids is not a guest id: the caller learns
-- that 43 people have generated something, never which 43. Reading the table
-- through PostgREST instead would mean the server fetching guest ids in order to
-- count them, which is the thing worth avoiding.
--
-- WHAT THE NUMBERS MEAN
--
-- A generation is one row, written when the generator returns paths, whichever
-- of the three sources produced them. One person generating the same name twice
-- counts twice: these are attempts, not people, and the distinct-user count is
-- the separate figure for that.
--
-- history keeps only the newest 50 entries per guest and is pruned on the
-- retention window, so these are counts over what is retained, not all time.
-- That is stated on the panel rather than left to be discovered.

-- Grouping by name for the top list, and by guest for the distinct count.
create index if not exists history_kind_name_idx on history (kind, name);

create or replace function generate_usage_stats(top_limit integer default 20)
returns json
language sql
security definer
set search_path = public
stable
as $$
  with generated as (
    select guest_id, name, created_at
      from history
     where kind = 'generated'
  )
  select json_build_object(
    'generations',   (select count(*) from generated),
    'users',         (select count(distinct guest_id) from generated),
    'names',         (select count(distinct name) from generated),
    'last7Days',     (select count(*) from generated where created_at > now() - interval '7 days'),
    'contributed',   (select count(*) from history where kind = 'contributed'),
    'newest',        (select max(created_at) from generated),
    'top',           coalesce(
                       (select json_agg(t)
                          from (
                            select name,
                                   count(*)                  as generations,
                                   count(distinct guest_id)  as users,
                                   max(created_at)           as last_generated
                              from generated
                             group by name
                             order by count(*) desc, name asc
                             limit greatest(least(coalesce(top_limit, 20), 200), 1)
                          ) t),
                       '[]'::json)
  );
$$;

-- Both revokes are needed. Postgres grants EXECUTE on a new function to PUBLIC,
-- and revoking from a named role leaves that grant standing — anon inherits it.
-- This one is admin-only and reads a personal-data table under security definer,
-- so it must never be reachable with the anon key.
revoke all on function generate_usage_stats(integer) from public;
revoke all on function generate_usage_stats(integer) from anon, authenticated;
