-- =====================================================================
-- ShopSphere — Ad Banners (run once in Supabase → SQL Editor)
-- Requires supabase-setup.sql to have been run first (uses is_moderator()).
-- =====================================================================

create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  advertiser text not null,
  headline text,
  subtext text,
  button_text text not null default 'Learn more',
  image_url text,
  whatsapp text,
  link_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  views bigint not null default 0,
  clicks bigint not null default 0,
  created_at timestamptz not null default now()
);

alter table public.banners enable row level security;
drop policy if exists "banners_select" on public.banners;
drop policy if exists "banners_insert" on public.banners;
drop policy if exists "banners_update" on public.banners;
drop policy if exists "banners_delete" on public.banners;

-- visitors only ever see banners that are switched on and inside their dates; moderators see all
create policy "banners_select" on public.banners for select using (
  public.is_moderator()
  or (is_active
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at >= now()))
);
create policy "banners_insert" on public.banners for insert with check (public.is_moderator());
create policy "banners_update" on public.banners for update
  using (public.is_moderator()) with check (public.is_moderator());
create policy "banners_delete" on public.banners for delete using (public.is_moderator());

-- anyone (including signed-out visitors) can add +1 view / +1 click to a LIVE banner, nothing else
create or replace function public.track_banner(p_banner_id uuid, p_event text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_event = 'view' then
    update public.banners set views = views + 1
     where id = p_banner_id and is_active
       and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at >= now());
  elsif p_event = 'click' then
    update public.banners set clicks = clicks + 1
     where id = p_banner_id and is_active
       and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at >= now());
  end if;
end $$;

grant execute on function public.track_banner(uuid, text) to anon, authenticated;