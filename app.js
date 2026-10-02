/* global firebase */
"use strict";

firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();
const FieldValue = firebase.firestore.FieldValue;

const DEFAULT_SERVICES = [
  { id: "soporte-web", name: "Soporte web", price: 0, order: 1 },
  { id: "redes", name: "Gestión de redes sociales", price: 0, order: 2 },
  { id: "web-redes", name: "Web + redes sociales", price: 0, order: 3 }
];

let clients = [];
let payments = [];
let services = [];
let view = "dashboard";
let timer;
let month = localMonth();
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

function shift(m, n) {
  const d = md(m);
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

function days(m) {
  const [y, n] = m.split("-").map(Number);
  return new Date(y, n, 0).getDate();
}

function due(m, d) {
  const day = Math.min(Math.max(Number(d) || 1, 1), days(m));
  return `${m}-${String(day).padStart(2, "0")}`;
}

/* ============ Pagos parciales (abonos) ============ */

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

/* ================== DATOS ================== */

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

async function load() {
  try {
    await loadServices();

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
      dueDate: due(month, c.dueDay),
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
      String(a.p?.dueDate || "").localeCompare(String(b.p?.dueDate || ""))
    );
}

/* ================== RENDER ================== */

function render() {
  const titles = {
    dashboard: "Inicio",
    clients: "Clientes",
    services: "Servicios",
    history: "Historial"
  };
  $("#title").textContent = titles[view] || "Inicio";

  $("#today").textContent = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date());

  $("#months").style.display = view === "dashboard" ? "flex" : "none";
  $("#months").innerHTML = `
    <button data-month="-1">‹</button>
    <div class="month-title">${esc(ml(month))}</div>
    <button data-month="1">›</button>`;

  ["dashboard", "clients", "services", "history"].forEach((v) =>
    $("#" + v).classList.toggle("hidden", v !== view)
  );

  document.querySelectorAll(".nav").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view)
  );

  dashboard();
  clientsView();
  servicesView();
  historyView();
}

function dashboard() {
  const r = rows();
  const total = r.reduce((s, x) => s + Number(x.p.amount || 0), 0);
  const cobrado = r.reduce((s, x) => s + paidAmount(x.p), 0);
  const pendiente = r.reduce((s, x) => s + remaining(x.p), 0);
  const pagaron = r.filter((x) => payStatus(x.p) === "paid").length;
  const parciales = r.filter((x) => payStatus(x.p) === "partial").length;

  $("#dashboard").innerHTML = `
    <div class="stats">
      <div class="card"><div class="label">Cobrado</div><div class="value">${money(cobrado)}</div></div>
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
      ${
        r.length
          ? `<div style="overflow:auto">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th><th>Servicio</th><th>Vencimiento</th>
                    <th>Total</th><th>Pagado</th><th>Estado</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  ${r
                    .map(
                      (x) => `<tr>
                        <td class="name">${esc(x.c.name)}</td>
                        <td>${esc(x.p.service)}</td>
                        <td>${df(x.p.dueDate)}</td>
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
    const status = total > 0 && paid >= total ? "paid" : paid > 0 ? "partial" : "pending";

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

function clientsView() {
  const table = (list) =>
    list.length
      ? `<div style="overflow:auto">
          <table>
            <thead>
              <tr><th>Cliente</th><th>Servicio</th><th>Mensual</th><th>Vencimiento</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              ${list
                .map(
                  (c) => `<tr>
                    <td class="name">${esc(c.name)}</td>
                    <td>${esc(c.service)}</td>
                    <td><b>${money(c.monthlyAmount)}</b></td>
                    <td>Día ${c.dueDay}</td>
                    <td>${
                      c.active === false
                        ? '<span class="badge pending">Inactivo</span>'
                        : '<span class="badge paid">Activo</span>'
                    }</td>
                    <td>
                      <button class="action" data-detail="${c.id}">Historial</button>
                      <button class="action" data-edit="${c.id}">Editar</button>
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
      ${
        services.length
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
                          <button class="action" data-del-service="${s.id}">Eliminar</button>
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
        ${
          edit
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

function historyView() {
  const list = payments
    .filter((p) => p.type === "monthly")
    .sort(
      (a, b) =>
        String(b.month).localeCompare(String(a.month)) ||
        cid(a.clientId).localeCompare(cid(b.clientId), "es")
    );

  const table = (a) =>
    a.length
      ? `<div style="overflow:auto">
          <table>
            <thead>
              <tr>
                <th>Mes</th><th>Cliente</th><th>Servicio</th><th>Total</th>
                <th>Pagado</th><th>Estado</th><th>Último pago</th>
              </tr>
            </thead>
            <tbody>
              ${a
                .map((p) => {
                  const ab = getAbonos(p);
                  const last = ab.length ? ab[ab.length - 1] : null;
                  return `<tr>
                    <td>${esc(ml(p.month))}</td>
                    <td class="name">${esc(cid(p.clientId))}</td>
                    <td>${esc(p.service || "-")}</td>
                    <td><b>${money(p.amount)}</b></td>
                    <td>${paidAmount(p) ? money(paidAmount(p)) : "-"}</td>
                    <td>${badgeHtml(p)}</td>
                    <td>${last ? `${df(last.date)} · ${esc(last.method || "s/m")}` : "-"}</td>
                  </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>`
      : `<div class="empty"><b>No hay historial todavía</b></div>`;

  $("#history").innerHTML = `
    <div class="toolbar">
      <div>
        <h2>Historial mensual</h2>
        <div style="color:#6b7280;font-size:13px">Todos los meses quedan guardados.</div>
      </div>
      <input class="search" id="histSearch" placeholder="Buscar cliente...">
    </div>
    <div class="table-card" id="histTable">${table(list)}</div>`;

  $("#histSearch").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    $("#histTable").innerHTML = table(
      list.filter((p) => cid(p.clientId).toLowerCase().includes(q))
    );
  });
}

/* ================== FORM CLIENTE ================== */

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
                (s) => `<option value="${esc(s.name)}" data-price="${s.price}" ${
                  s.name === c?.service ? "selected" : ""
                }>${esc(s.name)} — ${money(s.price)}</option>`
              )
              .join("")}
          </select>
        </div>
        <div class="field">
          <label>Monto mensual</label>
          <input name="amount" type="number" min="0" required value="${c?.monthlyAmount ?? ""}">
        </div>
        <div class="field">
          <label>Día de vencimiento</label>
          <input name="due" type="number" min="1" max="31" required value="${c?.dueDay ?? 10}">
        </div>
        ${
          edit
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
    const dueDay = Math.min(Math.max(Number(f.get("due") || 1), 1), 31);
    const sync = f.get("sync") === "on";

    if (!name || !service) return toast("Completá cliente y servicio");

    const data = {
      name,
      service,
      monthlyAmount: amount,
      dueDay,
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
            dueDate: due(month, dueDay),
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

/* ================== DETALLE ================== */

function detail(id) {
  const c = clients.find((x) => x.id === id);
  if (!c) return;

  const h = payments
    .filter((p) => p.type === "monthly" && p.clientId === id)
    .sort((a, b) => String(b.month).localeCompare(String(a.month)));

  const totalCobrado = h.reduce((s, p) => s + paidAmount(p), 0);
  const totalPendiente = h.reduce((s, p) => s + remaining(p), 0);

  modal(`
    <h2>${esc(c.name)}</h2>
    <p style="color:#6b7280">
      ${esc(c.service)} · ${money(c.monthlyAmount)} por mes · Vence día ${c.dueDay}
    </p>
    <div class="stats" style="grid-template-columns:1fr 1fr">
      <div class="card"><div class="label">Cobrado histórico</div><div class="value">${money(totalCobrado)}</div></div>
      <div class="card"><div class="label">Pendiente histórico</div><div class="value">${money(totalPendiente)}</div></div>
    </div>
    <div class="table-card">
      <div class="head"><h2>Historial</h2></div>
      ${
        h.length
          ? `<div style="overflow:auto">
              <table>
                <thead>
                  <tr><th>Mes</th><th>Total</th><th>Pagado</th><th>Estado</th><th>Último pago</th></tr>
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

/* ================== PAGOS ================== */

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

    ${
      abonos.length
        ? `<div class="abonos-list">
             <h3>Abonos registrados (${abonos.length})</h3>
             ${abonos
               .map(
                 (a, i) => `
                   <div class="abono-row">
                     <span>${df(a.date)} · ${esc(a.method || "sin método")}${
                   a.note ? ` · ${esc(a.note)}` : ""
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

  const m = e.target.closest("[data-month]");
  if (m) {
    month = shift(month, Number(m.dataset.month));
    load();
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
});

load();