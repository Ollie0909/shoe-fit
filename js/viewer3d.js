/**
 * viewer3d.js — 3D 試穿畫面（使用 three.js）
 *
 * 畫面內容：
 *   - 半透明的鞋內空間（依掃描尺寸建模，金色等高線代表掃描輪廓）
 *   - 你的腳（依腳長、腳寬、腳背高建模），表面顏色代表各區域的合腳狀態
 *   - 腳跟對齊鞋跟，所以鞋頭前方的空隙就是腳趾的活動空間
 * 手指拖曳可旋轉、兩指可縮放。若手機不支援 3D，會顯示文字提示，其餘功能照常。
 */

export const STATUS_COLORS = { 太緊: 0xc0503a, 略緊: 0xd9a03f, 剛好: 0x6f9a63, 偏鬆: 0x5f86b0 };
const SKIN = 0xe8d5c2;
const SCALE = 0.01; // 1 mm = 0.01 單位

/** 平滑內插：points = [[t, 值], ...]，t 從 0（腳跟）到 1（腳尖） */
function profile(points, t) {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i];
    const [t0, v0] = points[i - 1];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * u * u * (3 - 2 * u);
    }
  }
  return points[points.length - 1][1];
}

const smooth = (a, b, x) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** 腳或鞋內空間的寬度、高度輪廓（mm） */
function shapeFns({ ballWidth, heelWidth, instep }, kind) {
  const bw = ballWidth / 2;
  const hw = heelWidth / 2;
  const halfWidth = (t) =>
    profile([[0, 0], [0.03, hw * 0.75], [0.1, hw * 0.98], [0.2, hw], [0.4, bw * 0.8], [0.62, bw * 0.97], [0.72, bw], [0.84, bw * 0.9], [0.93, bw * 0.68], [0.985, bw * 0.35], [1, 0]], t);
  const heights = {
    foot: [[0, 0], [0.03, 0.55], [0.12, 1.02], [0.28, 1.08], [0.45, 0.98], [0.6, 0.72], [0.72, 0.52], [0.85, 0.4], [0.95, 0.32], [1, 0]],
    shoe: [[0, 0], [0.03, 0.62], [0.12, 0.88], [0.3, 0.95], [0.45, 1.03], [0.6, 0.8], [0.72, 0.62], [0.85, 0.5], [0.95, 0.4], [1, 0]],
    boot: [[0, 0], [0.03, 1.4], [0.1, 2.1], [0.3, 2.1], [0.42, 1.5], [0.52, 1.05], [0.62, 0.8], [0.72, 0.62], [0.85, 0.5], [0.95, 0.4], [1, 0]],
  }[kind];
  const height = (t) => profile(heights, t) * instep;
  return { halfWidth, height };
}

/** 依輪廓產生封閉的立體（沿長度一圈一圈的環） */
function bodyGeometry(THREE, length, { halfWidth, height }, rings = 72, seg = 44) {
  const pos = [];
  const tAttr = [];
  const sAttr = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const hw = halfWidth(t);
    const h = height(t);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const y = s >= 0 ? h * Math.pow(s, 0.85) : s * 3; // 上半部是腳背弧度，下半部接近平的腳底
      const z = s >= 0 ? hw * c * (1 - 0.18 * s) : hw * c;
      pos.push(t * length * SCALE, y * SCALE, z * SCALE);
      tAttr.push(t);
      sAttr.push(s);
    }
  }
  const index = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      const c = (i + 1) * seg + j;
      const d = (i + 1) * seg + ((j + 1) % seg);
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  g.userData = { t: tAttr, s: sAttr, rings, seg };
  return g;
}

/** 依各區域狀態替腳上色（區域交界處漸層） */
function paintFoot(THREE, geometry, statuses) {
  const { t, s } = geometry.userData;
  const col = (st) => new THREE.Color(STATUS_COLORS[st] ?? SKIN);
  const cToe = col(statuses.toe);
  const cBall = col(statuses.ball);
  const cInstep = col(statuses.instep);
  const cHeel = col(statuses.heel);
  const cSkin = new THREE.Color(SKIN);
  const colors = [];
  const tmp = new THREE.Color();
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    const wToe = smooth(0.82, 0.88, x);
    const wBall = smooth(0.56, 0.62, x) * (1 - wToe);
    const wHeel = 1 - smooth(0.2, 0.28, x);
    const wInstep = smooth(0.3, 0.36, x) * (1 - smooth(0.52, 0.58, x)) * smooth(0.35, 0.65, s[i]);
    const wSkin = Math.max(0, 1 - wToe - wBall - wHeel - wInstep);
    tmp.setRGB(0, 0, 0);
    for (const [c, w] of [[cToe, wToe], [cBall, wBall], [cHeel, wHeel], [cInstep, wInstep], [cSkin, wSkin]]) {
      tmp.r += c.r * w;
      tmp.g += c.g * w;
      tmp.b += c.b * w;
    }
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

export async function createViewer(container) {
  let THREE;
  let OrbitControls;
  try {
    THREE = await import('three');
    ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
  } catch {
    return fallback(container, '3D 元件載入失敗（可能是網路問題），下方的分析結果仍然有效。');
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return fallback(container, '這個瀏覽器不支援 3D 顯示，下方的分析結果仍然有效。');
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(1.6, 2.3, 5.2);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.25, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 2.5;
  controls.maxDistance = 8;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.1;
  controls.addEventListener('start', () => (controls.autoRotate = false));

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9ccb8, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1.5, 3, 2);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xfff1dd, 0.6);
  rim.position.set(-2, 1, -2);
  scene.add(rim);

  // 地面陰影
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.7, 48),
    new THREE.MeshBasicMaterial({ color: 0x1f1d1a, transparent: true, opacity: 0.07, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1, 0.42, 1);
  shadow.position.y = -0.13;
  scene.add(shadow);

  let group = null;

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  function dispose(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  return {
    /**
     * @param foot     { lengthMm, ballWidthMm, instepMm, heelWidthMm }
     * @param interior 鞋內尺寸 { lengthMm, ballWidthMm, instepHeightMm, heelWidthMm }（磨合後模式會傳入撐開後的數值）
     * @param model    鞋款（決定鞋子顏色、是不是靴子）
     * @param statuses { toe, ball, instep, heel } 各區域狀態
     */
    show({ foot, interior, model, statuses }) {
      if (group) {
        scene.remove(group);
        dispose(group);
      }
      group = new THREE.Group();
      const isBoot = model.category === '靴子';

      // 鞋內空間（半透明）＋ 掃描等高線
      const shoeShape = shapeFns({ ballWidth: interior.ballWidthMm, heelWidth: interior.heelWidthMm, instep: interior.instepHeightMm }, isBoot ? 'boot' : 'shoe');
      const shoeGeo = bodyGeometry(THREE, interior.lengthMm, shoeShape);
      const shoeColor = new THREE.Color(model.art?.upper || '#8a6a4c');
      const shell = new THREE.Mesh(
        shoeGeo,
        new THREE.MeshStandardMaterial({ color: shoeColor, transparent: true, opacity: 0.2, roughness: 0.5, side: THREE.DoubleSide, depthWrite: false }),
      );
      group.add(shell);
      const pos = shoeGeo.getAttribute('position');
      const { rings, seg } = shoeGeo.userData;
      const lineMat = new THREE.LineBasicMaterial({ color: 0xa8854f, transparent: true, opacity: 0.6 });
      for (let i = 4; i < rings; i += 6) {
        const pts = [];
        for (let j = 0; j < seg; j++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i * seg + j));
        group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
      }

      // 鞋底
      const outline = new THREE.Shape();
      const steps = 60;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = t * interior.lengthMm * SCALE;
        const z = (shoeShape.halfWidth(t) + 4) * SCALE;
        if (i === 0) outline.moveTo(x, z);
        else outline.lineTo(x, z);
      }
      for (let i = steps; i >= 0; i--) {
        const t = i / steps;
        outline.lineTo(t * interior.lengthMm * SCALE, -(shoeShape.halfWidth(t) + 4) * SCALE);
      }
      const soleGeo = new THREE.ExtrudeGeometry(outline, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.03, bevelSegments: 2 });
      soleGeo.rotateX(-Math.PI / 2);
      const sole = new THREE.Mesh(soleGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(model.art?.sole || '#2a2420'), roughness: 0.85 }));
      sole.position.y = -0.12;
      group.add(sole);

      // 腳（腳跟對齊鞋跟，往前 2 mm 讓腳跟不穿出鞋）
      const footShape = shapeFns({ ballWidth: foot.ballWidthMm, heelWidth: foot.heelWidthMm, instep: foot.instepMm }, 'foot');
      const footGeo = bodyGeometry(THREE, foot.lengthMm, footShape);
      paintFoot(THREE, footGeo, statuses);
      const footMesh = new THREE.Mesh(footGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }));
      footMesh.position.x = 2 * SCALE;
      footMesh.position.y = 1 * SCALE;
      group.add(footMesh);

      group.position.x = -(interior.lengthMm * SCALE) / 2;
      group.position.y = 0;
      scene.add(group);
    },
  };
}

function fallback(container, message) {
  const div = document.createElement('div');
  div.className = 'viewer-fallback';
  div.textContent = message;
  container.appendChild(div);
  return null;
}
