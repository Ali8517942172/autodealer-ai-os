-- ============================================================================
-- 2026-08-14 · Two production defects found during the full-system audit.
-- Both are already applied to project dsvuoovivysszdoiorch. This file is the
-- record, so the schema in the repo matches what is actually running.
-- ============================================================================

-- ── 1. users and deals_embeddings had RLS ENABLED with ZERO policies ────────
-- In Postgres that means "deny everything", not "allow everything".
-- v_team_performance is a security_invoker view, so it read users as the
-- browser's authenticated role and got nothing back: the entire Team screen
-- rendered "Team members 0 / Nothing here yet" while four users existed, and
-- boot()'s lookup of the signed-in user silently returned null, which is why
-- the sidebar showed an email address instead of a name and role.
--
-- Grants match the model already used by leads / inventory / competitors.
-- DELETE is deliberately withheld on users: removing a row orphans the
-- assigned_to_id on every lead that person owns.

create policy users_authenticated_read on public.users
  for select to authenticated using (true);
create policy users_authenticated_insert on public.users
  for insert to authenticated with check (true);
create policy users_authenticated_update on public.users
  for update to authenticated using (true) with check (true);
create policy users_service_role_all on public.users
  for all to service_role using (true) with check (true);

create policy deals_embeddings_authenticated_read on public.deals_embeddings
  for select to authenticated using (true);
create policy deals_embeddings_service_role_all on public.deals_embeddings
  for all to service_role using (true) with check (true);


-- ── 2. inventory's derived columns were frozen snapshots ───────────────────
-- days_in_stock, holding_cost_accrued, net_margin and aging_alert are stored
-- columns, written once when a unit is saved. The dashboard hides this because
-- deriveUnit() recomputes them from acquired_at on every render — but the n8n
-- workflows and the Finance Desk read the stored copy, so from the day after a
-- unit is added those consumers are wrong, holding cost under-reports, and
-- units never cross the WARNING / CRITICAL thresholds the ageing automations
-- depend on. Drift was zero only because the seed data was generated the same
-- day it was inspected.
--
-- Constants match the frontend exactly: AED 50/day holding, VAT 5% of list,
-- commission 5% of net margin, WARNING at 90 days, CRITICAL at 120, and
-- holding cost stops accruing once a unit is marked Sold.
--
-- Called nightly at 00:15 Asia/Dubai by the "Inventory Ageing Recompute"
-- workflow (n8n id ZUc42jcwwHoBeEr8) via PostgREST RPC.

create or replace function public.recompute_inventory_derived()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  update public.inventory i
  set
    days_in_stock = d.days,
    holding_cost_accrued = case when d.sold then i.holding_cost_accrued else d.days * 50 end,
    gross_margin = coalesce(i.price_aed,0) - coalesce(i.cost_aed,0),
    net_margin = (coalesce(i.price_aed,0) - coalesce(i.cost_aed,0))
                 - case when d.sold then i.holding_cost_accrued else d.days * 50 end,
    vat_amount = round(coalesce(i.price_aed,0) * 0.05),
    recommended_commission = round(
      ((coalesce(i.price_aed,0) - coalesce(i.cost_aed,0))
        - case when d.sold then i.holding_cost_accrued else d.days * 50 end) * 0.05),
    aging_alert = case
      when d.sold then 'HEALTHY'
      when d.days >= 120 then 'CRITICAL'
      when d.days >= 90  then 'WARNING'
      else 'HEALTHY' end
  from (
    select id,
           greatest(0, current_date - acquired_at) as days,
           lower(coalesce(status,'')) = 'sold' as sold
    from public.inventory
    where acquired_at is not null
  ) d
  where i.id = d.id;

  get diagnostics touched = row_count;
  return touched;
end;
$$;

revoke all on function public.recompute_inventory_derived() from public;
grant execute on function public.recompute_inventory_derived() to service_role;
grant execute on function public.recompute_inventory_derived() to authenticated;
