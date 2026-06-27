-- Simple username + password accounts (no email required).
-- Passwords are bcrypt-hashed via pgcrypto. The accounts table is locked down
-- with RLS and *no* policies, so it is unreachable directly with the anon key.
-- All access goes through SECURITY DEFINER functions that only ever return the
-- safe public columns (never the hash).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.accounts (
  id           uuid primary key default gen_random_uuid(),
  username     text unique not null,
  pass_hash    text not null,
  display_name text,
  created_at   timestamptz not null default now()
);

alter table public.accounts enable row level security;
-- intentionally no policies: only the SECURITY DEFINER functions below touch it.

-- Create an account. Raises USERNAME_TAKEN / WEAK_PASSWORD on bad input.
create or replace function public.account_signup(p_username text, p_password text)
returns table (id uuid, username text, display_name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_username text := trim(p_username);
  v_id uuid;
begin
  if length(coalesce(p_password, '')) < 4 then
    raise exception 'WEAK_PASSWORD';
  end if;
  if char_length(v_username) < 1 then
    raise exception 'WEAK_PASSWORD';
  end if;
  if exists (select 1 from public.accounts a where lower(a.username) = lower(v_username)) then
    raise exception 'USERNAME_TAKEN';
  end if;

  insert into public.accounts (username, pass_hash, display_name)
  values (v_username, crypt(p_password, gen_salt('bf')), v_username)
  returning accounts.id into v_id;

  return query
    select a.id, a.username, a.display_name
    from public.accounts a
    where a.id = v_id;
end;
$$;

-- Verify a login. Returns the matching row, or no rows if the combo is wrong.
create or replace function public.account_login(p_username text, p_password text)
returns table (id uuid, username text, display_name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
    select a.id, a.username, a.display_name
    from public.accounts a
    where lower(a.username) = lower(trim(p_username))
      and a.pass_hash = crypt(p_password, a.pass_hash);
end;
$$;

grant execute on function public.account_signup(text, text) to anon, authenticated;
grant execute on function public.account_login(text, text)  to anon, authenticated;
