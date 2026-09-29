/* global firebase */
"use strict";

firebase.initializeApp(window.firebaseConfig);
const db = firebase.firestore();
const FieldValue = firebase.firestore.FieldValue;

const SERVICES = [
  "Soporte web",
  "Gestión de redes sociales",
  "Web + redes sociales"
];

let clients = [];
let payments = [];
let view = "dashboard";
let timer;
let month = localMonth();

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

function isPaid(p) {
  return p?.status === "paid";
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
}

/* ================== DATOS ================== */

async function load() {
  try {
    const cs = await db.collection("clients").get();
    clients = cs.docs
      .map((x) => ({ id: x.id, ...x.data() }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));

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
  const titles = { dashboard: "Inicio", clients: "Clientes", history: "Historial" };
  $("#title").textContent = titles[view];

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

  ["dashboard", "clients", "history"].forEach((v) =>
    $("#" + v).classList.toggle("hidden", v !== view)
  );

  document.querySelectorAll(".nav").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view)
  );

  dashboard();
  clientsView();
  historyView();
}

function dashboard() {
  const r = rows();
  const paid = r.filter((x) => isPaid(x.p));
  const pending = r.filter((x) => !isPaid(x.p));
  const pt = paid.reduce((s, x) => s + Number(x.p.amount || 0), 0);
  const qt = pending.reduce((s, x) => s + Number(x.p.amount || 0), 0);

  $("#dashboard").innerHTML = `
    <div class="stats">
      <div class="card"><div class="label">Cobrado</div><div class="value">${money(pt)}</div></div>
      <div class="card"><div class="label">Pendiente</div><div class="value">${money(qt)}</div></div>
      <div class="card"><div class="label">Pagaron</div><div class="value">${paid.length}</div></div>
      <div class="card"><div class="label">Pendientes</div><div class="value">${pending.length}</div></div>
    </div>

    <div class="table-card">
      <div class="head">
        <div>
          <h2>Estado de ${esc(ml(month))}</h2>
          <span>El historial anterior no se toca.</span>
        </div>
      </div>
      ${
        r.length
          ? `<div style="overflow:auto">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th><th>Servicio</th><th>Vencimiento</th>
                    <th>Importe</th><th>Estado</th><th>Pago</th><th></th>
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
                        <td><span class="badge ${isPaid(x.p) ? "paid" : "pending"}">
                          ${isPaid(x.p) ? "Pagó" : "Pendiente"}
                        </span></td>
                        <td>${isPaid(x.p) ? df(x.p.paidDate) : "-"}</td>
                        <td>
                          <button class="action" data-pay="${x.p.id}">
                            ${isPaid(x.p) ? "Marcar pendiente" : "Marcar pagado"}
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
}

function clientsView() {
  const table = (list) =>
    list.length
      ? `<div style="overflow:auto">
          <table>
            <thead>
              <tr><th>Cliente</th><th>Servicio</th><th>Mensual</th><th>Vencimiento</th><th></th></tr>
            </thead>
            <tbody>
              ${list
                .map(
                  (c) => `<tr>
                    <td class="name">${esc(c.name)}</td>
                    <td>${esc(c.service)}</td>
                    <td><b>${money(c.monthlyAmount)}</b></td>
                    <td>Día ${c.dueDay}</td>
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
      <div>
        <input class="search" id="clientSearch" placeholder="Buscar cliente...">
        <button class="primary" data-new>+ Nuevo cliente</button>
      </div>
    </div>
    <div class="table-card" id="clientTable">${table(clients)}</div>`;

  $("#clientSearch").addEventListener("input", (e) =>
    ($("#clientTable").innerHTML = table(
      clients.filter((c) =>
        String(c.name || "").toLowerCase().includes(e.target.value.toLowerCase())
      )
    ))
  );
}

function historyView() {
  const list = payments
    .filter((p) => p.type === "monthly")
    .sort((a, b) => String(b.month).localeCompare(String(a.month)));

  const table = (a) =>
    a.length
      ? `<div style="overflow:auto">
          <table>
            <thead>
              <tr>
                <th>Mes</th><th>Cliente</th><th>Servicio</th><th>Importe</th>
                <th>Estado</th><th>Fecha de pago</th><th>Método</th>
              </tr>
            </thead>
            <tbody>
              ${a
                .map(
                  (p) => `<tr>
                    <td>${esc(ml(p.month))}</td>
                    <td class="name">${esc(cid(p.clientId))}</td>
                    <td>${esc(p.service)}</td>
                    <td><b>${money(p.amount)}</b></td>
                    <td><span class="badge ${isPaid(p) ? "paid" : "pending"}">
                      ${isPaid(p) ? "Pagó" : "Pendiente"}
                    </span></td>
                    <td>${df(p.paidDate)}</td>
                    <td>${esc(p.method || "-")}</td>
                  </tr>`
                )
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

  $("#histSearch").addEventListener("input", (e) =>
    ($("#histTable").innerHTML = table(
      list.filter((p) =>
        cid(p.clientId).toLowerCase().includes(e.target.value.toLowerCase())
      )
    ))
  );
}

/* ================== FORM CLIENTE ================== */

function form(c = null) {
  const edit = !!c;

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
            ${SERVICES.map(
              (s) => `<option ${s === c?.service ? "selected" : ""}>${esc(s)}</option>`
            ).join("")}
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
               </div>`
            : ""
        }
      </div>
      <div class="form-actions">
        <button type="button" class="secondary" data-close>Cancelar</button>
        <button class="primary">${edit ? "Guardar cambios" : "Crear cliente"}</button>
      </div>
    </form>`);

  $("#clientForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") || "").trim();
    const service = String(f.get("service") || "");
    const amount = Number(f.get("amount") || 0);
    const dueDay = Math.min(Math.max(Number(f.get("due") || 1), 1), 31);

    if (!name || !SERVICES.includes(service)) {
      toast("Completá cliente y servicio");
      return;
    }

    const data = {
      name,
      service,
      monthlyAmount: amount,
      dueDay,
      active: edit ? String(f.get("active")) !== "false" : true,
      updatedAt: FieldValue.serverTimestamp()
    };

    try {
      if (edit) {
        await db.collection("clients").doc(c.id).update(data);
      } else {
        await db.collection("clients").add({
          ...data,
          createdAt: FieldValue.serverTimestamp()
        });
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

  modal(`
    <h2>${esc(c.name)}</h2>
    <p style="color:#6b7280">
      ${esc(c.service)} · ${money(c.monthlyAmount)} por mes · Vence día ${c.dueDay}
    </p>
    <div class="table-card">
      <div class="head"><h2>Historial</h2></div>
      ${
        h.length
          ? `<div style="overflow:auto">
              <table>
                <thead>
                  <tr><th>Mes</th><th>Importe</th><th>Estado</th><th>Fecha</th><th>Método</th></tr>
                </thead>
                <tbody>
                  ${h
                    .map(
                      (p) => `<tr>
                        <td>${esc(ml(p.month))}</td>
                        <td>${money(p.amount)}</td>
                        <td><span class="badge ${isPaid(p) ? "paid" : "pending"}">
                          ${isPaid(p) ? "Pagó" : "Pendiente"}
                        </span></td>
                        <td>${df(p.paidDate)}</td>
                        <td>${esc(p.method || "-")}</td>
                      </tr>`
                    )
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

  if (isPaid(p)) {
    db.collection("payments")
      .doc(id)
      .update({
        status: "pending",
        paidDate: "",
        method: "",
        updatedAt: FieldValue.serverTimestamp()
      })
      .then(() => {
        p.status = "pending";
        p.paidDate = "";
        p.method = "";
        render();
        toast("Marcado como pendiente");
      })
      .catch((err) => {
        console.error(err);
        toast("No se pudo actualizar");
      });
    return;
  }

  modal(`
    <h2>Registrar pago</h2>
    <p style="color:#6b7280">
      ${esc(cid(p.clientId))} · ${esc(ml(p.month))} · ${money(p.amount)}
    </p>
    <form class="form" id="payForm">
      <div class="grid">
        <div class="field">
          <label>Fecha de pago</label>
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
      </div>
      <div class="form-actions">
        <button type="button" class="secondary" data-close>Cancelar</button>
        <button class="primary">Confirmar pago</button>
      </div>
    </form>`);

  $("#payForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const d = String(f.get("date"));
    const m = String(f.get("method") || "");

    try {
      await db.collection("payments").doc(id).update({
        status: "paid",
        paidDate: d,
        method: m,
        updatedAt: FieldValue.serverTimestamp()
      });
      p.status = "paid";
      p.paidDate = d;
      p.method = m;
      close();
      render();
      toast("Pago registrado");
    } catch (err) {
      console.error(err);
      toast("No se pudo registrar");
    }
  });
}

/* ================== EVENTOS ================== */

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) {
    close();
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
  }
});

load();