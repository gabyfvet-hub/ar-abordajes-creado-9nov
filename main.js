import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MindARThree } from 'mindar-image-three';

const EDITOR = new URLSearchParams(location.search).has('editor');
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- avisos y carga de datos ---------- */
let avisoTimer;
function aviso(texto, ms = 4500) {
  const el = $('#aviso');
  el.textContent = texto;
  el.classList.remove('oculto');
  clearTimeout(avisoTimer);
  if (ms > 0) avisoTimer = setTimeout(() => el.classList.add('oculto'), ms);
}
function ocultarAviso() { $('#aviso').classList.add('oculto'); }

async function cargarJSON(url, defecto) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    console.warn('No se pudo cargar', url, e);
    return defecto;
  }
}

const cfg = await cargarJSON('abordajes.json', null);
if (!cfg) { aviso('No se encontró abordajes.json', 0); throw new Error('Sin configuración'); }
const posiciones = await cargarJSON('posiciones.json', {});
const M = Object.assign({ archivo: 'ovejero.glb', largo: 1, rotacion: [0, 0, 0], elevacion: 0, eje: 'z' }, cfg.modelo);
const posturas = cfg.posturas ?? [{ nombre: 'De pie', grados: 0 }];
const COLOR_DEF = '#888888';

if (EDITOR) document.body.classList.add('editando');

/* ---------- escena base ---------- */
const escena = new THREE.Group();   // Y hacia arriba
const pivote = new THREE.Group();   // gira para cambiar la postura
const cuerpo = new THREE.Group();   // rotación del modelo; las marcas viven acá
const marcas = new THREE.Group();
escena.add(pivote);
pivote.add(cuerpo);
cuerpo.add(marcas);
cuerpo.rotation.set(...M.rotacion.map((g) => THREE.MathUtils.degToRad(g)));

let modelo = null;
let cajaLocal = null;   // caja del modelo normalizado, en el sistema de «cuerpo»
let techo = 1;          // altura del perro de pie sobre el marcador
let renderer, camera, scene, controls, mindar, ancla;

if (EDITOR) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9edf2);
  camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 50);
  camera.position.set(1.5, 1.1, 1.9);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  $('#ar').appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.4, 0);
  scene.add(escena);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
} else {
  mindar = new MindARThree({ container: $('#ar'), imageTargetSrc: cfg.marcador ?? 'marcador.mind', uiScanning: 'no', uiLoading: 'no' });
  ({ renderer, scene, camera } = mindar);
  ancla = mindar.addAnchor(0);
  const base = new THREE.Group();
  base.rotation.x = Math.PI / 2;      // el eje Y de la escena apunta hacia afuera del marcador
  ancla.group.add(base);
  base.add(escena);
  ancla.onTargetFound = () => ocultarAviso();
  ancla.onTargetLost = () => aviso('Apuntá la cámara al marcador', 0);
}

scene.add(new THREE.HemisphereLight(0xffffff, 0x8888aa, 1.6));
const luz = new THREE.DirectionalLight(0xffffff, 1.2);
luz.position.set(1, 2, 1.5);
scene.add(luz);

/* ---------- modelo ---------- */
async function cargarModelo() {
  let objeto;
  try {
    const cargador = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    cargador.setDRACOLoader(draco);
    const gltf = await cargador.loadAsync(M.archivo, (e) => {
      if (e.total) aviso(`Cargando modelo… ${Math.round((e.loaded / e.total) * 100)}%`, 0);
    });
    objeto = gltf.scene;
  } catch (e) {
    console.warn('No se pudo cargar el modelo', e);
    aviso('No se encontró ' + M.archivo + ': se muestra una figura de prueba.', 6000);
    objeto = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.12, 0.5, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0xc08a4a })
    );
    objeto.rotation.z = Math.PI / 2;
  }
  const contenedor = new THREE.Group();
  contenedor.add(objeto);
  const caja = new THREE.Box3().setFromObject(contenedor);
  const tam = caja.getSize(new THREE.Vector3());
  const centro = caja.getCenter(new THREE.Vector3());
  const k = M.largo / Math.max(tam.x, tam.y, tam.z);
  contenedor.scale.setScalar(k);
  contenedor.position.copy(centro).multiplyScalar(-k);
  cajaLocal = new THREE.Box3().setFromObject(contenedor);   // todavía sin padres: coordenadas locales
  cuerpo.add(contenedor);
  modelo = contenedor;
}

/* Altura del perro sobre el marcador según la postura (así siempre «apoya» sobre el plano) */
const EJES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
function extremosY(grados) {
  const q = new THREE.Quaternion().setFromAxisAngle(EJES[M.eje] ?? EJES.z, THREE.MathUtils.degToRad(grados));
  let min = Infinity, max = -Infinity;
  for (const x of [cajaLocal.min.x, cajaLocal.max.x]) for (const y of [cajaLocal.min.y, cajaLocal.max.y]) for (const z of [cajaLocal.min.z, cajaLocal.max.z]) {
    const v = new THREE.Vector3(x, y, z).applyQuaternion(cuerpo.quaternion).applyQuaternion(q);
    min = Math.min(min, v.y); max = Math.max(max, v.y);
  }
  return { min, max };
}
const elevacionPara = (grados) => -extremosY(grados).min + 0.005 + M.elevacion;
function animarPostura() {
  const g = posturas[posturaIdx].grados;
  pivote.rotation[M.eje] += (objetivoRoll - pivote.rotation[M.eje]) * 0.12;
  pivote.position.y += (elevacionPara(g) - pivote.position.y) * 0.12;
}

/* ---------- texto 3D y anotación ---------- */
async function crearTexto3D() {
  try {
    const fuente = await new FontLoader().loadAsync('helvetiker_bold.typeface.json');
    const geo = new TextGeometry(cfg.titulo3d ?? 'LAPAROTOMIAS', { font: fuente, size: 0.05, height: 0.02, curveSegments: 6 });
    geo.center();
    const malla = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a9d8f, metalness: 0.2, roughness: 0.5 }));
    malla.position.set(0, techo + 0.38, 0);
    escena.add(malla);
  } catch (e) {
    console.warn('No se pudo crear el texto 3D', e);
  }
}

function crearEtiqueta(texto) {
  const lineas = String(texto).split('\n');
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(20,30,50,0.9)';
  x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#2a9d8f';
  x.lineWidth = 10;
  x.strokeRect(5, 5, c.width - 10, c.height - 10);
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.font = 'bold 76px sans-serif';
  x.fillText(lineas[0] ?? '', c.width / 2, 110);
  if (lineas[1]) { x.font = '44px sans-serif'; x.fillText(lineas[1], c.width / 2, 190); }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
  sprite.scale.set(0.8, 0.2, 1);
  sprite.position.set(0, techo + 0.17, 0);
  return sprite;
}

/* ---------- posiciones y marcas ---------- */
const pos = (id) => (posiciones[id] ? new THREE.Vector3(...posiciones[id]) : null);
const grupoDe = (a) => cfg.grupos.find((g) => g.id === a.grupo) ?? { id: '', nombre: '', color: COLOR_DEF };

function puntosDe(a) {
  if (a.ref) {
    const p = a.ref.map(pos);
    return p.every(Boolean) ? p : null;
  }
  if (a.centrado) {
    const c = pos(a.centrado.en);
    const [i, f] = a.centrado.eje.map(pos);
    if (!c || !i || !f) return null;
    const u = f.clone().sub(i);
    const mitad = u.length() * a.centrado.mitad;
    u.normalize();
    return [c.clone().addScaledVector(u, -mitad), c.clone().addScaledVector(u, mitad)];
  }
  if (a.puntos) {
    const p = a.puntos.map((q) => pos(q.id));
    return p.every(Boolean) ? p : null;
  }
  return null;
}

const matTactil = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const EJE_Y = new THREE.Vector3(0, 1, 0);

function segmento(p1, p2, radio, material) {
  const d = new THREE.Vector3().subVectors(p2, p1);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio, Math.max(d.length(), 0.001), 10), material);
  m.position.copy(p1).add(p2).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(EJE_Y, d.normalize());
  return m;
}

let grupoActivo = 'todo';
let seleccion = null;      // id de abordaje seleccionado
let quiz = null;

function reconstruirMarcas() {
  marcas.clear();
  for (const r of cfg.referencias ?? []) {
    const p = pos(r.id);
    if (!p) continue;
    const g = new THREE.Group();
    g.userData = { ref: r.id, grupo: r.grupo };
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const t = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), matTactil());
    s.position.copy(p); t.position.copy(p);
    g.add(s, t);
    marcas.add(g);
  }
  for (const a of cfg.abordajes) {
    const color = new THREE.Color(grupoDe(a).color);
    const g = new THREE.Group();
    g.userData = { id: a.id, grupo: a.grupo };
    const pts = puntosDe(a);
    if (pts) {
      for (let i = 0; i < pts.length - 1; i++) {
        const v = segmento(pts[i], pts[i + 1], 0.011, new THREE.MeshBasicMaterial({ color }));
        v.userData.visual = true;
        g.add(v, segmento(pts[i], pts[i + 1], 0.045, matTactil()));
      }
      for (const p of pts) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 12), new THREE.MeshBasicMaterial({ color }));
        s.position.copy(p);
        s.userData.visual = true;
        g.add(s);
      }
    } else if (EDITOR) {
      for (const q of a.puntos ?? []) {
        const p = pos(q.id);
        if (!p) continue;
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 12), new THREE.MeshBasicMaterial({ color }));
        s.position.copy(p);
        g.add(s);
      }
    }
    if (g.children.length) marcas.add(g);
  }
  aplicarVisibilidad();
}

function aplicarVisibilidad() {
  for (const g of marcas.children) {
    const u = g.userData;
    if (EDITOR) g.visible = true;
    else if (quiz) g.visible = u.ref ? true : u.id === quiz.mostrar;
    else g.visible = grupoActivo === 'todo' || !u.grupo || u.grupo === grupoActivo;
    const sel = u.id && u.id === seleccion;
    g.traverse((o) => { if (o.userData.visual && o.geometry?.type === 'CylinderGeometry') o.scale.set(sel ? 1.9 : 1, 1, sel ? 1.9 : 1); });
  }
}

/* ---------- puntero y selección ---------- */
const rayo = new THREE.Raycaster();
function apuntar(e) {
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  rayo.setFromCamera(ndc, camera);
}
function visibleReal(o) {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}
function marcaTocada(golpeCuerpo) {
  for (const h of rayo.intersectObjects(marcas.children, true)) {
    let o = h.object;
    while (o && !o.userData.id && !o.userData.ref) o = o.parent;
    if (!o || !visibleReal(o)) continue;
    if (golpeCuerpo && golpeCuerpo.distance < h.distance - 0.03) return null;  // tapada por el cuerpo
    return o.userData;
  }
  return null;
}

function alToque(e) {
  apuntar(e);
  const hm = modelo ? rayo.intersectObject(modelo, true)[0] ?? null : null;
  if (EDITOR) { if (editorSel && hm) fijarPunto(hm); return; }
  if (quiz && !quiz.resuelta) { evaluarQuiz(hm); return; }
  const u = marcaTocada(hm);
  if (!u) return;
  if (u.id) { seleccion = u.id; aplicarVisibilidad(); abrirAbordaje(cfg.abordajes.find((a) => a.id === u.id)); }
  else if (u.ref) {
    const r = cfg.referencias.find((x) => x.id === u.ref);
    abrirPanel(`<h3>${esc(r.nombre)}</h3><p>Punto de referencia anatómico.</p><p class="fuente">${esc(cfg.fuente_libro)}, cap. 26.</p>`);
  }
}

let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const mov = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (mov < 8) alToque(e);
});

/* ---------- panel de información ---------- */
function abrirPanel(html) {
  const p = $('#panel');
  p.innerHTML = html + '<button class="cerrar">Cerrar</button>';
  p.classList.remove('oculto');
  p.scrollTop = 0;
  p.querySelector('.cerrar').onclick = cerrarPanel;
}
function cerrarPanel() {
  $('#panel').classList.add('oculto');
  seleccion = null;
  aplicarVisibilidad();
}
const lista = (t, arr) => (arr?.length ? `<h4>${t}</h4><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');

function abrirAbordaje(a) {
  const g = grupoDe(a);
  const t = g.tecnica ?? {};
  const planos = a.planos ?? t.planos;
  const sintesis = a.sintesis ?? t.sintesis;
  const notas = [...(a.notas ?? []), ...(t.notas ?? [])];
  const variantes = (a.variantes ?? []).map((v) => `<p><b>${esc(v.nombre)}:</b> ${esc(v.texto)}</p>`).join('');
  const pensar = a.paraPensar ?? t.paraPensar;
  abrirPanel(`
    <span class="chip" style="background:${esc(g.color)}">${esc(g.nombre)}</span>
    <h3>${esc(a.nombre)}</h3>
    <p>${esc(a.resumen)}</p>
    ${a.acceso ? `<h4>Permite acceder a</h4><p>${esc(a.acceso)}</p>` : ''}
    ${variantes ? `<h4>Variantes</h4>${variantes}` : ''}
    ${lista('Planos de la diéresis', planos)}
    ${lista('Síntesis', sintesis)}
    ${lista('Para tener en cuenta', notas)}
    ${pensar ? `<p class="pensar">💭 ${esc(pensar)}</p>` : ''}
    <p class="fuente">Fuente: ${esc(cfg.fuente_libro)}, ${esc(a.fuente ?? '')}</p>`);
}

function abrirResumen() {
  const html = (cfg.generales ?? []).map((s) => lista(s.titulo, s.items)).join('');
  abrirPanel(`<h3>Resumen</h3>${html}<p class="fuente">Diapositivas de la Cátedra de Cirugía (2024); ${esc(cfg.fuente_libro)}.</p>`);
}

/* ---------- modo «¿Dónde incidirías?» ---------- */
function distSegmento(p, a, b) {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

function iniciarQuiz() {
  const validos = cfg.abordajes.filter((a) => puntosDe(a) && a.pregunta);
  if (!validos.length) { aviso('Primero hay que ubicar las incisiones (modo editor).'); return; }
  cerrarPanel();
  quiz = { orden: validos.sort(() => Math.random() - 0.5), i: 0, resuelta: false, mostrar: null };
  mostrarPregunta();
}
function salirQuiz() {
  quiz = null;
  $('#pregunta').classList.add('oculto');
  aplicarVisibilidad();
  actualizarBarra();
}
function mostrarPregunta(mensaje = '') {
  const a = quiz.orden[quiz.i];
  const p = $('#pregunta');
  p.classList.remove('oculto');
  p.innerHTML = `<div><b>Pregunta ${quiz.i + 1}/${quiz.orden.length}</b> · ${esc(a.pregunta)}</div>
    <div>${esc(mensaje) || 'Tocá sobre el perro el lugar de la incisión.'}</div>
    <div class="botones"></div>`;
  const b = p.querySelector('.botones');
  const btn = (txt, fn) => { const e = document.createElement('button'); e.textContent = txt; e.onclick = fn; b.appendChild(e); };
  if (!quiz.resuelta) btn('Ver respuesta', () => { quiz.resuelta = true; quiz.mostrar = a.id; aplicarVisibilidad(); mostrarPregunta('Esta es la incisión: ' + a.nombre + '.'); });
  else btn(quiz.i + 1 < quiz.orden.length ? 'Siguiente' : 'Terminar', () => {
    if (quiz.i + 1 < quiz.orden.length) { quiz.i++; quiz.resuelta = false; quiz.mostrar = null; aplicarVisibilidad(); mostrarPregunta(); }
    else salirQuiz();
  });
  btn('Salir', salirQuiz);
  aplicarVisibilidad();
}
function evaluarQuiz(hm) {
  if (!hm) { aviso('Tocá sobre el perro.'); return; }
  const a = quiz.orden[quiz.i];
  const pts = puntosDe(a);
  const local = cuerpo.worldToLocal(hm.point.clone());
  const d = Math.min(...pts.slice(0, -1).map((p, i) => distSegmento(local, p, pts[i + 1])));
  if (d < (cfg.quiz?.tolerancia ?? 0.07) * M.largo) {
    quiz.resuelta = true; quiz.mostrar = a.id; aplicarVisibilidad();
    mostrarPregunta('¡Correcto! Es la ' + a.nombre.charAt(0).toLowerCase() + a.nombre.slice(1) + '.');
  } else {
    mostrarPregunta('Todavía no. Probá de nuevo o tocá «Ver respuesta».');
  }
}

/* ---------- barra de botones y postura ---------- */
let posturaIdx = 0;
let objetivoRoll = 0;
let btnPostura, btnQuiz;
const botonesGrupo = {};

function construirBarra() {
  const b = $('#barra');
  b.innerHTML = '';
  const add = (txt, fn) => { const e = document.createElement('button'); e.textContent = txt; e.onclick = fn; b.appendChild(e); return e; };
  if (!EDITOR) {
    for (const g of [{ id: 'todo', nombre: 'Todo' }, ...cfg.grupos]) {
      botonesGrupo[g.id] = add(g.nombre, () => { grupoActivo = g.id; cerrarPanel(); actualizarBarra(); });
    }
  }
  btnPostura = add('', () => {
    posturaIdx = (posturaIdx + 1) % posturas.length;
    objetivoRoll = THREE.MathUtils.degToRad(posturas[posturaIdx].grados);
    actualizarBarra();
  });
  if (!EDITOR) {
    btnQuiz = add('¿Dónde incidirías?', () => (quiz ? salirQuiz() : iniciarQuiz()));
    add('Resumen', abrirResumen);
  }
  actualizarBarra();
}
function actualizarBarra() {
  for (const [id, e] of Object.entries(botonesGrupo)) e.classList.toggle('activo', id === grupoActivo);
  btnPostura.textContent = 'Postura: ' + posturas[posturaIdx].nombre;
  btnQuiz?.classList.toggle('activo', !!quiz);
  aplicarVisibilidad();
}

/* ---------- editor de posiciones (?editor) ---------- */
let editorSel = null;
function itemsEditor() {
  const it = [];
  for (const r of cfg.referencias ?? []) it.push({ id: r.id, nombre: r.nombre });
  for (const a of cfg.abordajes) for (const p of a.puntos ?? []) it.push({ id: p.id, nombre: `${a.nombre} — ${p.nombre}` });
  return it;
}
function fijarPunto(hit) {
  const l = cuerpo.worldToLocal(hit.point.clone());
  posiciones[editorSel] = [l.x, l.y, l.z].map((n) => Math.round(n * 10000) / 10000);
  const items = itemsEditor();
  const sig = items.slice(items.findIndex((i) => i.id === editorSel) + 1).find((i) => !posiciones[i.id]);
  editorSel = sig ? sig.id : editorSel;
  reconstruirMarcas();
  dibujarEditor();
}
function dibujarEditor() {
  const ed = $('#editor');
  ed.classList.remove('oculto');
  const items = itemsEditor();
  ed.innerHTML = `<h3>Ubicar puntos sobre el perro</h3>
    <p>1) Elegí un punto de la lista. 2) Tocá con el mouse el lugar exacto del perro. Arrastrá para girar la vista.</p>
    ${items.map((i) => `<button class="fila ${i.id === editorSel ? 'sel' : ''} ${posiciones[i.id] ? 'hecho' : ''}" data-id="${esc(i.id)}">${posiciones[i.id] ? '✓' : '○'} ${esc(i.nombre)}</button>`).join('')}
    <div class="acciones">
      <button id="e-desc">Descargar posiciones.json</button>
      <button id="e-copiar">Copiar JSON</button>
      <button id="e-borrar">Borrar punto elegido</button>
    </div>`;
  ed.querySelectorAll('.fila').forEach((b) => (b.onclick = () => { editorSel = b.dataset.id; dibujarEditor(); }));
  $('#e-desc').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(posiciones, null, 1)], { type: 'application/json' }));
    a.download = 'posiciones.json';
    a.click();
  };
  $('#e-copiar').onclick = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(posiciones)); aviso('JSON copiado.'); }
    catch { aviso('No se pudo copiar: usá «Descargar».'); }
  };
  $('#e-borrar').onclick = () => { if (editorSel) { delete posiciones[editorSel]; reconstruirMarcas(); dibujarEditor(); } };
}

/* ---------- arranque ---------- */
aviso('Cargando…', 0);
await cargarModelo();
techo = elevacionPara(0) + extremosY(0).max;
pivote.position.y = elevacionPara(0);
if (EDITOR) controls.target.set(0, techo * 0.6, 0);
await crearTexto3D();
escena.add(crearEtiqueta(cfg.anotacion ?? 'Ovejero alemán'));
reconstruirMarcas();
construirBarra();

if (EDITOR) {
  editorSel = itemsEditor().find((i) => !posiciones[i.id])?.id ?? null;
  dibujarEditor();
  ocultarAviso();
  renderer.setAnimationLoop(() => {
    animarPostura();
    controls.update();
    renderer.render(scene, camera);
  });
} else {
  try {
    const archivoMarcador = cfg.marcador ?? 'marcador.mind';
    const r = await fetch(archivoMarcador, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
    if (!r || !r.ok) throw new Error('Falta ' + archivoMarcador);
    aviso('Iniciando cámara…', 0);
    await mindar.start();
    aviso('Apuntá la cámara al marcador', 0);
    renderer.setAnimationLoop(() => {
      animarPostura();
      renderer.render(scene, camera);
    });
  } catch (e) {
    console.error(e);
    aviso(String(e.message).startsWith('Falta')
      ? 'Falta el archivo del marcador (marcador.mind). Para ubicar las incisiones sin cámara, abrí la página con /?editor al final de la dirección.'
      : 'No se pudo iniciar la cámara. Revisá el permiso de cámara del navegador.', 0);
  }
}
