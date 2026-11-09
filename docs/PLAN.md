# Amana (أمانة): خطة البناء لـ NEAR HACKATHON 2026

> **الفكرة في سطر:** زكاة وصدقات بتشوف فيها كل دولار راح فين. وكيل بيحسب الزكاة بالعربي والإنجليزي، والدفع من أي عملة، والفلوس محفوظة في عقد ما يصرفش غير بموافقة أمناء على Sputnik DAO، والصرف بيكون لمستحقين متسجلين في واحد من المصارف الثمانية. كل متبرع معاه إيصال على السلسلة يتابع بيه فلوسه وصلت لمين.

- **المسارات:** الأساسي `social` (Social Money)، ومعاه `realworld` (Real-World Money) و `agents` (Agent Economy).
- **آخر موعد:** 14 نوفمبر 2026، الساعة 23:59 UTC. الريبو لازم يبقى public، ونعمل بوست على X فيه @NEARProtocol و #NEARHackathon.
- **البناء:** على GitHub في الريبو `Near_Agent`، والواجهة منشورة على Vercel، والعقد على NEAR testnet.

---

## 1. ملخص البحث

### 1.1 شبكة NEAR: اللي يهمنا منها
| المفهوم | معناه لمشروعنا |
|---|---|
| **Named accounts و sub-accounts** | العقد هيبقى على `amana.<name>.testnet`، وكل صندوق ليه DAO على `<fund>.sputnikv2.testnet` |
| **Access keys** | فيه Full access وفيه Function-call key. الـ Function-call key يقدر ينادي methods معينة بس ومن غير deposit. هنستخدمه لوكيل الحساب لو احتجنا يكتب حاجة على السلسلة |
| **Storage staking** | العقد بيدفع مقابل التخزين بـ NEAR. المتبرع هيدفع جزء صغير من الـ storage لما يتسجل إيصاله، أو العقد يتحمله من رصيده |
| **NEP-141** | معيار التوكنز. USDC بيتبعت للعقد عن طريق `ft_transfer_call`، والعقد بيستقبله في `ft_on_transfer` |
| **NEP-297 events** | نطلع Logs بصيغة `EVENT_JSON:` لكل تبرع وكل صرف، والواجهة بتقراها |
| **NEAR Intents (1Click)** | أي توكن على أي سلسلة بيتحول لـ USDC على NEAR. **مالهاش testnet.** هنعمل dry quotes على testnet، وتجربة حقيقية واحدة بمبلغ صغير على mainnet |

### 1.2 الـ Testnet: كل ده اتجرب وشغال النهارده
| البند | القيمة |
|---|---|
| RPC | `https://rpc.testnet.fastnear.com`. شغال، الـ `chain_id=testnet`، والإصدار 2.14 |
| Explorer | `https://testnet.nearblocks.io` |
| Faucet | `near account create-account sponsor-by-faucet-service` أو near-faucet.io |
| Sputnik DAO factory | `sputnikv2.testnet`. شغال وعليه **5512 DAO** |
| USDC testnet (Circle) | `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`. الـ `ft_metadata` رجع USDC صح |
| 1Click API | `https://1click.chaindefuser.com/v0/tokens` فيه 216 توكن، منها USDC على near و eth و base و sol و arb و bsc و pol وغيرهم، و USDT على tron وغيرها |
| الأدوات اللي على الجهاز | Rust/cargo 1.97 و Node 22. لسه هنتبت `cargo-near` و `near-cli-rs` |

### 1.3 العقود الذكية
- **اللغة:** Rust مع `near-sdk` 5.x، والـ build والـ deploy بـ `cargo-near`. اخترنا Rust لأنها أنضج من JS على NEAR، والحكام والأدوات بيتعاملوا معاها أحسن.
- **الاختبارات:** unit tests، وبعدها `near-workspaces` على sandbox لو الوقت سمح.
- **النشر:** `cargo near deploy` مع init في نفس الخطوة. لازم يحصلوا مع بعض، عشان أي حد ممكن يعمل init لعقد اتنشر ولسه ما اتعملوش init.
- **Sputnik DAO:** نعمل DAO من الـ factory. كل حاجة بتتعمل بـ `add_proposal`، والموافقة بـ `act_proposal` و `VoteApprove`. هنستخدم proposal من نوع `FunctionCall` بينادي `disburse` على عقدنا. يعني العقد ما يصرفش غير لما الـ DAO يوافق.

### 1.4 المنافسين والمشاريع الشبيهة
| المشروع | الشبكة | الفرق بينه وبيننا |
|---|---|---|
| Potlock | NEAR | تمويل للـ public goods وجولات quadratic funding. مفيهوش زكاة ولا مصارف ولا تتبع لكل متبرع |
| HAQQ / Fairshare | HAQQ (EVM) | زكاة وصدقات بالكريبتو، بس على شبكة خاصة بيهم. مفيهاش وكيل ولا DAO بيتحكم في الصرف |
| ZakatDAO | Ethereum/Polygon | كسب في هاكاثون جامعي 2025. مش على NEAR ومفيهوش دفع من أي سلسلة |
| Giveth / Endaoment / The Giving Block | EVM | تبرعات عامة. مفيهاش زكاة ولا مصارف |
| Zakat House وغيرها | Off-chain | بيقبلوا كريبتو، بس الشفافية مجرد وعود |
| Njangi، Cowrie، hat-tip | NEAR Hackathon 2026 | بيستخدموا Sputnik DAO لحاجات تانية: جمعيات ومكافآت. **مفيش مشروع زكاة أو صدقات في الهاكاثون** |

**اللي بيميزنا:**
1. القواعد الشرعية مكتوبة جوه العقد: فلوس الزكاة ما تتصرفش غير لمستحق متسجل تحت مصرف من الثمانية.
2. إيصال لكل متبرع، بيتتبع فلوسه لحد آخر مستحق بطريقة FIFO.
3. وكيل بيحسب الزكاة من كلام عادي بالعامية.
4. الدفع من أي سلسلة عن طريق Intents.

---

## 2. المعمارية

```
┌────────────── Next.js (Vercel) ──────────────┐
│  /            الصفحة الرئيسية + الصناديق       │
│  /zakat       وكيل حساب الزكاة (شات بالعربي/EN)  │
│  /fund/[id]   صفحة صندوق: الرصيد، التبرعات،     │
│               الصرف لكل مصرف، المستحقين        │
│  /receipt/[id] إيصال: فلوسك راحت فين (FIFO)     │
│  /admin       الأمناء: تسجيل مستحق / طلب صرف     │
│  /api/agent   LLM (NEAR AI Cloud) → JSON أصول   │
│  /api/prices  سعر الذهب/الفضة (للنصاب)         │
│  /api/quote   1Click quote (dry على testnet)    │
└──────┬─────────────────────────┬──────────────┘
       │ wallet (near-connect)   │ RPC reads (view)
┌──────▼─────────────────────────▼──────────────┐
│  amana.<x>.testnet  (Rust contract)            │
│   create_fund(dao, name, kind)                 │
│   donate (NEAR deposit) / ft_on_transfer (USDC)│
│   register_recipient(fund, account, category)  │ ← DAO فقط
│   disburse(fund, recipient, amount, token, memo)│ ← DAO فقط
│   views: get_fund, get_donations, get_disbursements, get_receipt
└──────▲────────────────────────────────────────┘
       │ FunctionCall proposal → act_proposal(VoteApprove)
┌──────┴────────────────┐
│ <fund>.sputnikv2.testnet│  أمناء (council) بنسبة موافقة 2 من 3
└───────────────────────┘
```

### 2.1 العقد (`contract/`)
- **`Fund`:**
  - `id`، `name`، و `dao` (الحساب الوحيد اللي يقدر يصرف أو يسجل مستحقين).
  - `kind`: `Zakat` أو `Sadaqah` أو `General`.
  - الأرصدة لكل توكن، وإجمالي المتبرع بيه والمصروف.
- **`Donation`:** `id`، `fund`، `donor`، `token`، `amount`، `kind`، `ts`، `memo`.
- **`Recipient`:**
  - `account` و `category`. المصارف الثمانية: `Fuqara`، `Masakin`، `Amilin`، `MuallafatQulub`، `Riqab`، `Gharimin`، `FiSabilillah`، `IbnSabil`.
  - `verified_by` (الـ DAO)، و `label_hash`. الـ hash بيخلّي بيانات المستحق الشخصية برا السلسلة.
- **القواعد اللي العقد بيفرضها:**
  1. اللي يقدر ينادي `disburse` و `register_recipient` هو `fund.dao` بس.
  2. صندوق الزكاة ما يصرفش غير لمستحق متسجل، والمبلغ ما يعديش رصيد التوكن.
  3. نصيب العاملين عليها (`Amilin`) ليه حد أقصى، الافتراضي 12.5%.
  4. تبرع الزكاة ما يتحولش لصندوق مش زكاة.
  5. مفيش أي method تسحب الفلوس غير `disburse`.
- **Events:**
  - `donation`
  - `disbursement`
  - `recipient_registered`
  - `fund_created`
- **حساب الإيصال:** `get_receipt(donation_id)` بيوزع الصرف على التبرعات بالترتيب (FIFO) لكل صندوق ولكل توكن. نقدر نعمله view في العقد. ولو الـ gas بقى عالي مع البيانات الكتير، نعمله في الواجهة بنفس الخوارزمية ونضيف اختبارات.

### 2.2 وكيل الزكاة
- **الـ LLM:** NEAR AI Cloud، والـ API بتاعه OpenAI-compatible (فيه $10 credits ببلاش). بيحول كلام عادي زي "عندي 200 ألف جنيه في البنك و50 جرام دهب عيار 21 ودين ليا 10 آلاف" لـ JSON منظم.
- **الحساب نفسه كود ثابت مش LLM:**
  - النصاب = 85 جرام دهب عيار 24 بالسعر الحالي.
  - الزكاة 2.5% على الأصول اللي فوق النصاب، بعد خصم الديون اللي عليك.
  - الدهب بيتحول لعيار 24 حسب العيار.
  - الكود عليه unit tests، وكل خطوة بتظهر للمستخدم مع مصدرها.
- **بعد الحساب:** زرار "ادفع زكاتك"، اللي بيفتح الدفع بـ NEAR أو USDC أو أي عملة عن طريق Intents.
- **تنبيه:** "الحاسبة للاسترشاد. راجع عالم أو جهة موثوقة في الحالات المركّبة."

### 2.3 الدفع
1. **NEAR testnet:** `donate` مع attached deposit.
2. **USDC testnet:** `ft_transfer_call` على عقد USDC، والـ `msg` = `{"fund_id":..,"kind":"zakat"}`.
3. **أي سلسلة (1Click):**
   - على testnet: dry quote بيعرض للمستخدم هيدفع كام بالـ USDT على Tron مثلاً.
   - على mainnet: deposit address فيه recipient عقد Amana. هنعمل تجربة حقيقية واحدة بمبلغ صغير ونحط رابطها في الـ README.

### 2.4 الواجهة
- Next.js (App Router) و TypeScript و Tailwind.
- RTL بالعربي، والإنجليزية متاحة بضغطة.
- `@hot-labs/near-connect` أو `@near-wallet-selector` (من غير Ledger، عشان مشكلة Next.js 15).
- القراءة من العقد بـ RPC view calls، فمش محتاجين قاعدة بيانات.
- صفحة الصندوق فيها:
  - رسم بيان لكل مصرف.
  - قائمة التبرعات والصرف، مع روابط nearblocks.
  - عداد "كل دولار متتبع".

---

## 3. الريبو

```
Near_Agent/
├── contract/            # Rust, near-sdk 5.x, cargo-near
│   ├── src/lib.rs
│   └── tests/
├── web/                 # Next.js app (Vercel root = web/)
│   ├── app/ (pages + api routes)
│   ├── lib/zakat.ts     # حساب ثابت + tests
│   ├── lib/near.ts      # RPC + wallet
│   └── lib/intents.ts   # 1Click
├── scripts/             # create-dao.sh, deploy.sh, seed-demo.ts
├── docs/PLAN.md
├── README.md            # للحكام: المشكلة، جرّبه في 3 خطوات، روابط
└── LICENSE (MIT)
```

**Vercel:** نعمل Import للريبو، و Root Directory = `web`. متغيرات البيئة:
- `NEXT_PUBLIC_NETWORK=testnet`
- `NEXT_PUBLIC_CONTRACT_ID`
- `NEARAI_API_KEY`
- `ONECLICK_JWT` (اختياري)

كل push بيطلع preview، وفرع main هو اللي بيروح production.

---

## 4. الجدول الزمني (9 لـ 14 نوفمبر)

| اليوم | الشغل | تعريف "خلص" |
|---|---|---|
| **9 نوفمبر (النهارده)** | البحث والخطة، وتثبيت `cargo-near` و `near-cli-rs`، وحساب testnet | الخطة مرفوعة ✅ |
| **10 نوفمبر** | العقد: الصناديق والتبرعات (NEAR و USDC) والمستحقين والصرف والقواعد والـ events والإيصال، مع unit tests، والنشر على testnet، وعمل DAO وربطه | تبرع وبعده proposal وموافقة وصرف، كلهم شغالين من CLI على testnet |
| **11 نوفمبر** | الواجهة: ربط المحفظة، وصفحة الصندوق، والتبرع، والإيصال، والعربي RTL، والنشر على Vercel | رابط Vercel شغال وتبرع حقيقي على testnet من المتصفح |
| **12 نوفمبر** | وكيل الزكاة (NEAR AI و `zakat.ts` والاختبارات)، وصفحة الأمناء (تسجيل مستحق وطلب صرف)، و 1Click dry quote | من كلام عادي بالعربي لمبلغ زكاة، ومنه لدفع، ومنه لإيصال |
| **13 نوفمبر** | تجربة 1Click على mainnet بمبلغ صغير، وبيانات demo، والـ README كامل، والـ LICENSE، وتصليح الأخطاء، وخطوات `npm test` | حد غريب يقدر يشغل المشروع من الـ README |
| **14 نوفمبر** | فيديو ديمو (2 لـ 3 دقايق)، وبوست X، والتسليم في الفورم (قبل 20:00 UTC عشان يبقى فيه هامش) | اتسلم ✅ |

**لو الوقت ضاق، دي حاجات ممكن نشيلها بالترتيب ده:** تجربة mainnet، وبعدها حساب الإيصال جوه العقد (نعمله في الواجهة)، وبعدها صفحة الأمناء (نستخدم CLI و Trezu بدالها).

---

## 5. سيناريو الديمو (للفيديو والحكام)
1. **"فاطمة"** بتكتب للوكيل: "عندي 150 ألف جنيه وطقم دهب 60 جرام عيار 21". الوكيل بيرد: "زكاتك X دولار"، وبيوضح الحساب خطوة بخطوة.
2. بتدفع بـ USDC، أو بنعرض quote لو هتدفع USDT على Tron. بيطلعلها إيصال #12.
3. أمين بيطلب صرف 50 USDC لأسرة متسجلة كـ "غارمين". اتنين أمناء بيوافقوا على Sputnik DAO، والعقد بينفذ.
4. **محاولة غش:** أمين لوحده بيحاول يصرف لحساب مش متسجل، أو يصرف من غير موافقة الـ DAO، و**العقد بيرفض**.
5. فاطمة بتفتح الإيصال وتلاقي: "فلوسك راحت 100% لأسرتين (غارمين، فقراء)"، ومعاها روابط المعاملات.

## 6. مخاطر وحلولها
| الخطر | الحل |
|---|---|
| Intents مالهاش testnet | dry quotes، وتجربة mainnet واحدة صغيرة، ونقول ده بوضوح في الـ README |
| خصوصية المستحقين | على السلسلة hash وتصنيف بس، والاسم والبيانات برا السلسلة |
| دقة الحساب الشرعي | حساب ثابت، والمصادر والافتراضات ظاهرة، وتنبيه للمستخدم إن الحاسبة للاسترشاد |
| مشاكل wallet-selector مع Next.js | near-connect، أو نشيل Ledger |
| الحكام ما يعرفوش الزكاة | نقدمه كـ "Transparent giving"، والزكاة أقوى use case فيه، ونشرح بسطر واحد بالإنجليزي |

## 7. المصادر
- [nearhackathon.com](https://nearhackathon.com/) و [HACKATHON.md](https://nearhackathon.com/HACKATHON.md)
- [NEAR Docs: Smart contract quickstart](https://docs.near.org/smart-contracts/quickstart) و [NEAR CLI](https://docs.near.org/tools/cli) و [Deploying](https://docs.near.org/smart-contracts/release/deploy)
- [near-sdk-rs](https://github.com/near/near-sdk-rs) و [cargo-near](https://lib.rs/crates/cargo-near)
- [NEAR Docs: DAO primitives](https://docs.near.org/primitives/dao) و [sputnik-dao-contract](https://github.com/near-daos/sputnik-dao-contract)
- [Token faucet](https://docs.near.org/getting-started/faucet) و [near-faucet.io](https://near-faucet.io/) و [USDC on NEAR (Circle)](https://www.circle.com/multi-chain-usdc/near)
- [1Click API](https://docs.near-intents.org/near-intents/1click-api) و [request a quote](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote)
- [wallet-selector](https://github.com/near/wallet-selector) و [@hot-labs/near-connect](https://www.npmjs.com/package/@hot-labs/near-connect)
- [Potlock docs](https://github.com/PotLock/docs) و [HAQQ](https://haqq.network/) و [ZakatDAO](https://github.com/JienWeng/ZakatDAO)
- [NEAR hackathon prompt examples](https://github.com/nearai/near-hackathon-prompt-examples)
