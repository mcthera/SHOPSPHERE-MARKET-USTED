-- Run this once in Supabase → SQL Editor. Adds Canceled + automatic stock restore.

create or replace function public.update_order_status(p_order_id uuid, p_status text)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders;
  v_item jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_status not in ('Pending','Shipped','Delivered','Canceled') then
    raise exception 'Invalid status.';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not (public.is_moderator() or exists (
        select 1 from jsonb_array_elements(v_order.items) i
        where i->>'seller_id' = auth.uid()::text)) then
    raise exception 'You are not allowed to update this order.';
  end if;
  if v_order.status = p_status then return v_order; end if;
  if v_order.status = 'Canceled' then
    raise exception 'A canceled order cannot be changed. Ask the customer to place a new order.';
  end if;
  if p_status = 'Canceled' then
    if v_order.status = 'Delivered' then
      raise exception 'A delivered order cannot be canceled.';
    end if;
    -- put the reserved stock back on the shelf
    for v_item in select * from jsonb_array_elements(v_order.items) loop
      update public.products
         set stock = stock + coalesce((v_item->>'qty')::int, 0)
       where id = (v_item->>'product_id')::uuid;
    end loop;
  end if;
  update public.orders set status = p_status where id = p_order_id returning * into v_order;
  return v_order;
end $$;

grant execute on function public.update_order_status(uuid,text) to authenticated;