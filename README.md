# SyncPal

SyncPal es una aplicacion publica de Shopify que sincroniza con PayPal los numeros de seguimiento creados en los fulfillments de una tienda. El objetivo del MVP es ayudar a que PayPal disponga del tracking cuanto antes, sin bloquear la respuesta a los webhooks de Shopify.

## Estado

Los pasos 1 y 2 estan completados: scaffold oficial integrado, dependencias de cola instaladas y Prisma configurado para PostgreSQL con `ShopConfig` y `SyncLog`.

> Shopify sustituyo su plantilla oficial de Remix por React Router. En Shopify CLI 4.8.0, `app init` acepta `reactRouter` o `none`; no acepta `remix`. React Router es la continuacion oficial del stack Remix y es la opcion recomendada para este proyecto.

## Stack del MVP

- Shopify CLI con la plantilla React Router y TypeScript
- Node.js y React
- Shopify Polaris y App Bridge
- PostgreSQL con Prisma ORM
- Redis con BullMQ e ioredis
- Cifrado AES-256-CTR con `node:crypto`

## Inicializacion realizada

El proyecto se genero con Shopify CLI mediante:

```bash
npm init @shopify/app@latest -- --name SyncPal --template reactRouter --flavor typescript --package-manager npm
```

## Dependencias adicionales

Las dependencias de colas ya estan instaladas:

```bash
npm install bullmq ioredis
```

Prisma y el cliente de Shopify proceden de la plantilla. El modulo `node:crypto` forma parte de Node.js y no se instala.

## Entorno local

Crea el archivo de entorno y levanta PostgreSQL y Redis:

```bash
cp .env.example .env
docker compose up -d
npm run prisma -- migrate dev
```

Shopify CLI proporciona durante `npm run dev` las variables de la aplicacion Shopify. Los secretos de PayPal y la clave de cifrado deben configurarse solo en `.env`; este archivo esta excluido de Git.

Para validar el proyecto:

```bash
npm run typecheck
npm run build
```

## Desarrollo previsto

La implementacion se realizara por etapas:

1. Generar y validar el scaffold oficial. Completado.
2. Configurar PostgreSQL y los modelos Prisma `ShopConfig` y `SyncLog`. Completado.
3. Implementar el webhook `fulfillments/create`, la cola BullMQ, el worker de PayPal y el cifrado de tokens.
4. Crear dashboard, onboarding e historial con Polaris.
5. Integrar el plan unico con prueba gratuita y completar las reglas de desconexion.

## Alcance

Incluye conexion OAuth con PayPal, sincronizacion inicial, sincronizacion por webhook, reintentos hasta tres intentos, historial, sincronizacion manual y un unico plan con free trial.

No incluye multi-idioma, exportaciones complejas ni alertas por correo.

## Repositorio remoto

El remoto del proyecto es `git@github.com:miikorz/SyncPal.git`. No se deben subir archivos `.env`, credenciales de Shopify, secretos OAuth, claves de cifrado ni datos de PostgreSQL/Redis.

