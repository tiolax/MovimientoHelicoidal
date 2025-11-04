import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";

import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';


//////---------------------------------------------/////////
//////---- BLOQUE A: ESTADOS Y UTILIDADES----------/////////
//////---------------------------------------------/////////  

///Variable editables
const params = {
  // Editables "del problema":
  R: 100,            // radio [m]
  Tinput: 30,        // periodo por vuelta [s]
  dzPerTurn: 2,     // ascenso por vuelta [m] (en Tinput segundos)
  phi0: 0,           // ángulo inicial [rad]
  z0: 20,            // altura inicial [m]

  mPerUnit: 10,
  // Derivados (se calculan con applyDerived()):
  omega: 2*Math.PI/30,  // velocidad angular [rad/s]
  vz: 10/30,            // velocidad vertical [m/s]

  // Simulación y consulta:
  x0: 0, y0: 0,
  dt: 0.016, tmax: 80,
  targetT: 45,       // tiempo a consultar
  playing: true, projection: "persp"
};

//derivar ω y vz a partir de T y Δz por vuelt
function applyDerived(p = params){
  const T = Math.max(1e-9, p.Tinput);
 if (p.Tinput && p.Tinput > 0) {
    p.omega = 2*Math.PI / p.Tinput;
  }
 if (p.Tinput && p.Tinput > 0) {
    p.vz = p.dzPerTurn / p.Tinput;
  }
}
applyDerived();

///----Modelo Aguila---//
// Nodo que reemplaza a la partícula y alojará el modelo
let particleRoot;      // Group que moveremos/rotaremos
let model = null;      // La malla del modelo
let mixer = null;      // Para animaciones del modelo (si las tiene)
let modelForward = new THREE.Vector3(0, 1, 0); // Eje "frente" del modelo (ajusta si hace falta)
///------////

const history = []; // {t,x,y,z,vx,vy,vz,ax,ay,az}
let t = 0;

// Posición/velocidad/aceleración paramétrica del helicoide
function stateAt(time, p=params) {
  const {R, omega, vz, phi0, x0, y0, z0} = p;
  const ang = omega * time + phi0;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const x = x0 + R * cos;
  const y = y0 + R * sin;
  const z = z0 + vz * time;

  const vx = -R * omega * sin;
  const vy =  R * omega * cos;
  const vzv = vz;

  const ax = -R * omega * omega * cos;
  const ay = -R * omega * omega * sin;
  const az = 0;

  return {x,y,z,vx,vy,vz:vzv,ax,ay,az};
}

function period(p=params){ return 2*Math.PI / Math.abs(p.omega || 1e-9); }
function pitch(p=params){ return (2*Math.PI * p.vz) / (p.omega || 1e-9); } // avance por vuelta


//////---------------------------------------------/////////
//////---- BLOQUE B: THREE.JS BASE-----------------/////////
//////---------------------------------------------/////////  
const wrap = document.getElementById("canvas-wrap");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(wrap.clientWidth, wrap.clientHeight);
wrap.appendChild(renderer.domElement);

// Haz que todo el mundo tenga Z como "arriba"
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);


const scene = new THREE.Scene();
scene.background = new THREE.Color(0xFFFFFF);

const perspCam = new THREE.PerspectiveCamera(50, wrap.clientWidth / wrap.clientHeight, 0.01, 1000);
perspCam.position.set(8, 6, 10);

perspCam.up.set(0, 0, 1);


const orthoCam = new THREE.OrthographicCamera(); // valores se ajustan en resize/proyección
let activeCam = perspCam;

const controls = new OrbitControls(perspCam, renderer.domElement);
controls.enableDamping = true;

controls.object.up.set(0, 0, 1);
controls.update();

// === Ejes y grillas ===
const AXIS_LEN = 3; ///Hacer este valor editable desde el UI

// Ejes principales con Z vertical
const axes = new THREE.AxesHelper(AXIS_LEN);
scene.add(axes);

// Etiquetas de los ejes (X, Y, Z) con sprites de Canvas
function makeAxisLabel(text) {
  const size = 100;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,size,size);
  ctx.font = 'bold 72px system-ui, Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#111';
  ctx.fillText(text, size/2, size/2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(0.4, 0.4, 0.4);
  return spr;
}
const lblX = makeAxisLabel('X'); lblX.position.set(AXIS_LEN*1.1, 0, 0);
const lblY = makeAxisLabel('Y'); lblY.position.set(0, AXIS_LEN*1.1, 0);
const lblZ = makeAxisLabel('Z'); lblZ.position.set(0, 0, AXIS_LEN*1.1);
scene.add(lblX, lblY, lblZ);

// Grillas en los tres planos, con ligeras transparencias
const GRID_SIZE = 20, GRID_DIV = 20;

// Plano XY (suelo si Z es arriba)
const gridXY = new THREE.GridHelper(GRID_SIZE, GRID_DIV, 0x000000, 0x000000);
gridXY.rotation.x = 0;            // está en XY
gridXY.material.opacity = 0.12;
gridXY.material.transparent = true;
scene.add(gridXY);

// Plano YZ
const gridYZ = new THREE.GridHelper(GRID_SIZE, GRID_DIV, 0x000000, 0x000000);
gridYZ.rotation.z = Math.PI / 2;  // lo llevamos a YZ
gridYZ.material.opacity = 0.08;
gridYZ.material.transparent = true;
scene.add(gridYZ);

// Plano ZX
const gridZX = new THREE.GridHelper(GRID_SIZE, GRID_DIV, 0x000000, 0x000000);
gridZX.rotation.y = Math.PI / 2;  // lo llevamos a ZX
gridZX.material.opacity = 0.08;
gridZX.material.transparent = true;
scene.add(gridZX);


// Partícula (esfera pequeña)
let cargarModelo = true;

particleRoot = new THREE.Group();
particleRoot.name = 'ParticleRoot';
scene.add(particleRoot);

function loadModel() {
  const loader = new GLTFLoader(); 
  loader.load(
    'models/Aguila2.glb',      
    (gltf) => {
      model = gltf.scene;
      model.name = 'ParticleModel';

      // Ajusta escala inicial (depende de tu modelo)
      const s = 2.5; // ej.: si tu modelo viene en cm; prueba 0.01 o 0.1
      model.scale.set(s, s, s);
        model.rotation.x = Math.PI / 2; // Y→Z
        model.rotation.y =Math.PI/2;
      // Mejora visual
      model.traverse(obj => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });

      // Añade al contenedor
      particleRoot.add(model);

      // Animaciones (si el modelo trae clips)
      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        const action = mixer.clipAction(gltf.animations[0]);
        action.play();
      }
    },
    undefined,
    (err) => console.error('Error cargando modelo:', err)
  );
}
loadModel();

/*const particle = new THREE.Mesh(
new THREE.SphereGeometry(0.08, 32, 16),
new THREE.MeshStandardMaterial({ color: 0x1565c0, metalness: 0.1, roughness: 0.6 })
);
scene.add(particle);*/



// Luz
const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.0);
scene.add(hemi);

// Trayectoria (línea dinámica)
const maxPoints = 5000;
const positions = new Float32Array(maxPoints * 3);
const trajGeom = new THREE.BufferGeometry();
trajGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
trajGeom.setDrawRange(0, 0);
const trajectory = new THREE.Line(
  trajGeom,
  new THREE.LineBasicMaterial({ color: 0x0d47a1, linewidth: 1 })
);
scene.add(trajectory);

let drawCount = 0;

// --------- Proyecciones / cámaras ---------
function setProjection(mode){
  params.projection = mode;
  if(mode === "persp"){
    activeCam = perspCam;
    controls.enabled = true;
  } else {
    // Cámara ortográfica
    activeCam = orthoCam;
    controls.enabled = false;
    const size = fitOrthoSize();

    orthoCam.left = -size.w/2;
    orthoCam.right = size.w/2;
    orthoCam.top = size.h/2;
    orthoCam.bottom = -size.h/2;
    orthoCam.near = -1000;
    orthoCam.far = 1000;

    const d = 100; // distancia “lejana” para orto
    if(mode === "xy"){
      orthoCam.position.set(0, 0, d);
      orthoCam.up.set(0, 1, 0);
      orthoCam.lookAt(0,0,0);
    } else if(mode === "yz"){
      orthoCam.position.set(d, 0, 0); // mirando hacia -x
      orthoCam.up.set(0, 0, 1);       // eje Z arriba para ver Y vertical y Z horizontal
      orthoCam.lookAt(0,0,0);
    } else if(mode === "zx"){
      orthoCam.position.set(0, d, 0); // mirando hacia -y
      orthoCam.up.set(0, 0, 1);       // eje Z arriba para ver Z vertical y X horizontal
      orthoCam.lookAt(0,0,0);
    }
    orthoCam.updateProjectionMatrix();
  }
}

function fitOrthoSize(){
  // Mantén una escala razonable en orto: 20 unidades a lo ancho aprox.
  const aspect = wrap.clientWidth / wrap.clientHeight;
  const worldWidth = 20;
  const worldHeight = worldWidth / aspect;
  return { w: worldWidth, h: worldHeight };
}

function onResize(){
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  perspCam.aspect = wrap.clientWidth / wrap.clientHeight;
  perspCam.updateProjectionMatrix();

  if(activeCam === orthoCam){
    const size = fitOrthoSize();
    orthoCam.left = -size.w/2;
    orthoCam.right = size.w/2;
    orthoCam.top = size.h/2;
    orthoCam.bottom = -size.h/2;
    orthoCam.updateProjectionMatrix();
  }
}
window.addEventListener("resize", onResize);


//////---------------------------------------------/////////
//////---- BLOQUE C: UI, FORMULARIOS Y EVENTOS-----/////////
//////---------------------------------------------/////////  
const form = document.getElementById("controls");
const readouts = {
  t: document.getElementById("ro-t"),
  speed: document.getElementById("ro-speed"),
  acc: document.getElementById("ro-acc"),
  T: document.getElementById("ro-T"),
  p: document.getElementById("ro-p"),
};


function syncParamsFromForm(evt){
  const data = new FormData(form);
  for (const [k, v] of data.entries()) {
    const num = Number(v);
    if (!Number.isNaN(num)) params[k] = num;
  }

  const changed = evt && evt.target ? evt.target.name : null;

  if (changed === "omega") {
    // Usuario editó ω directamente: recalcular T y vz
    const w = Number(params.omega);
    const absw = Math.max(1e-9, Math.abs(w)); // evita división por 0
    params.Tinput = 2 * Math.PI / absw;
    params.vz = params.dzPerTurn / params.Tinput;

    // reflejar T en el input
    const Tin = form.querySelector('input[name="Tinput"]');
    if (Tin) Tin.value = params.Tinput.toFixed(6);
  } else {
    // Para cualquier otro cambio (incluye Tinput): derivar ω y vz desde T
    applyDerived(params);

    // reflejar ω en el input
    const wIn = form.querySelector('input[name="omega"]');
    if (wIn) wIn.value = params.omega.toFixed(6);
  }
}


form.addEventListener("input", () => {
  syncParamsFromForm(e);
  updateReadouts(); // T y p dependen de parámetros
});

document.getElementById("play").addEventListener("click", () => params.playing = !params.playing);
document.getElementById("reset").addEventListener("click", resetSim);
document.getElementById("export").addEventListener("click", exportCSV);

document.querySelectorAll(".view-buttons button").forEach(btn => {
  btn.addEventListener("click", () => setProjection(btn.dataset.view));
});

window.addEventListener("keydown", (e) => {
  if(e.key === "1") setProjection("persp");
  if(e.key === "2") setProjection("xy");
  if(e.key === "3") setProjection("yz");
  if(e.key === "4") setProjection("zx");
});


const btnCalc = document.getElementById("calc");
if(btnCalc){
  btnCalc.addEventListener("click", () => {
    computeInstant();
    buildTableTwoTurns();
  });
}



//////---------------------------------------------/////////
//////---- BLOQUE D: SIMULACION--------------------/////////
//////---------------------------------------------/////////  

//Reinicia el t, limpia trayectoria e historial
function resetSim(){
  applyDerived(params);

  t = 0;
  drawCount = 0;
  trajGeom.setDrawRange(0, 0);
  trajGeom.attributes.position.needsUpdate = true;
  history.length = 0;

  const s0 = stateAt(0);

// Ahora
particleRoot.position.set(
  s0.x / params.mPerUnit,
  s0.y / params.mPerUnit,
  s0.z / params.mPerUnit
);


  /*
  particle.position.set(
  s0.x / params.mPerUnit,
  s0.y / params.mPerUnit,
  s0.z / params.mPerUnit
)*/


  updateReadouts(0, s0);
  computeInstant();
}


function step(dt){
  t = Math.min(t + dt, params.tmax);

  const s = stateAt(t);

  particleRoot.position.set(
  s.x / params.mPerUnit,
  s.y / params.mPerUnit,
  s.z / params.mPerUnit
);
   /*
 particle.position.set(
  s.x / params.mPerUnit,
  s.y / params.mPerUnit,
  s.z / params.mPerUnit
);
*/



// Calcula la dirección de la velocidad en metros/segundo
const v = new THREE.Vector3(s.vx, s.vy, s.vz);
if (v.lengthSq() > 1e-12) {
  v.normalize();

  // Quaternion que lleva el eje "frente" del modelo hacia v
  const q = new THREE.Quaternion().setFromUnitVectors(modelForward, v);
  particleRoot.quaternion.copy(q);
}





  // agregar punto a la trayectoria
  if(drawCount < maxPoints){
    const i = drawCount * 3;
positions[i]   = s.x / params.mPerUnit;
positions[i+1] = s.y / params.mPerUnit;
positions[i+2] = s.z / params.mPerUnit;
    drawCount++;
    trajGeom.setDrawRange(0, drawCount);
    trajGeom.attributes.position.needsUpdate = true;
  }

  // guardar en historial para export/análisis
  history.push({t, ...s});

  updateReadouts(t, s);
}

function updateReadouts(curT=t, s=stateAt(t)){
  const speed = Math.hypot(s.vx, s.vy, s.vz);
  const acc = Math.hypot(s.ax, s.ay, s.az);
  readouts.t.textContent = curT.toFixed(3);
  readouts.speed.textContent = speed.toFixed(4);
  readouts.acc.textContent = acc.toFixed(4);
  readouts.T.textContent = period().toFixed(4);
  readouts.p.textContent = pitch().toFixed(4);
}


// --- Cálculo en t = params.targetT ---
function computeInstant(){
  const tQ = params.targetT;
  const s = stateAt(tQ);
  const speed = Math.hypot(s.vx, s.vy, s.vz);
  const acc   = Math.hypot(s.ax, s.ay, s.az);

  // Mostrar si existen elementos; si no, log
  const el = document.getElementById("instant");
  const text =
    `t=${tQ.toFixed(3)} s\n` +
    `pos = (${s.x.toFixed(3)}, ${s.y.toFixed(3)}, ${s.z.toFixed(3)}) m\n` +
    `vel = (${s.vx.toFixed(3)}, ${s.vy.toFixed(3)}, ${s.vz.toFixed(3)}) m/s | |v|=${speed.toFixed(4)}\n` +
    `acc = (${s.ax.toFixed(3)}, ${s.ay.toFixed(3)}, ${s.az.toFixed(3)}) m/s² | |a|=${acc.toFixed(4)}`;
  if(el) el.textContent = text; else console.log(text);

  return {tQ, s, speed, acc};
}

// --- Tabla hasta 2 vueltas (también equivalen a 2 "pasos" en z) ---
function buildTableTwoTurns(){
  const T = period();               // basado en params.omega
  const tEnd = 2 * T;               // dos vueltas
  const body = document.querySelector('#table2 tbody');
  if (!body) return;

  // Limpia
  body.innerHTML = '';

  // Recorre en pasos de 1 s (0,1,2,...)
  const rows = [];
  for (let k = 0; k <= Math.floor(tEnd + 1e-9); k += 1) {
    const tt = k * 1.0;             // segundos enteros
    const s = stateAt(tt);
    rows.push({ t: tt, ...s });
  }

  // Inserta filas
  const toFixed = (v, n=3) => (Number.isFinite(v) ? v.toFixed(n) : '');
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${toFixed(r.t, 0)}</td>` +
      `<td>${toFixed(r.x)}</td><td>${toFixed(r.y)}</td><td>${toFixed(r.z)}</td>` +
      `<td>${toFixed(r.vx)}</td><td>${toFixed(r.vy)}</td><td>${toFixed(r.vz)}</td>` +
      `<td>${toFixed(r.ax)}</td><td>${toFixed(r.ay)}</td><td>${toFixed(r.az)}</td>`;
    body.appendChild(tr);
  }

  // (Opcional) descarga CSV si quieres seguir guardando
  const header = "t,x,y,z,vx,vy,vz,ax,ay,az\n";
  const csv = header + rows.map(r => [
    r.t, r.x, r.y, r.z, r.vx, r.vy, r.vz, r.ax, r.ay, r.az
  ].join(",")).join("\n");

  const blob = new Blob([csv], {type: "text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tabla_2vueltas.csv";
  a.click();
  URL.revokeObjectURL(url);

  return rows;
}



//////---------------------------------------------/////////
//////---- BLOQUE E: BUCLE PRINCIPAL---------------/////////
//////---------------------------------------------/////////  
let last = performance.now();
function animate(now){
  requestAnimationFrame(animate);
  const dtReal = (now - last) / 1000;
  last = now;

  controls.update();

  if(params.playing && t < params.tmax){
    // usamos dt de parámetros para control numérico
    const steps = Math.max(1, Math.round(dtReal / Math.max(1e-6, params.dt)));
    const fixed = dtReal / steps;
    for(let i=0;i<steps;i++) step(fixed);
  }

  renderer.render(scene, activeCam);
}

// --------- Init ---------
syncParamsFromForm();
resetSim();
setProjection("persp");
onResize();
animate(performance.now());


//////---------------------------------------------/////////
//////---- BLOQUE F: EXPORTAR DATOS----------------/////////
//////---------------------------------------------/////////  
/// Este bloque es meramente opcional /////

function exportCSV(){
  if(history.length === 0) return;
  const header = "t,x,y,z,vx,vy,vz,ax,ay,az\n";
  const rows = history.map(s => [s.t,s.x,s.y,s.z,s.vx,s.vy,s.vz,s.ax,s.ay,s.az].join(",")).join("\n");
  const blob = new Blob([header + rows], {type: "text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "helicoide.csv";
  a.click();
  URL.revokeObjectURL(url);
}
