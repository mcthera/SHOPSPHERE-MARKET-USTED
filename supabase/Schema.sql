Claude



























Schema · SQL
-- =====================================================================
-- ShopSphere — Notifications: database changes (safe to run more than once)
-- Run in Supabase → SQL Editor. Requires supabase-setup.sql + supabase-featured.sql first.
--
-- Seller contact email: ShopSphere already stores it in public.profiles.email
-- (new seller sign-ups now REQUIRE it). Nothing new is needed for that column.
-- =====================================================================
 
-- notification tracking (prevents duplicate texts/emails)
alter table public.profiles add column if not exists application_notified_at timestamptz;
alter table public.orders   add column if not exists seller_notified_at timestamptz;
alter table public.orders   add column if not exists notification_log jsonb not null default '[]'::jsonb;
 
-- users must not be able to reset their own tracking (that would re-trigger SMS to the moderator)
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_moderator() then
    new.role := old.role;
    new.seller_status := old.seller_status;
    new.verified := old.verified;
    new.application_notified_at := old.application_notified_at;
  end if;
  return new;
end $$;
 
-- sellers that exist already but have no contact email (they won't get order emails until fixed)
select id, full_name, phone_whatsapp, email
from public.profiles
where role = 'seller' and (email is null or email = '');
 
-- To add one, run (edit the values):
--   update public.profiles set email = 'seller@example.com' where phone_whatsapp = '0597787700' and role = 'seller';
 
Claude finished the response
