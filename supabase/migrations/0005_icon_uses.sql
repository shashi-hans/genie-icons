-- How often each icon is copied or downloaded, for the admin page. Apply after
-- 0004.
--
-- WHAT IS STORED, AND WHAT DELIBERATELY IS NOT
--
-- Two aggregate numbers per icon name, and nothing else. No guest id, no time of
-- an individual export, no country. A row here says "arrow-left: 41 copies, 12
-- downloads"; nothing in the schema can say who made them or when any one of
-- them happened. That keeps this table outside the DPDP Act's personal data, so
-- it needs no retention window and no place in prune_personal_data — the same
-- line drawn in 0004 for the country tally.
--
-- WHAT THE NUMBERS MEAN
--
-- Every copy and every download counts, so one person exporting an icon as SVG
-- and then as PNG counts twice. These are export counts, not people, and not
-- installs — the npm package is used without ever touching this site.
--
-- The gallery and the generator both write here, keyed by icon name alone, so a
-- generated icon's exports land on the same row the gallery later uses for it.
-- The resizer has no icon to name: it works on whatever file the user drops in,
-- and the filename is the user's own data, so it contributes a single total in
-- site_counters and nothing per file.

create table if not exists icon_uses (
  -- Kebab-case, the same shape kebabName() produces and the same shape the
  -- catalogue uses.
  name      text primary key check (name ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  copies    bigint not null default 0,
  downloads bigint not null default 0,
  -- Stored rather than summed on read: PostgREST orders by columns, not
  -- expressions, so a busiest-first page has to have a column to order on.
  total     bigint generated always as (copies + downloads) stored,
  -- Which icons are still in use, without storing when any one export happened.
  last_used timestamptz not null default now()
);

-- The admin page reads the busiest icons first.
create index if not exists icon_uses_total_idx on icon_uses (total desc);

alter table icon_uses enable row level security;
-- No policies: every read and write goes through this project's own API using
-- the service_role key, which bypasses RLS. Leaving the table with RLS on and no
-- policy means a leaked anon key still reads nothing.
revoke all on table icon_uses from anon, authenticated;

-- --- record_icon_use ----------------------------------------------------------
-- One round trip, and the increment is atomic. Read-modify-write in the
-- application would lose counts whenever two exports overlap.
--
-- The endpoint in front of this is open, because copying an icon needs no
-- account. Anyone can therefore inflate a number by posting in a loop. Two
-- things bound the damage: an unknown name can only ever create one row, and
-- MAX_NAMES caps how many rows exist at all, after which new names raise the
-- site totals but do not fill the table. Treat the numbers as a popularity
-- signal, not as something to bill or report on.
-- p_count is for one gesture that exports several files at once, so the resizer's
-- "Download all" is one call rather than one beacon per file. Clamped here as
-- well as in the API: this function is the last thing before the numbers, and a
-- caller reaching PostgREST directly must not be able to set an arbitrary
-- multiplier.
-- A two-argument version from an earlier apply of this file would still match a
-- {p_name, p_action} body, and PostgREST would refuse the call as ambiguous
-- rather than pick one. Dropped so exactly one signature exists.
drop function if exists record_icon_use(text, text);

create or replace function record_icon_use(p_name text, p_action text, p_count integer default 1)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  -- Roughly ten times the icons the library ships, so a real name always fits
  -- and a flood of invented ones stops here.
  max_names constant integer := 5000;
  max_count constant integer := 32;
  v_name    text;
  v_copy    boolean;
  v_count   integer;
  v_copies  bigint;
  v_downs   bigint;
begin
  -- A name the check constraint would reject counts nowhere, not even in the
  -- site totals, so junk cannot move any number. Dropped rather than raised:
  -- the caller is a fire-and-forget beacon behind someone's copy button, and a
  -- failed count must never be visible to them. NULL is a caller that sent no
  -- name at all, which is not the same as the empty name the resizer sends.
  if p_name is null then
    return;
  end if;
  v_name := lower(trim(p_name));
  if v_name <> '' and v_name !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    return;
  end if;

  -- Anything that is not 'copy' is a download: the caller sends one of two
  -- words, and a typo must not silently drop the count.
  v_copy := lower(coalesce(p_action, '')) = 'copy';

  v_count  := least(greatest(coalesce(p_count, 1), 1), max_count);
  v_copies := case when v_copy then v_count else 0 end;
  v_downs  := case when v_copy then 0 else v_count end;

  insert into site_counters (key, value)
    values (case when v_copy then 'icon_copies' else 'icon_downloads' end, v_count)
    on conflict (key) do update set value = site_counters.value + v_count;

  -- An empty name means the resizer, which exports a file the user supplied
  -- rather than an icon of ours. It gets a total and nothing more.
  if v_name = '' then
    insert into site_counters (key, value) values ('resizer_exports', v_count)
      on conflict (key) do update set value = site_counters.value + v_count;
    return;
  end if;

  update icon_uses
     set copies    = copies    + v_copies,
         downloads = downloads + v_downs,
         last_used = now()
   where name = v_name;

  if not found and (select count(*) from icon_uses) < max_names then
    insert into icon_uses (name, copies, downloads)
      values (v_name, v_copies, v_downs)
      on conflict (name) do update
        set copies    = icon_uses.copies    + excluded.copies,
            downloads = icon_uses.downloads + excluded.downloads,
            last_used = now();
  end if;
end;
$$;

-- Both revokes are needed. Postgres grants EXECUTE on a new function to PUBLIC,
-- and revoking from a named role leaves that grant standing — anon inherits it.
revoke all on function record_icon_use(text, text, integer) from public;
revoke all on function record_icon_use(text, text, integer) from anon, authenticated;
