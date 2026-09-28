import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";


// ============================================================
// FIREBASE
// ============================================================

const firebaseReady = !Object.values(firebaseConfig).some(
  value => String(value).startsWith("PEGAR_")
);

const firebaseApp = firebaseReady
  ? initializeApp(firebaseConfig)
  : null;

const db = firebaseApp
  ? getFirestore(firebaseApp)
  : null;


// ============================================================
// ESTADO
// ============================================================

let clients = [];
let payments = [];
let currentView = "dashboard";


// ============================================================
// HELPERS
// ============================================================

const $ = selector => document.querySelector(selector);

function money(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(date) {
  if (!date) return "-";

  return new Intl.DateTimeFormat("es-AR").format(
    new Date(`${date}T12:00:00`)
  );
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function clientName(clientId) {
  const client = clients.find(client => client.id === clientId);

  return client?.name || "Cliente eliminado";
}

function getPaymentStatus(payment) {
  if (payment.status === "paid") {
    return "paid";
  }

  if (
    payment.dueDate &&
    payment.dueDate < todayISO()
  ) {
    return "overdue";
  }

  return "pending";
}

function statusLabel(status) {
  const labels = {
    paid: "Pagado",
    pending: "Pendiente",
    overdue: "Vencido"
  };

  return labels[status] || status;
}

function showToast(message) {
  const toast = $("#toast");

  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}


// ============================================================
// MODAL
// ============================================================

function openModal(html) {
  $("#modal-content").innerHTML = html;
  $("#modal").classList.remove("hidden");
}

function closeModal() {
  $("#modal").classList.add("hidden");
}

$("#close-modal").addEventListener("click", closeModal);

$("#modal").addEventListener("click", event => {
  if (event.target.id === "modal") {
    closeModal();
  }
});


// ============================================================
// CARGAR FIREBASE
// ============================================================

async function loadData() {

  if (!firebaseReady || !db) {
    renderFirebaseWarning();
    return;
  }

  try {

    const clientsQuery = query(
      collection(db, "clients"),
      orderBy("name")
    );

    const paymentsQuery = query(
      collection(db, "payments"),
      orderBy("dueDate", "desc")
    );

    const clientsSnapshot = await getDocs(clientsQuery);

    clients = clientsSnapshot.docs.map(documentSnapshot => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data()
    }));

    const paymentsSnapshot = await getDocs(paymentsQuery);

    payments = paymentsSnapshot.docs.map(documentSnapshot => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data()
    }));

    render();

  } catch (error) {

    console.error("Error cargando Firebase:", error);

    $("#app").innerHTML = `
      <div class="section">
        <h2>Error cargando los datos</h2>
        <p>
          Revisá la configuración de Firebase y las reglas de Firestore.
        </p>

        <p class="muted">
          ${escapeHTML(error.message)}
        </p>
      </div>
    `;
  }
}


// ============================================================
// WARNING FIREBASE
// ============================================================

function renderFirebaseWarning() {

  $("#app").innerHTML = `
    <div class="section">

      <h2>Falta configurar Firebase</h2>

      <p>
        Abrí <b>firebase-config.js</b> y pegá la configuración
        de tu aplicación web de Firebase.
      </p>

      <p class="muted">
        Después recargá la página.
      </p>

    </div>
  `;
}


// ============================================================
// RENDER PRINCIPAL
// ============================================================

function render() {

  const titles = {
    dashboard: "Inicio",
    clients: "Clientes",
    payments: "Pagos"
  };

  $("#page-title").textContent =
    titles[currentView] || "Mis Cobros";

  if (currentView === "dashboard") {
    renderDashboard();
  }

  if (currentView === "clients") {
    renderClients();
  }

  if (currentView === "payments") {
    renderPayments();
  }
}


// ============================================================
// DASHBOARD
// ============================================================

function renderDashboard() {

  const paidTotal = payments
    .filter(payment => payment.status === "paid")
    .reduce(
      (total, payment) => total + Number(payment.amount || 0),
      0
    );

  const pendingTotal = payments
    .filter(payment => getPaymentStatus(payment) !== "paid")
    .reduce(
      (total, payment) => total + Number(payment.amount || 0),
      0
    );

  const recentPayments = [...payments]
    .sort((a, b) => {
      const dateA = a.paidDate || a.dueDate || "";
      const dateB = b.paidDate || b.dueDate || "";

      return dateB.localeCompare(dateA);
    })
    .slice(0, 8);

  $("#app").innerHTML = `

    <div class="cards">

      <div class="card">
        <div class="metric-label">
          Cobrado
        </div>

        <div class="metric">
          ${money(paidTotal)}
        </div>
      </div>


      <div class="card">
        <div class="metric-label">
          Pendiente
        </div>

        <div class="metric">
          ${money(pendingTotal)}
        </div>
      </div>


      <div class="card">
        <div class="metric-label">
          Clientes
        </div>

        <div class="metric">
          ${clients.length}
        </div>
      </div>

    </div>


    <div class="section">

      <div class="section-head">

        <h2>
          Pagos recientes
        </h2>

        <button
          class="primary"
          id="dashboard-add-payment"
        >
          + Registrar pago
        </button>

      </div>

      ${renderPaymentTable(recentPayments)}

    </div>
  `;


  $("#dashboard-add-payment").addEventListener(
    "click",
    () => showPaymentForm()
  );
}


// ============================================================
// TABLA DE PAGOS
// ============================================================

function renderPaymentTable(paymentList) {

  if (!paymentList.length) {

    return `
      <div class="empty">
        Todavía no hay pagos registrados.
      </div>
    `;
  }


  return `

    <table class="table">

      <thead>

        <tr>
          <th>Cliente</th>
          <th>Servicio</th>
          <th>Monto</th>
          <th>Vencimiento</th>
          <th>Estado</th>
          <th></th>
        </tr>

      </thead>


      <tbody>

        ${paymentList.map(payment => {

          const status = getPaymentStatus(payment);

          return `

            <tr>

              <td>
                ${escapeHTML(
                  payment.clientName ||
                  clientName(payment.clientId)
                )}
              </td>

              <td>
                ${escapeHTML(payment.service || "-")}
              </td>

              <td>
                ${money(payment.amount)}
              </td>

              <td>
                ${formatDate(payment.dueDate)}
              </td>

              <td>

                <span class="badge ${status}">
                  ${statusLabel(status)}
                </span>

              </td>

              <td>

                <div class="actions">

                  ${
                    status !== "paid"

                    ? `
                      <button
                        class="link"
                        data-action="paid"
                        data-id="${payment.id}"
                      >
                        Marcar pagado
                      </button>
                    `

                    : `
                      <button
                        class="link"
                        data-action="pending"
                        data-id="${payment.id}"
                      >
                        Desmarcar
                      </button>
                    `
                  }


                  <button
                    class="link"
                    data-action="delete-payment"
                    data-id="${payment.id}"
                  >
                    Eliminar
                  </button>

                </div>

              </td>

            </tr>
          `;

        }).join("")}

      </tbody>

    </table>
  `;
}


// ============================================================
// CLIENTES
// ============================================================

function renderClients() {

  $("#app").innerHTML = `

    <div class="section">

      <div class="section-head">

        <h2>
          Clientes
        </h2>

        <button
          class="primary"
          id="add-client"
        >
          + Nuevo cliente
        </button>

      </div>


      <input
        class="search"
        id="client-search"
        placeholder="Buscar cliente..."
      >


      <div
        class="client-grid"
        id="client-grid"
      ></div>

    </div>
  `;


  $("#add-client").addEventListener(
    "click",
    () => showClientForm()
  );


  const search = $("#client-search");

  function drawClients() {

    const searchText =
      search.value.toLowerCase().trim();

    const filteredClients = clients.filter(client => {

      const text = `
        ${client.name || ""}
        ${client.company || ""}
        ${client.service || ""}
      `.toLowerCase();

      return text.includes(searchText);
    });


    if (!filteredClients.length) {

      $("#client-grid").innerHTML = `
        <div class="empty">
          No hay clientes.
        </div>
      `;

      return;
    }


    $("#client-grid").innerHTML =
      filteredClients.map(client => `

        <div class="client-card">

          <h3>
            ${escapeHTML(client.name)}
          </h3>

          <div class="muted">
            ${escapeHTML(client.company || "")}
          </div>

          <p>
            ${escapeHTML(client.service || "Sin servicio")}
            ·
            ${money(client.monthlyAmount || 0)}
            ${
              client.frequency === "monthly"
                ? "/mes"
                : ""
            }
          </p>


          <div class="actions">

            <button
              class="secondary"
              data-action="view-client"
              data-id="${client.id}"
            >
              Ver
            </button>


            <button
              class="link"
              data-action="edit-client"
              data-id="${client.id}"
            >
              Editar
            </button>

          </div>

        </div>

      `).join("");
  }


  search.addEventListener(
    "input",
    drawClients
  );

  drawClients();
}


// ============================================================
// PAGOS
// ============================================================

function renderPayments() {

  $("#app").innerHTML = `

    <div class="section">

      <div class="section-head">

        <h2>
          Todos los pagos
        </h2>

        <button
          class="primary"
          id="add-payment"
        >
          + Registrar pago
        </button>

      </div>


      ${renderPaymentTable(payments)}

    </div>
  `;


  $("#add-payment").addEventListener(
    "click",
    () => showPaymentForm()
  );
}


// ============================================================
// FORMULARIO CLIENTE
// ============================================================

function showClientForm(client = null) {

  const editing = Boolean(client?.id);

  openModal(`

    <h2>
      ${editing ? "Editar" : "Nuevo"} cliente
    </h2>


    <form id="client-form">

      <div class="form-grid">


        <div class="field">

          <label>
            Nombre
          </label>

          <input
            name="name"
            required
            value="${escapeHTML(client?.name || "")}"
          >

        </div>


        <div class="field">

          <label>
            Empresa
          </label>

          <input
            name="company"
            value="${escapeHTML(client?.company || "")}"
          >

        </div>


        <div class="field">

          <label>
            Servicio
          </label>

          <input
            name="service"
            placeholder="Gestión de redes / Página web"
            value="${escapeHTML(client?.service || "")}"
          >

        </div>


        <div class="field">

          <label>
            Monto
          </label>

          <input
            name="monthlyAmount"
            type="number"
            min="0"
            value="${client?.monthlyAmount || ""}"
          >

        </div>


        <div class="field">

          <label>
            Frecuencia
          </label>

          <select name="frequency">

            <option
              value="monthly"
              ${
                client?.frequency === "monthly"
                  ? "selected"
                  : ""
              }
            >
              Mensual
            </option>

            <option
              value="once"
              ${
                client?.frequency === "once"
                  ? "selected"
                  : ""
              }
            >
              Único
            </option>

          </select>

        </div>


        <div class="field">

          <label>
            Día de vencimiento
          </label>

          <input
            name="dueDay"
            type="number"
            min="1"
            max="31"
            value="${client?.dueDay || ""}"
          >

        </div>


      </div>


      <div class="form-actions">

        <button
          type="button"
          class="secondary"
          id="cancel-client"
        >
          Cancelar
        </button>


        <button
          type="submit"
          class="primary"
        >
          Guardar
        </button>

      </div>

    </form>
  `);


  $("#cancel-client").addEventListener(
    "click",
    closeModal
  );


  $("#client-form").addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      const formData =
        new FormData(event.target);


      const data = {

        name: String(
          formData.get("name") || ""
        ).trim(),

        company: String(
          formData.get("company") || ""
        ).trim(),

        service: String(
          formData.get("service") || ""
        ).trim(),

        monthlyAmount:
          Number(
            formData.get("monthlyAmount") || 0
          ),

        frequency:
          formData.get("frequency"),

        dueDay:
          Number(
            formData.get("dueDay") || 0
          )
      };


      try {

        // ----------------------------------------------------
        // EDITAR CLIENTE
        // ----------------------------------------------------

        if (editing) {

          if (!client.id) {
            throw new Error(
              "El cliente no tiene un ID válido."
            );
          }


          await updateDoc(
            doc(db, "clients", client.id),
            data
          );


          showToast(
            "Cliente actualizado"
          );

        }


        // ----------------------------------------------------
        // CREAR CLIENTE
        // ----------------------------------------------------

        else {

          const newClient =
            await addDoc(
              collection(db, "clients"),
              data
            );


          console.log(
            "Cliente creado:",
            newClient.id
          );


          showToast(
            "Cliente creado"
          );
        }


        closeModal();

        await loadData();

      } catch (error) {

        console.error(
          "Error guardando cliente:",
          error
        );


        showToast(
          "No se pudo guardar el cliente"
        );


        alert(
          "Error al guardar:\n\n" +
          error.message
        );
      }

    }
  );
}


// ============================================================
// FORMULARIO PAGO
// ============================================================

function showPaymentForm(prefillClient = null) {

  if (!clients.length) {

    alert(
      "Primero tenés que crear un cliente."
    );

    return;
  }


  openModal(`

    <h2>
      Registrar pago
    </h2>


    <form id="payment-form">

      <div class="form-grid">


        <div class="field full">

          <label>
            Cliente
          </label>

          <select
            name="clientId"
            required
          >

            ${clients.map(client => `

              <option
                value="${client.id}"
                ${
                  prefillClient?.id === client.id
                    ? "selected"
                    : ""
                }
              >
                ${escapeHTML(client.name)}
              </option>

            `).join("")}

          </select>

        </div>


        <div class="field">

          <label>
            Servicio
          </label>

          <input
            name="service"
            required
            placeholder="Gestión de redes"
          >

        </div>


        <div class="field">

          <label>
            Monto
          </label>

          <input
            name="amount"
            type="number"
            min="0"
            required
          >

        </div>


        <div class="field">

          <label>
            Vencimiento
          </label>

          <input
            name="dueDate"
            type="date"
            value="${todayISO()}"
            required
          >

        </div>


        <div class="field">

          <label>
            Fecha de pago
          </label>

          <input
            name="paidDate"
            type="date"
          >

        </div>


        <div class="field">

          <label>
            Método
          </label>

          <select name="method">

            <option>
              Transferencia
            </option>

            <option>
              Efectivo
            </option>

            <option>
              Tarjeta
            </option>

            <option>
              Otro
            </option>

          </select>

        </div>


        <div class="field">

          <label>
            Estado
          </label>

          <select name="status">

            <option value="paid">
              Pagado
            </option>

            <option value="pending">
              Pendiente
            </option>

          </select>

        </div>


        <div class="field full">

          <label>
            Notas
          </label>

          <textarea
            name="notes"
            rows="3"
          ></textarea>

        </div>


      </div>


      <div class="form-actions">

        <button
          type="button"
          class="secondary"
          id="cancel-payment"
        >
          Cancelar
        </button>


        <button
          type="submit"
          class="primary"
        >
          Guardar
        </button>

      </div>

    </form>
  `);


  const clientSelect =
    document.querySelector(
      '[name="clientId"]'
    );

  const serviceInput =
    document.querySelector(
      '[name="service"]'
    );

  const amountInput =
    document.querySelector(
      '[name="amount"]'
    );


  function fillClientData() {

    const client =
      clients.find(
        item => item.id === clientSelect.value
      );


    if (!client) return;


    serviceInput.value =
      client.service || "";

    amountInput.value =
      client.monthlyAmount || "";
  }


  clientSelect.addEventListener(
    "change",
    fillClientData
  );


  fillClientData();


  document
    .querySelector('[name="status"]')
    .addEventListener(
      "change",
      event => {

        const paidDate =
          document.querySelector(
            '[name="paidDate"]'
          );


        paidDate.value =
          event.target.value === "paid"
            ? todayISO()
            : "";
      }
    );


  $("#cancel-payment").addEventListener(
    "click",
    closeModal
  );


  $("#payment-form").addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      const formData =
        new FormData(event.target);


      const clientId =
        formData.get("clientId");


      const client =
        clients.find(
          item => item.id === clientId
        );


      if (!client) {

        alert(
          "No se encontró el cliente seleccionado."
        );

        return;
      }


      const data = {

        clientId: client.id,

        clientName: client.name,

        service:
          String(
            formData.get("service") || ""
          ).trim(),

        amount:
          Number(
            formData.get("amount") || 0
          ),

        dueDate:
          formData.get("dueDate"),

        paidDate:
          formData.get("paidDate") || "",

        method:
          formData.get("method"),

        status:
          formData.get("status"),

        notes:
          String(
            formData.get("notes") || ""
          ).trim(),

        createdAt:
          serverTimestamp()
      };


      try {

        await addDoc(
          collection(db, "payments"),
          data
        );


        closeModal();

        showToast(
          "Pago registrado"
        );


        await loadData();

      } catch (error) {

        console.error(
          "Error guardando pago:",
          error
        );


        alert(
          "Error al guardar el pago:\n\n" +
          error.message
        );
      }

    }
  );
}


// ============================================================
// DETALLE CLIENTE
// ============================================================

function showClientDetail(client) {

  if (!client?.id) {

    alert(
      "El cliente seleccionado no tiene un ID válido."
    );

    return;
  }


  const clientPayments =
    payments.filter(
      payment =>
        payment.clientId === client.id
    );


  openModal(`

    <div class="back">

      <button
        class="link"
        id="detail-back"
      >
        ← Volver
      </button>

    </div>


    <div class="detail-head">

      <div>

        <h2>
          ${escapeHTML(client.name)}
        </h2>

        <p class="muted">
          ${escapeHTML(client.company || "")}
        </p>

        <p>
          ${escapeHTML(
            client.service || "Sin servicio"
          )}

          ·

          ${money(
            client.monthlyAmount || 0
          )}

          ${
            client.frequency === "monthly"
              ? "/mes"
              : ""
          }
        </p>

      </div>


      <div class="actions">

        <button
          class="secondary"
          id="edit-detail"
        >
          Editar
        </button>


        <button
          class="danger"
          id="delete-detail"
        >
          Eliminar
        </button>

      </div>

    </div>


    <div class="section">

      <div class="section-head">

        <h2>
          Pagos
        </h2>

        <button
          class="primary"
          id="detail-add"
        >
          + Registrar
        </button>

      </div>


      ${renderPaymentTable(clientPayments)}

    </div>
  `);


  $("#detail-back").addEventListener(
    "click",
    () => {

      closeModal();

      renderClients();
    }
  );


  $("#edit-detail").addEventListener(
    "click",
    () => {

      closeModal();

      showClientForm(client);
    }
  );


  $("#delete-detail").addEventListener(
    "click",
    async () => {

      const confirmed =
        confirm(
          "¿Eliminar este cliente?\n\n" +
          "Los pagos existentes no se eliminarán."
        );


      if (!confirmed) return;


      try {

        await deleteDoc(
          doc(
            db,
            "clients",
            client.id
          )
        );


        closeModal();

        showToast(
          "Cliente eliminado"
        );


        await loadData();

      } catch (error) {

        console.error(error);

        alert(
          "No se pudo eliminar el cliente:\n\n" +
          error.message
        );
      }
    }
  );


  $("#detail-add").addEventListener(
    "click",
    () => showPaymentForm(client)
  );
}


// ============================================================
// PAGOS: MARCAR PAGADO / PENDIENTE
// ============================================================

async function setPaymentStatus(
  paymentId,
  paid
) {

  if (!paymentId) {

    console.error(
      "ID de pago inválido:",
      paymentId
    );

    return;
  }


  try {

    await updateDoc(
      doc(
        db,
        "payments",
        paymentId
      ),
      {
        status:
          paid
            ? "paid"
            : "pending",

        paidDate:
          paid
            ? todayISO()
            : ""
      }
    );


    showToast(
      paid
        ? "Pago marcado como pagado"
        : "Pago vuelto a pendiente"
    );


    await loadData();

  } catch (error) {

    console.error(
      "Error actualizando pago:",
      error
    );


    alert(
      "No se pudo actualizar el pago:\n\n" +
      error.message
    );
  }
}


// ============================================================
// ELIMINAR PAGO
// ============================================================

async function deletePayment(
  paymentId
) {

  if (!paymentId) return;


  const confirmed =
    confirm(
      "¿Eliminar este pago?"
    );


  if (!confirmed) return;


  try {

    await deleteDoc(
      doc(
        db,
        "payments",
        paymentId
      )
    );


    showToast(
      "Pago eliminado"
    );


    await loadData();

  } catch (error) {

    console.error(error);

    alert(
      "No se pudo eliminar el pago:\n\n" +
      error.message
    );
  }
}


// ============================================================
// EVENTOS GLOBALES
// ============================================================

document.addEventListener(
  "click",
  async event => {

    const element =
      event.target.closest(
        "[data-action]"
      );


    if (!element) return;


    const action =
      element.dataset.action;

    const id =
      element.dataset.id;


    if (action === "paid") {

      await setPaymentStatus(
        id,
        true
      );

      return;
    }


    if (action === "pending") {

      await setPaymentStatus(
        id,
        false
      );

      return;
    }


    if (action === "delete-payment") {

      await deletePayment(id);

      return;
    }


    if (action === "view-client") {

      const client =
        clients.find(
          item => item.id === id
        );


      if (!client) {

        alert(
          "No se encontró el cliente."
        );

        return;
      }


      showClientDetail(client);

      return;
    }


    if (action === "edit-client") {

      const client =
        clients.find(
          item => item.id === id
        );


      if (!client) {

        alert(
          "No se encontró el cliente."
        );

        return;
      }


      showClientForm(client);

      return;
    }

  }
);


// ============================================================
// NAVEGACIÓN
// ============================================================

document
  .querySelectorAll(".nav-btn")
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        currentView =
          button.dataset.view;


        document
          .querySelectorAll(".nav-btn")
          .forEach(navButton => {

            navButton.classList.toggle(
              "active",
              navButton === button
            );

          });


        render();
      }
    );

  });


// ============================================================
// BOTÓN SUPERIOR
// ============================================================

$("#quick-payment").addEventListener(
  "click",
  () => showPaymentForm()
);


// ============================================================
// FECHA
// ============================================================

$("#today").textContent =
  new Intl.DateTimeFormat(
    "es-AR",
    {
      dateStyle: "long"
    }
  ).format(new Date());


// ============================================================
// ARRANQUE
// ============================================================

loadData();