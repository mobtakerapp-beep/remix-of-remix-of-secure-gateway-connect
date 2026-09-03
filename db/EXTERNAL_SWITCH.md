# التحويل للمشروع الخارجي (معلّق حتى تنفيذ الـ SQL)

## بيانات المشروع الخارجي
- URL: `https://sajkxtqcaiubmtamenke.supabase.co`
- Publishable (anon) key: `sb_publishable_SfwOz0n9xYKwvzFAl71GxA_jVpkF6cm`
- Service key: مخزّن كسِر `EXTERNAL_SUPABASE_SERVICE_KEY` (لا يُكتب في الكود)

## الخطوة المطلوبة منك
افتح المشروع الخارجي → SQL Editor → الصق كامل محتوى `db/external_setup.sql` → Run.
الملف آمن للتكرار (idempotent) ويُنشئ:

- `profiles`, `subscriptions`, `activation_codes`, `code_redemptions`,
  `user_roles`, `ai_generation_log`
- `user_lessons`, `lesson_shares`, `lesson_share_results` (نتائج الطلبة)
- الدوال: `has_role`, `bootstrap_account`, `count_generations_today`,
  `handle_new_user` + تريجر إنشاء الحساب عند التسجيل
- سياسات RLS والصلاحيات (GRANT) لكل جدول
- السيريالات القديمة بنفس المعرّفات:
  - `UUXZ@272` (سيريال الأدمن — yearly, 36500 يوم, 1000 استخدام)
  - `PVBZ-L7GK-Z67H` (هدية 8 أيام, 30 استخدام)
  - صلاحية الأدمن للحساب `743baa5a-c669-4a40-b020-a5ae1a09b877`

## بعد التنفيذ
قل لي "خلصت" وأحوّل ملفات الاتصال (`client.ts`, `client.server.ts`,
`auth-middleware.ts` + `.env`) للمشروع الخارجي فورًا.
