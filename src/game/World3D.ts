import * as THREE from 'three';

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
import { box, cyl, makeCharacter, makePatty, makeBurgerMesh, makeSmokeParticle, makeMat } from './meshes';
import { t, getLang } from '../i18n';

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
}

export interface GrillSlotVis {
  patty: THREE.Mesh;
  ring: THREE.Mesh;
  progress: THREE.Mesh;
}

export class World3D {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  camPos = new THREE.Vector3(0.5, 15.5, 12);
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
  focusRing!: THREE.Mesh;
  tutorialArrow!: THREE.Group;
  smoke: { mesh: THREE.Mesh; life: number; vy: number }[] = [];
  titleSprite!: THREE.Sprite;

  playerMesh!: THREE.Group;
  playerStack!: THREE.Group;
  workerMeshes = new Map<any, THREE.Group>();
  customerMeshes = new Map<any, THREE.Group>();

  private clock = 0;
  private _resizeObs?: ResizeObserver;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1008);
    this.scene.fog = new THREE.Fog(0x1a1008, 22, 38);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
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
    this.camera.position.set(0.5, 15.5, dist * 0.78);
    this.camera.lookAt(0, 0, 0.5);
  }

  setupLights() {
    const hemi = new THREE.HemisphereLight(0xfff0dd, 0x3a2818, 0.85);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffe0b0, 1.15);
    sun.position.set(8, 18, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 40;
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.bias = -0.001;
    this.scene.add(sun);

    const warm = new THREE.PointLight(0xff8c42, 1.2, 12, 1.5);
    warm.position.set(-6, 3.2, -2.5);
    this.scene.add(warm);

    const cool = new THREE.PointLight(0x88aaff, 0.55, 14, 1.5);
    cool.position.set(5, 3, 1);
    this.scene.add(cool);
  }

  buildRoom() {
    // Floor kitchen / dining
    const kitchen = box(9.5, 0.12, 12, 0xc4784a, -0.06);
    kitchen.position.set(-4.75, 0, 0);
    kitchen.receiveShadow = true;
    this.root.add(kitchen);

    const dining = box(9.5, 0.12, 12, 0x7d5a38, -0.06);
    dining.position.set(4.75, 0, 0);
    dining.receiveShadow = true;
    this.root.add(dining);

    // Checker accents via thin pads
    const kitPad = box(8.6, 0.02, 11, 0xd4895a, 0.01);
    kitPad.position.set(-4.5, 0, 0);
    kitPad.material = makeMat(0xd4895a);
    (kitPad.material as THREE.MeshStandardMaterial).transparent = true;
    (kitPad.material as THREE.MeshStandardMaterial).opacity = 0.25;
    this.root.add(kitPad);

    // Zone color washes
    const grillZone = box(3.4, 0.03, 2.6, 0xe64a28, 0.02);
    grillZone.position.set(-6, 0, -2.5);
    (grillZone.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x661800);
    (grillZone.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35;
    this.root.add(grillZone);

    const prepZone = box(3.4, 0.03, 2.2, 0xf1c40f, 0.02);
    prepZone.position.set(-6, 0, 0.9);
    (prepZone.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x665500);
    (prepZone.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25;
    this.root.add(prepZone);

    const counterZone = box(2.2, 0.03, 5.2, 0x27ae60, 0.02);
    counterZone.position.set(-2.2, 0, 0.2);
    (counterZone.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x0a4020);
    (counterZone.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3;
    this.root.add(counterZone);

    const hallZone = box(8.5, 0.03, 9.5, 0x4a6fa5, 0.02);
    hallZone.position.set(4.5, 0, 0.2);
    (hallZone.material as THREE.MeshStandardMaterial).transparent = true;
    (hallZone.material as THREE.MeshStandardMaterial).opacity = 0.35;
    this.root.add(hallZone);

    // Walls
    const wallMat = 0x4a2c1a;
    const back = box(19.2, 2.4, 0.35, wallMat, 0);
    back.position.set(0, 0, -6.1);
    this.root.add(back);
    const left = box(0.35, 2.4, 12.4, wallMat, 0);
    left.position.set(-9.6, 0, 0);
    this.root.add(left);
    const right = box(0.35, 2.4, 12.4, wallMat, 0);
    right.position.set(9.6, 0, 0);
    this.root.add(right);

    // Divider strip
    const div = box(0.18, 0.08, 11.5, 0xffd278, 0.04);
    div.position.set(-0.1, 0, 0);
    this.root.add(div);

    // Menu board
    const board = box(1.1, 1.4, 0.12, 0x2b1d12, 0.9);
    board.position.set(-8.6, 0, -4.8);
    this.root.add(board);

    // Plants
    this.addPlant(8.5, -4.8);
    this.addPlant(-0.8, 5.2);

    this.titleSprite = this.makeTextSprite(getLang() === 'en' ? '🍔 Burger Rush' : '🍔 Бургерная', {
      fontSize: 48,
      color: '#ffd36a',
    });
    this.titleSprite.position.set(0, 3.2, -5.6);
    this.titleSprite.scale.set(6, 1.5, 1);
    this.root.add(this.titleSprite);
  }

  addPlant(x: number, z: number) {
    const pot = cyl(0.22, 0.28, 0x5d3a1a, 0, 8);
    pot.position.set(x, 0, z);
    const leaf1 = cyl(0.16, 0.5, 0x27ae60, 0.28, 6);
    leaf1.position.set(x, 0, z);
    const leaf2 = cyl(0.12, 0.4, 0x1e8449, 0.35, 6);
    leaf2.position.set(x + 0.12, 0, z + 0.05);
    this.root.add(pot, leaf1, leaf2);
  }

  buildStations() {
    // Grill
    this.grillGroup = new THREE.Group();
    this.grillGroup.position.set(-6, 0, -2.5);
    const grillBody = box(2.4, 0.7, 1.6, 0x2a2a2a, 0);
    const grillTop = box(2.2, 0.08, 1.4, 0x444444, 0.7);
    this.grillGroup.add(grillBody, grillTop);
    for (let i = 0; i < 3; i++) {
      const sx = -0.7 + i * 0.7;
      const pan = cyl(0.28, 0.05, 0x111111, 0.78, 12);
      pan.position.x = sx;
      const patty = makePatty(false);
      patty.position.set(sx, 0.88, 0);
      patty.visible = false;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.32, 0.38, 24),
        new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(sx, 0.92, 0);
      ring.visible = false;
      const progGeo = new THREE.RingGeometry(0.32, 0.38, 24, 1, 0, 0.01);
      const progress = new THREE.Mesh(
        progGeo,
        new THREE.MeshBasicMaterial({ color: 0xf39c12, side: THREE.DoubleSide }),
      );
      progress.rotation.x = -Math.PI / 2;
      progress.position.set(sx, 0.93, 0);
      progress.visible = false;
      this.grillGroup.add(pan, patty, ring, progress);
      this.grillSlots.push({ patty, ring, progress });
    }
    const grillLabel = this.makeTextSprite('🔥 ' + t('zoneGrill'), { fontSize: 36, color: '#ffd0c0' });
    grillLabel.position.set(0, 1.6, 0);
    grillLabel.scale.set(2.2, 0.55, 1);
    this.grillGroup.add(grillLabel);
    this.root.add(this.grillGroup);

    // Prep
    this.prepGroup = new THREE.Group();
    this.prepGroup.position.set(-6, 0, 0.9);
    const prepBody = box(2.4, 0.65, 1.4, 0xf4d03f, 0);
    const board = box(2.0, 0.06, 1.1, 0xe8c27a, 0.65);
    this.prepGroup.add(prepBody, board);
    this.prepLabel = this.makeTextSprite('🍖0  🍔0', { fontSize: 40, color: '#4a3208' });
    this.prepLabel.position.set(0, 1.35, 0);
    this.prepLabel.scale.set(2.0, 0.5, 1);
    this.prepGroup.add(this.prepLabel);
    const prepZoneLbl = this.makeTextSprite('🍔 ' + t('zonePrep'), { fontSize: 32, color: '#5a3d00' });
    prepZoneLbl.position.set(0, 1.7, 0);
    prepZoneLbl.scale.set(2.2, 0.5, 1);
    this.prepGroup.add(prepZoneLbl);
    this.root.add(this.prepGroup);

    // Counter
    this.counterGroup = new THREE.Group();
    this.counterGroup.position.set(-2.2, 0, 0.2);
    const counterBody = box(1.2, 1.0, 4.4, 0x27ae60, 0);
    const counterTop = box(1.3, 0.1, 4.5, 0x1e8449, 1.0);
    this.counterGroup.add(counterBody, counterTop);
    this.counterStack.position.set(0, 1.15, 1.5);
    this.counterGroup.add(this.counterStack);
    const cLbl = this.makeTextSprite('✅ ' + t('zoneCounter'), { fontSize: 32, color: '#e8ffe8' });
    cLbl.position.set(0, 1.55, -1.6);
    cLbl.scale.set(2.0, 0.45, 1);
    this.counterGroup.add(cLbl);
    this.root.add(this.counterGroup);

    // Trash
    this.trashGroup = new THREE.Group();
    this.trashGroup.position.set(-7.2, 0, 4.2);
    const trash = box(1.0, 1.0, 1.0, 0x3a3a3a, 0);
    const stripe = box(1.02, 0.15, 1.02, 0xf1c40f, 0.85);
    this.trashGroup.add(trash, stripe);
    const tLbl = this.makeTextSprite('🗑️ ' + t('zoneTrash'), { fontSize: 28, color: '#f1c40f' });
    tLbl.position.set(0, 1.4, 0);
    tLbl.scale.set(1.8, 0.45, 1);
    this.trashGroup.add(tLbl);
    this.root.add(this.trashGroup);

    // Tables
    const positions = [
      [2.2, -3.2], [4.6, -3.2], [7.0, -3.2],
      [2.2, -0.6], [4.6, -0.6], [7.0, -0.6],
      [3.4, 2.2], [5.8, 2.2],
    ];
    positions.forEach(([x, z], i) => {
      const mesh = new THREE.Group();
      mesh.position.set(x, 0, z);
      const top = box(1.35, 0.12, 1.35, 0xa67c52, 0.55);
      const leg1 = box(0.12, 0.55, 0.12, 0x6b4a2a, 0);
      leg1.position.set(-0.5, 0, -0.5);
      const leg2 = leg1.clone(); leg2.position.set(0.5, 0, -0.5);
      const leg3 = leg1.clone(); leg3.position.set(-0.5, 0, 0.5);
      const leg4 = leg1.clone(); leg4.position.set(0.5, 0, 0.5);
      const cloth = box(1.1, 0.04, 1.1, 0x5d8aa8, 0.67);
      const dirtyFX = box(1.1, 0.05, 1.1, 0x6b3a1f, 0.68);
      dirtyFX.visible = false;
      const lockIcon = this.makeTextSprite('🔒', { fontSize: 64, color: '#ffffff' });
      lockIcon.position.set(0, 1.2, 0);
      lockIcon.scale.set(0.8, 0.8, 1);
      lockIcon.visible = i !== 0;
      mesh.add(top, leg1, leg2, leg3, leg4, cloth, dirtyFX, lockIcon);
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
      });
    });

    const hallLbl = this.makeTextSprite('🪑 ' + t('zoneTables'), { fontSize: 32, color: '#c8dcff' });
    hallLbl.position.set(4.6, 0.4, -4.8);
    hallLbl.scale.set(2.4, 0.55, 1);
    this.root.add(hallLbl);

    this.queueSpots = [
      { x: -0.6, z: -1.4 },
      { x: -0.6, z: -0.2 },
      { x: -0.6, z: 1.0 },
      { x: -0.6, z: 2.2 },
    ];
  }

  buildFocusAndTutorial() {
    this.focusRing = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.35, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe566, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    this.focusRing.rotation.x = -Math.PI / 2;
    this.focusRing.position.y = 0.06;
    this.focusRing.visible = false;
    this.root.add(this.focusRing);

    this.tutorialArrow = new THREE.Group();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 0.7, 4),
      new THREE.MeshBasicMaterial({ color: 0xffe566 }),
    );
    cone.rotation.x = Math.PI;
    this.tutorialArrow.add(cone);
    this.tutorialArrow.visible = false;
    this.root.add(this.tutorialArrow);
  }


  buildInteractPads() {
    // Floor top is ~y=0.06 — pads MUST sit above it or they are invisible (z-fight / inside mesh)
    type Pad = { x: number; z: number; color: number; r?: number };
    const pads: Pad[] = [
      { x: -6, z: -1.1, color: 0xff6b35 },        // grill (front)
      { x: -6, z: 2.1, color: 0xf1c40f },         // prep / assembly
      { x: -0.7, z: 0.2, color: 0x2ecc71 },       // counter (customer/kitchen approach on +x side)
      { x: -7.2, z: 3.1, color: 0xf1c40f, r: 0.9 },
    ];
    for (const tb of this.tables) {
      pads.push({ x: tb.x, z: tb.z - 1.05, color: 0x5dade2, r: 0.95 });
    }
    const y = 0.13;
    for (const p of pads) {
      const outer = p.r ?? 1.05;
      const inner = outer * 0.62;
      const matRing = new THREE.MeshBasicMaterial({
        color: p.color,
        transparent: true,
        opacity: 0.92,
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
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(inner * 0.92, 32), matDisc);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(p.x, y - 0.005, p.z);
      disc.renderOrder = 19;
      this.root.add(disc);
    }
  }

  followCamera(px: number, pz: number, dt: number) {
    const desiredPos = new THREE.Vector3(px * 0.35 + 0.5, 15.2, pz * 0.25 + 12.2);
    const desiredLook = new THREE.Vector3(px * 0.55, 0.5, pz * 0.55 + 0.3);
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

  updatePlayerStack(patties: number, burgers: number) {
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
    for (let i = 0; i < burgers; i++) {
      const b = makeBurgerMesh();
      b.position.y = y;
      b.scale.setScalar(0.75);
      this.playerStack.add(b);
      y += 0.22;
    }
  }

  syncGrill(slots: { state: string; progress: number }[], cookNeed: number, time: number) {
    slots.forEach((s, i) => {
      const v = this.grillSlots[i];
      if (!v) return;
      if (s.state === 'empty') {
        v.patty.visible = false;
        v.ring.visible = false;
        v.progress.visible = false;
      } else {
        v.patty.visible = true;
        (v.patty.material as THREE.MeshStandardMaterial).color.setHex(
          s.state === 'ready' ? 0x6b3a12 : 0xc0392b,
        );
        if (s.state === 'cooking') {
          v.progress.visible = true;
          v.ring.visible = false;
          const frac = Math.min(1, s.progress / cookNeed);
          v.progress.geometry.dispose();
          v.progress.geometry = new THREE.RingGeometry(0.32, 0.38, 24, 1, -Math.PI / 2, Math.PI * 2 * frac);
          // smoke
          if (Math.random() < 0.08) this.spawnSmoke(
            this.grillGroup.position.x + v.patty.position.x,
            1.1,
            this.grillGroup.position.z,
          );
        } else if (s.state === 'ready') {
          v.progress.visible = false;
          v.ring.visible = true;
          const pulse = 0.55 + Math.sin(time * 8) * 0.35;
          (v.ring.material as THREE.MeshBasicMaterial).opacity = pulse;
        }
      }
    });
  }

  syncPrep(patties: number, burgers: number) {
    this.updateSpriteText(this.prepLabel, `🍖${patties}  🍔${burgers}`);
  }

  syncCounter(burgers: number) {
    while (this.counterStack.children.length) {
      this.counterStack.remove(this.counterStack.children[0]);
    }
    const n = Math.min(burgers, 8);
    for (let i = 0; i < n; i++) {
      const b = makeBurgerMesh();
      b.position.y = i * 0.2;
      b.scale.setScalar(0.7);
      this.counterStack.add(b);
    }
  }

  syncTables() {
    for (const tb of this.tables) {
      tb.lockIcon.visible = !tb.unlocked;
      tb.cloth.visible = tb.unlocked && !tb.dirty;
      tb.dirtyFX.visible = tb.unlocked && tb.dirty;
      const top = tb.mesh.children[0] as THREE.Mesh;
      if (top?.material) {
        (top.material as THREE.MeshStandardMaterial).color.setHex(tb.dirty ? 0x6b3a1f : 0xa67c52);
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
    (this.focusRing.material as THREE.MeshBasicMaterial).color.setHex(color);
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
        shirt: w.type === 'waiter' ? 0x1abc9c : 0x9b59b6,
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
    const pulse = 1 + Math.sin(time * 4.5) * 0.08;
    this.focusRing.scale.setScalar(pulse);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
