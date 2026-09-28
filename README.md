# Mis Cobros

App web personal para registrar clientes y pagos de servicios de páginas web y gestión de redes.

## Stack

- HTML
- CSS
- JavaScript vanilla
- Firebase Firestore
- Sin Authentication

## 1. Crear Firebase

1. Entrá a Firebase Console.
2. Creá un proyecto.
3. Creá una base de datos Firestore en modo producción.
4. Agregá una aplicación Web.
5. Copiá la configuración que te da Firebase.

## 2. Configurar el proyecto

Abrí `firebase-config.js` y reemplazá los valores `PEGAR_...` por los datos de tu aplicación Firebase.

## 3. Reglas

El archivo `firestore.rules` permite lectura/escritura sin autenticación. Esto es intencional para que el MVP sea simple, pero significa que NO deberías publicar esta versión con datos reales si queda accesible públicamente.

Si la app va a quedar solo en tu computadora o en un entorno privado, podés mantenerla así. Si la vas a publicar en Internet, agregá Firebase Authentication y reglas por usuario antes de usar datos reales.

## 4. Ejecutar

No abras `index.html` directamente con `file://`, porque los módulos JavaScript y Firebase pueden bloquearse.

Usá un servidor local. Por ejemplo, si tenés Node.js:

```bash
npx serve .
```

o:

```bash
npx http-server .
```

Después abrí la dirección local que indique el comando.

## Funciones incluidas

- Dashboard
- Total cobrado
- Total pendiente/vencido
- Cantidad de clientes
- Alta, edición y eliminación de clientes
- Registro de pagos
- Marcar pago como pagado/pendiente
- Historial de pagos
- Detalle de cliente
- Métodos de pago
- Fechas de vencimiento
- Diseño responsive


## Inicio rápido en Windows

Si tenés Python instalado, no necesitás abrir una terminal.

Hacé doble clic en:

`INICIAR.bat`

El archivo inicia un servidor local en el puerto 8000 y abre automáticamente:

`http://localhost:8000`

Dejá abierta la ventana negra mientras uses la aplicación. Para apagar la aplicación, cerrá esa ventana.

### Si Windows dice que no encuentra Python

Instalá Python y durante la instalación marcá:

`Add Python.exe to PATH`

Después de instalarlo, volvé a hacer doble clic en `INICIAR.bat`.
