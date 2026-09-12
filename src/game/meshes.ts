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

/** Low-poly humanoid: body + head + legs + optional hat */
export function makeCharacter(opts: {
  shirt: number;
  skin?: number;
  hair?: number;
  hat?: 'chef' | 'cap' | 'bow' | 'none';
  scale?: number;
}) {
  const g = new THREE.Group();
  const scale = opts.scale ?? 1;
  const skin = opts.skin ?? 0xf1c27d;
  const hair = opts.hair ?? 0x3a2a1a;

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.28, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  g.add(shadow);

  const legL = box(0.16, 0.35, 0.16, 0x2c3e50, 0);
  legL.position.x = -0.1;
  legL.name = 'legL';
  const legR = box(0.16, 0.35, 0.16, 0x2c3e50, 0);
  legR.position.x = 0.1;
  legR.name = 'legR';
  g.add(legL, legR);

  const body = box(0.42, 0.5, 0.28, opts.shirt, 0.35);
  body.name = 'body';
  g.add(body);

  const head = cyl(0.18, 0.28, skin, 0.85, 10);
  head.name = 'head';
  g.add(head);

  const hairMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
    makeMat(hair),
  );
  hairMesh.position.y = 1.08;
  hairMesh.castShadow = true;
  g.add(hairMesh);

  const eyeMat = makeMat(0x2c1810);
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), eyeMat);
  eyeL.position.set(-0.06, 1.02, 0.15);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.06;
  g.add(eyeL, eyeR);

  if (opts.hat === 'chef') {
    const brim = box(0.42, 0.06, 0.42, 0xffffff, 1.12);
    const puff = cyl(0.2, 0.22, 0xffffff, 1.18, 10);
    const band = box(0.44, 0.04, 0.44, 0xe74c3c, 1.12);
    g.add(brim, puff, band);
  } else if (opts.hat === 'cap') {
    const cap = cyl(0.2, 0.1, 0x8e44ad, 1.12, 10);
    const bill = box(0.22, 0.04, 0.14, 0x8e44ad, 1.12);
    bill.position.z = 0.16;
    g.add(cap, bill);
  } else if (opts.hat === 'bow') {
    const bow = box(0.22, 0.06, 0.08, 0x145a32, 0.78);
    bow.position.z = 0.16;
    g.add(bow);
  }

  g.scale.setScalar(scale);
  g.userData.bobParts = { legL, legR, body, head };
  return g;
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
    const cheese = box(0.36, 0.025, 0.36, 0xf1c40f, 0.09);
    cheese.position.y = 0.1;
    g.add(cheese);
  }
  const lettuce = box(0.34, 0.03, 0.34, kind === 'cheese' ? 0x27ae60 : 0x2ecc71, kind === 'double' ? 0.16 : 0.08);
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
