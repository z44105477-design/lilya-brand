/**
 * admin-dashboard.js
 * يعرض: قائمة الطلبات مع تأكيد/حذف + إحصائيات مبيعات (اليوم/الأسبوع/الشهر)
 *
 * ============ طريقة الدمج في admin.html ============
 *
 * 1) في <head> أو قبل </body>، زيد Firebase SDK (v9 modular عبر CDN):
 *    <script type="module" src="admin-dashboard.js"></script>
 *
 * 2) بدّل القيم تحت (firebaseConfig) بقيم مشروعك (نفس القيم اللي مستعملة
 *    في index.html القديم تاعك - ماشي تحتاج تبدلهم، فقط انسخهم من هناك).
 *
 * 3) زيد في admin.html هذا الـ HTML وين تحب يظهر الداشبورد:
 *
 *    <div id="statsBox" style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px;"></div>
 *    <div id="ordersBox"></div>
 *
 * ====================================================
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, onSnapshot, doc, updateDoc, deleteDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ⚠️ بدّل هذا بقيم مشروعك الحقيقية (نفس القيم اللي في index.html القديم)
const firebaseConfig = {
  apiKey: "XXXX",
  authDomain: "XXXX.firebaseapp.com",
  projectId: "XXXX",
  storageBucket: "XXXX.appspot.com",
  messagingSenderId: "XXXX",
  appId: "XXXX",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const STATUS_LABELS = {
  pending: "بانتظار التأكيد",
  confirmed: "مؤكد",
  sent_to_noest: "أُرسل لشركة التوصيل",
  error: "خطأ",
};
const STATUS_COLORS = {
  pending: "#e9a13a",
  confirmed: "#2f9e6f",
  sent_to_noest: "#3b6fd4",
  error: "#c65b5b",
};

let allOrders = [];

function renderStats() {
  const box = document.getElementById("statsBox");
  if (!box) return;

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay()); // الأحد كبداية الأسبوع
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const sumSince = (date) =>
    allOrders
      .filter(o => o.createdAtDate && o.createdAtDate >= date && o.status !== "error")
      .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

  const countSince = (date) =>
    allOrders.filter(o => o.createdAtDate && o.createdAtDate >= date && o.status !== "error").length;

  const stats = [
    { label: "مبيعات اليوم", value: sumSince(startOfDay), count: countSince(startOfDay) },
    { label: "مبيعات هذا الأسبوع", value: sumSince(startOfWeek), count: countSince(startOfWeek) },
    { label: "مبيعات هذا الشهر", value: sumSince(startOfMonth), count: countSince(startOfMonth) },
  ];

  box.innerHTML = stats.map(s => `
    <div style="flex:1;min-width:160px;background:#fff;border:1px solid #e5e0e1;border-radius:12px;padding:16px 18px;">
      <div style="font-size:12.5px;color:#8a8081;margin-bottom:6px;">${s.label}</div>
      <div style="font-size:22px;font-weight:800;">${s.value.toLocaleString("fr-DZ")} دج</div>
      <div style="font-size:12px;color:#8a8081;margin-top:2px;">${s.count} طلب</div>
    </div>
  `).join("");
}

function renderOrders() {
  const box = document.getElementById("ordersBox");
  if (!box) return;

  if (!allOrders.length) {
    box.innerHTML = `<p style="color:#8a8081;">لا توجد طلبات بعد.</p>`;
    return;
  }

  box.innerHTML = allOrders.map(o => `
    <div style="border:1px solid #e5e0e1;border-radius:10px;padding:14px 16px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-weight:700;font-size:14.5px;">${o.customerName || "بدون اسم"} — ${o.customerPhone || ""}</div>
          <div style="font-size:12.5px;color:#635a5b;">${o.wilaya || ""} ${o.commune ? "- " + o.commune : ""}</div>
          <div style="font-size:12.5px;color:#635a5b;margin-top:2px;">${(o.items || []).map(i => `${i.name} x${i.qty}`).join(", ")}</div>
        </div>
        <div style="text-align:end;">
          <div style="font-weight:800;">${(o.total || 0).toLocaleString("fr-DZ")} دج</div>
          <span style="display:inline-block;margin-top:4px;font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;color:#fff;background:${STATUS_COLORS[o.status] || "#888"};">
            ${STATUS_LABELS[o.status] || o.status}
          </span>
        </div>
      </div>
      ${o.status === "error" ? `<div style="font-size:12px;color:#c65b5b;margin-top:6px;">خطأ: ${o.errorMessage || ""}</div>` : ""}
      ${o.noestTracking ? `<div style="font-size:12px;color:#2f9e6f;margin-top:6px;">رقم التتبع NOEST: ${o.noestTracking}</div>` : ""}
      <div style="display:flex;gap:8px;margin-top:10px;">
        ${o.status === "pending" ? `<button data-confirm="${o.id}" style="background:#2f9e6f;color:#fff;border:none;border-radius:6px;padding:8px 14px;font-weight:700;cursor:pointer;">تأكيد الطلب</button>` : ""}
        <button data-delete="${o.id}" style="background:#fff;color:#c65b5b;border:1.5px solid #c65b5b;border-radius:6px;padding:8px 14px;font-weight:700;cursor:pointer;">حذف</button>
        ${o.customerPhone ? `<a href="https://wa.me/${o.customerPhone.replace(/^0/, '213')}" target="_blank" style="background:#25D366;color:#fff;border-radius:6px;padding:8px 14px;font-weight:700;text-decoration:none;">واتساب الزبون</a>` : ""}
      </div>
    </div>
  `).join("");

  box.querySelectorAll("[data-confirm]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("تأكيد هذا الطلب وإرساله لشركة التوصيل؟")) return;
      await updateDoc(doc(db, "orders", btn.dataset.confirm), { status: "confirmed" });
    });
  });

  box.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("حذف هذا الطلب نهائيًا؟")) return;
      await deleteDoc(doc(db, "orders", btn.dataset.delete));
    });
  });
}

function startListening() {
  const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    allOrders = snapshot.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        createdAtDate: data.createdAt?.toDate ? data.createdAt.toDate() : null,
      };
    });
    renderStats();
    renderOrders();
  });
}

startListening();
