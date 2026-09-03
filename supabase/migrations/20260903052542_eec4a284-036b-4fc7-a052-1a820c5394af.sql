revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.bootstrap_account(uuid, text, text) from public, anon;
revoke execute on function public.count_generations_today(uuid) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;