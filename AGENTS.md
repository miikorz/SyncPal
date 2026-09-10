# AGENTS.md

## Producto

SyncPal es una aplicacion publica y embebida de Shopify. Sincroniza hacia PayPal los trackings de pedidos cada vez que Shopify emite un webhook `fulfillments/create`, con el fin de facilitar la liberacion de fondos retenidos.

## Alcance del MVP

- Conexion y desconexion OAuth de PayPal por tienda.
- Sincronizacion inicial del historial elegible tras el onboarding.
- Encolado inmediato de fulfillments y procesamiento asincrono.
- Maximo de tres intentos por trabajo.
- Dashboard con estado de conexion y contadores.
- Historial con detalle de errores y reintento manual.
- Un unico plan de tarifa plana con free trial mediante Shopify Billing API.
- Al desconectar PayPal, no aceptar nuevos trabajos y eliminar los trabajos de esa tienda.

No implementar multi-idioma, exportaciones complejas, alertas por correo ni otras funciones fuera del MVP.

## Stack obligatorio

- Shopify CLI y plantilla oficial React Router con TypeScript. Shopify ya no ofrece una plantilla `remix`; React Router es su sucesora oficial.
- Node.js, React, Shopify Polaris y Shopify App Bridge.
- PostgreSQL y Prisma ORM.
- Redis, BullMQ e ioredis.
- `node:crypto` con AES-256-CTR para los tokens de PayPal.

No sustituir estas tecnologias sin aprobacion explicita.

## Arquitectura objetivo

- `app/routes/webhooks.*`: autenticar el webhook con las utilidades oficiales de Shopify, validar los campos requeridos y encolar el trabajo. Responder cuanto antes y nunca llamar a PayPal dentro del request del webhook.
- `server/jobs/paypalSync.*`: consumir trabajos, comprobar que PayPal sigue conectado, descifrar el token solo en memoria, invocar PayPal y registrar cada resultado.
- Utilidad de criptografia: exponer `encrypt` y `decrypt`; obtener una clave de 32 bytes desde variables de entorno y usar un IV aleatorio por valor.
- Prisma: conservar el modelo `Session` de Shopify y agregar `ShopConfig` y `SyncLog`.
- Rutas UI: dashboard, onboarding e historial con componentes Polaris y patrones del template generado.

Los nombres y extensiones exactos deben adaptarse a las convenciones del scaffold antes de crear archivos.

## Reglas de datos y seguridad

- Nunca registrar tokens, secretos, claves de cifrado ni cabeceras de autorizacion.
- Guardar tokens de PayPal unicamente cifrados.
- Relacionar todos los trabajos y logs con una tienda; no confiar solo en `orderId`.
- Hacer idempotente la sincronizacion para tolerar webhooks duplicados y reintentos.
- Validar el webhook mediante la autenticacion oficial antes de leer o procesar el payload.
- Guardar en `rawResponse` solo informacion util y saneada.
- Mantener secretos exclusivamente en `.env` y documentar sus nombres en `.env.example`.

## BullMQ

- El handler solo valida, crea el registro pendiente si corresponde y encola.
- Configurar los reintentos en la cola con `attempts: 3` y backoff explicito.
- El worker actualiza `SyncLog` de forma consistente en exito y error.
- Los comentarios deben explicar solo decisiones criticas: idempotencia, reintentos, rate limits y limpieza por tienda.
- La desconexion de PayPal debe marcar primero la tienda como desconectada y despues retirar sus trabajos pendientes. El worker vuelve a comprobar el estado para cubrir carreras.

## Forma de trabajo

- Implementar por pasos y no adelantar etapas sin confirmacion cuando se este siguiendo el plan inicial.
- Reutilizar APIs, helpers y convenciones del template oficial.
- Mantener cambios pequenos, modulares y centrados en el MVP.
- Aplicar migraciones Prisma y ejecutar las pruebas o comprobaciones de tipos relevantes tras cada cambio.
- No modificar el modelo `Session` sin comprobar los requisitos de la version instalada de Shopify.
- No hacer commits ni publicar cambios sin peticion explicita.

## Comandos base

Tras generar el scaffold, confirmar los scripts reales de `package.json`. Los comandos esperados son:

```bash
npm install
npm run dev
npm run build
npx prisma migrate dev
```

No asumir comandos de test, lint o typecheck hasta comprobar que existen en el proyecto generado.
