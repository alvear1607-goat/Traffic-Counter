# Aforo Vehicular · versión web (iPhone y Android)

Es una página que se instala en el celular como una app y funciona sin internet.
Los conteos se guardan en el propio celular.

## 1. Publicarla (una sola vez, gratis)
1. Crea una cuenta en https://github.com y un repositorio nuevo (botón **New**), por ejemplo `aforo`. Déjalo **Public**.
2. En el repositorio: **Add file → Upload files**. Arrastra TODOS los archivos de esta carpeta
   (index.html, app.js, core.js, styles.css, sw.js, manifest.webmanifest, la carpeta `icons` y `.nojekyll`).
   Pulsa **Commit changes**.
3. Ve a **Settings → Pages**. En *Branch* elige **main** y la carpeta **/(root)**. Pulsa **Save**.
4. En 1-2 minutos aparece la dirección, parecida a `https://TU-USUARIO.github.io/aforo/`.
   Esa es la dirección que le compartes al equipo.

## 2. Instalarla en cada celular
- **iPhone:** abrir la dirección en **Safari** → botón Compartir → **Añadir a pantalla de inicio**.
  Usar SIEMPRE el ícono de la pantalla de inicio (la copia de Safari y la del ícono guardan datos por separado).
- **Android:** abrir en Chrome → menú ⋮ → **Instalar app**.

Abre la app una vez con internet para que quede disponible sin conexión.

## 3. Juntar los datos de varias personas
- Cada celular guarda sus propios conteos. Cada persona usa **Guardar respaldo** y te envía el archivo .json.
- En el celular o computador donde harás el estudio usa **Importar respaldo** con cada archivo.
  No duplica conteos que ya estén.
- Luego **Exportar todos** genera un Excel (una hoja por conteo) y dos CSV con todo junto
  (incluyen aforista, zona, punto y fecha).

## 4. Actualizar la app
Sustituye los archivos en GitHub. Si cambias algo, sube el número de versión en `sw.js` (línea `CACHE`).
Los celulares la actualizan al abrirla con internet.

## Limitaciones en iPhone
- Safari no permite vibración: el aviso de fin de intervalo es sonido + destello de pantalla + mensaje.
- Mantener la pantalla encendida funciona desde iOS 16.4; en versiones anteriores desactiva el bloqueo automático.
- Haz respaldos con frecuencia: si el iPhone se queda sin espacio, Safari puede borrar datos de páginas.
