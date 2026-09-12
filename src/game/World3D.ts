import * as THREE from 'three';

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
import { box, cyl, makeCharacter, makePatty, makeBurgerMesh, makeSmokeParticle } from './meshes';
import { t, tf, getLang } from '../i18n';

export type StationKind = 'grill' | 'prep' | 'counter' | 'table' | 'trash';

export interface TableData {
  x: number;
  z: number;
  unlocked: boolean;
  dirty: boolean;
  customer: any;
  mesh: THREE.Group;
  cloth: THREE.Mesh;
  lockIcon: THREE.Sprite;
  dirtyFX: THREE.Mesh;
  dirtyLabel: THREE.Sprite;
  cleanPunchT: number;
}

export interface GrillSlotVis {
  patty: THREE.Mesh;
  ring: THREE.Mesh;
  progress: THREE.Mesh;
  bang: THREE.Sprite;
  baseScale: number;
  punchT: number;
}

export class World3D {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  camPos = new THREE.Vector3(0.5, 16.2, 13);
  camLook = new THREE.Vector3(0, 0.4, 0.5);
  renderer: THREE.WebGLRenderer;
  root: THREE.Group;

  grillGroup!: THREE.Group;
  prepGroup!: THREE.Group;
  counterGroup!: THREE.Group;
  trashGroup!: THREE.Group;
  tables: TableData[] = [];
  queueSpots: { x: number; z: number }[] = [];

  grillSlots: GrillSlotVis[] = [];
  prepLabel!: THREE.Sprite;
  counterStack: THREE.Group;
  counterPunchT = 0;
  focusRing!: THREE.Mesh;
  tutorialArrow!: THREE.Group;
  softHintArrow!: THREE.Group;
  interactPads: {
    kind: string;
    ring: THREE.Mesh;
    disc: THREE.Mesh;
    ringMat: THREE.MeshBasicMaterial;
    discMat: THREE.MeshBasicMaterial;
    baseOuter: number;
  }[] = [];
  smoke: { mesh: THREE.Mesh; life: number; vy: number }[] = [];
  titleSprite!: THREE.Sprite;
  approachSprite!: THREE.Sprite;

  playerMesh!: THREE.Group;
  playerStack!: THREE.Group;
  workerMeshes = new Map<any, THREE.Group>();
  customerMeshes = new Map<any, THREE.Group>();

  private clock = 0;
  private _resizeObs?: ResizeObserver;
  buildPadRoot!: THREE.Group;
  buildPadMeshes = new Map<string, THREE.Group>();
  zoneBarriers: Record<string, THREE.Group> = {};
  streetFloor!: THREE.Mesh;
  hrFloor!: THREE.Mesh;
  playerUpFloor!: THREE.Mesh;
  streetSpawn = { x: 3, z: -8.5 };
  floorCoins: { mesh: THREE.Mesh; x: number; z: number; value: number }[] = [];


  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1008);
    this.scene.fog = new THREE.Fog(0x1a1008, 28, 52);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    // Isometric-ish: above-front
    this.camera.position.set(0, 16, 14);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.counterStack = new THREE.Group();

    this.setupLights();
    this.buildRoom();
    this.buildStations();
    this.buildInteractPads();
    this.buildFocusAndTutorial();

    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
  }

  handleResize() {
    const parent = this.renderer.domElement.parentElement || document.body;
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    // Keep framing similar on ultrawide / mobile
    const dist = 18 + Math.max(0, (w / h - 1.4) * 2);
    this.camera.position.set(0.5, 16.2, dist * 0.82);
    this.camera.lookAt(0, 0, 0.5);
  }

  setupLights() {
    // v3.3: warmer key ~+20% vs cozy pass; still warm #fff2e0/#ffe4c4 — no acid
    const hemi = new THREE.HemisphereLight(0xfff5e8, 0x4a3420, 0.82);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffe8cc, 1.12);
    sun.position.set(8, 20, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 55;
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.bias = -0.001;
    this.scene.add(sun);

    const warm = new THREE.PointLight(0xffb070, 1.12, 14, 1.45);
    warm.position.set(-6.5, 3.4, -2.0);
    this.scene.add(warm);

    const fill = new THREE.PointLight(0xffe0c0, 0.42, 16, 1.5);
    fill.position.set(2, 3.5, 2);
    this.scene.add(fill);

    const cool = new THREE.PointLight(0xb0bcc8, 0.34, 15, 1.5);
    cool.position.set(6, 3.2, 0);
    this.scene.add(cool);
  }

  buildRoom() {
    // ~24×16 connected floors: kitchen west, dining center, street north, wings
    // Floors share y≈-0.06 — shrink so XZ regions do not overlap (kills floor z-fight)
    const kitchen = box(11, 0.12, 12, 0xb8906a, -0.06);
    kitchen.position.set(-6.5, 0, 0);
    kitchen.receiveShadow = true;
    this.root.add(kitchen);

    const dining = box(12, 0.12, 12, 0xd4c4ae, -0.06);
    dining.position.set(5, 0, 0);
    dining.receiveShadow = true;
    this.root.add(dining);

    // North strip abuts kitchen/dining at z=-6 (no XZ overlap with main floors)
    const northD = 4.35;
    const northZ = -8.175; // south edge = -6.0
    // Street / yard (north-east) — cooler gray, not acid
    this.streetFloor = box(12, 0.12, northD, 0x7a8078, -0.06);
    this.streetFloor.position.set(4.5, 0, northZ);
    this.streetFloor.receiveShadow = true;
    this.root.add(this.streetFloor);

    // HR / Player wing floors (muted neutrals) — exclusive XZ tiles north of kitchen
    this.hrFloor = box(5, 0.12, northD, 0xc2ad92, -0.06);
    this.hrFloor.position.set(-8.5, 0, northZ);
    this.hrFloor.receiveShadow = true;
    this.root.add(this.hrFloor);
    this.playerUpFloor = box(4.5, 0.12, northD, 0xbaa282, -0.06);
    this.playerUpFloor.position.set(-3.75, 0, northZ);
    this.playerUpFloor.receiveShadow = true;
    this.root.add(this.playerUpFloor);

    // kitPad overlay removed — coplanar tint caused flicker over kitchen floor

    // Zone rims: brass #c9a227, opacity ≤0.35; depthWrite off + polygonOffset vs floor
    const mkZoneRim = (w: number, d: number, x: number, z: number, op = 0.28) => {
      const zmesh = box(w, 0.03, d, 0xc9a227, 0.02);
      zmesh.position.set(x, 0, z);
      const zm = zmesh.material as THREE.MeshStandardMaterial;
      zm.transparent = true;
      zm.opacity = op;
      zm.depthWrite = false;
      zm.polygonOffset = true;
      zm.polygonOffsetFactor = -1;
      zm.polygonOffsetUnits = -1;
      zm.emissive.setHex(0x000000);
      zm.emissiveIntensity = 0;
      this.root.add(zmesh);
      return zmesh;
    };
    mkZoneRim(3.4, 2.6, -8.0, -2.8, 0.28);
    mkZoneRim(3.4, 2.2, -8.0, 2.0, 0.24);
    mkZoneRim(2.2, 5.2, -2.2, 0.0, 0.24);
    mkZoneRim(11, 10, 5.5, 1.0, 0.18);

    // Outer walls: wood #5c4033 + plaster #efe6d6 panels (plaster ≥0.08 clear of wood face)
    const wallMat = 0x5c4033;
    const plaster = 0xf7f1e8;
    const woodT = 0.35;
    const plasT = 0.12;
    const plasClear = 0.08; // min gap from wood surface → plaster surface
    const plasOff = woodT / 2 + plasT / 2 + plasClear; // 0.315
    const backL = box(8, 2.4, woodT, wallMat, 0);
    backL.position.set(-8, 0, -10.1);
    this.root.add(backL);
    const backLP = box(6.5, 1.6, plasT, plaster, 0.4);
    backLP.position.set(-8, 0, -10.1 + plasOff);
    this.root.add(backLP);
    const backR = box(8, 2.4, woodT, wallMat, 0);
    backR.position.set(8, 0, -10.1);
    this.root.add(backR);
    const backRP = box(6.5, 1.6, plasT, plaster, 0.4);
    backRP.position.set(8, 0, -10.1 + plasOff);
    this.root.add(backRP);
    const left = box(woodT, 2.4, 16.5, wallMat, 0);
    left.position.set(-12.1, 0, -2);
    this.root.add(left);
    const leftP = box(plasT, 1.6, 14, plaster, 0.4);
    leftP.position.set(-12.1 + plasOff, 0, -2);
    this.root.add(leftP);
    const right = box(woodT, 2.4, 16.5, wallMat, 0);
    right.position.set(12.1, 0, -2);
    this.root.add(right);
    const rightP = box(plasT, 1.6, 14, plaster, 0.4);
    rightP.position.set(12.1 - plasOff, 0, -2);
    this.root.add(rightP);
    const front = box(24.5, 2.4, woodT, wallMat, 0);
    front.position.set(0, 0, 6.15);
    this.root.add(front);
    const frontP = box(20, 1.6, plasT, plaster, 0.4);
    frontP.position.set(0, 0, 6.15 - plasOff);
    this.root.add(frontP);

    // Sunny windows (warm glass, not acid fills) — more daylight into room
    const addWindow = (wx: number, wy: number, wz: number, ww: number, wh: number, wd: number) => {
      const glass = box(ww, wh, wd, 0xc8e0f0, wy);
      const gm = glass.material as THREE.MeshStandardMaterial;
      gm.transparent = true;
      gm.opacity = 0.42;
      gm.metalness = 0.15;
      gm.roughness = 0.2;
      gm.emissive.setHex(0xfff0d8);
      gm.emissiveIntensity = 0.22;
      gm.depthWrite = false;
      glass.position.set(wx, 0, wz);
      glass.castShadow = false;
      this.root.add(glass);
      const frame = box(ww + 0.12, wh + 0.12, Math.max(wd, 0.08) + 0.04, 0x5c4033, wy - 0.02);
      frame.position.set(wx, 0, wz);
      this.root.add(frame);
    };
    // Left wall windows
    addWindow(-12.1 + plasOff + 0.02, 0.55, -5.5, 0.08, 1.15, 2.2);
    addWindow(-12.1 + plasOff + 0.02, 0.55, -1.5, 0.08, 1.15, 2.2);
    addWindow(-12.1 + plasOff + 0.02, 0.55, 2.5, 0.08, 1.15, 2.0);
    // Right wall windows
    addWindow(12.1 - plasOff - 0.02, 0.55, -5.0, 0.08, 1.15, 2.4);
    addWindow(12.1 - plasOff - 0.02, 0.55, 0.5, 0.08, 1.15, 2.4);
    addWindow(12.1 - plasOff - 0.02, 0.55, 3.5, 0.08, 1.15, 1.8);
    // Back (north) windows — street light
    addWindow(-5.5, 0.55, -10.1 + plasOff + 0.02, 2.4, 1.15, 0.08);
    addWindow(5.5, 0.55, -10.1 + plasOff + 0.02, 2.4, 1.15, 0.08);
    addWindow(0, 0.55, -10.1 + plasOff + 0.02, 2.0, 1.15, 0.08);
    // Front (south) high windows
    addWindow(-6, 0.7, 6.15 - plasOff - 0.02, 2.2, 0.9, 0.08);
    addWindow(6, 0.7, 6.15 - plasOff - 0.02, 2.2, 0.9, 0.08);

    // Arch carpet kitchen↔dining (muted brick)
    const carpet = box(1.4, 0.04, 5.0, 0xb54a3a, 0.05);
    carpet.position.set(-0.6, 0, 0.0);
    this.root.add(carpet);
    // Path to street (caramel)
    const path = box(3.8, 0.04, 1.2, 0xd4a574, 0.05);
    path.position.set(3.0, 0, -4.2);
    this.root.add(path);

    // Zone barriers: solid wood + thin center arch (same positions; unlock still hides group)
    this.zoneBarriers = {};
    const mkBar = (id: string, x: number, z: number, w: number, d: number) => {
      const g = new THREE.Group();
      const wood = 0x5c4033;
      const wallH = 2.2;
      const gap = Math.min(1.35, Math.max(0.9, (w >= d ? w : d) * 0.32));
      const lintelH = 0.38;
      if (w >= d) {
        const sideW = Math.max(0.28, (w - gap) / 2);
        const leftW = box(sideW, wallH, d, wood, 0);
        leftW.position.x = -(gap / 2 + sideW / 2);
        const rightW = box(sideW, wallH, d, wood, 0);
        rightW.position.x = gap / 2 + sideW / 2;
        const lintel = box(gap + 0.12, lintelH, Math.max(0.28, d * 0.95), wood, wallH - lintelH);
        g.add(leftW, rightW, lintel);
      } else {
        const sideD = Math.max(0.28, (d - gap) / 2);
        const a = box(w, wallH, sideD, wood, 0);
        a.position.z = -(gap / 2 + sideD / 2);
        const b = box(w, wallH, sideD, wood, 0);
        b.position.z = gap / 2 + sideD / 2;
        const lintel = box(Math.max(0.28, w * 0.95), lintelH, gap + 0.12, wood, wallH - lintelH);
        g.add(a, b, lintel);
      }
      const lock = this.makeTextSprite('🔒', { fontSize: 48, color: '#fff' });
      lock.position.set(0, 1.35, 0);
      lock.scale.set(1.2, 1.2, 1);
      g.add(lock);
      g.position.set(x, 0, z);
      this.root.add(g);
      this.zoneBarriers[id] = g;
    };
    mkBar('hr', -8.5, -5.2, 4.5, 0.35);
    mkBar('playerUp', -4.0, -5.2, 4.5, 0.35);
    mkBar('street', 3.0, -4.5, 6, 0.35);
    mkBar('storage', -10.5, -1.5, 0.35, 3);
    mkBar('restroom', 0.5, -5.2, 3, 0.35);
    mkBar('driveThru', 9.5, -4.0, 0.35, 4);
    mkBar('wingB', 10.8, 1.5, 0.35, 5);

    this.addPlant(10.8, -3.2);
    this.addPlant(-0.2, 5.2);

    this.titleSprite = this.makeTextSprite(getLang() === 'en' ? '🍔 Burger Rush' : '🍔 Бургерная', {
      fontSize: 48,
      color: '#e8d5a3',
    });
    this.titleSprite.position.set(0, 3.2, 5.4);
    this.titleSprite.scale.set(6, 1.5, 1);
    this.root.add(this.titleSprite);

    this.buildPadRoot = new THREE.Group();
    this.root.add(this.buildPadRoot);
  }


  addPlant(x: number, z: number) {
    const pot = cyl(0.22, 0.28, 0x5d3a1a, 0, 8);
    pot.position.set(x, 0, z);
    const leaf1 = cyl(0.16, 0.5, 0x5a8f6b, 0.28, 6);
    leaf1.position.set(x, 0, z);
    const leaf2 = cyl(0.12, 0.4, 0x3d6b4f, 0.35, 6);
    leaf2.position.set(x + 0.12, 0, z + 0.05);
    this.root.add(pot, leaf1, leaf2);
  }

  buildStations() {
    // Grill
    this.grillGroup = new THREE.Group();
    this.grillGroup.position.set(-8.0, 0, -2.8);
    const grillBody = box(2.4, 0.7, 1.6, 0x3a3a3e, 0);
    (grillBody.material as THREE.MeshStandardMaterial).metalness = 0.72;
    (grillBody.material as THREE.MeshStandardMaterial).roughness = 0.35;
    const grillTop = box(2.2, 0.08, 1.4, 0x3a3a3e, 0.7);
    (grillTop.material as THREE.MeshStandardMaterial).metalness = 0.85;
    (grillTop.material as THREE.MeshStandardMaterial).roughness = 0.28;
    this.grillGroup.add(grillBody, grillTop);
    for (let i = 0; i < 3; i++) {
      const sx = -0.7 + i * 0.7;
      const pan = cyl(0.28, 0.05, 0x1a1a1c, 0.78, 12);
      (pan.material as THREE.MeshStandardMaterial).metalness = 0.8;
      (pan.material as THREE.MeshStandardMaterial).roughness = 0.3;
      pan.position.x = sx;
      const patty = makePatty(false);
      patty.position.set(sx, 0.88, 0);
      patty.visible = false;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.32, 0.38, 24),
        new THREE.MeshBasicMaterial({ color: 0x5a8f6b, transparent: true, opacity: 0.42, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(sx, 0.92, 0);
      ring.visible = false;
      const progGeo = new THREE.RingGeometry(0.32, 0.38, 24, 1, 0, 0.01);
      const progress = new THREE.Mesh(
        progGeo,
        new THREE.MeshBasicMaterial({ color: 0xc9a227, side: THREE.DoubleSide }),
      );
      progress.rotation.x = -Math.PI / 2;
      progress.position.set(sx, 0.93, 0);
      progress.visible = false;
      const bang = this.makeTextSprite('!', { fontSize: 72, color: '#d4a574' });
      bang.position.set(sx, 1.35, 0);
      bang.scale.set(0.55, 0.55, 1);
      bang.visible = false;
      this.grillGroup.add(pan, patty, ring, progress, bang);
      this.grillSlots.push({ patty, ring, progress, bang, baseScale: 1, punchT: 0 });
    }
    const grillLabel = this.makeTextSprite('🔥 ' + t('zoneGrill'), { fontSize: 36, color: '#e8d5a3' });
    grillLabel.position.set(0, 1.6, 0);
    grillLabel.scale.set(2.2, 0.55, 1);
    this.grillGroup.add(grillLabel);
    this.root.add(this.grillGroup);

    // Prep
    this.prepGroup = new THREE.Group();
    this.prepGroup.position.set(-8.0, 0, 2.0);
    const prepBody = box(2.4, 0.65, 1.4, 0x6e4e32, 0);
    const board = box(2.0, 0.06, 1.1, 0x9aa3a8, 0.65);
    (board.material as THREE.MeshStandardMaterial).metalness = 0.55;
    (board.material as THREE.MeshStandardMaterial).roughness = 0.35;
    this.prepGroup.add(prepBody, board);
    this.prepLabel = this.makeTextSprite('🍖0  🍔0', { fontSize: 40, color: '#3a2208' });
    this.prepLabel.position.set(0, 1.35, 0);
    this.prepLabel.scale.set(2.0, 0.5, 1);
    this.prepGroup.add(this.prepLabel);
    const prepZoneLbl = this.makeTextSprite('🍔 ' + t('zonePrep'), { fontSize: 32, color: '#d4b896' });
    prepZoneLbl.position.set(0, 1.7, 0);
    prepZoneLbl.scale.set(2.2, 0.5, 1);
    this.prepGroup.add(prepZoneLbl);
    this.root.add(this.prepGroup);

    // Counter
    this.counterGroup = new THREE.Group();
    this.counterGroup.position.set(-2.2, 0, 0.0);
    const counterBody = box(1.2, 1.0, 4.4, 0x5c4033, 0);
    const counterTop = box(1.3, 0.1, 4.5, 0x9aa3a8, 1.0);
    (counterTop.material as THREE.MeshStandardMaterial).metalness = 0.5;
    (counterTop.material as THREE.MeshStandardMaterial).roughness = 0.4;
    this.counterGroup.add(counterBody, counterTop);
    this.counterStack.position.set(0, 1.15, 1.5);
    this.counterGroup.add(this.counterStack);
    const cLbl = this.makeTextSprite('✅ ' + t('zoneCounter'), { fontSize: 32, color: '#f3ebe0' });
    cLbl.position.set(0, 1.55, -1.6);
    cLbl.scale.set(2.0, 0.45, 1);
    this.counterGroup.add(cLbl);
    this.root.add(this.counterGroup);

    // Trash
    this.trashGroup = new THREE.Group();
    this.trashGroup.position.set(-11.0, 0, 4.5);
    const trash = box(1.0, 1.0, 1.0, 0x3a3a3e, 0);
    (trash.material as THREE.MeshStandardMaterial).metalness = 0.45;
    (trash.material as THREE.MeshStandardMaterial).roughness = 0.5;
    const stripe = box(1.02, 0.15, 1.02, 0xa89070, 0.85);
    this.trashGroup.add(trash, stripe);
    const tLbl = this.makeTextSprite('🗑️ ' + t('zoneTrash'), { fontSize: 28, color: '#d4b896' });
    tLbl.position.set(0, 1.4, 0);
    tLbl.scale.set(1.8, 0.45, 1);
    this.trashGroup.add(tLbl);
    this.root.add(this.trashGroup);

    // Tables — v3.3 spacious center-to-center ≥3.2–3.6
    const positions = [
      [2.5, 0.6], [5.9, 0.6], [9.3, 0.6],
      [3.2, 4.3], [6.8, 4.3],
    ];
    const addChair = (parent: THREE.Group, cx: number, cz: number, rotY: number) => {
      const ch = new THREE.Group();
      ch.position.set(cx, 0, cz);
      ch.rotation.y = rotY;
      const seat = box(0.42, 0.06, 0.42, 0x6e4e32, 0.38);
      const back = box(0.42, 0.42, 0.06, 0x5c4033, 0.44);
      back.position.z = -0.18;
      const legA = box(0.06, 0.38, 0.06, 0x4a3420, 0);
      legA.position.set(-0.14, 0, -0.14);
      const legB = legA.clone(); legB.position.set(0.14, 0, -0.14);
      const legC = legA.clone(); legC.position.set(-0.14, 0, 0.14);
      const legD = legA.clone(); legD.position.set(0.14, 0, 0.14);
      ch.add(seat, back, legA, legB, legC, legD);
      parent.add(ch);
    };
    positions.forEach(([x, z], i) => {
      const mesh = new THREE.Group();
      mesh.position.set(x, 0, z);
      const top = box(1.35, 0.12, 1.35, 0x7a5c3e, 0.55);
      const leg1 = box(0.12, 0.55, 0.12, 0x6b4a2a, 0);
      leg1.position.set(-0.5, 0, -0.5);
      const leg2 = leg1.clone(); leg2.position.set(0.5, 0, -0.5);
      const leg3 = leg1.clone(); leg3.position.set(-0.5, 0, 0.5);
      const leg4 = leg1.clone(); leg4.position.set(0.5, 0, 0.5);
      const cloth = box(1.1, 0.04, 1.1, 0xd9cfc0, 0.67);
      const dirtyFX = box(1.15, 0.08, 1.15, 0x4a2208, 0.68);
      (dirtyFX.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x000000);
      (dirtyFX.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
      dirtyFX.visible = false;
      const dirtyLabel = this.makeTextSprite('🤢 ' + t('dirtyLabel'), { fontSize: 36, color: '#ffcc88' });
      dirtyLabel.position.set(0, 1.35, 0);
      dirtyLabel.scale.set(1.6, 0.45, 1);
      dirtyLabel.visible = false;
      const lockIcon = this.makeTextSprite('🔒', { fontSize: 64, color: '#ffffff' });
      lockIcon.position.set(0, 1.2, 0);
      lockIcon.scale.set(0.8, 0.8, 1);
      lockIcon.visible = i !== 0;
      mesh.add(top, leg1, leg2, leg3, leg4, cloth, dirtyFX, dirtyLabel, lockIcon);
      // Two chairs with walkway clearance (not crowding aisles)
      addChair(mesh, 0, 0.95, 0);
      addChair(mesh, 0, -0.95, Math.PI);
      this.root.add(mesh);
      this.tables.push({
        x, z,
        unlocked: i === 0,
        dirty: false,
        customer: null,
        mesh,
        cloth,
        lockIcon,
        dirtyFX,
        dirtyLabel,
        cleanPunchT: 0,
      });
    });

    const hallLbl = this.makeTextSprite('🪑 ' + t('zoneTables'), { fontSize: 32, color: '#d4b896' });
    hallLbl.position.set(5.5, 0.4, -4.6);
    hallLbl.scale.set(2.4, 0.55, 1);
    this.root.add(hallLbl);

    // Queue east of counter (clear kitchen→counter aisle)
    this.queueSpots = [
      { x: -0.3, z: -1.4 },
      { x: -0.3, z: -0.2 },
      { x: -0.3, z: 1.0 },
      { x: -0.3, z: 2.2 },
    ];
    this.streetSpawn = { x: 3.0, z: -8.5 };
  }

  buildFocusAndTutorial() {
    this.focusRing = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.35, 32),
      new THREE.MeshBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    this.focusRing.rotation.x = -Math.PI / 2;
    this.focusRing.position.y = 0.06;
    this.focusRing.visible = false;
    this.root.add(this.focusRing);

    this.tutorialArrow = new THREE.Group();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 0.7, 4),
      new THREE.MeshBasicMaterial({ color: 0xc9a227 }),
    );
    cone.rotation.x = Math.PI;
    this.tutorialArrow.add(cone);
    this.tutorialArrow.visible = false;
    this.root.add(this.tutorialArrow);

    this.softHintArrow = new THREE.Group();
    const softCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.55, 4),
      new THREE.MeshBasicMaterial({ color: 0xa8d8ff, transparent: true, opacity: 0.55 }),
    );
    softCone.rotation.x = Math.PI;
    this.softHintArrow.add(softCone);
    this.softHintArrow.visible = false;
    this.root.add(this.softHintArrow);

    this.approachSprite = this.makeTextSprite(t('approachCloser'), { fontSize: 34, color: '#ffe9b0' });
    this.approachSprite.position.set(0, 1.1, 0);
    this.approachSprite.scale.set(2.2, 0.5, 1);
    this.approachSprite.visible = false;
    this.root.add(this.approachSprite);
  }


  buildInteractPads() {
    // Floor top is ~y=0.06 — pads MUST sit above it or they are invisible (z-fight / inside mesh)
    type Pad = { x: number; z: number; color: number; r?: number; kind: string };
    const pads: Pad[] = [
      { x: -8.0, z: -1.5, color: 0xb54a3a, kind: 'grill' },
      { x: -8.0, z: 3.1, color: 0xc9a227, kind: 'prep' },
      { x: -0.5, z: 0.0, color: 0x5a8f6b, kind: 'counter' },
      { x: -11.0, z: 3.5, color: 0xa89070, r: 0.9, kind: 'trash' },
    ];
    this.tables.forEach((tb, i) => {
      pads.push({ x: tb.x, z: tb.z - 1.05, color: 0xa89070, r: 1.15, kind: `table-${i}` });
    });
    const y = 0.13;
    this.interactPads = [];
    for (const p of pads) {
      const outer = p.r ?? 1.05;
      const inner = outer * 0.62;
      const matRing = new THREE.MeshBasicMaterial({
        color: p.color,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 40), matRing);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, y, p.z);
      ring.renderOrder = 20;
      this.root.add(ring);

      const matDisc = new THREE.MeshBasicMaterial({
        color: p.color,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(inner * 0.92, 32), matDisc);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(p.x, y - 0.005, p.z);
      disc.renderOrder = 19;
      this.root.add(disc);
      this.interactPads.push({
        kind: p.kind,
        ring,
        disc,
        ringMat: matRing,
        discMat: matDisc,
        baseOuter: outer,
      });
    }
  }

  /** Active pad soft pulse; others quieter (no neon) */
  updateInteractPads(activeKind: string | null, time: number) {
    const pulse = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(time * Math.PI * 2 * 1.0));
    for (const p of this.interactPads) {
      const active = !!activeKind && p.kind === activeKind;
      p.ringMat.opacity = active ? 0.38 + 0.12 * pulse : 0.22;
      p.discMat.opacity = active ? 0.2 + 0.1 * pulse : 0.1;
      const s = active ? 1 + 0.04 * pulse : 0.94;
      p.ring.scale.set(s, s, s);
      p.disc.scale.set(s, s, s);
    }
  }

  setApproachHint(x: number | null, z: number | null, opacity: number) {
    if (x == null || z == null || opacity <= 0.02) {
      this.approachSprite.visible = false;
      return;
    }
    this.updateSpriteText(this.approachSprite, t('approachCloser'));
    this.approachSprite.visible = true;
    this.approachSprite.position.set(x, 1.15, z);
    (this.approachSprite.material as THREE.SpriteMaterial).opacity = Math.min(1, opacity);
  }

  setSoftHintTarget(x: number | null, z: number | null, time: number) {
    if (x == null || z == null) {
      this.softHintArrow.visible = false;
      return;
    }
    this.softHintArrow.visible = true;
    const bob = Math.sin(time * 3.6) * 0.18;
    this.softHintArrow.position.set(x, 2.0 + bob, z);
  }

  setStationHighlight(kind: string | null) {
    const boost = (group: THREE.Group, on: boolean, color: number) => {
      group.traverse((obj) => {
        const m = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (!m || !('emissive' in m)) return;
        if (on) {
          m.emissive.setHex(color);
          m.emissiveIntensity = 0.18;
        } else if (m.userData._baseEmissive == null) {
          m.emissive.setHex(0x000000);
          m.emissiveIntensity = 0;
        }
      });
    };
    boost(this.grillGroup, kind === 'grill', 0xb54a3a);
    boost(this.prepGroup, kind === 'prep', 0xc9a227);
    boost(this.counterGroup, kind === 'counter', 0x5a8f6b);
  }

  punchGrillReady(slotIndex: number) {
    const v = this.grillSlots[slotIndex];
    if (v) v.punchT = 0.35;
  }

  punchTableClean(tb: TableData) {
    tb.cleanPunchT = 0.28;
  }

  mapBounds = { minX: -11.5, maxX: 11.5, minZ: -9.5, maxZ: 5.5 };

  followCamera(px: number, pz: number, dt: number) {
    const bx = Math.max(this.mapBounds.minX + 2, Math.min(this.mapBounds.maxX - 2, px));
    const bz = Math.max(this.mapBounds.minZ + 2, Math.min(this.mapBounds.maxZ - 2, pz));
    const desiredPos = new THREE.Vector3(bx * 0.32 + 0.4, 16.9, bz * 0.22 + 14.3);
    const desiredLook = new THREE.Vector3(bx * 0.5, 0.5, bz * 0.5 + 0.2);
    const k = clamp01(1 - Math.exp(-5.5 * dt));
    this.camPos.lerp(desiredPos, k);
    this.camLook.lerp(desiredLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  createPlayer() {
    this.playerMesh = makeCharacter({ shirt: 0xf4f6f7, hat: 'chef', scale: 1.05 });
    this.playerStack = new THREE.Group();
    this.playerStack.position.y = 1.55;
    this.playerMesh.add(this.playerStack);
    this.root.add(this.playerMesh);
    return this.playerMesh;
  }

  setPlayerPose(x: number, z: number, facing: number, walk: number, moving: boolean) {
    if (!this.playerMesh) return;
    const mesh = this.playerMesh;
    if (mesh.userData.vizX == null) {
      mesh.userData.vizX = x;
      mesh.userData.vizZ = z;
      mesh.userData.vizYaw = facing >= 0 ? 0.4 : Math.PI - 0.4;
    }
    mesh.userData.vizX = THREE.MathUtils.lerp(mesh.userData.vizX, x, 0.28);
    mesh.userData.vizZ = THREE.MathUtils.lerp(mesh.userData.vizZ, z, 0.28);
    const yaw = facing >= 0 ? 0.4 : Math.PI - 0.4;
    let cur = mesh.userData.vizYaw as number;
    let diff = yaw - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    mesh.userData.vizYaw = cur + diff * 0.22;
    mesh.position.set(mesh.userData.vizX, 0, mesh.userData.vizZ);
    mesh.rotation.y = mesh.userData.vizYaw;
    const bob = moving ? Math.sin(walk) * 0.04 : 0;
    const parts = this.playerMesh.userData.bobParts;
    if (parts) {
      parts.body.position.y = 0.35 + 0.25 + bob;
      parts.head.position.y = 0.85 + 0.14 + bob;
      if (moving) {
        parts.legL.rotation.x = Math.sin(walk) * 0.45;
        parts.legR.rotation.x = -Math.sin(walk) * 0.45;
      } else {
        parts.legL.rotation.x *= 0.8;
        parts.legR.rotation.x *= 0.8;
      }
    }
  }

  updatePlayerStack(patties: number, burgers: ('classic' | 'cheese' | 'double')[] | number) {
    while (this.playerStack.children.length) {
      this.playerStack.remove(this.playerStack.children[0]);
    }
    let y = 0;
    for (let i = 0; i < patties; i++) {
      const p = makePatty(true);
      p.position.y = y;
      p.scale.setScalar(0.85);
      this.playerStack.add(p);
      y += 0.12;
    }
    const list = Array.isArray(burgers)
      ? burgers
      : Array.from({ length: burgers }, () => 'classic' as const);
    for (const kind of list) {
      const b = makeBurgerMesh(kind);
      b.position.y = y;
      b.scale.setScalar(0.75);
      this.playerStack.add(b);
      y += kind === 'double' ? 0.28 : 0.22;
    }
  }

  syncGrill(slots: { state: string; progress: number }[], cookNeed: number, time: number, dt = 0.016) {
    const cooking = slots.some((s) => s.state === 'cooking');
    this.grillGroup.traverse((obj) => {
      const m = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m || !('emissive' in m)) return;
      if (cooking) {
        m.emissive.setHex(0x4a2010);
        m.emissiveIntensity = 0.12;
      } else if (!m.userData._keepEmissive) {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    });
    slots.forEach((s, i) => {
      const v = this.grillSlots[i];
      if (!v) return;
      if (v.punchT > 0) v.punchT = Math.max(0, v.punchT - dt);
      const punchScale = v.punchT > 0 ? 1 + Math.sin((1 - v.punchT / 0.35) * Math.PI) * 0.35 : 1;
      if (s.state === 'empty') {
        v.patty.visible = false;
        v.ring.visible = false;
        v.progress.visible = false;
        v.bang.visible = false;
        v.patty.scale.setScalar(1);
      } else {
        v.patty.visible = true;
        v.patty.scale.setScalar(punchScale);
        (v.patty.material as THREE.MeshStandardMaterial).color.setHex(
          s.state === 'ready' ? 0x6b3a12 : 0xc0392b,
        );
        if (s.state === 'cooking') {
          v.progress.visible = true;
          v.ring.visible = false;
          v.bang.visible = false;
          const frac = Math.min(1, s.progress / cookNeed);
          v.progress.geometry.dispose();
          v.progress.geometry = new THREE.RingGeometry(0.32, 0.38, 24, 1, -Math.PI / 2, Math.PI * 2 * frac);
          if (Math.random() < 0.08) this.spawnSmoke(
            this.grillGroup.position.x + v.patty.position.x,
            1.1,
            this.grillGroup.position.z,
          );
        } else if (s.state === 'ready') {
          v.progress.visible = false;
          v.ring.visible = true;
          v.bang.visible = true;
          const pulse = 0.55 + Math.sin(time * 8) * 0.35;
          (v.ring.material as THREE.MeshBasicMaterial).opacity = pulse;
          const bob = 1.35 + Math.sin(time * 10) * 0.08;
          v.bang.position.y = bob;
          (v.bang.material as THREE.SpriteMaterial).opacity = 0.75 + pulse * 0.25;
        }
      }
    });
  }

  syncPrep(patties: number, burgers: ('classic' | 'cheese' | 'double')[] | number) {
    const n = Array.isArray(burgers) ? burgers.length : burgers;
    const icons = Array.isArray(burgers)
      ? burgers.slice(0, 4).map((k) => (k === 'cheese' ? '🧀' : k === 'double' ? '🍔×2' : '🍔')).join('')
      : '🍔'.repeat(Math.min(n, 4));
    this.updateSpriteText(this.prepLabel, `🍖${patties}  ${icons || '—'}`);
  }

  punchCounter() {
    this.counterPunchT = 0.28;
  }

  syncCounter(burgers: ('classic' | 'cheese' | 'double')[] | number, dt = 0.016) {
    while (this.counterStack.children.length) {
      this.counterStack.remove(this.counterStack.children[0]);
    }
    const list = Array.isArray(burgers)
      ? burgers.slice(0, 8)
      : Array.from({ length: Math.min(burgers, 8) }, () => 'classic' as const);
    for (let i = 0; i < list.length; i++) {
      const b = makeBurgerMesh(list[i]);
      b.position.y = i * 0.2;
      b.scale.setScalar(0.7);
      this.counterStack.add(b);
    }
    if (this.counterPunchT > 0) {
      this.counterPunchT = Math.max(0, this.counterPunchT - dt);
      const k = Math.sin((1 - this.counterPunchT / 0.28) * Math.PI) * 0.1;
      this.counterStack.scale.setScalar(1 + k);
    } else {
      this.counterStack.scale.setScalar(1);
    }
  }

  syncTables(dt = 0.016) {
    for (const tb of this.tables) {
      tb.lockIcon.visible = !tb.unlocked;
      tb.cloth.visible = tb.unlocked && !tb.dirty;
      tb.dirtyFX.visible = tb.unlocked && tb.dirty;
      tb.dirtyLabel.visible = tb.unlocked && tb.dirty;
      if (tb.dirty && tb.dirtyLabel.visible) {
        tb.dirtyLabel.position.y = 1.35 + Math.sin(this.clock * 6) * 0.06;
      }
      const top = tb.mesh.children[0] as THREE.Mesh;
      if (top?.material) {
        const mat = top.material as THREE.MeshStandardMaterial;
        mat.color.setHex(tb.dirty ? 0x4a2208 : 0x7a5c3e);
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
      if (tb.cleanPunchT > 0) {
        tb.cleanPunchT = Math.max(0, tb.cleanPunchT - dt);
        const k = Math.sin((1 - tb.cleanPunchT / 0.28) * Math.PI) * 0.12;
        tb.mesh.scale.setScalar(1 + k);
      } else {
        tb.mesh.scale.setScalar(1);
      }
    }
  }

  setFocus(x: number, z: number, color: number | null) {
    if (color == null) {
      this.focusRing.visible = false;
      return;
    }
    this.focusRing.visible = true;
    this.focusRing.position.x = x;
    this.focusRing.position.z = z;
    const mat = this.focusRing.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = Math.min(mat.opacity, 0.35) || 0.35;
  }

  setTutorialTarget(x: number | null, z: number | null, time: number) {
    if (x == null || z == null) {
      this.tutorialArrow.visible = false;
      return;
    }
    this.tutorialArrow.visible = true;
    const bob = Math.sin(time * 5.2) * 0.25;
    this.tutorialArrow.position.set(x, 2.2 + bob, z);
  }

  spawnSmoke(x: number, y: number, z: number) {
    if (this.smoke.length > 40) return;
    const mesh = makeSmokeParticle();
    mesh.position.set(x + (Math.random() - 0.5) * 0.2, y, z + (Math.random() - 0.5) * 0.2);
    this.root.add(mesh);
    this.smoke.push({ mesh, life: 0.8 + Math.random() * 0.4, vy: 0.6 + Math.random() * 0.4 });
  }

  updateSmoke(dt: number) {
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i];
      s.life -= dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.x += (Math.random() - 0.5) * 0.3 * dt;
      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, s.life * 0.5);
      s.mesh.scale.setScalar(1 + (0.8 - s.life));
      if (s.life <= 0) {
        this.root.remove(s.mesh);
        s.mesh.geometry.dispose();
        mat.dispose();
        this.smoke.splice(i, 1);
      }
    }
  }

  ensureCustomerMesh(c: any) {
    let m = this.customerMeshes.get(c);
    if (!m) {
      m = makeCharacter({
        shirt: new THREE.Color(c.shirt).getHex(),
        skin: new THREE.Color(c.skin).getHex(),
        hair: new THREE.Color(c.hair).getHex(),
        hat: 'none',
        scale: 0.95,
      });
      this.customerMeshes.set(c, m);
      this.root.add(m);
    }
    return m;
  }

  syncCustomers(customers: any[], time: number) {
    const alive = new Set(customers);
    for (const [c, mesh] of this.customerMeshes) {
      if (!alive.has(c)) {
        this.root.remove(mesh);
        this.customerMeshes.delete(c);
      }
    }
    for (const c of customers) {
      const mesh = this.ensureCustomerMesh(c);
      mesh.position.set(c.x, c.state === 'eating' ? -0.15 : 0, c.z);
      mesh.rotation.y = (c.facing ?? 1) >= 0 ? 0.3 : Math.PI - 0.3;
      mesh.visible = true;
      const moving = c.state === 'toTable' || c.state === 'leave';
      const parts = mesh.userData.bobParts;
      if (parts && moving) {
        const w = time * 10 + c.x;
        parts.legL.rotation.x = Math.sin(w) * 0.4;
        parts.legR.rotation.x = -Math.sin(w) * 0.4;
      }
    }
  }

  ensureWorkerMesh(w: any) {
    let m = this.workerMeshes.get(w);
    if (!m) {
      m = makeCharacter({
        shirt: w.type === 'waiter' ? 0x4a7a6a : 0x5c3d6e,
        hat: w.type === 'cleaner' ? 'cap' : 'bow',
        scale: 0.95,
      });
      const stack = new THREE.Group();
      stack.name = 'stack';
      stack.position.y = 1.45;
      m.add(stack);
      this.workerMeshes.set(w, m);
      this.root.add(m);
    }
    return m;
  }

  syncWorkers(workers: any[]) {
    const alive = new Set(workers);
    for (const [w, mesh] of this.workerMeshes) {
      if (!alive.has(w)) {
        this.root.remove(mesh);
        this.workerMeshes.delete(w);
      }
    }
    for (const w of workers) {
      const mesh = this.ensureWorkerMesh(w);
      mesh.position.set(w.x, 0, w.z);
      mesh.rotation.y = (w.facing ?? 1) >= 0 ? 0.3 : Math.PI - 0.3;
      const stack = mesh.getObjectByName('stack') as THREE.Group;
      if (stack) {
        while (stack.children.length) stack.remove(stack.children[0]);
        for (let i = 0; i < (w.carrying || 0); i++) {
          const b = makeBurgerMesh();
          b.position.y = i * 0.2;
          b.scale.setScalar(0.65);
          stack.add(b);
        }
      }
    }
  }

  worldToScreen(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z);
    v.project(this.camera);
    const canvas = this.renderer.domElement;
    return {
      x: (v.x * 0.5 + 0.5) * canvas.clientWidth,
      y: (-v.y * 0.5 + 0.5) * canvas.clientHeight,
      visible: v.z < 1,
    };
  }

  makeTextSprite(text: string, opts: { fontSize?: number; color?: string } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = `bold ${opts.fontSize ?? 40}px Trebuchet MS, Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = opts.color ?? '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 6;
    ctx.strokeText(text, 256, 64);
    ctx.fillText(text, 256, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
    const spr = new THREE.Sprite(mat);
    (spr as any)._canvas = canvas;
    (spr as any)._ctx = ctx;
    (spr as any)._opts = opts;
    return spr;
  }

  updateSpriteText(spr: THREE.Sprite, text: string) {
    const canvas = (spr as any)._canvas as HTMLCanvasElement;
    const ctx = (spr as any)._ctx as CanvasRenderingContext2D;
    const opts = (spr as any)._opts || {};
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `bold ${opts.fontSize ?? 40}px Trebuchet MS, Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = opts.color ?? '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 6;
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    (spr.material as THREE.SpriteMaterial).map!.needsUpdate = true;
  }

  refreshLabels() {
    this.updateSpriteText(this.titleSprite, getLang() === 'en' ? '🍔 Burger Rush' : '🍔 Бургерная');
  }

  render(time: number) {
    this.clock = time;
    const pulse = 1 + Math.sin(time * Math.PI * 2 * 1.2) * 0.1;
    this.focusRing.scale.setScalar(pulse);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }

  setZoneOpen(id: string, open: boolean) {
    const b = this.zoneBarriers[id];
    if (b) b.visible = !open;
  }

  setStationBuilt(kind: 'grill' | 'prep' | 'counter' | 'trash', built: boolean) {
    const g = kind === 'grill' ? this.grillGroup
      : kind === 'prep' ? this.prepGroup
      : kind === 'counter' ? this.counterGroup
      : this.trashGroup;
    if (g) g.visible = built;
  }

  syncBuildPads(
    pads: { id: string; x: number; z: number; label: string; cost: number; paid: number; locked: boolean; lockLv?: number; visible: boolean; dim?: boolean }[],
  ) {
    const seen = new Set<string>();
    const pulse = 1 + 0.05 * Math.sin(this.clock * Math.PI * 2); // ≤1.05
    for (const p of pads) {
      seen.add(p.id);
      let g = this.buildPadMeshes.get(p.id);
      if (!g) {
        g = new THREE.Group();
        g.position.set(p.x, 0, p.z);
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(0.95, 32),
          new THREE.MeshBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.35, depthWrite: false }),
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = 0.14;
        disc.renderOrder = 18;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.95, 1.15, 32),
          new THREE.MeshBasicMaterial({ color: 0xa89070, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.15;
        ring.renderOrder = 19;
        const label = this.makeTextSprite(p.label, { fontSize: 36, color: '#f3ebe0' });
        label.position.set(0, 1.15, 0);
        label.scale.set(2.4, 0.55, 1);
        g.add(disc, ring, label);
        g.userData.disc = disc;
        g.userData.ring = ring;
        g.userData.label = label;
        this.buildPadRoot.add(g);
        this.buildPadMeshes.set(p.id, g);
      }
      g.visible = p.visible;
      const disc = g.userData.disc as THREE.Mesh;
      const ring = g.userData.ring as THREE.Mesh;
      const label = g.userData.label as THREE.Sprite;
      const discMat = disc.material as THREE.MeshBasicMaterial;
      const ringMat = ring.material as THREE.MeshBasicMaterial;

      if (p.dim) {
        discMat.color.setHex(0x5a554c);
        discMat.opacity = 0.12;
        ring.visible = false;
        label.visible = false;
        g.scale.set(1, 1, 1);
        continue;
      }

      label.visible = true;
      const costTxt = p.locked
        ? `🔒 ${p.lockLv != null ? tf('padLockedLv', { n: p.lockLv }) : ''}`
        : (p.cost <= 0 ? 'FREE' : (p.paid > 0 && p.paid < p.cost ? `$${Math.floor(p.paid)}/$${p.cost}` : `$${p.cost}`));
      this.updateSpriteText(label, `${p.label}\n${costTxt}`);

      if (p.locked) {
        discMat.color.setHex(0x5a554c);
        discMat.opacity = 0.3;
        ring.visible = false;
        g.scale.set(1, 1, 1);
      } else if (p.cost <= 0) {
        discMat.color.setHex(0xa89070);
        discMat.opacity = 0.3;
        ring.visible = true;
        ringMat.color.setHex(0xa89070);
        ringMat.opacity = 0.35;
        g.scale.set(1, 1, 1);
      } else if (p.paid > 0 && p.paid < p.cost) {
        discMat.color.setHex(0x5a8f6b);
        discMat.opacity = 0.45;
        ring.visible = true;
        ringMat.color.setHex(0x5a8f6b);
        ringMat.opacity = 0.4;
        g.scale.set(pulse, 1, pulse);
      } else {
        discMat.color.setHex(0xc9a227);
        discMat.opacity = 0.35;
        ring.visible = true;
        ringMat.color.setHex(0xa89070);
        ringMat.opacity = 0.4;
        g.scale.set(1, 1, 1);
      }
    }
    for (const [id, g] of this.buildPadMeshes) {
      if (!seen.has(id)) { g.visible = false; }
    }
  }

  spawnFloorCoin(x: number, z: number, value: number) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: 0xc9a227, emissive: 0x6a5010, emissiveIntensity: 0.12, metalness: 0.55, roughness: 0.35 }),
    );
    m.position.set(x, 0.2, z);
    this.root.add(m);
    this.floorCoins.push({ mesh: m, x, z, value });
  }

  collectFloorCoinsNear(px: number, pz: number, r = 1.1): number {
    let sum = 0;
    for (let i = this.floorCoins.length - 1; i >= 0; i--) {
      const c = this.floorCoins[i];
      if (Math.hypot(c.x - px, c.z - pz) < r) {
        sum += c.value;
        this.root.remove(c.mesh);
        c.mesh.geometry.dispose();
        this.floorCoins.splice(i, 1);
      }
    }
    return sum;
  }
}
