import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

(function () {
  "use strict";

  var container = document.querySelector(".hero");
  var canvas = document.getElementById("growth-canvas");
  if (!container || !canvas) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isNarrow = window.matchMedia("(max-width: 900px)").matches;

  function hasWebGL() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
    } catch (e) {
      return false;
    }
  }

  if (reduceMotion || isNarrow || !hasWebGL()) {
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    return;
  }

  var INK = 0x0b0d0f;
  var GOLD = new THREE.Color(0xc9a961);
  var GREEN = new THREE.Color(0x3ecf8e);
  var BONE = new THREE.Color(0xe8e6e0);

  var PERIOD = 48; // seconds for one full, seamless loop
  var W0 = (Math.PI * 2) / PERIOD;

  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(INK, 0.052);

  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setClearColor(INK, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  scene.background = new THREE.Color(INK);

  // ---------- Ground ----------
  var groundMat = new THREE.MeshStandardMaterial({ color: 0x0a0c0e, roughness: 0.88, metalness: 0.2 });
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------- Lights ----------
  scene.add(new THREE.AmbientLight(0x2a3038, 0.55));

  var key = new THREE.DirectionalLight(0xffdfa8, 1.25);
  key.position.set(-9, 15, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -22;
  key.shadow.camera.right = 22;
  key.shadow.camera.top = 22;
  key.shadow.camera.bottom = -22;
  key.shadow.camera.far = 50;
  key.shadow.bias = -0.0015;
  scene.add(key);

  var rimGold = new THREE.PointLight(0xc9a961, 1.4, 30, 2);
  rimGold.position.set(5, 6, -4);
  scene.add(rimGold);

  var rimGreen = new THREE.PointLight(0x3ecf8e, 0.7, 26, 2);
  rimGreen.position.set(-6, 5, -10);
  scene.add(rimGreen);

  // ---------- Candlestick grid ----------
  var COLS = 9;
  var ROWS = 9;
  var SPACING_X = 2.3;
  var SPACING_Z = 2.5;
  var COUNT = COLS * ROWS;

  var bodyGeo = new THREE.BoxGeometry(1, 1, 1);
  var wickGeo = new THREE.CylinderGeometry(0.055, 0.055, 1, 8);
  var tipGeo = new THREE.SphereGeometry(0.11, 12, 12);

  var bodyMat = new THREE.MeshStandardMaterial({
    roughness: 0.38,
    metalness: 0.55,
    emissive: 0x3a2c10,
    emissiveIntensity: 0.6,
  });
  var wickMat = bodyMat;
  var tipMat = new THREE.MeshBasicMaterial({ toneMapped: false });

  var bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, COUNT);
  var wicks = new THREE.InstancedMesh(wickGeo, wickMat, COUNT);
  var tips = new THREE.InstancedMesh(tipGeo, tipMat, COUNT);
  bodies.castShadow = true;
  bodies.receiveShadow = true;
  wicks.castShadow = true;

  var dummy = new THREE.Object3D();
  var instances = [];

  function bell(i, n) {
    var mid = (n - 1) / 2;
    return 1 - Math.abs((i - mid) / (mid || 1));
  }

  var idx = 0;
  for (var r = 0; r < ROWS; r++) {
    for (var c = 0; c < COLS; c++) {
      var x = (c - (COLS - 1) / 2) * SPACING_X;
      var z = -r * SPACING_Z;
      var depthBoost = 0.5 + 0.5 * (r / (ROWS - 1));
      var base = 1.1 + 3.6 * bell(c, COLS) * depthBoost + Math.random() * 0.6;
      var amp = 0.6 + Math.random() * 1.6;
      var phase = Math.random() * Math.PI * 2;
      var harmonic = 1 + Math.floor(Math.random() * 2); // 1 or 2, still integer -> stays periodic
      var isGreen = Math.random() < 0.24;
      var color = isGreen ? GREEN : GOLD;
      var wickH = 0.35 + Math.random() * 0.35;

      instances.push({ x: x, z: z, base: base, amp: amp, phase: phase, harmonic: harmonic, wickH: wickH });

      bodies.setColorAt(idx, color);
      wicks.setColorAt(idx, color);
      tips.setColorAt(idx, color);
      idx++;
    }
  }

  scene.add(bodies, wicks, tips);

  // ---------- Composer / bloom ----------
  var composer = new EffectComposer(renderer);
  var renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  var bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.32);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- Resize ----------
  function resize() {
    var w = container.clientWidth || window.innerWidth;
    var h = container.clientHeight || window.innerHeight;
    var pr = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  var resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  window.addEventListener("resize", resize);
  resize();

  // ---------- Animation loop ----------
  var clock = new THREE.Clock();
  var running = true;

  document.addEventListener("visibilitychange", function () {
    running = document.visibilityState === "visible";
  });

  var lookTarget = new THREE.Vector3();

  function tick() {
    requestAnimationFrame(tick);
    if (!running) return;

    var t = clock.getElapsedTime();

    camera.position.set(
      Math.sin(W0 * t) * 2.6,
      3.1 + Math.sin(2 * W0 * t) * 0.55,
      8.4 + Math.cos(W0 * t) * 2.8
    );
    lookTarget.set(Math.sin(3 * W0 * t) * 1.6, 2.3 + Math.sin(2 * W0 * t + 1.1) * 0.4, -9);
    camera.lookAt(lookTarget);

    for (var i = 0; i < instances.length; i++) {
      var inst = instances[i];
      var growth = 0.5 + 0.5 * Math.sin(inst.harmonic * W0 * t + inst.phase);
      var height = inst.base + inst.amp * growth;

      dummy.position.set(inst.x, height / 2, inst.z);
      dummy.scale.set(1, height, 1);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);

      dummy.position.set(inst.x, height + inst.wickH / 2, inst.z);
      dummy.scale.set(1, inst.wickH, 1);
      dummy.updateMatrix();
      wicks.setMatrixAt(i, dummy.matrix);

      dummy.position.set(inst.x, height + inst.wickH + 0.05, inst.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      tips.setMatrixAt(i, dummy.matrix);
    }

    bodies.instanceMatrix.needsUpdate = true;
    wicks.instanceMatrix.needsUpdate = true;
    tips.instanceMatrix.needsUpdate = true;

    composer.render();
  }

  tick();
})();
