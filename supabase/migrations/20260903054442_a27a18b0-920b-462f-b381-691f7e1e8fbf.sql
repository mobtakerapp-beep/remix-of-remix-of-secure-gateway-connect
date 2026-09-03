revoke execute on function public.bootstrap_account(uuid, text, text) from public;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.count_generations_today(uuid) from public;
revoke execute on function public.has_role(uuid, public.app_role) from public;
revoke execute on function public.set_updated_at() from public;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.count_generations_today(uuid) to authenticated;