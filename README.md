# 💄 Agenda Maquillaje

App web (funciona en el celular y en la compu) para agendar citas de maquillaje.
**Cada cita se guarda directamente en tu Google Calendar**, así que la ves en la app de Google
de tu celular, con avisos para salir de casa a tiempo.

## Qué hace

- **Nueva cita**: clienta, WhatsApp, servicio, duración, cantidad de personas, fecha, **hora de llegada**,
  dirección, tiempo de viaje, precio, seña y notas.
- **Calcula a qué hora salir de casa**: "👉 Tenés que salir de casa a las 09:15".
- **Horarios disponibles**: cuando elegís un día y un servicio, te muestra los horarios libres
  (ya descuenta los viajes, un descanso después de cada cita y también tus otros eventos de Google Calendar).
  Te avisa si el horario elegido se superpone con algo.
- **Vista Día**: tus citas en orden, con hora de salida, dirección (abre Google Maps para ir),
  botón de **WhatsApp** con un mensaje de confirmación listo, y los huecos libres para agendar con un toque.
- **Vista Próximas**: todas las citas que vienen, agrupadas por día.
- **Vista Mes**: calendario mensual con la cantidad de citas por día y el total del mes.
- **Ajustes**: tu jornada (desde/hasta), cada cuánto ofrecer horarios, descanso entre citas,
  tiempo de viaje habitual, tu lista de servicios con duración y precio, y el mensaje de WhatsApp.

- **Presupuestos** 💰: elegís el tipo de evento (👰 Novia, 👑 15 años, 💄 Social u Otro) y la app arma los ítems
  con tus precios: maquillaje principal, prueba, cantidad de invitadas a maquillar, traslado, descuento y seña.
  Después lo mandás por WhatsApp **como imagen** (en el celu se abre el menú "Compartir" → WhatsApp),
  **como texto**, o lo guardás en **PDF**. Si la clienta acepta, tocás **📅 Agendar** y se crea la cita
  con todos los datos ya cargados. Tu nombre/marca, contacto, precio por invitada, seña y condiciones
  se configuran en Ajustes → Presupuestos.

### Cómo queda en Google Calendar

- Un evento rosa **"💄 María López · Maquillaje de novia"** en el horario de la cita, con la dirección
  y en la descripción: WhatsApp (con link directo), servicio, hora de salida, precio, seña y notas.
- Un evento gris **"🚗 Salir hacia María López"** que cubre el tiempo de viaje (se puede desactivar en Ajustes).
- Avisos en el celular: 1 día antes, 30 min antes de salir y **a la hora de salir**.

Si editás o borrás una cita desde la app, se actualiza también en Google Calendar.

---

## Conectar con Google

Se hace **una sola vez** (unos 10 minutos). Google exige crear un "ID de cliente" propio para que
la app pueda escribir en tu calendario.

1. Entrá a <https://console.cloud.google.com/> con tu cuenta de Gmail.
2. Arriba, en el selector de proyectos → **Proyecto nuevo** → nombre: `Agenda Maquillaje` → **Crear**.
3. Menú ☰ → **APIs y servicios** → **Biblioteca** → buscá **Google Calendar API** → **Habilitar**.
4. Menú ☰ → **APIs y servicios** → **Pantalla de consentimiento de OAuth** (o "Google Auth Platform"):
   - Tipo de usuario: **Externo**.
   - Nombre de la app: `Agenda Maquillaje`, y tu email como correo de asistencia y de contacto.
   - En **Público / Usuarios de prueba**, agregá tu propio Gmail (y el de cualquier otra persona que vaya a usarla).
5. Menú ☰ → **APIs y servicios** → **Credenciales** → **Crear credenciales** → **ID de cliente de OAuth**:
   - Tipo de aplicación: **Aplicación web**.
   - En **Orígenes autorizados de JavaScript** agregá la dirección donde vas a abrir la app, por ejemplo:
     - `https://gozzilola.github.io` (si la publicás con GitHub Pages, ver abajo)
     - `http://localhost:8000` (solo si la probás en tu compu)
   - **Crear**. Copiá el **ID de cliente** (termina en `.apps.googleusercontent.com`).
6. Abrí la app → **Ajustes** → pegá el ID en **ID de cliente de Google** → **Guardar ajustes**
   → **Conectar con Google** → elegí tu cuenta y aceptá los permisos de calendario.

> Como la app queda "en modo prueba" en Google, la primera vez puede aparecer un cartel de
> "Google no verificó esta app": tocá **Continuar** (es tu propia app). No hace falta publicarla ni verificarla.

En Ajustes también podés elegir **en qué calendario** guardar las citas (por ejemplo, uno llamado "Maquillaje").

Mientras no pegues el ID, la app funciona en **modo prueba**: guarda las citas solo en ese dispositivo,
sirve para probarla.

---

## Publicarla (para abrirla desde el celular)

La forma más simple y gratis es **GitHub Pages**. El repositorio ya trae lo necesario:

1. Uní estos cambios a la rama `main`.
2. En GitHub: **Settings** → **Pages** → en **Source** elegí **GitHub Actions**.
3. Esperá un minuto: la app queda en `https://gozzilola.github.io/makeup/`.

> **Importante:** GitHub Pages es gratis solo si el repositorio es **público** (en privados pide un plan pago).
> Podés hacerlo público sin problema: en el repositorio queda solo el código, **ningún dato tuyo ni de tus clientas**
> (las citas viven en tu Google Calendar y los presupuestos en tu celular).
> Se cambia en **Settings → General → Danger Zone → Change repository visibility → Public**.
4. Asegurate de que `https://gozzilola.github.io` esté en los **Orígenes autorizados** (paso 5 de arriba).
5. En el celular abrí esa dirección y usá **"Agregar a pantalla de inicio"** (Chrome: menú ⋮;
   iPhone/Safari: botón Compartir). Queda como una app más.

### Probarla en la compu

```bash
npx http-server -p 8000
# y abrí http://localhost:8000
```

## Archivos

| Archivo | Para qué sirve |
| --- | --- |
| `index.html` | Estructura de la app y formulario de citas |
| `app.js` | Lógica: conexión con Google Calendar, vistas, horarios disponibles |
| `budget.js` | Presupuestos: armado, imagen para WhatsApp, PDF y paso a cita |
| `styles.css` | Diseño |
| `config.js` | Opcional: dejar fijo el ID de cliente de Google |
| `manifest.webmanifest`, `icons/` | Para instalarla en el celular |

## Privacidad

No hay servidor: la app corre en tu navegador y habla directamente con Google Calendar.
El acceso a Google dura una hora y después la app te pide reconectar con un toque.
Los ajustes se guardan en el navegador de cada dispositivo.
