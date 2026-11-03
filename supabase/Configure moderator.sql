Claude



























Configure moderator · SQL
-- =====================================================================
-- ShopSphere — set the moderator's SMS number
-- Run AFTER schema.sql. It stops with an error unless there is exactly ONE moderator.
-- =====================================================================
do $$
declare
  v_count int;
  v_id uuid;
begin
  select count(*) into v_count from public.profiles where role = 'moderator';
  if v_count <> 1 then
    raise exception 'Expected exactly one moderator account, found %. Make yourself a moderator first (see the bottom of supabase-setup.sql).', v_count;
  end if;
  select id into v_id from public.profiles where role = 'moderator';
  update public.profiles set phone_whatsapp = '0554166822' where id = v_id;
  raise notice 'Moderator SMS number set to 0554166822 for account %', v_id;
end $$;
 
-- check:
select id, full_name, phone_whatsapp, role from public.profiles where role = 'moderator';
 
Claude finished the response
