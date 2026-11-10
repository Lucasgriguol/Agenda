/* global firebase */
"use strict";

/* ================== INIT ================== */

firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();
const FieldValue = firebase.firestore.FieldValue;

const DEFAULT_SERVICES = [
  { id: "soporte-web", name: "Soporte web", price: 0, order: 1 },
  { id: "redes", name: "Gestión de redes sociales", price: 0, order: 2 },
  { id: "web-redes", name: "Web + redes sociales", price: 0, order: 3 }
];

/* ================== ESTADO ================== */

let clients = [];
let payments = [];
let services = [];
let notes = [];
let specials = [];
let expenses = [];
let view = "dashboard";
let timer;
const month = localMonth(); // mes fijo = mes actual
let currentPayId = null;

/* ================== HELPERS ================== */

const $ = (s) => document.querySelector(s);

const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function money(v) {
  return Number(v || 0).toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0
  });
}

function localMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function md(m) {
  const [y, n] = m.split("-").map(Number);
  return new Date(y, n - 1, 1);
}

function ml(m) {
  const s = new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric"
  }).format(md(m));
  return s[0].toUpperCase() + s.slice(1);
}

function df(v) {
  return v ? String(v).split("-").reverse().join("/") : "-";
}

function cid(id) {
  return clients.find((c) => c.id === id)?.name || "Cliente eliminado";
}

function pid(id, m) {
  return `monthly__${id}__${m}`;
}

/* ================== PAGOS (ABONOS) ================== */

function getAbonos(p) {
  if (Array.isArray(p?.abonos) && p.abonos.length) return p.abonos;
  if (p?.status === "paid" && p?.paidDate) {
    return [
      {
        date: p.paidDate,
        amount: Number(p.amount || 0),
        method: p.method || "",
        note: "Pago registrado"
      }
    ];
  }
  return [];
}

function paidAmount(p) {
  return getAbonos(p).reduce((s, a) => s + Number(a.amount || 0), 0);
}

function remaining(p) {
  return Math.max(0, Number(p?.amount || 0) - paidAmount(p));
}

function payStatus(p) {
  const total = Number(p?.amount || 0);
  const paid = paidAmount(p);
  if (paid <= 0) return "pending";
  if (total > 0 && paid >= total) return "paid";
  return "partial";
}

function isPaid(p) {
  return payStatus(p) === "paid";
}

function badgeHtml(p) {
  const st = payStatus(p);
  if (st === "paid") return `<span class="badge paid">Pagó</span>`;
  if (st === "partial") return `<span class="badge partial">Parcial</span>`;
  return `<span class="badge pending">Pendiente</span>`;
}

/* ================== UI BASE ================== */

function toast(s) {
  const e = $("#toast");
  e.textContent = s;
  e.classList.add("show");
  clearTimeout(timer);
  timer = setTimeout(() => e.classList.remove("show"), 2200);
}

function modal(h) {
  $("#modalBody").innerHTML = h;
  $("#modal").classList.remove("hidden");
}

function close() {
  $("#modal").classList.add("hidden");
  $("#modalBody").innerHTML = "";
  currentPayId = null;
}

/* ================== CARGA DE DATOS ================== */

async function loadServices() {
  try {
    const s = await db.collection("services").get();
    if (s.empty) {
      for (const x of DEFAULT_SERVICES) {
        await db.collection("services").doc(x.id).set(x);
      }
      services = [...DEFAULT_SERVICES];
    } else {
      services = s.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort(
          (a, b) =>
            (a.order || 0) - (b.order || 0) ||
            String(a.name || "").localeCompare(String(b.name || ""), "es")
        );
    }
  } catch (e) {
    console.error(e);
    services = [...DEFAULT_SERVICES];
  }
}

async function loadNotes() {
  try {
    const s = await db.collection("notes").get();
    notes = s.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const av = a.updatedAt?.seconds || a.createdAt?.seconds || 0;
        const bv = b.updatedAt?.seconds || b.createdAt?.seconds || 0;
        return bv - av;
      });
  } catch (e) {
    console.error(e);
    notes = [];
  }
}

async function loadSpecials() {
  try {
    const s = await db.collection("specials").get();
    specials = s.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  } catch (e) {
    console.error(e);
    specials = [];
  }
}

async function load() {
  try {
    await loadServices();
    await loadNotes();
    await loadSpecials();
    await loadExpenses();

    const cs = await db.collection("clients").get();
    clients = cs.docs
      .map((x) => ({ id: x.id, ...x.data() }))
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "es")
      );

    const ps = await db.collection("payments").get();
    payments = ps.docs.map((x) => ({ id: x.id, ...x.data() }));

    await ensureMonth();
    render();
  } catch (e) {
    console.error(e);
    toast("Revisá la configuración de Firebase");
  }
}

async function ensureMonth() {
  const have = new Set(
    payments
      .filter((p) => p.type === "monthly" && p.month === month)
      .map((p) => p.id)
  );

  const actives = clients.filter((c) => c.active !== false);

  for (const c of actives) {
    const id = pid(c.id, month);
    if (have.has(id)) continue;

    const p = {
      clientId: c.id,
      month,
      type: "monthly",
      amount: Number(c.monthlyAmount || 0),
      status: "pending",
      paidDate: "",
      method: "",
      abonos: [],
      paidAmount: 0,
      service: c.service,
      createdAt: FieldValue.serverTimestamp()
    };

    await db.collection("payments").doc(id).set(p);
    payments.push({ id, ...p });
  }
}

function rows() {
  return clients
    .filter((c) => c.active !== false)
    .map((c) => ({ c, p: payments.find((p) => p.id === pid(c.id, month)) }))
    .filter((x) => x.p)
    .sort((a, b) =>
      String(a.c.name || "").localeCompare(String(b.c.name || ""), "es")
    );
}

/* ================== RENDER ================== */

function render() {
  const titles = {
    dashboard: "Inicio",
    clients: "Clientes",
    services: "Servicios",
    history: "Historial",
    notes: "Notas",
    expenses: "Gastos",
    calendar: "Vencimientos"
  };
  $("#title").textContent = titles[view] || "Inicio";

  $("#today").textContent = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date());

  $("#monthBadge").textContent = ml(month);

  ["dashboard", "clients", "services", "history", "notes", "expenses", "calendar"].forEach((v) =>
    $("#" + v).classList.toggle("hidden", v !== view)
  );

  document.querySelectorAll(".nav").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view)
  );

  dashboard();
  clientsView();
  servicesView();
  historyView();
  notesView();
  expensesView();
  calendarView();
}

/* ================== VISTA: DASHBOARD ================== */

function dashboard() {
  const r = rows();
  const total = r.reduce((s, x) => s + Number(x.p.amount || 0), 0);
  const cobradoMensual = r.reduce((s, x) => s + paidAmount(x.p), 0);
  const cobradoEspeciales = specials
    .filter((s) => String(s.date || "").slice(0, 7) === month)
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  const cobrado = cobradoMensual + cobradoEspeciales;
  const pendiente = r.reduce((s, x) => s + remaining(x.p), 0);
  const pagaron = r.filter((x) => payStatus(x.p) === "paid").length;
  const parciales = r.filter((x) => payStatus(x.p) === "partial").length;
  const gastosMes = expenseTotal(expenses.filter(x => String(x.date || "").slice(0,7) === month));
  const resultadoNeto = cobrado - gastosMes;

  $("#dashboard").innerHTML = `
    <div class="stats">
      <div class="card financial-card"><div class="label">Resultado neto</div><div class="value ${resultadoNeto >= 0 ? "positive" : "negative"}">${money(resultadoNeto)}</div><small>Ingresos cobrados menos gastos</small></div>
      <div class="card"><div class="label">Gastos del mes</div><div class="value negative">${money(gastosMes)}</div><small><a href="#" data-go-expenses>Ver gastos</a></small></div>
      <div class="card">
        <div class="label">Cobrado</div>
        <div class="value">${money(cobrado)}</div>
        ${cobradoEspeciales ? `<small style="color:#6b7280;font-size:11px">Incluye ${money(cobradoEspeciales)} de especiales</small>` : ""}
      </div>
      <div class="card"><div class="label">Pendiente</div><div class="value">${money(pendiente)}</div></div>
      <div class="card"><div class="label">Total del mes</div><div class="value">${money(total)}</div></div>
      <div class="card"><div class="label">Pagos</div><div class="value">${pagaron}/${r.length}</div></div>
    </div>

    <div class="table-card">
      <div class="head">
        <div>
          <h2>Estado de ${esc(ml(month))}</h2>
          <span>${parciales ? `${parciales} con pago parcial · ` : ""}El historial anterior no se toca.</span>
        </div>
        <div style="display:flex;gap:8px">
          <button class="action" id="syncMonth">Actualizar importes</button>
          <button class="action" id="payAll">Cobrar todo</button>
        </div>
      </div>
      ${r.length
      ? `<div style="overflow:auto">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th><th>Servicio</th>
                    <th>Total</th><th>Pagado</th><th>Estado</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  ${r
        .map(
          (x) => `<tr>
                        <td class="name">${esc(x.c.name)}</td>
                        <td>${esc(x.p.service)}</td>
                        <td><b>${money(x.p.amount)}</b></td>
                        <td>${paidAmount(x.p) ? money(paidAmount(x.p)) : "-"}</td>
                        <td>${badgeHtml(x.p)}</td>
                        <td>
                          <button class="action" data-pay="${x.p.id}">
                            ${isPaid(x.p) ? "Editar pago" : "Registrar pago"}
                          </button>
                        </td>
                      </tr>`
        )
        .join("")}
                </tbody>
              </table>
            </div>`
      : `<div class="empty"><b>No hay clientes</b>Agregá tu primer cliente.</div>`
    }
    </div>`;

  $("#syncMonth").addEventListener("click", syncMonth);
  $("#payAll").addEventListener("click", payAll);
}

async function syncMonth() {
  const r = rows();
  let n = 0;
  for (const x of r) {
    if (isPaid(x.p)) continue;
    const current = Number(x.p.amount || 0);
    const target = Number(x.c.monthlyAmount || 0);
    const svc = x.c.service;
    if (current === target && x.p.service === svc) continue;

    await db.collection("payments").doc(x.p.id).update({
      amount: target,
      service: svc,
      updatedAt: FieldValue.serverTimestamp()
    });
    x.p.amount = target;
    x.p.service = svc;
    n++;
  }
  render();
  toast(n ? `${n} pago(s) actualizado(s)` : "Todo al día");
}

async function payAll() {
  const list = rows().filter((x) => payStatus(x.p) !== "paid");
  if (!list.length) return toast("No hay pendientes");
  if (!confirm(`¿Marcar ${list.length} pago(s) como pagados por el total pendiente?`))
    return;

  const t = today();
  for (const x of list) {
    const rem = remaining(x.p);
    if (rem <= 0) continue;
    const abonos = [
      ...getAbonos(x.p),
      { date: t, amount: rem, method: "", note: "Cobro rápido" }
    ];
    const paid = abonos.reduce((s, a) => s + Number(a.amount || 0), 0);
    const total = Number(x.p.amount || 0);
    const status =
      total > 0 && paid >= total ? "paid" : paid > 0 ? "partial" : "pending";

    await db.collection("payments").doc(x.p.id).update({
      abonos,
      paidAmount: paid,
      status,
      paidDate: status === "paid" ? t : "",
      updatedAt: FieldValue.serverTimestamp()
    });
    Object.assign(x.p, {
      abonos,
      paidAmount: paid,
      status,
      paidDate: status === "paid" ? t : ""
    });
  }
  render();
  toast("Pagos registrados");
}

/* ================== VISTA: CLIENTES ================== */

function clientsView() {
  const table = (list) =>
    list.length
      ? `<div style="overflow:auto">
          <table>
            <thead>
              <tr><th>Cliente</th><th>Servicio</th><th>Mensual</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              ${list
        .map(
          (c) => `<tr>
                    <td class="name">${esc(c.name)}</td>
                    <td>${esc(c.service)}</td>
                    <td><b>${money(c.monthlyAmount)}</b></td>
                    <td>${c.active === false
              ? '<span class="badge pending">Inactivo</span>'
              : '<span class="badge paid">Activo</span>'
            }</td>
                    <td>
                      <button class="action" data-detail="${c.id}">Historial</button>
                      <button class="action" data-edit="${c.id}">Editar</button>
                      <button class="action danger" data-del-client="${c.id}">Eliminar</button>
                    </td>
                  </tr>`
        )
        .join("")}
            </tbody>
          </table>
        </div>`
      : `<div class="empty"><b>No hay clientes</b>Agregá el primero.</div>`;

  $("#clients").innerHTML = `
    <div class="toolbar">
      <h2>Clientes</h2>
      <input class="search" id="clientSearch" placeholder="Buscar cliente...">
    </div>
    <div class="table-card" id="clientTable">${table(clients)}</div>`;

  $("#clientSearch").addEventListener("input", (e) => {
    $("#clientTable").innerHTML = table(
      clients.filter((c) =>
        String(c.name || "").toLowerCase().includes(e.target.value.toLowerCase())
      )
    );
  });
}

function form(c = null) {
  const edit = !!c;

  if (!services.length) {
    toast("Primero creá un servicio");
    view = "services";
    render();
    return;
  }

  modal(`
    <h2>${edit ? "Editar cliente" : "Nuevo cliente"}</h2>
    <form class="form" id="clientForm">
      <div class="grid">
        <div class="field full">
          <label>Cliente</label>
          <input name="name" required placeholder="Ej: Nike, Juan Pérez, Marca ABC" value="${esc(c?.name || "")}">
        </div>
        <div class="field full">
          <label>Servicio</label>
          <select name="service" required>
            <option value="">Elegí un servicio</option>
            ${services
      .map(
        (s) => `<option value="${esc(s.name)}" data-price="${s.price}" ${s.name === c?.service ? "selected" : ""
          }>${esc(s.name)} — ${money(s.price)}</option>`
      )
      .join("")}
          </select>
        </div>
        <div class="field">
          <label>Día de vencimiento</label>
          <input name="dueDay" type="number" min="1" max="31" value="${Number(c?.dueDay || 10)}" required>
          <small>Para clientes existentes se usa el día 10 hasta que lo cambies.</small>
        </div>
        <div class="field full">
          <label>Monto mensual</label>
          <input name="amount" type="number" min="0" required value="${c?.monthlyAmount ?? ""}">
        </div>
        ${edit
      ? `<div class="field full">
                 <label>Estado</label>
                 <select name="active">
                   <option value="true" ${c.active !== false ? "selected" : ""}>Activo</option>
                   <option value="false" ${c.active === false ? "selected" : ""}>Inactivo</option>
                 </select>
               </div>
               <div class="field full">
                 <label style="display:flex;gap:8px;align-items:center;font-weight:400">
                   <input type="checkbox" name="sync" checked>
                   Actualizar el importe del pago pendiente de este mes
                 </label>
               </div>`
      : ""
    }
      </div>
      <div class="form-actions">
        <button type="button" class="secondary" data-close>Cancelar</button>
        <button class="primary">${edit ? "Guardar cambios" : "Crear cliente"}</button>
      </div>
    </form>`);

  const formEl = $("#clientForm");
  const sel = formEl.querySelector("[name=service]");
  const amt = formEl.querySelector("[name=amount]");

  sel.addEventListener("change", () => {
    const opt = sel.options[sel.selectedIndex];
    const price = opt.dataset.price;
    if (price !== undefined && (!edit || !amt.value)) amt.value = price;
  });

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(formEl);
    const name = String(f.get("name") || "").trim();
    const service = String(f.get("service") || "");
    const amount = Number(f.get("amount") || 0);
    const sync = f.get("sync") === "on";

    if (!name || !service) return toast("Completá cliente y servicio");

    const data = {
      name,
      service,
      monthlyAmount: amount,
      dueDay: Math.min(31, Math.max(1, Number(f.get("dueDay") || 10))),
      active: edit ? String(f.get("active")) !== "false" : true,
      updatedAt: FieldValue.serverTimestamp()
    };

    try {
      let clientId;
      if (edit) {
        await db.collection("clients").doc(c.id).update(data);
        clientId = c.id;
      } else {
        const ref = await db
          .collection("clients")
          .add({ ...data, createdAt: FieldValue.serverTimestamp() });
        clientId = ref.id;
      }

      if (edit && sync) {
        const payId = pid(clientId, month);
        const existing = payments.find((x) => x.id === payId);
        if (existing && !isPaid(existing)) {
          await db.collection("payments").doc(payId).update({
            amount,
            service,
            updatedAt: FieldValue.serverTimestamp()
          });
        }
      }

      close();
      toast(edit ? "Cliente actualizado" : "Cliente creado");
      await load();
    } catch (err) {
      console.error(err);
      toast("No se pudo guardar");
    }
  });
}

function deleteClient(id) {
  const c = clients.find((x) => x.id === id);
  if (!c) return;

  const count = payments.filter(
    (p) => p.type === "monthly" && p.clientId === id
  ).length;

  modal(`
    <h2>Eliminar cliente</h2>
    <p style="color:#6b7280;margin-top:4px">
      <b>${esc(c.name)}</b> · ${esc(c.service)} · ${money(c.monthlyAmount)} por mes
    </p>

    <div class="danger-text">
      ⚠️ Esta acción no se puede deshacer.${count
      ? ` Este cliente tiene <b>${count}</b> pago(s) en el historial.`
      : ""
    }
    </div>

    <form id="delClientForm" class="form">
      ${count
      ? `<div class="field">
               <label style="display:flex;gap:8px;align-items:center;font-weight:400">
                 <input type="radio" name="mode" value="keep" checked>
                 Eliminar solo el cliente (conservar su historial)
               </label>
               <label style="display:flex;gap:8px;align-items:center;font-weight:400;margin-top:6px">
                 <input type="radio" name="mode" value="wipe">
                 Eliminar el cliente <b>y todo su historial</b> (${count} pago/s)
               </label>
             </div>`
      : `<p style="color:#6b7280">No tiene pagos en el historial.</p>`
    }
      <div class="form-actions">
        <button type="button" class="secondary" data-close>Cancelar</button>
        <button class="primary" style="background:#b91c1c">Eliminar</button>
      </div>
    </form>`);

  $("#delClientForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const mode = String(f.get("mode") || "keep");

    try {
      if (mode === "wipe") {
        const list = payments.filter(
          (p) => p.type === "monthly" && p.clientId === id
        );
        for (const p of list) {
          await db.collection("payments").doc(p.id).delete();
        }
        payments = payments.filter(
          (p) => !(p.type === "monthly" && p.clientId === id)
        );
      }

      await db.collection("clients").doc(id).delete();
      clients = clients.filter((x) => x.id !== id);
      close();
      render();
      toast(
        mode === "wipe"
          ? "Cliente e historial eliminados"
          : "Cliente eliminado (historial conservado)"
      );
    } catch (err) {
      console.error(err);
      toast("No se pudo eliminar");
    }
  });
}

/* ================== VISTA: SERVICIOS ================== */

function servicesView() {
  $("#services").innerHTML = `
    <div class="toolbar">
      <div>
        <h2>Servicios</h2>
        <div style="color:#6b7280;font-size:13px">Precios por defecto. Al cambiar uno podés actualizar los clientes y pagos pendientes.</div>
      </div>
      <button class="primary" id="newService">+ Nuevo servicio</button>
    </div>
    <div class="table-card">
      ${services.length
      ? `<div style="overflow:auto">
              <table>
                <thead><tr><th>Servicio</th><th>Precio</th><th></th></tr></thead>
                <tbody>
                  ${services
        .map(
          (s) => `<tr>
                        <td class="name">${esc(s.name)}</td>
                        <td><b>${money(s.price)}</b></td>
                        <td>
                          <button class="action" data-edit-service="${s.id}">Editar</button>
                          <button class="action danger" data-del-service="${s.id}">Eliminar</button>
                        </td>
                      </tr>`
        )
        .join("")}
                </tbody>
              </table>
            </div>`
      : `<div class="empty"><b>No hay servicios</b>Creá el primero.</div>`
    }
    </div>`;

  $("#newService").addEventListener("click", () => serviceForm());
}

function serviceForm(s = null) {
  const edit = !!s;

  modal(`
    <h2>${edit ? "Editar servicio" : "Nuevo servicio"}</h2>
    <form id="serviceForm" class="form">
      <div class="grid">
        <div class="field full">
          <label>Nombre</label>
          <input name="name" required value="${esc(s?.name || "")}" placeholder="Ej: Pack redes + web">
        </div>
        <div class="field full">
          <label>Precio por defecto</label>
          <input name="price" type="number" min="0" required value="${s?.price ?? 0}">
        </div>
        ${edit
      ? `<div class="field full">
                 <label style="display:flex;gap:8px;align-items:center;font-weight:400">
                   <input type="checkbox" name="sync" checked>
                   Actualizar el precio de los clientes con este servicio y sus pagos pendientes
                 </label>
               </div>`
      : ""
    }
      </div>
      <div class="form-actions">
        <button type="button" class="secondary" data-close>Cancelar</button>
        <button class="primary">${edit ? "Guardar" : "Crear"}</button>
      </div>
    </form>`);

  $("#serviceForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") || "").trim();
    const price = Number(f.get("price") || 0);
    const sync = f.get("sync") === "on";

    if (!name) return toast("Poné un nombre");

    try {
      if (edit) {
        const oldName = s.name;
        await db.collection("services").doc(s.id).update({ name, price });

        if (oldName !== name) {
          const affected = clients.filter((c) => c.service === oldName);
          for (const c of affected) {
            await db.collection("clients").doc(c.id).update({
              service: name,
              updatedAt: FieldValue.serverTimestamp()
            });
          }
        }

        if (sync) {
          const affected = clients.filter((c) => c.service === name);
          for (const c of affected) {
            await db.collection("clients").doc(c.id).update({
              monthlyAmount: price,
              updatedAt: FieldValue.serverTimestamp()
            });
          }
        }
      } else {
        const id =
          name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
          `svc-${Date.now()}`;
        await db
          .collection("services")
          .doc(id)
          .set({ name, price, order: services.length + 1 });
      }

      close();
      toast(edit ? "Servicio actualizado" : "Servicio creado");
      await load();
      if (edit && sync) await syncMonth();
    } catch (err) {
      console.error(err);
      toast("No se pudo guardar");
    }
  });
}

async function deleteService(id) {
  const s = services.find((x) => x.id === id);
  if (!s) return;
  const used = clients.filter((c) => c.service === s.name).length;
  const msg = used
    ? `Hay ${used} cliente(s) usando "${s.name}". ¿Eliminar igual?`
    : `¿Eliminar "${s.name}"?`;
  if (!confirm(msg)) return;
  await db.collection("services").doc(id).delete();
  toast("Servicio eliminado");
  await load();
}

/* ================== VISTA: HISTORIAL (solo pagos) ================== */

function historyView() {
  const list = [];
  payments
    .filter((p) => p.type === "monthly")
    .forEach((p) => {
      getAbonos(p).forEach((a, i) => {
        list.push({
          kind: "abono",
          key: `${p.id}|${i}`,
          clientId: p.clientId,
          clientName: cid(p.clientId),
          concept: p.service || "Mensual",
          month: p.month,
          date: a.date,
          amount: Number(a.amount || 0),
          method: a.method || "",
          note: a.note || "",
          isSpecial: false
        });
      });
    });

  specials.forEach((s) => {
    list.push({
      kind: "special",
      key: s.id,
      clientId: s.clientId || "",
      clientName: s.clientName || (s.clientId ? cid(s.clientId) : "Sin cliente"),
      concept: s.concept || "Cobro especial",
      month: s.date ? String(s.date).slice(0, 7) : "",
      date: s.date,
      amount: Number(s.amount || 0),
      method: s.method || "",
      note: s.note || "",
      isSpecial: true
    });
  });

  list.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const table = (a) =>
    a.length
      ? `<div style="overflow:auto">
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Tipo</th><th>Cliente</th><th>Concepto</th>
                <th>Mes</th><th>Monto</th><th>Método</th><th>Nota</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${a
        .map(
          (x) => `<tr>
                    <td>${df(x.date)}</td>
                    <td>${x.isSpecial
              ? '<span class="badge partial">Especial</span>'
              : '<span class="badge paid">Mensual</span>'
            }</td>
                    <td class="name">${esc(x.clientName)}</td>
                    <td>${esc(x.concept)}</td>
                    <td>${x.month ? esc(ml(x.month)) : "-"}</td>
                    <td><b>${money(x.amount)}</b></td>
                    <td>${esc(x.method || "-")}</td>
                    <td>${esc(x.note || "-")}</td>
                    <td>
                      <button class="action danger" ${x.isSpecial
              ? `data-del-special="${x.key}"`
              : `data-del-abono="${x.key}"`
            }>Eliminar</button>
                    </td>
                  </tr>`
        )
        .join("")}
            </tbody>
          </table>
        </div>`
      : `<div class="empty"><b>No hay pagos registrados todavía</b>Los cobros van a aparecer acá.</div>`;

  $("#history").innerHTML = `
    <div class="toolbar">
      <div>
        <h2>Historial de pagos</h2>
        <div style="color:#6b7280;font-size:13px">Todos los cobros registrados, mes a mes.</div>
      </div>
      <input class="search" id="histSearch" placeholder="Buscar cliente o concepto...">
    </div>
    <div class="table-card" id="histTable">${table(list)}</div>`;

  $("#histSearch").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    $("#histTable").innerHTML = table(
      list.filter(
        (p) =>
          p.clientName.toLowerCase().includes(q) ||
          String(p.concept || "").toLowerCase().includes(q)
      )
    );
  });
}

/* ================== DETALLE DE CLIENTE ================== */

function detail(id) {
  const c = clients.find((x) => x.id === id);
  if (!c) return;

  const h = payments
    .filter((p) => p.type === "monthly" && p.clientId === id)
    .sort((a, b) => String(b.month).localeCompare(String(a.month)));

  const specialsList = specials.filter((s) => s.clientId === id);

  const totalCobrado =
    h.reduce((s, p) => s + paidAmount(p), 0) +
    specialsList.reduce((s, x) => s + Number(x.amount || 0), 0);
  const totalPendiente = h.reduce((s, p) => s + remaining(p), 0);

  modal(`
    <h2>${esc(c.name)}</h2>
    <p style="color:#6b7280">
      ${esc(c.service)} · ${money(c.monthlyAmount)} por mes
    </p>
    <div class="stats" style="grid-template-columns:1fr 1fr">
      <div class="card"><div class="label">Cobrado histórico</div><div class="value">${money(totalCobrado)}</div></div>
      <div class="card"><div class="label">Pendiente histórico</div><div class="value">${money(totalPendiente)}</div></div>
    </div>

    ${specialsList.length
      ? `<div class="table-card">
             <div class="head"><h2>Cobros especiales</h2></div>
             <div style="overflow:auto">
               <table>
                 <thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th><th>Método</th></tr></thead>
                 <tbody>
                   ${specialsList
        .map(
          (s) => `<tr>
                         <td>${df(s.date)}</td>
                         <td>${esc(s.concept)}</td>
                         <td><b>${money(s.amount)}</b></td>
                         <td>${esc(s.method || "-")}</td>
                       </tr>`
        )
        .join("")}
                 </tbody>
               </table>
             </div>
           </div>`
      : ""
    }

    <div class="table-card">
      <div class="head">
        <h2>Historial mensual</h2>
        ${h.length
      ? `<button class="action danger" data-wipe-client="${c.id}">Borrar todo el historial</button>`
      : ""
    }
      </div>
      ${h.length
      ? `<div style="overflow:auto">
              <table>
                <thead>
                  <tr><th>Mes</th><th>Total</th><th>Pagado</th><th>Estado</th><th>Último pago</th><th></th></tr>
                </thead>
                <tbody>
                  ${h
        .map((p) => {
          const ab = getAbonos(p);
          const last = ab[ab.length - 1];
          return `<tr>
                        <td>${esc(ml(p.month))}</td>
                        <td>${money(p.amount)}</td>
                        <td>${paidAmount(p) ? money(paidAmount(p)) : "-"}</td>
                        <td>${badgeHtml(p)}</td>
                        <td>${last ? `${df(last.date)} · ${esc(last.method || "s/m")}` : "-"}</td>
                        <td>
                          <button class="action danger" data-del-pay="${p.id}">Eliminar</button>
                        </td>
                      </tr>`;
        })
        .join("")}
                </tbody>
              </table>
            </div>`
      : `<div class="empty"><b>Sin historial todavía</b></div>`
    }
    </div>`);
}

/* ================== PAGO (MODAL) ================== */

function pay(id) {
  const p = payments.find((x) => x.id === id);
  if (!p) return;
  currentPayId = id;
  renderPayModal(p);
}

function renderPayModal(p) {
  const abonos = getAbonos(p);
  const paid = paidAmount(p);
  const total = Number(p.amount || 0);
  const rem = Math.max(0, total - paid);

  modal(`
    <h2>Pago de ${esc(cid(p.clientId))}</h2>
    <p style="color:#6b7280">${esc(p.service || "Sin servicio")} · ${esc(ml(p.month))}</p>

    <div class="pay-summary">
      <div><small>Total</small><b>${money(total)}</b></div>
      <div><small>Pagado</small><b style="color:#15803d">${money(paid)}</b></div>
      <div><small>Pendiente</small><b style="color:${rem > 0 ? "#b45309" : "#15803d"}">${money(rem)}</b></div>
    </div>

    ${abonos.length
      ? `<div class="abonos-list">
             <h3>Abonos registrados (${abonos.length})</h3>
             ${abonos
        .map(
          (a, i) => `
                   <div class="abono-row">
                     <span>${df(a.date)} · ${esc(a.method || "sin método")}${a.note ? ` · ${esc(a.note)}` : ""
            }</span>
                     <b>${money(a.amount)}</b>
                     <button class="action small" data-rm-abono="${i}" title="Eliminar">×</button>
                   </div>`
        )
        .join("")}
           </div>`
      : ""
    }

    <form id="payForm" class="form" style="margin-top:14px">
      <h3 style="margin:0;font-size:14px">${abonos.length ? "Nuevo abono" : "Registrar pago"}</h3>
      <div class="grid">
        <div class="field">
          <label>Monto</label>
          <input name="amount" type="number" min="0" step="1" value="${rem > 0 ? rem : ""}" required>
        </div>
        <div class="field">
          <label>Fecha</label>
          <input name="date" type="date" value="${today()}" required>
        </div>
        <div class="field">
          <label>Método</label>
          <select name="method">
            <option value="">No especificado</option>
            <option>Transferencia</option>
            <option>Efectivo</option>
            <option>Mercado Pago</option>
            <option>Tarjeta</option>
            <option>Otro</option>
          </select>
        </div>
        <div class="field">
          <label>Nota (opcional)</label>
          <input name="note" placeholder="Ej: primer pago">
        </div>
      </div>
      <div class="form-actions">
        ${abonos.length ? `<button type="button" class="secondary" id="resetPay">Borrar todo</button>` : ""}
        <button type="button" class="secondary" data-close>Cancelar</button>
        <button class="primary">${abonos.length ? "Agregar abono" : "Confirmar pago"}</button>
      </div>
    </form>`);

  $("#payForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amount = Number(f.get("amount") || 0);
    const date = String(f.get("date"));
    const method = String(f.get("method") || "");
    const note = String(f.get("note") || "").trim();

    if (amount <= 0) return toast("Ingresá un monto mayor a 0");

    const newAbonos = [...getAbonos(p), { date, amount, method, note }];
    const newPaid = newAbonos.reduce((s, a) => s + Number(a.amount || 0), 0);
    const newStatus =
      total > 0 && newPaid >= total ? "paid" : newPaid > 0 ? "partial" : "pending";

    try {
      await db.collection("payments").doc(p.id).update({
        abonos: newAbonos,
        paidAmount: newPaid,
        status: newStatus,
        paidDate: newStatus === "paid" ? date : "",
        method,
        updatedAt: FieldValue.serverTimestamp()
      });
      Object.assign(p, {
        abonos: newAbonos,
        paidAmount: newPaid,
        status: newStatus,
        paidDate: newStatus === "paid" ? date : "",
        method
      });
      close();
      render();
      toast("Pago registrado");
    } catch (err) {
      console.error(err);
      toast("No se pudo registrar");
    }
  });
}

async function removeAbono(idx) {
  const p = payments.find((x) => x.id === currentPayId);
  if (!p) return;
  const abonos = getAbonos(p).filter((_, i) => i !== idx);
  const newPaid = abonos.reduce((s, a) => s + Number(a.amount || 0), 0);
  const total = Number(p.amount || 0);
  const newStatus =
    total > 0 && newPaid >= total ? "paid" : newPaid > 0 ? "partial" : "pending";
  const last = abonos[abonos.length - 1];

  try {
    await db.collection("payments").doc(p.id).update({
      abonos,
      paidAmount: newPaid,
      status: newStatus,
      paidDate: newStatus === "paid" && last ? last.date : "",
      updatedAt: FieldValue.serverTimestamp()
    });
    Object.assign(p, {
      abonos,
      paidAmount: newPaid,
      status: newStatus,
      paidDate: newStatus === "paid" && last ? last.date : ""
    });
    renderPayModal(p);
    render();
    toast("Abono eliminado");
  } catch (err) {
    console.error(err);
    toast("No se pudo eliminar");
  }
}

async function resetPay() {
  const p = payments.find((x) => x.id === currentPayId);
  if (!p) return;
  if (!confirm("¿Borrar todos los abonos de este pago?")) return;

  try {
    await db.collection("payments").doc(p.id).update({
      abonos: [],
      paidAmount: 0,
      status: "pending",
      paidDate: "",
      method: "",
      updatedAt: FieldValue.serverTimestamp()
    });
    Object.assign(p, {
      abonos: [],
      paidAmount: 0,
      status: "pending",
      paidDate: "",
      method: ""
    });
    renderPayModal(p);
    render();
    toast("Pago reiniciado");
  } catch (err) {
    console.error(err);
  }
}

/* ================== ELIMINAR PAGOS / ABONOS ================== */

async function deleteAbonoFromHistory(key) {
  const [payId, idxStr] = String(key).split("|");
  const idx = Number(idxStr);
  const p = payments.find((x) => x.id === payId);
  if (!p) return;

  const abonos = getAbonos(p);
  const a = abonos[idx];
  if (!a) return;

  const msg =
    `¿Eliminar el pago de ${money(a.amount)} del ${df(a.date)}?\n` +
    `Cliente: ${cid(p.clientId)} · Mes: ${ml(p.month)}\n\n` +
    `Esta acción no se puede deshacer.`;
  if (!confirm(msg)) return;

  const newAbonos = abonos.filter((_, i) => i !== idx);
  const newPaid = newAbonos.reduce((s, x) => s + Number(x.amount || 0), 0);
  const total = Number(p.amount || 0);
  const newStatus =
    total > 0 && newPaid >= total ? "paid" : newPaid > 0 ? "partial" : "pending";
  const last = newAbonos[newAbonos.length - 1];

  try {
    await db.collection("payments").doc(p.id).update({
      abonos: newAbonos,
      paidAmount: newPaid,
      status: newStatus,
      paidDate: newStatus === "paid" && last ? last.date : "",
      updatedAt: FieldValue.serverTimestamp()
    });
    Object.assign(p, {
      abonos: newAbonos,
      paidAmount: newPaid,
      status: newStatus,
      paidDate: newStatus === "paid" && last ? last.date : ""
    });
    render();
    toast("Pago eliminado");
  } catch (err) {
    console.error(err);
    toast("No se pudo eliminar");
  }
}

async function deletePayment(id) {
  const p = payments.find((x) => x.id === id);
  if (!p) return;

  const cliente = cid(p.clientId);
  const msg =
    `¿Eliminar el pago de ${cliente} de ${ml(p.month)}?\n` +
    `Total: ${money(p.amount)} · Pagado: ${money(paidAmount(p))}\n\n` +
    `Esta acción no se puede deshacer.`;

  if (!confirm(msg)) return;

  try {
    await db.collection("payments").doc(id).delete();
    payments = payments.filter((x) => x.id !== id);
    render();
    toast("Pago eliminado del historial");
  } catch (err) {
    console.error(err);
    toast("No se pudo eliminar");
  }
}

async function wipeClientHistory(clientId) {
  const list = payments.filter(
    (p) => p.type === "monthly" && p.clientId === clientId
  );
  if (!list.length) return toast("Sin historial");

  if (
    !confirm(
      `¿Borrar los ${list.length} pagos de ${cid(clientId)}?\n\nEsta acción no se puede deshacer.`
    )
  )
    return;

  try {
    for (const p of list) {
      await db.collection("payments").doc(p.id).delete();
    }
    payments = payments.filter(
      (p) => !(p.type === "monthly" && p.clientId === clientId)
    );
    close();
    render();
    toast("Historial del cliente eliminado");
  } catch (err) {
    console.error(err);
    toast("No se pudo eliminar");
  }
}

/* ================== COBRO ESPECIAL ================== */

function specialForm() {
  modal(`
    <h2>Nuevo cobro especial</h2>
    <p style="color:#6b7280;margin-top:4px">
      Para ingresos que no son el abono mensual (torneos, trabajos puntuales, ventas, etc.).
    </p>
    <form id="specialForm" class="form">
      <div class="grid">
        <div class="field full">
          <label>Concepto</label>
          <input name="concept" required placeholder="Ej: Torneo de fútbol, Diseño de logo">
        </div>
        <div class="field full">
          <label>Cliente (opcional)</label>
          <select name="clientId">
            <option value="">Sin cliente</option>
            ${clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Monto</label>
          <input name="amount" type="number" min="0" step="1" required>
        </div>
        <div class="field">
          <label>Fecha</label>
          <input name="date" type="date" value="${today()}" required>
        </div>
        <div class="field">
          <label>Método</label>
          <select name="method">
            <option value="">No especificado</option>
            <option>Transferencia</option>
            <option>Efectivo</option>
            <option>Mercado Pago</option>
            <option>Tarjeta</option>
            <option>Otro</option>
          </select>
        </div>
        <div class="field">
          <label>Nota (opcional)</label>
          <input name="note" placeholder="Ej: 12 inscriptos">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="secondary" data-close>Cancelar</button>
        <button class="primary">Guardar cobro</button>
      </div>
    </form>`);

  $("#specialForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const concept = String(f.get("concept") || "").trim();
    const clientId = String(f.get("clientId") || "");
    const amount = Number(f.get("amount") || 0);
    const date = String(f.get("date"));
    const method = String(f.get("method") || "");
    const note = String(f.get("note") || "").trim();

    if (!concept) return toast("Poné un concepto");
    if (amount <= 0) return toast("Ingresá un monto mayor a 0");

    try {
      await db.collection("specials").add({
        concept,
        clientId,
        clientName: clientId ? cid(clientId) : "",
        amount,
        date,
        method,
        note,
        createdAt: FieldValue.serverTimestamp()
      });
      close();
      toast("Cobro especial guardado");
      await loadSpecials();
      render();
    } catch (err) {
      console.error(err);
      toast("No se pudo guardar");
    }
  });
}

async function deleteSpecial(id) {
  const s = specials.find((x) => x.id === id);
  if (!s) return;
  if (
    !confirm(
      `¿Eliminar el cobro especial "${s.concept || "Sin concepto"}" de ${money(
        s.amount
      )}?`
    )
  )
    return;

  try {
    await db.collection("specials").doc(id).delete();
    specials = specials.filter((x) => x.id !== id);
    render();
    toast("Cobro especial eliminado");
  } catch (err) {
    console.error(err);
    toast("No se pudo eliminar");
  }
}

/* ================== VISTA: NOTAS ================== */

function notesView() {
  $("#notes").innerHTML = `
    <div class="toolbar">
      <div>
        <h2>Notas</h2>
        <div style="color:#6b7280;font-size:13px">Anotá recordatorios, pendientes o ideas.</div>
      </div>
      <button class="primary" id="newNote">+ Nueva nota</button>
    </div>
    ${notes.length
      ? `<div class="notes-grid">
            ${notes
        .map(
          (n) => `<div class="note-card">
                  <h3>${esc(n.title || "Sin título")}</h3>
                  <p>${esc(n.body || "")}</p>
                  <div class="note-date">${df(n.date || "")}</div>
                  <div class="note-actions">
                    <button class="action" data-edit-note="${n.id}">Editar</button>
                    <button class="action danger" data-del-note="${n.id}">Eliminar</button>
                  </div>
                </div>`
        )
        .join("")}
          </div>`
      : `<div class="table-card"><div class="empty"><b>No hay notas</b>Creá la primera.</div></div>`
    }`;

  $("#newNote").addEventListener("click", () => noteForm());
}

function noteForm(n = null) {
  const edit = !!n;

  modal(`
    <h2>${edit ? "Editar nota" : "Nueva nota"}</h2>
    <form id="noteForm" class="form">
      <div class="grid">
        <div class="field full">
          <label>Título</label>
          <input name="title" required value="${esc(n?.title || "")}" placeholder="Ej: Llamar a Juan">
        </div>
        <div class="field full">
          <label>Contenido</label>
          <textarea name="body" placeholder="Escribí acá...">${esc(n?.body || "")}</textarea>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="secondary" data-close>Cancelar</button>
        <button class="primary">${edit ? "Guardar" : "Crear nota"}</button>
      </div>
    </form>`);

  $("#noteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const title = String(f.get("title") || "").trim();
    const body = String(f.get("body") || "").trim();
    if (!title) return toast("Poné un título");

    try {
      if (edit) {
        await db.collection("notes").doc(n.id).update({
          title,
          body,
          date: n.date || today(),
          updatedAt: FieldValue.serverTimestamp()
        });
      } else {
        await db.collection("notes").add({
          title,
          body,
          date: today(),
          createdAt: FieldValue.serverTimestamp()
        });
      }
      close();
      toast(edit ? "Nota actualizada" : "Nota creada");
      await loadNotes();
      render();
    } catch (err) {
      console.error(err);
      toast("No se pudo guardar");
    }
  });
}

async function deleteNote(id) {
  const n = notes.find((x) => x.id === id);
  if (!n) return;
  if (!confirm(`¿Eliminar la nota "${n.title || "Sin título"}"?`)) return;
  try {
    await db.collection("notes").doc(id).delete();
    notes = notes.filter((x) => x.id !== id);
    render();
    toast("Nota eliminada");
  } catch (err) {
    console.error(err);
    toast("No se pudo eliminar");
  }
}

/* ================== GASTOS Y CALENDARIO ================== */
async function loadExpenses() {
  try {
    const snap = await db.collection("expenses").get();
    expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => String(b.date || "").localeCompare(String(a.date || "")));
  } catch (e) { console.error("No se pudieron cargar los gastos", e); expenses = []; }
}
function expenseTotal(list) { return list.reduce((n,x) => n + Number(x.amount || 0), 0); }
function expenseForm(item=null) {
  modal(`<h2>${item ? "Editar gasto" : "Nuevo gasto"}</h2>
    <form class="form" id="expenseForm"><div class="grid">
      <div class="field full"><label>Concepto</label><input name="concept" required maxlength="90" value="${esc(item?.concept || "")}" placeholder="Ej. Internet, publicidad..."></div>
      <div class="field"><label>Monto</label><input name="amount" type="number" min="1" step="0.01" required value="${item?.amount ?? ""}"></div>
      <div class="field"><label>Fecha</label><input name="date" type="date" required value="${esc(item?.date || today())}"></div>
      <div class="field"><label>Categoría</label><select name="category"><option ${item?.category==="Operativo"?"selected":""}>Operativo</option><option ${item?.category==="Herramientas"?"selected":""}>Herramientas</option><option ${item?.category==="Publicidad"?"selected":""}>Publicidad</option><option ${item?.category==="Servicios"?"selected":""}>Servicios</option><option ${item?.category==="Otro"?"selected":""}>Otro</option></select></div>
      <div class="field"><label>Medio de pago</label><input name="method" value="${esc(item?.method || "")}" placeholder="Efectivo, transferencia..."></div>
      <div class="field full"><label>Nota (opcional)</label><input name="note" value="${esc(item?.note || "")}"></div>
    </div><div class="form-actions"><button type="button" class="secondary" data-close>Cancelar</button><button class="primary">Guardar gasto</button></div></form>`);
  $("#expenseForm").addEventListener("submit", async e => { e.preventDefault(); const f=new FormData(e.currentTarget); const data={concept:String(f.get("concept")).trim(),amount:Number(f.get("amount")),date:String(f.get("date")),category:String(f.get("category")),method:String(f.get("method")||""),note:String(f.get("note")||""),updatedAt:FieldValue.serverTimestamp()};
    try { if(item) await db.collection("expenses").doc(item.id).update(data); else await db.collection("expenses").add({...data,createdAt:FieldValue.serverTimestamp()}); close(); await loadExpenses(); render(); toast("Gasto guardado"); } catch(err){console.error(err);toast("No se pudo guardar el gasto");}
  });
}
function expensesView() {
  const el=$("#expenses"); if(!el) return;
  const list=expenses.filter(x=>String(x.date||"").slice(0,7)===month);
  el.innerHTML=`<div class="section-top"><div><h2>Gastos de ${esc(ml(month))}</h2><p>Registrá egresos para conocer tu resultado real.</p></div><button class="primary" id="addExpense">+ Nuevo gasto</button></div>
  <div class="stats"><div class="card"><div class="label">Total de gastos</div><div class="value negative">${money(expenseTotal(list))}</div></div><div class="card"><div class="label">Movimientos</div><div class="value">${list.length}</div></div></div>
  <div class="table-card"><div class="head"><h2>Movimientos</h2><span>${list.length} registros</span></div>${list.length?`<div class="table-scroll"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Medio</th><th>Monto</th><th></th></tr></thead><tbody>${list.map(x=>`<tr><td>${df(x.date)}</td><td class="name">${esc(x.concept)}</td><td>${esc(x.category||"-")}</td><td>${esc(x.method||"-")}</td><td class="negative"><b>${money(x.amount)}</b></td><td><button class="action" data-edit-expense="${x.id}">Editar</button> <button class="action danger" data-del-expense="${x.id}">Eliminar</button></td></tr>`).join("")}</tbody></table></div>`:`<div class="empty"><b>Sin gastos este mes</b>Cuando registres uno, va a aparecer acá.</div>`}</div>`;
  $("#addExpense").onclick=()=>expenseForm();
}
function calendarView() {
  const el=$("#calendar"); if(!el) return;
  const [yy,mm]=month.split("-").map(Number); const days=new Date(yy,mm,0).getDate();
  const events=[];
  clients.filter(c=>c.active!==false).forEach(c=>{const day=Math.min(days,Math.max(1,Number(c.dueDay||10)));const p=payments.find(x=>x.id===pid(c.id,month));events.push({day,name:c.name,amount:p?remaining(p):Number(c.monthlyAmount||0),status:p?payStatus(p):"pending",id:c.id});});
  const byDay=Array.from({length:days},(_,i)=>({day:i+1,items:events.filter(x=>x.day===i+1)}));
  el.innerHTML=`<div class="section-top"><div><h2>Calendario de ${esc(ml(month))}</h2><p>Los vencimientos se calculan según el día configurado en cada cliente.</p></div></div><div class="calendar-grid">${["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(d=>`<div class="calendar-weekday">${d}</div>`).join("")}${Array.from({length:(new Date(yy,mm-1,1).getDay()+6)%7},()=>'<div class="calendar-cell muted"></div>').join("")}${byDay.map(d=>`<div class="calendar-cell"><b>${d.day}</b>${d.items.map(x=>`<div class="calendar-event ${x.status}" title="${esc(x.name)}">${esc(x.name)}<small>${x.amount?money(x.amount):"Al día"}</small></div>`).join("")}</div>`).join("")}</div>`;
}
async function removeExpense(id) { if(!confirm("¿Eliminar este gasto?")) return; try {await db.collection("expenses").doc(id).delete();await loadExpenses();render();toast("Gasto eliminado");}catch(e){console.error(e);toast("No se pudo eliminar");} }

/* ================== EVENTOS ================== */

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) {
    close();
    return;
  }

  const rm = e.target.closest("[data-rm-abono]");
  if (rm) {
    removeAbono(Number(rm.dataset.rmAbono));
    return;
  }

  if (e.target.id === "resetPay") {
    resetPay();
    return;
  }

  const da = e.target.closest("[data-del-abono]");
  if (da) {
    deleteAbonoFromHistory(da.dataset.delAbono);
    return;
  }

  const ds2 = e.target.closest("[data-del-special]");
  if (ds2) {
    deleteSpecial(ds2.dataset.delSpecial);
    return;
  }

  const dp = e.target.closest("[data-del-pay]");
  if (dp) {
    deletePayment(dp.dataset.delPay);
    return;
  }

  const wc = e.target.closest("[data-wipe-client]");
  if (wc) {
    wipeClientHistory(wc.dataset.wipeClient);
    return;
  }

  const dc = e.target.closest("[data-del-client]");
  if (dc) {
    deleteClient(dc.dataset.delClient);
    return;
  }

  const n = e.target.closest(".nav");
  if (n) {
    view = n.dataset.view;
    render();
    return;
  }

  if (e.target.closest("#newClient,[data-new]")) {
    form();
    return;
  }

  if (e.target.closest("#newSpecialPay")) {
    specialForm();
    return;
  }

  const p = e.target.closest("[data-pay]");
  if (p) {
    pay(p.dataset.pay);
    return;
  }

  const d = e.target.closest("[data-detail]");
  if (d) {
    detail(d.dataset.detail);
    return;
  }

  const x = e.target.closest("[data-edit]");
  if (x) {
    const c = clients.find((c) => c.id === x.dataset.edit);
    if (c) form(c);
    return;
  }

  const es = e.target.closest("[data-edit-service]");
  if (es) {
    const s = services.find((s) => s.id === es.dataset.editService);
    if (s) serviceForm(s);
    return;
  }

  const ds = e.target.closest("[data-del-service]");
  if (ds) {
    deleteService(ds.dataset.delService);
    return;
  }

  const en = e.target.closest("[data-edit-note]");
  if (en) {
    const nt = notes.find((x) => x.id === en.dataset.editNote);
    if (nt) noteForm(nt);
    return;
  }

  const dn = e.target.closest("[data-del-note]");
  if (dn) {
    deleteNote(dn.dataset.delNote);
    return;
  }
});

/* ================== ARRANQUE ================== */

load();

document.addEventListener("click", e => {
  const edit=e.target.closest("[data-edit-expense]"); if(edit){const x=expenses.find(v=>v.id===edit.dataset.editExpense);if(x)expenseForm(x);return;}
  const del=e.target.closest("[data-del-expense]"); if(del){removeExpense(del.dataset.delExpense);return;}
});

document.addEventListener("click", e => { if(e.target.closest("[data-go-expenses]")){e.preventDefault();view="expenses";render();} });
