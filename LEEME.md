# Abordajes de laparotomía en AR (MindAR + three.js)

## Qué hay en la carpeta
- `index.html`, `main.js`, `estilo.css`: la aplicación.
- `abordajes.json`: todo el contenido didáctico (textos, planos, preguntas). Se edita con cualquier editor de texto.
- `posiciones.json`: dónde está cada incisión sobre el ovejero (se genera con el modo editor).
- `ovejero.glb`: tu modelo, optimizado (de 28,7 MB a 2,5 MB: texturas reducidas y sin compresión Draco).
- Archivos `three.module.js`, `GLTFLoader.js`, `OrbitControls.js`, `mindar-image-three.prod.js`, etc.: librerías (three.js y MindAR) incluidas, para que no dependa de ningún servidor externo. Están sueltas, sin subcarpetas, para poder subir todo de una vez.
- Falta UN archivo tuyo: `marcador.mind` (compilado de tu imagen).

## Pasos
1. Compilá tu imagen marcadora y guardá el resultado como `marcador.mind` en esta carpeta (ver más abajo).
2. Publicá la carpeta (HTTPS es obligatorio para la cámara): arrastrala a https://app.netlify.com/drop
3. Abrí el link que te da Netlify agregando `/?editor` al final (en la computadora). Ejemplo: `https://tu-sitio.netlify.app/?editor`
   Elegí cada punto de la lista y tocá el lugar correspondiente sobre el perro.
   Al terminar: «Descargar posiciones.json» y reemplazá el archivo de la carpeta.
   El editor funciona sin cámara y sin marcador.
4. Volvé a arrastrar la carpeta a Netlify Drop.
5. Abrí el link en el celular y apuntá la cámara a la imagen del marcador.

## Marcador
Compilá tu imagen en https://hiukim.github.io/mind-ar-js-doc/tools/compile y descargá `targets.mind`; renombralo a `marcador.mind`.
Conviene una imagen con mucho detalle y contraste (no un fondo liso).

## Ajustes en abordajes.json (sección «modelo»)
- `largo`: tamaño del perro (1 = el ancho del marcador).
- `rotacion`: [x, y, z] en grados. El perro mira hacia +Z; con [0, 90, 0] su largo queda a lo ancho del marcador.
- `elevacion`: ajuste fino de altura (el perro ya apoya solo sobre el marcador en cada postura).
- `eje`: eje del botón «Postura». Para este modelo es `z` (el largo del perro).
- `posturas`: lista de posturas del botón. Revisá visualmente qué flanco queda hacia arriba en «Decúbito lateral».

## Contenido
Los textos del libro están resumidos con palabras propias y citados; los de las diapositivas son de la Cátedra.
Revisá todo el contenido quirúrgico y corregí título y edición del libro (`fuente_libro`).
