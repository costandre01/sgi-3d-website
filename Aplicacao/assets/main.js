import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ============================================================
   TEXTURAS (SEM ANIMAÇÃO)
   ============================================================ */

const textureLoader = new THREE.TextureLoader();
const texturaB = textureLoader.load('./assets/texture/Wood050_4K-JPG_Color.jpg');

let materialBase = null;
let texturaAtual = 0;
let texturaOrigem = null;

/* ============================================================
   ÁUDIO
   ============================================================ */

const somStop     = new Audio('./assets/sounds/KSHMR_Tape_Stop_02.wav');
const somCrackle  = new Audio('./assets/sounds/KSHMR_Song_Starter_17_Endless_Horizon_135_Fm.wav');
const somCrackle2 = new Audio('./assets/sounds/KSHMR_Song_Starter_01_80s_Eternal_Flame_117_Fm.wav');

somStop.volume     = 0.05;
somCrackle.volume  = 0.6;
somCrackle.loop    = true;
somCrackle2.volume = 0.6;
somCrackle2.loop   = true;

function tocarSom(audio) {
  try {
    audio.currentTime = 0;
    audio.play();
  } catch (_) {}
}

/* ============================================================
   CENA, CÂMARA, RENDERER
   ============================================================ */

const container = document.getElementById('turntable-3d');
if (!container) throw new Error('Falta o container #turntable-3d');

const cena = new THREE.Scene();
cena.background = new THREE.Color(0xffffff);

const largura = container.clientWidth;
const altura  = container.clientHeight || 420;

const camara = new THREE.PerspectiveCamera(40, largura / altura, 0.1, 100);
camara.position.set(2.6, 1.55, 2.6);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(largura, altura);
container.appendChild(renderer.domElement);

/* ============================================================
   CONTROLOS
   ============================================================ */

const controlos = new OrbitControls(camara, renderer.domElement);
controlos.enableDamping = true;
controlos.dampingFactor = 0.08;
controlos.target.set(0, 0.6, 0);

/* ============================================================
   LUZES
   ============================================================ */

cena.add(new THREE.AmbientLight(0xffffff, 0.6));

const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
keyLight.position.set(3, 4, 2);
cena.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.65);
fillLight.position.set(-3, 2.5, -1.5);
cena.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 0.55);
rimLight.position.set(-2.5, 3.0, 3.0);
cena.add(rimLight);

/* ============================================================
   ESTADO / ANIMAÇÕES
   ============================================================ */

let modelo = null;
let disco1 = null;
let disco2 = null;
let discoAtivo = 1;

let mixer = null;
let rodarDisco = false;
let tocando = false;

/* tampa */
let dustAction = null;
let duracaoDust = 0;
let tampaAberta = false;
let tampaAnimando = false;
let tampaDestino = null;

/* knob / volume */
let tuningAction = null;
let duracaoTuning = 0;

let volumeAction = null;
let duracaoVolume = 0;

/* rotação discos */
let giraDisco1Action = null; // GirarDisco1
let giraDisco2Action = null; // RodarDisco2

/* agulha */
let agulhaAction = null;
let duracaoAgulha = 0;
let agulhaBaixando = false;

/* troca de disco */
let trocaDiscoActionBase = null;  // MudarDisco1
let duracaoTrocaBase = 0;

let trocaDiscoAction003 = null;   // MudarDisco2
let duracaoTroca003 = 0;

let trocandoDisco = false;
let faseTroca = 0;

/*
  0  idle
  1  base forward
  2  003 forward
  10 003 reverse
  11 base reverse
*/
let discoNoLado = 'direita'; // 'direita' | 'esquerda'

// evita que o estado inicial fique “do GLTF” (discos sobrepostos)
let estadoInicialDiscosAplicado = false;

/* ============================================================
   UI
   ============================================================ */

const btnAbrir   = document.getElementById('btn-open');
const btnFechar  = document.getElementById('btn-close');
const btnRodar   = document.getElementById('btn-play');
const btnParar   = document.getElementById('btn-stop');
const btnTrocar  = document.getElementById('btn-swap');
const btnTextura = document.getElementById('btn-textura');
const inputVol   = document.getElementById('volume');

function podeInteragirComDisco() {
  return (tampaAberta === true) && (tampaAnimando === false);
}

function setUIEnabled(el, enabled) {
  if (!el) return;
  el.disabled = !enabled;
  el.style.opacity = enabled ? '1' : '0.45';
  el.style.pointerEvents = enabled ? 'auto' : 'none';
}

function atualizarUI() {
  const aberto = podeInteragirComDisco();

  setUIEnabled(inputVol, aberto);

  setUIEnabled(btnRodar, aberto && !trocandoDisco && !agulhaBaixando && !tocando);

  setUIEnabled(btnParar, tocando || agulhaBaixando);

  setUIEnabled(btnTrocar, aberto && !trocandoDisco && !agulhaBaixando && !tocando);
}

/* ============================================================
   UTILITÁRIOS
   ============================================================ */

function desativarAction(action, setToStart = true) {
  if (!action) return;
  action.stop();
  action.reset();
  action.enabled = false;
  action.paused = true;
  if (setToStart) action.time = 0;
}

function congelarActionNoFim(action, duration) {
  if (!action || !duration || duration <= 0) return;
  action.enabled = true;
  action.paused = true;
  action.time = duration;
}

function congelarActionNoInicio(action) {
  if (!action) return;
  action.enabled = true;
  action.paused = true;
  action.time = 0;
}

function forcarParagemTotal() {
  tocando = false;
  rodarDisco = false;
  agulhaBaixando = false;

  pararRotacaoDiscos();

  somCrackle.pause();
  somCrackle.currentTime = 0;

  somCrackle2.pause();
  somCrackle2.currentTime = 0;

  atualizarUI();
}

/* ============================================================
   DISCO ATIVO
   ============================================================ */

function calcularDiscoAtivo() {
  if (!disco1 || !disco2) return discoAtivo;

  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  disco1.getWorldPosition(p1);
  disco2.getWorldPosition(p2);

  // Regra robusta: o disco no prato está MAIS ALTO (Y maior).
  // O disco na gaveta/caixa está bem mais baixo.
  const dy = p1.y - p2.y;

  // margem para evitar ruído
  if (Math.abs(dy) > 0.05) {
    discoAtivo = (dy > 0) ? 1 : 2;
    return discoAtivo;
  }

  // fallback: se estiverem com Y parecido, usa distância ao target
  const prato = controlos.target.clone();
  const d1 = p1.distanceToSquared(prato);
  const d2 = p2.distanceToSquared(prato);

  discoAtivo = (d1 <= d2) ? 1 : 2;
  return discoAtivo;
}

function crackleAtivo() {
  const idx = calcularDiscoAtivo();
  return (idx === 1) ? somCrackle : somCrackle2;
}

/* ============================================================
   ROTAÇÃO DISCOS
   ============================================================ */

function pararRotacaoDiscos() {
  // aqui NÃO faças reset obrigatório, só para mesmo
  if (giraDisco1Action) {
    giraDisco1Action.paused = true;
    giraDisco1Action.enabled = false;
  }
  if (giraDisco2Action) {
    giraDisco2Action.paused = true;
    giraDisco2Action.enabled = false;
  }
}

function iniciarRotacaoDiscoAtivo() {
  const idx = calcularDiscoAtivo();

  if (giraDisco1Action) {
    giraDisco1Action.enabled = (idx === 1);
    giraDisco1Action.paused  = (idx !== 1);
    if (idx === 1) {
      giraDisco1Action.timeScale = 1;
      if (!giraDisco1Action.isRunning()) giraDisco1Action.play();
    }
  }

  if (giraDisco2Action) {
    giraDisco2Action.enabled = (idx === 2);
    giraDisco2Action.paused  = (idx !== 2);
    if (idx === 2) {
      giraDisco2Action.timeScale = 1;
      if (!giraDisco2Action.isRunning()) giraDisco2Action.play();
    }
  }
}

/* ============================================================
   VOLUME
   ============================================================ */

function setVolumeUI(v01) {
  if (!podeInteragirComDisco()) return;
  if (trocandoDisco) return;

  const v = Math.min(1, Math.max(0, v01));

  somCrackle.volume  = v;
  somCrackle2.volume = v;
  somStop.volume     = 0.15 + 0.35 * v;

  if (tuningAction && duracaoTuning > 0) {
    tuningAction.stop();
    tuningAction.reset();
    tuningAction.enabled = true;
    tuningAction.play();
    tuningAction.paused = true;
    tuningAction.time = v * duracaoTuning;
  }

  if (volumeAction && duracaoVolume > 0) {
    volumeAction.stop();
    volumeAction.reset();
    volumeAction.enabled = true;
    volumeAction.play();
    volumeAction.paused = true;
    volumeAction.time = v * duracaoVolume;
  }
}

/* ============================================================
   TAMPA
   ============================================================ */

function animarTampa(abrir) {
  if (!dustAction || duracaoDust <= 0) return;
  if (tampaAnimando) return;

  // abrir=false => ABRIR
  // abrir=true  => FECHAR
  if (!abrir && tampaAberta) return;
  if (abrir && !tampaAberta) return;

  tampaAnimando = true;
  tampaDestino = abrir ? 'fechar' : 'abrir';
  atualizarUI();

  if (abrir) forcarParagemTotal();

  dustAction.stop();
  dustAction.reset();
  dustAction.enabled = true;
  dustAction.setEffectiveWeight(1);
  dustAction.loop = THREE.LoopOnce;
  dustAction.clampWhenFinished = true;

  if (abrir) {
    dustAction.timeScale = 1;
    dustAction.time = 0;
    dustAction.play();
  } else {
    dustAction.timeScale = -1;
    dustAction.time = duracaoDust;
    dustAction.play();
  }
}

/* ============================================================
   TROCA DISCO
   ============================================================ */

function tocarTrocaBaseForward() {
  if (!trocaDiscoActionBase || duracaoTrocaBase <= 0) return;
  trocaDiscoActionBase.stop();
  trocaDiscoActionBase.reset();
  trocaDiscoActionBase.enabled = true;
  trocaDiscoActionBase.setEffectiveWeight(1);
  trocaDiscoActionBase.timeScale = 1;
  trocaDiscoActionBase.time = 0;
  trocaDiscoActionBase.loop = THREE.LoopOnce;
  trocaDiscoActionBase.clampWhenFinished = true;
  trocaDiscoActionBase.play();
}

function tocarTroca003Forward() {
  if (!trocaDiscoAction003 || duracaoTroca003 <= 0) {
    faseTroca = 0;
    trocandoDisco = false;
    congelarActionNoFim(trocaDiscoActionBase, duracaoTrocaBase);
    discoNoLado = (discoNoLado === 'direita') ? 'esquerda' : 'direita';
    calcularDiscoAtivo();
    atualizarUI();
    return;
  }
  trocaDiscoAction003.stop();
  trocaDiscoAction003.reset();
  trocaDiscoAction003.enabled = true;
  trocaDiscoAction003.setEffectiveWeight(1);
  trocaDiscoAction003.timeScale = 1;
  trocaDiscoAction003.time = 0;
  trocaDiscoAction003.loop = THREE.LoopOnce;
  trocaDiscoAction003.clampWhenFinished = true;
  trocaDiscoAction003.play();
}

function tocarTroca003Reverse() {
  if (!trocaDiscoAction003 || duracaoTroca003 <= 0) {
    faseTroca = 11;
    tocarTrocaBaseReverse();
    return;
  }
  trocaDiscoAction003.stop();
  trocaDiscoAction003.reset();
  trocaDiscoAction003.enabled = true;
  trocaDiscoAction003.setEffectiveWeight(1);
  trocaDiscoAction003.timeScale = -1;
  trocaDiscoAction003.time = duracaoTroca003;
  trocaDiscoAction003.loop = THREE.LoopOnce;
  trocaDiscoAction003.clampWhenFinished = true;
  trocaDiscoAction003.play();
}

function tocarTrocaBaseReverse() {
  if (!trocaDiscoActionBase || duracaoTrocaBase <= 0) return;
  trocaDiscoActionBase.stop();
  trocaDiscoActionBase.reset();
  trocaDiscoActionBase.enabled = true;
  trocaDiscoActionBase.setEffectiveWeight(1);
  trocaDiscoActionBase.timeScale = -1;
  trocaDiscoActionBase.time = duracaoTrocaBase;
  trocaDiscoActionBase.loop = THREE.LoopOnce;
  trocaDiscoActionBase.clampWhenFinished = true;
  trocaDiscoActionBase.play();
}

function congelarTrocaNoFim() {
  congelarActionNoFim(trocaDiscoActionBase, duracaoTrocaBase);
  congelarActionNoFim(trocaDiscoAction003, duracaoTroca003);
}

function congelarTrocaNoInicio() {
  congelarActionNoInicio(trocaDiscoActionBase);
  congelarActionNoInicio(trocaDiscoAction003);
}

function aplicarEstadoInicialDiscos() {
  // aplica a pose "como se tivesses trocado 1 vez" e congela.
  if (estadoInicialDiscosAplicado) return;
  if (!trocaDiscoActionBase || !trocaDiscoAction003) return;
  if (!duracaoTrocaBase || !duracaoTroca003) return;

  // força a pose final das duas ações (base e 003)
  trocaDiscoActionBase.enabled = true;
  trocaDiscoActionBase.play();
  trocaDiscoActionBase.paused = true;
  trocaDiscoActionBase.time = duracaoTrocaBase;

  trocaDiscoAction003.enabled = true;
  trocaDiscoAction003.play();
  trocaDiscoAction003.paused = true;
  trocaDiscoAction003.time = duracaoTroca003;

  // após isto, o estado corresponde ao "forward completo"
  discoNoLado = 'esquerda';
  faseTroca = 0;
  trocandoDisco = false;

  // garantir que nada começa a rodar
  pararRotacaoDiscos();
  tocando = false;
  rodarDisco = false;

  calcularDiscoAtivo();
  atualizarUI();

  estadoInicialDiscosAplicado = true;
}

function animarTrocaDiscoToggle() {
  if (!podeInteragirComDisco()) return;
  if (tocando || agulhaBaixando) return;
  if (trocandoDisco) return;

  trocandoDisco = true;
  atualizarUI();

  // ao trocar, nunca pode ficar a rodar
  pararRotacaoDiscos();
  tocando = false;
  rodarDisco = false;

  // toggle
  if (discoNoLado === 'direita') {
    faseTroca = 1;
    tocarTrocaBaseForward();
  } else {
    faseTroca = 10;
    tocarTroca003Reverse();
  }
}

/* ============================================================
   PICKING (RAYCAST) — CLICAR EM PEÇAS DO MODELO
   ============================================================ */

const raycaster = new THREE.Raycaster();
const ponteiroNDC = new THREE.Vector2();

// referências a peças “clicáveis”
let objTampa = null;
let objAgulha = null;

let _down = null;

function _setPointerFromEvent(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
  ponteiroNDC.set(x, y);
}

function _isDescendantOf(node, ancestor) {
  if (!node || !ancestor) return false;
  let cur = node;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parent;
  }
  return false;
}

function _getTopHit(ev) {
  if (!modelo) return null;

  _setPointerFromEvent(ev);
  raycaster.setFromCamera(ponteiroNDC, camara);

  const hits = raycaster.intersectObject(modelo, true);
  if (!hits || hits.length === 0) return null;

  return hits[0];
}

/* ============
   AÇÕES (reutiliza a lógica dos botões)
   ============ */

function acaoToggleTampa() {
  // animarTampa(false) ABRE, animarTampa(true) FECHA
  // toggle = passar o estado atual
  animarTampa(tampaAberta);
  atualizarUI();
}

function acaoPlay() {
  if (!podeInteragirComDisco()) return;
  if (tocando || agulhaBaixando || trocandoDisco) return;

  if (agulhaAction && duracaoAgulha > 0) {
    agulhaBaixando = true;

    agulhaAction.stop();
    agulhaAction.reset();
    agulhaAction.enabled = true;
    agulhaAction.timeScale = 1;
    agulhaAction.time = 0;
    agulhaAction.play();
  } else {
    tocando = true;
    rodarDisco = true;
    iniciarRotacaoDiscoAtivo();
    const s = crackleAtivo();
    if (s.paused) tocarSom(s);
  }

  atualizarUI();
}

function acaoStop() {
  if (!tocando && !agulhaBaixando) return;

  tocando = false;
  rodarDisco = false;

  pararRotacaoDiscos();

  somCrackle.pause();
  somCrackle.currentTime = 0;
  somCrackle2.pause();
  somCrackle2.currentTime = 0;
  tocarSom(somStop);

  if (agulhaAction && duracaoAgulha > 0) {
    agulhaBaixando = false;

    agulhaAction.stop();
    agulhaAction.reset();
    agulhaAction.enabled = true;
    agulhaAction.timeScale = -1;
    agulhaAction.time = duracaoAgulha;
    agulhaAction.play();
  }

  atualizarUI();
}

function acaoTogglePlayStop() {
  if (tocando || agulhaBaixando) acaoStop();
  else acaoPlay();
}

function acaoSwap() {
  animarTrocaDiscoToggle();
}

/* ============
   DECISOR: o que foi clicado?
   ============ */

function decidirAcaoPorClique(hit) {
  const obj = hit?.object;
  if (!obj) return false;

  // 1) TAMPA
  if (_isDescendantOf(obj, objTampa)) {
    acaoToggleTampa();
    return true;
  }

  // 2) DISCOS (clicar no disco = play/stop)
  if (_isDescendantOf(obj, disco1) || _isDescendantOf(obj, disco2)) {
    acaoTogglePlayStop();
    return true;
  }

  // 3) AGULHA (opcional: clicar na agulha faz stop)
  if (_isDescendantOf(obj, objAgulha)) {
    acaoStop();
    return true;
  }

  // 4) OUTROS: para mapear pelo nome
  console.log('Clique sem ação mapeada:', obj.name, obj);
  return false;
}

function onPointerDown(ev) {
  _down = { x: ev.clientX, y: ev.clientY, t: performance.now() };
}

function onPointerUp(ev) {
  if (!_down) return;

  const dx = Math.abs(ev.clientX - _down.x);
  const dy = Math.abs(ev.clientY - _down.y);
  const dt = performance.now() - _down.t;

  _down = null;

  // tolerância (arrasto = OrbitControls)
  if (dx > 6 || dy > 6 || dt > 500) return;

  const hit = _getTopHit(ev);
  if (!hit) return;

  decidirAcaoPorClique(hit);
}

function ativarPickingNoCanvas() {
  renderer.domElement.style.touchAction = 'none';

  renderer.domElement.removeEventListener('pointerdown', onPointerDown);
  renderer.domElement.removeEventListener('pointerup', onPointerUp);

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
}

/* ============================================================
   LOADER / GLTF
   ============================================================ */

const loader = new GLTFLoader();
loader.setPath('./assets/texture/');

loader.load(
  'giradiscos_ambiente_final.gltf',
  (gltf) => {
    modelo = gltf.scene;
    modelo.scale.set(1, 1, 1);
    modelo.position.set(0, 0.05, 0);
    cena.add(modelo);

    modelo.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = false;
        obj.receiveShadow = false;

        if (obj.name === 'Base') {
          materialBase = obj.material;
          texturaOrigem = materialBase.map;
        }

        // --------- DETEÇÃO DE PEÇAS CLICÁVEIS (ajusta se necessário) ---------
        const n = (obj.name || '').toLowerCase();

        // Tampa
        if (!objTampa && (n.includes('tampa') || n.includes('lid') || n.includes('cover') || n.includes('dust'))) {
          objTampa = obj;
        }

        // Agulha / braço
        if (!objAgulha && (n.includes('agulha') || n.includes('tonearm') || n.includes('arm'))) {
          objAgulha = obj;
        }
        // -------------------------------------------------------------------
      }
    });

    const anims = gltf.animations || [];
    console.log('Animações no GLTF:', anims.map(c => c.name));

    disco1 = modelo.getObjectByName('disco') || modelo.getObjectByName('disc') || null;
    disco2 = modelo.getObjectByName('disco003') || modelo.getObjectByName('disc003') || null;

    mixer = new THREE.AnimationMixer(modelo);

    // ---------- Rotação discos (só rotação/quaternion) ----------
    const clipGira1 = THREE.AnimationClip.findByName(anims, 'GirarDisco1');
    if (clipGira1) {
      const c = clipGira1.clone();
      c.tracks = c.tracks.filter(t => t.name.endsWith('.quaternion'));
      giraDisco1Action = mixer.clipAction(c);
      giraDisco1Action.loop = THREE.LoopRepeat;
      giraDisco1Action.enabled = false;
      giraDisco1Action.play();
      giraDisco1Action.paused = true;
    } else {
      console.warn('⚠ Não encontrei "GirarDisco1".');
    }

    const clipGira2 = THREE.AnimationClip.findByName(anims, 'RodarDisco2');
    if (clipGira2) {
      const c = clipGira2.clone();
      c.tracks = c.tracks.filter(t => t.name.endsWith('.quaternion'));
      giraDisco2Action = mixer.clipAction(c);
      giraDisco2Action.loop = THREE.LoopRepeat;
      giraDisco2Action.enabled = false;
      giraDisco2Action.play();
      giraDisco2Action.paused = true;
    } else {
      console.warn('⚠ Não encontrei "RodarDisco2".');
    }

    // ---------- Tampa ----------
    const clipDust = THREE.AnimationClip.findByName(anims, 'Tampa');
    if (clipDust) {
      dustAction = mixer.clipAction(clipDust);
      dustAction.clampWhenFinished = true;
      dustAction.loop = THREE.LoopOnce;
      duracaoDust = clipDust.duration;

      dustAction.enabled = true;
      dustAction.play();
      dustAction.paused = true;
      dustAction.time = duracaoDust;

      tampaAberta = false;
      tampaAnimando = false;
      tampaDestino = null;
    } else {
      console.warn('⚠ Não encontrei "Tampa".');
    }

    // ---------- knob ----------
    const clipTuning = THREE.AnimationClip.findByName(anims, 'VelocidadeDisco');
    if (clipTuning) {
      tuningAction = mixer.clipAction(clipTuning);
      tuningAction.clampWhenFinished = true;
      tuningAction.loop = THREE.LoopOnce;
      duracaoTuning = clipTuning.duration;
    }

    const clipVolume = THREE.AnimationClip.findByName(anims, 'Som');
    if (clipVolume) {
      volumeAction = mixer.clipAction(clipVolume);
      volumeAction.clampWhenFinished = true;
      volumeAction.loop = THREE.LoopOnce;
      duracaoVolume = clipVolume.duration;
    }

    // ---------- Agulha ----------
    const clipAgulha = THREE.AnimationClip.findByName(anims, 'Agulha');
    if (clipAgulha) {
      agulhaAction = mixer.clipAction(clipAgulha);
      agulhaAction.clampWhenFinished = true;
      agulhaAction.loop = THREE.LoopOnce;
      duracaoAgulha = clipAgulha.duration;
    }

    /* ========================================================
       2.º GLTF — só para carregar animações de troca
       ======================================================== */

    const loader2 = new GLTFLoader();
    loader2.setPath('./assets/texture1/');

    loader2.load(
      'giradiscos_ambiente_final.gltf',
      (gltf2) => {
        const anims2 = gltf2.animations || [];

        const clipBase = THREE.AnimationClip.findByName(anims2, 'MudarDisco1');
        if (clipBase) {
          trocaDiscoActionBase = mixer.clipAction(clipBase);
          trocaDiscoActionBase.loop = THREE.LoopOnce;
          trocaDiscoActionBase.clampWhenFinished = true;
          duracaoTrocaBase = clipBase.duration;

          trocaDiscoActionBase.enabled = false;
          trocaDiscoActionBase.paused = true;
          trocaDiscoActionBase.time = 0;
        } else {
          console.warn('⚠ Não encontrei "MudarDisco1" no 2.º GLTF.');
        }

        const clip003 = THREE.AnimationClip.findByName(anims2, 'MudarDisco2');
        if (clip003) {
          trocaDiscoAction003 = mixer.clipAction(clip003);
          trocaDiscoAction003.loop = THREE.LoopOnce;
          trocaDiscoAction003.clampWhenFinished = true;
          duracaoTroca003 = clip003.duration;

          trocaDiscoAction003.enabled = false;
          trocaDiscoAction003.paused = true;
          trocaDiscoAction003.time = 0;
        } else {
          console.warn('⚠ Não encontrei "MudarDisco2" no 2.º GLTF.');
        }

        // correção do “arranque com discos sobrepostos”
        aplicarEstadoInicialDiscos();
      },
      undefined,
      (erro2) => console.error('Erro ao carregar 2.º GLTF:', erro2)
    );

    // =========================================================
    // Eventos: fim de animações
    // =========================================================
    mixer.addEventListener('finished', (event) => {
      // tampa acabou
      if (dustAction && event.action === dustAction) {
        tampaAnimando = false;

        if (tampaDestino === 'abrir') {
          tampaAberta = true;
          congelarActionNoInicio(dustAction);
        } else if (tampaDestino === 'fechar') {
          tampaAberta = false;
          congelarActionNoFim(dustAction, duracaoDust);
        }

        tampaDestino = null;
        atualizarUI();
        return;
      }

      // agulha acabou
      if (agulhaAction && event.action === agulhaAction) {
        if (agulhaBaixando) {
          agulhaBaixando = false;
          tocando = true;
          rodarDisco = true;
          iniciarRotacaoDiscoAtivo();
          const s = crackleAtivo();
          if (s.paused) tocarSom(s);
        }
        atualizarUI();
        return;
      }

      // troca disco: base terminou
      if (trocaDiscoActionBase && event.action === trocaDiscoActionBase) {
        if (faseTroca === 1) {
          faseTroca = 2;
          tocarTroca003Forward();
        } else if (faseTroca === 11) {
          faseTroca = 0;
          trocandoDisco = false;
          congelarTrocaNoInicio();

          discoNoLado = (discoNoLado === 'direita') ? 'esquerda' : 'direita';
          calcularDiscoAtivo();

          // NÃO roda automaticamente após troca
          if (tocando && rodarDisco) iniciarRotacaoDiscoAtivo();
          else pararRotacaoDiscos();

          atualizarUI();
        }
        return;
      }

      // troca disco: 003 terminou
      if (trocaDiscoAction003 && event.action === trocaDiscoAction003) {
        if (faseTroca === 2) {
          faseTroca = 0;
          trocandoDisco = false;
          congelarTrocaNoFim();

          discoNoLado = (discoNoLado === 'direita') ? 'esquerda' : 'direita';
          calcularDiscoAtivo();

          // NÃO roda automaticamente após troca
          if (tocando && rodarDisco) iniciarRotacaoDiscoAtivo();
          else pararRotacaoDiscos();

          atualizarUI();
        } else if (faseTroca === 10) {
          faseTroca = 11;
          tocarTrocaBaseReverse();
        }
        return;
      }
    });

    calcularDiscoAtivo();
    atualizarUI();

    // ativa cliques no modelo
    ativarPickingNoCanvas();
  },
  undefined,
  (erro) => console.error('Erro ao carregar giradiscos_ambiente_final.gltf:', erro)
);

/* ============================================================
   Trocar Textura
   ============================================================ */

function trocarTexturaBase() {
  if (!materialBase) return;

  texturaAtual = 1 - texturaAtual;
  materialBase.map = (texturaAtual === 0) ? texturaOrigem : texturaB;
  materialBase.needsUpdate = true;
}

/* ============================================================
   EVENTOS UI
   ============================================================ */

btnAbrir?.addEventListener('click', () => {
  // toggle (abre/fecha conforme estado)
  acaoToggleTampa();
});

btnFechar?.addEventListener('click', () => {
  // toggle (abre/fecha conforme estado)
  acaoToggleTampa();
});

btnRodar?.addEventListener('click', () => {
  acaoPlay();
});

btnParar?.addEventListener('click', () => {
  acaoStop();
});

btnTrocar?.addEventListener('click', () => {
  acaoSwap();
});

inputVol?.addEventListener('input', (e) => {
  if (!podeInteragirComDisco()) return;
  const raw = Number(e.target.value);
  if (Number.isNaN(raw)) return;
  setVolumeUI(raw / 100);
});

btnTextura?.addEventListener('click', () => {
  trocarTexturaBase();
});

/* ============================================================
   RESIZE
   ============================================================ */

window.addEventListener('resize', () => {
  const w = container.clientWidth;
  const h = container.clientHeight || 420;

  camara.aspect = w / h;
  camara.updateProjectionMatrix();
  renderer.setSize(w, h);
});

/* ============================================================
   LOOP
   ============================================================ */

const relogio = new THREE.Clock();

function animar() {
  requestAnimationFrame(animar);

  const dt = relogio.getDelta();
  if (mixer) mixer.update(dt);

  controlos.update();
  renderer.render(cena, camara);
}

animar();
