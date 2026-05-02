# Sistema de Gestión Multi-Negocio

## Stack
- **Frontend:** React + Vite
- **Backend/DB:** Supabase (PostgreSQL + Auth)
- **Deploy:** Vercel

---

## PASO 1 — Base de datos (Supabase)

1. Ir a [supabase.com](https://supabase.com) → tu proyecto
2. **SQL Editor → New Query**
3. Pegar el contenido de `schema.sql` y ejecutar (Run)
4. Verificar que no haya errores en la consola

---

## PASO 2 — Google OAuth (ya configurado)

Verificar en Supabase → Authentication → Providers → Google que esté habilitado.

El Redirect URL debe ser:
```
https://eyayblajtjscratpzopg.supabase.co/auth/v1/callback
```

Cuando el sitio esté en Vercel, agregar también en Google Console:
- Origen autorizado: `https://TU-DOMINIO.vercel.app`
- Redirect URI: `https://eyayblajtjscratpzopg.supabase.co/auth/v1/callback`

Y en Supabase → Authentication → URL Configuration:
- Site URL: `https://TU-DOMINIO.vercel.app`
- Redirect URLs: `https://TU-DOMINIO.vercel.app`

---

## PASO 3 — Correr localmente

```bash
cd gestion-app
npm install
npm run dev
```

Abrir http://localhost:5173

El primer usuario que inicia sesión con Google queda como **administrador** automáticamente con acceso a todos los negocios.

---

## PASO 4 — Deploy en Vercel

1. Subir la carpeta `gestion-app` a GitHub (nuevo repositorio)
2. Ir a [vercel.com](https://vercel.com) → New Project → importar el repo
3. En **Environment Variables** agregar:
   ```
   VITE_SUPABASE_URL = https://eyayblajtjscratpzopg.supabase.co
   VITE_SUPABASE_ANON_KEY = sb_publishable_6n-VUKP6hwRurVLNPzn2Kw_wuxX3vd2
   ```
4. Deploy → Vercel genera una URL automáticamente
5. Copiar esa URL y configurarla en:
   - Supabase → Authentication → URL Configuration → Site URL
   - Google Console → Orígenes autorizados

---

## Estructura del proyecto

```
gestion-app/
├── index.html
├── vite.config.js
├── vercel.json
├── schema.sql          ← Ejecutar en Supabase SQL Editor
├── .env                ← NO subir a GitHub (ya en .gitignore)
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── index.css
    ├── lib/
    │   └── supabase.js
    ├── contexts/
    │   ├── AuthContext.jsx
    │   └── ToastContext.jsx
    ├── components/
    │   └── UI.jsx
    └── pages/
        ├── Login.jsx
        ├── AppShell.jsx
        ├── Dashboard.jsx       ← Etapa 2
        ├── MateriasPrimas.jsx  ← Etapa 2
        ├── Proveedores.jsx     ← Etapa 2
        ├── Compras.jsx         ← Etapa 2
        ├── Produccion.jsx      ← Etapa 2
        ├── Productos.jsx       ← Etapa 2
        ├── Caja.jsx            ← Etapa 2
        ├── Estadisticas.jsx    ← Etapa 3
        └── Configuracion.jsx   ← Etapa 2
```

---

## Roles

| | Admin | Operario |
|---|---|---|
| Acceso por defecto | Todos los módulos | Dashboard, Materias, Producción |
| Anular registros | ✓ | ✗ |
| Gestionar usuarios | ✓ | ✗ |
| Módulos configurables | ✓ | ✓ (por admin) |
