revoke execute on function public.bootstrap_account(uuid, text, text) from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.count_generations_today(uuid) from anon;
revoke execute on function public.has_role(uuid, public.app_role) from anon;