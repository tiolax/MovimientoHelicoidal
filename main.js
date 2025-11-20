import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
//////---------------------------------------------/////////
//////---- BLOQUE A: ESTADOS Y UTILIDADES----------/////////
//////---------------------------------------------/////////  
const DEFAULTS = {
  R: 100,            // radio [m]
  Tinput: 30,        // periodo por vuelta [s]
  dzPerTurn: 20,     // ascenso por vuelta [m] (en Tinput segundos)
  phi0: 0,           // ángulo inicial [rad]
  z0: 20,            // altura inicial [m]

  mPerUnit: 10,
  omega: 2*Math.PI/30,  // velocidad angular [rad/s]
  vz: 10/30,            // velocidad vertical [m/s]
  // Simulación y consulta:
  x0: 0, y0: 0,
  dt: 0.016, tmax: 80,
  targetT: 45,       // tiempo a consultar
  playing: false, projection: "persp"
};

const params = { ...DEFAULTS };

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

let particleRoot;     
let model = null;  
let mixer = null;    
let modelForward = new THREE.Vector3(0, 1, 0);

const history = []; 
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
perspCam.position.set(22, 8, 15);

perspCam.up.set(0, 0, 1);

const orthoCam = new THREE.OrthographicCamera(); // valores se ajustan en resize/proyección
let activeCam = perspCam;

const controls = new OrbitControls(perspCam, renderer.domElement);
controls.enableDamping = true;
controls.minPolarAngle = 0.0;             
controls.maxPolarAngle = Math.PI * 0.499;

controls.object.up.set(0, 0, 1);
controls.update();


// Nuevo: límites de zoom (distancia cámara–target)
controls.minDistance = 2;    // evita meterte dentro del modelo
controls.maxDistance = 50;   // evita alejarse demasiado

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
  spr.userData.text = text; 
  return spr;
}
const lblX = makeAxisLabel('X'); lblX.position.set(AXIS_LEN*1.1, 0, 0);
const lblY = makeAxisLabel('Y'); lblY.position.set(0, AXIS_LEN*1.1, 0);
const lblZ = makeAxisLabel('Z'); lblZ.position.set(0, 0, AXIS_LEN*1.1);
scene.add(lblX, lblY, lblZ);

// Grillas en los tres planos, con ligeras transparencias
const GRID_SIZE = 40, GRID_DIV = 40;

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


function updateGridScale() {
  const s = 10 / params.mPerUnit; // 1 celda = 10 m
  gridXY.scale.set(s, s, s);
  gridYZ.scale.set(s, s, s);
  gridZX.scale.set(s, s, s);
}
// Etiquetas numéricas en el grid XY
const gridLabels = new THREE.Group();
scene.add(gridLabels);

function makeTickLabel(text, scale = 0.5) {
 const size = 210;
 const canvas = document.createElement('canvas');
 canvas.width = canvas.height = size;
 const ctx = canvas.getContext('2d');
 ctx.clearRect(0, 0, size, size);
 ctx.font = 'bold 72px system-ui, Arial';
 ctx.textAlign = 'center';
 ctx.textBaseline = 'middle';
 ctx.fillStyle = '#ffffffff';
 ctx.fillText(text, size / 2, size / 2);
 const tex = new THREE.CanvasTexture(canvas);
 tex.anisotropy = 4;
 const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
 const spr = new THREE.Sprite(mat);
 spr.scale.set(scale, scale, scale);
 spr.userData.text = text; 
 return spr;
}
function updateGridLabels() { // Limpia etiquetas previas
 while (gridLabels.children.length) gridLabels.remove(gridLabels.children[0]);
  const s = 10 / params.mPerUnit;
  const half = GRID_SIZE / 2;     // distancia entre líneas (1 celda = 10 m)          // 15 "celdas" a cada lado
 const zLift = 0.05;                // evita z-fighting con el grid
  for (let i = 1; i <= half; i++) {   const meters = i * 10;
   // +X
   const lx = makeTickLabel(`${meters} m`);
   lx.position.set(i * s, 0, zLift);
   gridLabels.add(lx);
   // -X
   const lnx = makeTickLabel(`${-meters} m`);
   lnx.position.set(-i * s, 0, zLift);
   gridLabels.add(lnx);
   // +Y
   const ly = makeTickLabel(`${meters} m`);
   ly.position.set(0, i * s, zLift);
   gridLabels.add(ly);
   // -Y
    const lny = makeTickLabel(`${-meters} m`);
    lny.position.set(0, -i * s, zLift);
    gridLabels.add(lny);

// +Z
const lz = makeTickLabel(`${meters} m`);
lz.position.set(0, 0, i * s);
gridLabels.add(lz);
// -Z (opcional)
const lnz = makeTickLabel(`${-meters} m`);
lnz.position.set(0, 0, -i * s);
gridLabels.add(lnz);


  }
}

const particleRoot2 = new THREE.Group();
particleRoot2.name = 'ParticleRoot2';

particleRoot = new THREE.Group();
particleRoot.name = 'ParticleRoot';
scene.add(particleRoot);
scene.add(particleRoot2);


function loadModel(){
  const base = new GLTFLoader();

  base.load(
    'models/Rocaopiedraloquesea.glb',      
    (gltf) => {
      model = gltf.scene;
      model.name = 'ParticleModel';
      const s = 0.165;
      model.scale.set(s, s, s);
        model.rotation.x = Math.PI / 2; // Y→Z
      model.traverse(obj => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });
      particleRoot2.add(model);
    },
    undefined,
    (err) => console.error('Error cargando modelo:', err)
  );

  const loader = new GLTFLoader(); 
  loader.load(
    'models/Aguila2.glb',      
    (gltf) => {
      model = gltf.scene;
      model.name = 'ParticleModel';

      const s = 1.8;
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
      particleRoot.add(model);

    if (gltf.animations && gltf.animations.length) {
      mixer = new THREE.AnimationMixer(model);
      const clip = gltf.animations[0];
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity); // loop infinito
      action.clampWhenFinished = false;
      action.enabled = true;
      action.reset().play();
    }
    },
    undefined,
    (err) => console.error('Error cargando modelo:', err)
  );
}


loadModel();

// Luz
const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.0);
scene.add(hemi);

// === SKY & GROUND ============================================================
// Carga de texturas
const texLoader = new THREE.TextureLoader();

// 1) Fondo de cielo (imagen equirectangular o simple)
const skyTex = texLoader.load('textures/sky.jpg', () => {
  // Gestión de color moderna (r160): usa colorSpace
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex; // establece imagen como fondo del canvas
});

// 2) Ground en el plano XY (Z es arriba)
const groundTex = texLoader.load('textures/ground.jpg', (t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(20, 20); // repite para alta resolución aparente
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
});

const GROUND_W = 150;       
const GROUND_H = 150;

const groundMat = new THREE.MeshStandardMaterial({
  map: groundTex, roughness: 1.0, metalness: 0.0
});

// PlaneGeometry por defecto es XY con normal +Z → perfecto para "suelo" con Z arriba
// Plane “decorativo” para vista superior (un pelo bajo el grid)
const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_W, GROUND_H), groundMat);
ground.position.set(0, 0, -0.002);
ground.receiveShadow = true;
scene.add(ground);

//scene.fog = new THREE.Fog(0x688CD4, 50, 100); // opcional
// Añadimos volumen bajo el plano para que se vea en YZ/ZX:
const SOIL_W = 2000, SOIL_H = 2000, SOIL_DEPTH = 40;  // profundidad hacia -Z
const soilSidesMat = new THREE.MeshStandardMaterial({ color: 0x888577, roughness: 1.0, metalness: 0.0 });
// Orden materiales en Box: [px, nx, py, ny, pz, nz]
const soilMats = [
  soilSidesMat, soilSidesMat, soilSidesMat, soilSidesMat,
  groundMat,        // pz  (tapa superior = mismo “ground”)
  soilSidesMat      // nz  (fondo)
];
const soil = new THREE.Mesh(new THREE.BoxGeometry(GROUND_W, GROUND_H, SOIL_DEPTH), soilMats);
// Coloca la “tapa” del box coincidiendo con el ground (z≈0)
soil.position.set(0, 0, -SOIL_DEPTH/2 - 0.002);
soil.receiveShadow = true;
scene.add(soil);
// ============================================================================
// Trayectoria (línea dinámica)
const maxPoints = 5000;
const positions = new Float32Array(maxPoints * 3);
const trajGeom = new THREE.BufferGeometry();
trajGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
trajGeom.setDrawRange(0, 0);

const trajectory = new THREE.Line(
  trajGeom,
  new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 })
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
    const d = 120; // distancia “lejana” para orto
    const zOffset = params.z0; 
    if(mode === "xy"){
      orthoCam.position.set(0, 0, d);
      orthoCam.up.set(0, 1, 0);
      orthoCam.lookAt(0,0,0);
    } else if(mode === "yz"){
      orthoCam.position.set(d, 0, 5); // mirando hacia -x
      orthoCam.up.set(0, 0, 1);      
      orthoCam.lookAt(0,0,5);
    } else if(mode === "zx"){
      orthoCam.position.set(0, d, 5); // mirando hacia -y
      orthoCam.up.set(0, 0, 1);       // eje Z arriba para ver Z vertical y X horizontal
      orthoCam.lookAt(0,0,5);
    }
    orthoCam.updateProjectionMatrix();
  }
}
function fitOrthoSize(){
  // Mantén una escala razonable en orto: 20 unidades a lo ancho aprox.
  const aspect = wrap.clientWidth / wrap.clientHeight;
  const worldWidth = 24;
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
    const w = Number(params.omega);
    const absw = Math.max(1e-9, Math.abs(w)); // evita división por 0
    params.Tinput = 2 * Math.PI / absw;
    params.vz = params.dzPerTurn / params.Tinput;
    const Tin = form.querySelector('input[name="Tinput"]');
    if (Tin) Tin.value = params.Tinput.toFixed(6);
  } else {
    applyDerived(params);

    // reflejar ω en el input
    const wIn = form.querySelector('input[name="omega"]');
    if (wIn) wIn.value = params.omega.toFixed(6);
  }
}
form.addEventListener("input", (e) => {
  syncParamsFromForm(e);
  updateReadouts();
  updateGridScale();
  updateGridLabels();
  computeTargetAnalysis();
});
 const playBtn = document.getElementById("play");
 const togglePlay = () => {
   params.playing = !params.playing;
   playBtn.textContent = params.playing ? "⏸︎Pausar" : "⏵︎ Reanudar";
 };
 playBtn.addEventListener("click", togglePlay);

 playBtn.textContent = params.playing ? "⏸︎ Pausar" : "⏵︎ Reanudar";
document.getElementById("reset").addEventListener("click", resetSim);
document.getElementById('export').addEventListener('click', () => {
  // Exporta lo que se ve en la tabla #table2 a un archivo .xlsx
  const table = document.getElementById('table2');
  const wb = XLSX.utils.table_to_book(table, { sheet: 'Simulación' });
  XLSX.writeFile(wb, 'simulacion.xlsx');
});

// On/Off de grillas y etiquetas
const toggleGridsBtn = document.getElementById("toggleGrids");
if (toggleGridsBtn) {
  toggleGridsBtn.addEventListener("click", () => {
    const newVis = !gridXY.visible;
    gridXY.visible = gridYZ.visible = gridZX.visible = newVis;
    gridLabels.visible = newVis;
    toggleGridsBtn.textContent = newVis ? "Ocultar grids" : "Mostrar grids";
  });
  // estado inicial del texto
  toggleGridsBtn.textContent = gridXY.visible ? "Ocultar grids" : "Mostrar grids";
}

// --- Ocultar Visuales (suelo, cielo, etiquetas, trayectoria) ---
const toggleVisualsBtn = document.getElementById("toggleVisuals");
let visualsVisible = true;

if (toggleVisualsBtn) {
  toggleVisualsBtn.addEventListener("click", () => {
    visualsVisible = !visualsVisible;

    if (skyTex)
      scene.background = visualsVisible ? skyTex : new THREE.Color(0xffffff);
    ground.visible = visualsVisible;
    if (typeof soil !== "undefined") soil.visible = visualsVisible;
    particleRoot2.visible = visualsVisible;
    trajectory.material.color.set(visualsVisible ? 0xffffff : 0x0d47a1);

    gridLabels.children.forEach((label) => {
      if (label.isSprite && label.material.map) {
        const canvas = label.material.map.image;
        const ctx = canvas.getContext("2d");
        const size = canvas.width;
        const text = label.material.name || label.userData.text || ""; // guardamos el texto
        ctx.clearRect(0, 0, size, size);
        ctx.font = "bold 72px system-ui, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = visualsVisible ? "#ffffffff" : "#000000ff";
        ctx.fillText(text, size / 2, size / 2);
        label.material.map.needsUpdate = true;
      }
    });

    toggleVisualsBtn.textContent = visualsVisible
      ? "Ocultar visuales"
      : "Mostrar visuales";
  });
}

const resetParamsBtn = document.getElementById("resetParams");
if (resetParamsBtn) {
  resetParamsBtn.addEventListener("click", () => {
    Object.assign(params, DEFAULTS);
    // Refleja en el formulario
    for (const el of form.querySelectorAll('input[name]')) {
      const k = el.name;
      if (k in params) el.value = params[k];
    }
    applyDerived(params);
    // Sincroniza ω y campos derivados visibles
    const wIn = form.querySelector('input[name="omega"]');
    if (wIn) wIn.value = params.omega.toFixed(6);
    // Reaplica escala y etiquetas
    updateGridScale();
    updateGridLabels();
    // Reinicia la sim y cámara actual
    resetSim();
    setProjection(params.projection === "persp" ? "persp" : params.projection);
  });
}

const infoBtn = document.getElementById("infoBtn");
const infoDlg = document.getElementById("infoDlg");
if (infoBtn && infoDlg) {
  infoBtn.addEventListener("click", () => infoDlg.showModal());
}

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
    computeTargetAnalysis();
    computeInstant();
    buildTableUntilNow();
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
particleRoot.position.set(
  s0.x / params.mPerUnit,
  s0.y / params.mPerUnit,
  s0.z / params.mPerUnit
);
  particleRoot2.position.set( 9.5,0,0);

  updateReadouts(0, s0);
  computeInstant();
}

function step(dt){
  const stopAt = Math.min(params.tmax, Number(params.targetT) || params.tmax);
t = Math.min(t + dt, stopAt);

  const s = stateAt(t);

  particleRoot.position.set(
  s.x / params.mPerUnit,
  s.y / params.mPerUnit,
  s.z / params.mPerUnit
);

  particleRoot2.position.set( 9.5,0,0);

const v = new THREE.Vector3(s.vx, s.vy, s.vz);
if (v.lengthSq() > 1e-12) {
  v.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(modelForward, v);
  particleRoot.quaternion.copy(q);
}

  if(drawCount < maxPoints){
    const i = drawCount * 3;
positions[i]   = s.x / params.mPerUnit;
positions[i+1] = s.y / params.mPerUnit;
positions[i+2] = s.z / params.mPerUnit;
    drawCount++;
    trajGeom.setDrawRange(0, drawCount);
    trajGeom.attributes.position.needsUpdate = true;
  }

  history.push({t, ...s});

  updateReadouts(t, s);
}

function updateReadouts(curT=t, s=stateAt(t)){
  const speed = Math.hypot(s.vx, s.vy, s.vz);
  const acc = Math.hypot(s.ax, s.ay, s.az);

try {
  const pre = document.getElementById("readout");
  if (pre) {
    const vec = (x, y, z, n = 3) => `⟨${x.toFixed(n)}, ${y.toFixed(n)}, ${z.toFixed(n)}⟩`;
    const axDisplay = -s.ax; 
    const text =
      `t = ${curT.toFixed(3)} s\n` +
      `r(t) = ${vec(s.x, s.y, s.z)} m\n` +
      `v(t) = ${vec(s.vx, s.vy, s.vz)} m/s\n` +
      `a(t) = ${vec(axDisplay, s.ay, s.az)} m/s²`;
    pre.textContent = text;
  }
} catch (e) {
}

}

// --- Cálculo en t = params.targetT ---
function computeInstant(){
  const tQ = params.targetT;
  const s = stateAt(tQ);

  const el = document.getElementById("readout");
  const vec = (x,y,z,n=3)=>`⟨${x.toFixed(n)}, ${y.toFixed(n)}, ${z.toFixed(n)}⟩`;
  const axDisplay = -s.ax;

  const text =
    `t = ${tQ.toFixed(3)} s\n` +
    `r(t) = ${vec(s.x, s.y, s.z)} m\n` +
    `v(t) = ${vec(s.vx, s.vy, s.vz)} m/s\n` +
    `a(t) = ${vec(axDisplay, s.ay, s.az)} m/s²`;

  if (el) el.textContent = text; else console.log(text);

  return { tQ, s };
}

function computeTargetAnalysis(tQ = Number(params.targetT)) {
  const s = stateAt(tQ); 
  const vec = (x,y,z,n=3)=>`⟨${x.toFixed(n)}, ${y.toFixed(n)}, ${z.toFixed(n)}⟩`;
  const speed  = Math.hypot(s.vx, s.vy, s.vz);
  const accMag = Math.hypot(s.ax, s.ay, s.az);
  const axDisplay = -s.ax;
  const el = document.getElementById("instant");
  if (el) {
    const text =
      `t objetivo = ${tQ.toFixed(3)} s\n` +
      `r(t) = ${vec(s.x, s.y, s.z)} m\n` +
      `v(t) = ${vec(s.vx, s.vy, s.vz)} m/s   |v| = ${speed.toFixed(3)} m/s\n` +
      `a(t) = ${vec(axDisplay, s.ay, s.az)} m/s²  |a| = ${accMag.toFixed(3)} m/s²`;
    el.textContent = text;
  }

  // 4) Retornar por si quieres usar los valores en otro lado (tabla, logs, etc.)
  return { tQ, s, speed, accMag };
}

// --- Tabla hasta 2 vueltas (también equivalen a 2 "pasos" en z) ---
function buildTableUntilNow(){
  const tEnd = Math.floor(t); // hasta el segundo actual
  const body = document.querySelector('#table2 tbody');
  if (!body) return;

  body.innerHTML = '';

  const rows = [];
  for (let k = 0; k <= tEnd; k++) {
    const s = stateAt(k);
    rows.push({ t: k, ...s });
  }

  const toFixed = (v, n=3) => (Number.isFinite(v) ? v.toFixed(n) : '');
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${toFixed(r.t, 0)}</td>` +
      `<td>${toFixed(r.x)}</td><td>${toFixed(r.y)}</td><td>${toFixed(r.z)}</td>` +
      `<td>${toFixed(r.vx)}</td><td>${toFixed(r.vy)}</td><td>${toFixed(r.vz)}</td>` +
      `<td>${toFixed(-r.ax)}</td><td>${toFixed(r.ay)}</td><td>${toFixed(r.az)}</td>`;
    body.appendChild(tr);
  }
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
 // Evita que la cámara en perspectiva baje de Z=0 (suelo)
 if (activeCam === perspCam && perspCam.position.z < 0.1) {
   perspCam.position.z = 0.1;
 }
if (mixer) mixer.update(dtReal * (params.playing ? 1 : 0));

const stopAt = Math.min(params.tmax, Number(params.targetT) || params.tmax);

if (params.playing && t < stopAt) {
  const steps = Math.max(1, Math.round(dtReal / Math.max(1e-6, params.dt)));
  const fixed = dtReal / steps;
  for (let i = 0; i < steps; i++) step(fixed);
}

if (params.playing && t >= stopAt) {
  params.playing = false;
  // Actualiza el texto del botón si existe
  const playBtn = document.getElementById("play");
  if (playBtn) playBtn.textContent = "⏵︎ Reanudar";
}


  renderer.render(scene, activeCam);
  //composer.render();
}

// --------- Init ---------
syncParamsFromForm();
resetSim();
computeTargetAnalysis();
setProjection("yz");
onResize();
updateGridScale();
updateGridLabels();
animate(performance.now());

//////---------------------------------------------/////////
//////---- BLOQUE F: EXPORTAR DATOS----------------/////////
//////---------------------------------------------/////////  
/// Este bloque es meramente opcional /////

function exportCSV(){
  if (history.length === 0) return;

  const rows = [];
  for (let k = 0; k <= Math.floor(t); k++) {
    const s = stateAt(k);
    rows.push([k, s.x, s.y, s.z, s.vx, s.vy, s.vz, -s.ax, s.ay, s.az].map(v => v.toFixed(3)));
  }

  const header = "t,x,y,z,vx,vy,vz,ax,ay,az\n";
  const csv = header + rows.map(r => r.join(",")).join("\n");

  const blob = new Blob([csv], {type: "text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "helicoide_por_segundos.csv";
  a.click();
  URL.revokeObjectURL(url);
}
