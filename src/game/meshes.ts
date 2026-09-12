import * as THREE from 'three';

const SKINS = [0xf1c27d, 0xffdeb4, 0xe0ac69, 0xc68642, 0x8d5524];

export function skinColor(i?: number) {
  return SKINS[(i ?? (Math.random() * SKINS.length) | 0) % SKINS.length];
}

export function makeMat(color: number, opts: { roughness?: number; metalness?: number; emissive?: number } = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.75,
    metalness: opts.metalness ?? 0.05,
    emissive: opts.emissive ?? 0x000000,
  });
}

export function box(w: number, h: number, d: number, color: number, y = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeMat(color));
  m.position.y = y + h / 2;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function cyl(r: number, h: number, color: number, y = 0, radial = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, radial), makeMat(color));
  m.position.y = y + h / 2;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Pivot at joint; mesh hangs down (legs/arms) or sits up. */
function limb(
  w: number, h: number, d: number, color: number,
  px: number, py: number, pz: number,
  hangDown: boolean,
): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(px, py, pz);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeMat(color));
  m.position.y = hangDown ? -h / 2 : h / 2;
  m.castShadow = true;
  m.receiveShadow = true;
  pivot.add(m);
  return pivot;
}

export type CharParts = {
  hips: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Object3D;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  propHand: THREE.Group;
};

/**
 * Low-poly humanoid CharacterRoot:
 * hips → body · head (± hat) · armL · armR · legL · legR · propHand
 * Roles differ by tint/hat/apron only — same skeleton.
 * Height ~1.55–1.75 (readable from top-down).
 */
export function makeCharacter(opts: {
  shirt: number;
  skin?: number;
  hair?: number;
  pants?: number;
  hat?: 'chef' | 'cap' | 'bow' | 'none';
  /** apron color, or true for off-white */
  apron?: boolean | number;
  scale?: number;
}) {
  const g = new THREE.Group();
  g.name = 'CharacterRoot';
  const scale = opts.scale ?? 1;
  const skin = opts.skin ?? 0xf1c27d;
  const hair = opts.hair ?? 0x3a2a1a;
  const pants = opts.pants ?? 0x2c3e50;

  const legH = 0.58;
  const torsoH = 0.50;
  const torsoW = 0.42;
  const torsoD = 0.26;
  const armH = 0.44;
  const armW = 0.11;
  const headH = 0.28;
  const hipY = legH;
  const shoulderY = hipY + torsoH - 0.06;
  const headY = hipY + torsoH;

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  g.add(shadow);

  const hips = new THREE.Group();
  hips.name = 'hips';
  g.add(hips);

  const legL = limb(0.15, legH, 0.16, pants, -0.11, hipY, 0, true);
  legL.name = 'legL';
  const legR = limb(0.15, legH, 0.16, pants, 0.11, hipY, 0, true);
  legR.name = 'legR';
  hips.add(legL, legR);

  const body = new THREE.Mesh(new THREE.BoxGeometry(torsoW, torsoH, torsoD), makeMat(opts.shirt));
  body.name = 'body';
  body.position.set(0, hipY + torsoH / 2, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  hips.add(body);
  // rest pose baselines for breathe / lean
  body.userData.baseY = body.position.y;

  if (opts.apron) {
    const apronColor = opts.apron === true ? 0xf0f2f4 : opts.apron;
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(torsoW * 0.78, torsoH * 0.72, 0.04),
      makeMat(apronColor, { roughness: 0.85 }),
    );
    apron.name = 'apron';
    apron.position.set(0, -torsoH * 0.06, torsoD / 2 + 0.02);
    body.add(apron);
  }

  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, headY, 0);
  head.userData.baseY = headY;
  const headMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.18, headH, 10),
    makeMat(skin),
  );
  headMesh.position.y = headH / 2;
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  head.add(headMesh);

  const hairMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
    makeMat(hair),
  );
  hairMesh.name = 'hair';
  hairMesh.position.y = headH * 0.72;
  hairMesh.castShadow = true;
  head.add(hairMesh);

  const eyeMat = makeMat(0x2c1810);
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), eyeMat);
  eyeL.position.set(-0.06, headH * 0.55, 0.15);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.06;
  head.add(eyeL, eyeR);

  if (opts.hat === 'chef') {
    const brim = box(0.4, 0.05, 0.4, 0xffffff, headH * 0.92);
    const puff = cyl(0.18, 0.2, 0xffffff, headH * 0.96, 10);
    const band = box(0.42, 0.035, 0.42, 0xb54a3a, headH * 0.9);
    head.add(brim, puff, band);
  } else if (opts.hat === 'cap') {
    const cap = cyl(0.19, 0.09, 0x5c3d6e, headH * 0.92, 10);
    const bill = box(0.2, 0.035, 0.13, 0x5c3d6e, headH * 0.92);
    bill.position.z = 0.15;
    head.add(cap, bill);
  } else if (opts.hat === 'bow') {
    const bow = box(0.2, 0.055, 0.07, 0x145a32, 0.02);
    bow.position.set(0, torsoH * 0.15, torsoD / 2 + 0.04);
    body.add(bow);
  }
  hips.add(head);

  const armL = limb(armW, armH, armW, opts.shirt, -torsoW / 2 - armW * 0.35, shoulderY, 0, true);
  armL.name = 'armL';
  const armR = limb(armW, armH, armW, opts.shirt, torsoW / 2 + armW * 0.35, shoulderY, 0, true);
  armR.name = 'armR';
  hips.add(armL, armR);

  // Carry stack / tray — in front of torso so arms reach it without clipping
  const propHand = new THREE.Group();
  propHand.name = 'propHand';
  propHand.position.set(0, shoulderY - 0.05, 0.34);
  hips.add(propHand);

  const parts: CharParts = { hips, body, head, armL, armR, legL, legR, propHand };
  g.userData.parts = parts;
  // legacy alias
  g.userData.bobParts = parts;

  g.scale.setScalar(scale);
  return g;
}

/** Shared idle / walk / carry (+ optional serve lean) for player, staff, guests. */
export function setCharPose(
  mesh: THREE.Group,
  opts: { moving: boolean; carry: boolean; t: number; serve?: boolean },
) {
  const p = mesh.userData.parts as CharParts | undefined;
  if (!p) return;

  const { moving, carry, t } = opts;
  const serve = !!opts.serve;
  const swingScale = carry ? 0.55 : 1;

  const baseBodyY = (p.body.userData.baseY as number) ?? p.body.position.y;
  const baseHeadY = (p.head.userData.baseY as number) ?? p.head.position.y;

  if (moving) {
    const bob = Math.sin(t) * 0.035;
    p.body.position.y = baseBodyY + bob;
    p.head.position.y = baseHeadY + bob;
    p.legL.rotation.x = Math.sin(t) * 0.48 * swingScale;
    p.legR.rotation.x = -Math.sin(t) * 0.48 * swingScale;
    if (carry) {
      // Arms forward toward propHand; shortened counter-swing
      p.armL.rotation.x = -1.05 + Math.sin(t) * 0.12;
      p.armR.rotation.x = -1.05 - Math.sin(t) * 0.12;
      p.armL.rotation.z = 0.12;
      p.armR.rotation.z = -0.12;
    } else {
      p.armL.rotation.x = -Math.sin(t) * 0.32;
      p.armR.rotation.x = Math.sin(t) * 0.32;
      p.armL.rotation.z = 0.06;
      p.armR.rotation.z = -0.06;
    }
  } else {
    // Idle breathe
    const breath = Math.sin(t * 0.9) * 0.012;
    p.body.position.y = baseBodyY + breath;
    p.head.position.y = baseHeadY + breath;
    p.legL.rotation.x *= 0.75;
    p.legR.rotation.x *= 0.75;
    if (Math.abs(p.legL.rotation.x) < 0.02) p.legL.rotation.x = 0;
    if (Math.abs(p.legR.rotation.x) < 0.02) p.legR.rotation.x = 0;
    if (carry) {
      p.armL.rotation.x = -1.05;
      p.armR.rotation.x = -1.05;
      p.armL.rotation.z = 0.14;
      p.armR.rotation.z = -0.14;
    } else {
      p.armL.rotation.x *= 0.8;
      p.armR.rotation.x *= 0.8;
      if (Math.abs(p.armL.rotation.x) < 0.03) p.armL.rotation.x = 0.08;
      if (Math.abs(p.armR.rotation.x) < 0.03) p.armR.rotation.x = 0.08;
      p.armL.rotation.z = 0.1;
      p.armR.rotation.z = -0.1;
    }
  }

  // Serve / punch: light torso lean at counter
  const leanTarget = serve ? 0.18 : 0;
  p.body.rotation.x += (leanTarget - p.body.rotation.x) * 0.35;
  p.head.rotation.x = p.body.rotation.x * 0.5;
}

export function makePatty(cooked: boolean) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.07, 10),
    makeMat(cooked ? 0x6b3a12 : 0xc0392b, { roughness: 0.9 }),
  );
  m.castShadow = true;
  return m;
}

/** classic / cheese / double visual variants */
export function makeBurgerMesh(kind: 'classic' | 'cheese' | 'double' = 'classic') {
  const g = new THREE.Group();
  const bunTop = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
    makeMat(kind === 'cheese' ? 0xf5d08a : 0xf0c27f),
  );
  bunTop.position.y = kind === 'double' ? 0.2 : 0.12;
  const patty = makePatty(true);
  patty.position.y = 0.06;
  patty.scale.set(0.9, 0.8, 0.9);
  g.add(patty);
  if (kind === 'double') {
    const patty2 = makePatty(true);
    patty2.position.y = 0.13;
    patty2.scale.set(0.9, 0.75, 0.9);
    g.add(patty2);
  }
  if (kind === 'cheese') {
    const cheese = box(0.36, 0.025, 0.36, 0xe8c96a, 0.09);
    cheese.position.y = 0.1;
    g.add(cheese);
  }
  const lettuce = box(0.34, 0.03, 0.34, kind === 'cheese' ? 0x5a8f6b : 0x6a9a6e, kind === 'double' ? 0.16 : 0.08);
  lettuce.position.y = kind === 'double' ? 0.17 : 0.09;
  const bunBot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10),
    makeMat(0xf0c27f),
  );
  bunBot.position.y = 0.03;
  g.add(bunBot, lettuce, bunTop);
  g.castShadow = true;
  g.userData.kind = kind;
  return g;
}

export function makeSmokeParticle() {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.45 }),
  );
  return m;
}
