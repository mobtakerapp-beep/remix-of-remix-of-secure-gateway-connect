# Roadmap

- [x] تثبيت بريد الأدمن `UUxz272@gmail.com` والسيريال `UUXZ@272` في قاعدة البيانات.
- [x] إعادة ربط السيريال وصلاحية الأدمن بالحساب الحالي.
- [x] إصلاح التحويل التلقائي من صوت يوتيوب إلى نص عند غياب الترجمة.
- [x] Trigger دائم يمنع اختفاء صلاحية الأدمن (حماية الحذف/التعديل + إعادة الربط التلقائي).
- [x] إصلاح خطأ 403 عند تنزيل صوت يوتيوب باختيار الملفات القياسية وتجربتها تلقائيًا.
- [x] التحويل تلقائيًا إلى OpenAI عند تعطل Lovable أو تجاوز حد الطلبات، مع إعادة محاولة محدودة.
- [x] إصلاح خطأ بناء `results.tsx` (إغلاق قائمة الطلبة بـ `</ul>` بدل `</ol>`).



- [x] إعادة إنشاء مخطط قاعدة البيانات بعد تفعيل Lovable Cloud (حسابات، اشتراكات، أكواد تفعيل، أدوار، مشاركات ونتائج الطلبة)

## Password reset via activation code (Sep 2026)
- Source: GitHub repo mobtakerapp-beep/remix-of-...-gemini-migration-update (imported)
- resetPasswordWithCode accepts any active, non-expired code; auto-records code_redemptions
- Error codes weak_password / invalid_input surfaced in auth.index.tsx
- Verify with typecheck + build; do NOT publish
- Run app locally (dev server) and verify it loads
