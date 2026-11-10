# CarPass — ملف التسليم للهاكاثون

- **الموقع:** https://carpass-near.vercel.app
- **المستودع:** https://github.com/medomohamed22/Near_Agent
- **العقد:** `carpass-v5.testnet` على NEAR Testnet
- **المسار:** 08 Real-World (ثانوي: 06 Security)
- **آخر موعد:** 14 نوفمبر 2026، 23:59 UTC. الموقع يبقى شغالًا حتى 25 نوفمبر.

## قبل التسليم

- [ ] تسجيل فيديو الديمو (السكريبت بالأسفل).
- [ ] نشر البوست على X.
- [ ] ملء نموذج التسليم بالروابط أعلاه.
- [ ] إضافة رابط الموقع في خانة Website بصفحة المستودع على GitHub (About ← ⚙).
- [ ] فتح الموقع كل بضعة أيام حتى 25 نوفمبر، حتى لا يتوقف مشروع Supabase المجاني.

## وصف قصير (للنموذج)

**EN:** CarPass is a used-car passport with an escrowed sale on NEAR testnet. Sellers photograph invoices; an AI proposes the fields with quotes from the document and the seller approves them; the document hash and odometer reading go on chain. Workshops confirm records with their own NEAR account, and the contract flags odometer readings that disagree. The buyer's payment waits in the contract and is released only on confirmed handover, refunded on cancel or timeout, or frozen by a dispute for a human reviewer. Press "Watch the live demo" and the site runs the whole flow by itself with real testnet transactions.

**AR:** CarPass جواز للسيارة المستعملة مع بيع بضمان على NEAR Testnet. البائع يصوّر الفواتير، ويقترح AI الحقول مع اقتباس من المستند ثم يوافق البائع، وتُسجَّل بصمة المستند وقراءة العدّاد على السلسلة. الورشة توثّق بحسابها، والعقد يعلّم تعارض العدّاد. مبلغ المشتري ينتظر في العقد ولا يُفرج عنه إلا عند تأكيد الاستلام.

## سكريبت الفيديو (90 ثانية)

سجّل الشاشة على الموقع بالإنجليزية والمظهر النهاري، بدقة 1080p.

| الوقت | ما يظهر | ما يُقال (EN) |
|---|---|---|
| 0–8 | الصفحة الرئيسية والعنوان | "Buying a used car means trusting loose invoices and an odometer that may have been rolled back, then paying before you are sure." |
| 8–15 | بطاقات الخطوات الثلاث، ثم تحريك الجواز 3D بالماوس وقلبه | "CarPass gives every car a passport on NEAR, and holds the payment in a smart contract until handover." |
| 15–20 | الضغط على Watch the live demo | "Everything you are about to see is live: a real AI call and real testnet transactions." |
| 20–40 | اللوحة تتقدم: قراءة الفاتورة، ثم توثيق الورشة | "The AI reads the invoice and quotes the document. A workshop confirms the record with its own NEAR account." |
| 40–60 | الدفع للضمان، التسليم، التأكيد | "The buyer pays into escrow. The seller is paid only when the buyer confirms receipt, and the passport moves with the car." |
| 60–72 | فاتورة 2025 بقراءة أقل وشارة التعارض | "A later invoice shows fewer kilometres. The contract flags the conflict; nobody can hide it." |
| 72–82 | إجابة السؤال، ثم فتح رابط معاملة في المستكشف | "Ask the records a question and you get an answer with sources, or an honest 'no record'. Every step is on the explorer." |
| 82–90 | تبديل العربية والمظهر الليلي، ثم زر Connect wallet | "English and Arabic, light and dark, guest mode or your own wallet. CarPass, on NEAR testnet." |

نصيحة: العرض الحي يأخذ نحو دقيقتين، فسجّله كاملًا ثم سرّع المقاطع التي تنتظر فيها المعاملات.

## بوست X

> Buying a used car? Don't trust the odometer. Trust the chain. 🚗
>
> CarPass: a used-car passport + escrowed sale on @NEARProtocol testnet.
> • AI reads invoices, you approve every field
> • Workshops confirm with their own account
> • Contract flags odometer rollbacks
> • Payment released only on handover
>
> Press one button and the site demos itself, live on chain:
> https://carpass-near.vercel.app
>
> Code: https://github.com/medomohamed22/Near_Agent
> #NEARHackathon

(أرفق الفيديو أو صورة `docs/screens/home.png`.)
