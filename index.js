/**
 * functions/index.js
 * منطق: طلب جديد -> pending -> تأكيد من الأدمن -> إرسال تلقائي لـ NOEST -> إشعار واتساب للزبون
 *
 * التثبيت:
 *   cd functions
 *   npm install firebase-admin firebase-functions node-fetch@2
 *
 * الإعداد (مرة وحدة، من الطرفية):
 *   firebase functions:config:set noest.token="TOKEN_TAAK" noest.guid="GUID_TAAK"
 *   firebase functions:config:set whatsapp.owner_phone="213XXXXXXXXX"
 *
 * الرفع:
 *   firebase deploy --only functions
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();
const db = admin.firestore();

/**
 * 1) عند إنشاء طلب جديد -> فقط نسجل، بلا اتصال بـ NOEST
 *    (الطلب يتسجل من index.html بـ status: "pending")
 *    هنا فقط نجهز حقول إضافية ونحسب الإحصائيات لاحقًا من الداشبورد مباشرة.
 */
exports.onOrderCreated = functions.firestore
  .document("orders/{orderId}")
  .onCreate(async (snap, context) => {
    const order = snap.data();
    await snap.ref.update({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: order.status || "pending",
    });
    // ملاحظة: إشعار الواتساب لك (صاحب المتجر) يتم يدويًا من لوحة التحكم عبر زر wa.me
    // (أبسط وأضمن من ربط API خارجي من البداية)
  });

/**
 * 2) عند ما يبدّل الأدمن status لـ "confirmed" من لوحة التحكم
 *    -> نرسل الطلب لـ NOEST تلقائيًا -> نسجل رقم التتبع -> نبدّل status لـ "sent_to_noest"
 */
exports.onOrderConfirmed = functions.firestore
  .document("orders/{orderId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    if (before.status === "confirmed" || after.status !== "confirmed") {
      return null; // ما تبدلش لـ confirmed توا، أو تبدلت قبل
    }

    const cfg = functions.config();
    const NOEST_TOKEN = cfg.noest?.token;
    const NOEST_GUID = cfg.noest?.guid;

    if (!NOEST_TOKEN || !NOEST_GUID) {
      await change.after.ref.update({
        status: "error",
        errorMessage: "مفاتيح NOEST ناقصة في functions config",
      });
      return null;
    }

    try {
      const res = await fetch("https://app.noest-dz.com/api/public/create/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_token: NOEST_TOKEN,
          user_guid: NOEST_GUID,
          reference: context.params.orderId,
          client: after.customerName || "",
          phone: after.customerPhone || "",
          phone_2: after.customerPhone2 || "",
          adresse: after.address || "",
          wilaya_id: after.wilayaId,
          commune: after.commune || "",
          montant: after.total || 0,
          remarque: after.note || "",
          produit: (after.items || []).map(i => `${i.name} x${i.qty}`).join(", "),
          type_id: 1,          // 1 = livraison, 2 = échange (راجع توثيق NOEST)
          poids: 1,
          stop_desk: after.stopDesk ? 1 : 0,
          station_code: after.stationCode || "",
          stock: 0,
        }),
      });

      const data = await res.json();

      if (data && data.success !== false && (data.tracking || data.tracking_number)) {
        await change.after.ref.update({
          status: "sent_to_noest",
          noestTracking: data.tracking || data.tracking_number,
          noestRaw: data,
          confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        await change.after.ref.update({
          status: "error",
          errorMessage: JSON.stringify(data),
        });
      }
    } catch (err) {
      await change.after.ref.update({
        status: "error",
        errorMessage: String(err),
      });
    }

    return null;
  });

/**
 * 3) حذف طلب (استدعاء من لوحة التحكم عبر httpsCallable، أضمن من حذف مباشر من الفرونت)
 */
exports.deleteOrder = functions.https.onCall(async (data, context) => {
  // TODO: تحقق من صلاحية الأدمن هنا (auth.token.admin === true) قبل الإنتاج
  const orderId = data.orderId;
  if (!orderId) {
    throw new functions.https.HttpsError("invalid-argument", "orderId مفقود");
  }
  await db.collection("orders").doc(orderId).delete();
  return { success: true };
});
