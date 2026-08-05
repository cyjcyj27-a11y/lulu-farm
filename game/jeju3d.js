// ===== 루루냥의 제주 들판 — Three.js 3D 프로토타입 =====
// 들판(풀·돌담·돌하르방·나무)은 전부 코드로 만들고,
// 루루와 성산일출봉은 직접 그리신 그림 파일을 가져다 씁니다.
// 구성: 하늘 → 바다 → 섬 지형 → 성산일출봉/한라산 → 풀·유채꽃·억새 → 돌담/돌하르방/나무 → 루루

// 그림 파일을 화면에 입히려면(WebGL 텍스처) 브라우저 보안 규칙상 "서버로 열기"가 필요합니다.
// html 파일을 그냥 더블클릭하면(file://) 그림을 못 쓰기 때문에, 그때는 코드로 만든 루루/산으로 대신 보여줍니다.
const CAN_USE_IMAGES = location.protocol !== 'file:';

// 폰·태블릿에서 열었는지. 폰은 그래픽 성능이 PC보다 훨씬 약해서 화면 해상도와 그림자를 낮추고,
// 키보드가 없으니 화면에 조이스틱과 버튼을 띄웁니다.
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

// ---------- 0. 기본 세팅 ----------
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd2e6ee, 150, 700);   // 멀수록 하늘색에 잠기게 (수평선을 부드럽게)

const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 2000);

const renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH });
renderer.setSize(innerWidth, innerHeight);
// 폰은 화면이 촘촘해서(devicePixelRatio 3 이상) 그대로 그리면 픽셀 수가 9배가 되어 뚝뚝 끊깁니다
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = IS_TOUCH ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// 빛: 태양(그림자용) + 하늘/땅 반사광
const sun = new THREE.DirectionalLight(0xfff2d8, 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
sun.shadow.camera.left = -26;
sun.shadow.camera.right = 26;
sun.shadow.camera.top = 26;
sun.shadow.camera.bottom = -26;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0012;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbcdcf5, 0x6c8a4a, 1.15));

// ---------- 1. 하늘 (위아래 색이 다른 큰 돔) ----------
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(900, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x2f7fd0) },
      bottomColor: { value: new THREE.Color(0xe2eff8) },
    },
    vertexShader: `
      varying float vH;
      void main() {
        vH = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      #include <common>
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      varying float vH;
      void main() {
        float t = clamp(pow(max(vH, 0.0), 0.55), 0.0, 1.0);
        gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
        #include <colorspace_fragment>
      }`,
  })
);
scene.add(sky);

// ---------- 2. 지형 높이 함수 ----------
// 이 함수 하나로 (1) 땅 메시 모양 (2) 풀·돌 배치 높이 (3) 루루가 걷는 높이를 모두 결정합니다.
const ISLAND_R = 108;   // 잔디 들판 반지름
const WALK_R = 96;      // 루루가 돌아다닐 수 있는 범위

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// 오름(작은 화산 언덕) — 가우시안 봉우리
function bump(x, z, cx, cz, amp, size) {
  const dx = x - cx, dz = z - cz;
  return amp * Math.exp(-(dx * dx + dz * dz) / (2 * size * size));
}

function groundHeight(x, z) {
  let h = 0;
  h += Math.sin(x * 0.032) * 1.3 + Math.cos(z * 0.027) * 1.5;   // 완만한 기복
  h += Math.sin((x + z) * 0.012) * 2.0;
  h += Math.sin(x * 0.11) * Math.cos(z * 0.09) * 0.35;          // 잔주름
  h += bump(x, z, -48, -52, 15, 20);                            // 오름 1
  h += bump(x, z, 62, -34, 11, 17);                             // 오름 2
  h += bump(x, z, 24, 66, 7, 14);                               // 오름 3
  h += 2.5;

  // 섬 가장자리는 바다 쪽으로 서서히 내려가게
  const r = Math.sqrt(x * x + z * z);
  const edge = 1 - smoothstep(ISLAND_R - 22, ISLAND_R + 16, r);
  return h * edge - (1 - edge) * 7;
}

// ---------- 3. 땅 메시 ----------
{
  const geo = new THREE.PlaneGeometry(340, 340, 190, 190);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = [];
  const cGrass = new THREE.Color(0x74a24d);
  const cHill = new THREE.Color(0x93b25b);
  const cSand = new THREE.Color(0xd8c79b);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = groundHeight(x, z);
    pos.setY(i, y);

    const c = new THREE.Color();
    if (y < 1.0) {
      c.copy(cSand).lerp(cGrass, smoothstep(-0.4, 1.0, y));       // 해안 모래밭
    } else {
      c.copy(cGrass).lerp(cHill, smoothstep(2, 14, y));           // 언덕은 밝은 풀색
      c.offsetHSL(0, 0, (Math.sin(x * 0.4) * Math.cos(z * 0.35)) * 0.025); // 얼룩덜룩하게
    }
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  ground.receiveShadow = true;
  scene.add(ground);
}

// ---------- 4. 바다 (잔잔한 물결) ----------
// 바다는 항상 카메라를 따라다니므로, 판 한가운데가 늘 발밑입니다.
// 그래서 가운데는 진한 청록, 바깥(=수평선 쪽)으로 갈수록 하늘빛으로 옅어지게 색을 칠해두면
// 어디를 가든 수평선이 자연스럽게 흐려집니다.
const sea = new THREE.Mesh(
  new THREE.PlaneGeometry(1700, 1700, 70, 70),
  new THREE.MeshPhongMaterial({ color: 0xffffff, vertexColors: true, shininess: 80, transparent: true, opacity: 0.94 })
);
sea.geometry.rotateX(-Math.PI / 2);
{
  const pos = sea.geometry.attributes.position;
  const near = new THREE.Color(0x2f88a8);    // 가까운 바다 (성산일출봉 그림의 청록빛에 맞춤)
  const far = new THREE.Color(0xcfe3ec);     // 수평선 근처 (하늘빛)
  const cols = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    c.copy(near).lerp(far, smoothstep(60, 620, r));
    cols.push(c.r, c.g, c.b);
  }
  sea.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
}
sea.position.y = -0.5;
scene.add(sea);
const seaBase = sea.geometry.attributes.position.array.slice();

// ---------- 5. 성산일출봉(그림)과 먼 산들 ----------
const texLoader = new THREE.TextureLoader();

function loadTexture(path) {
  const t = texLoader.load(path);
  t.colorSpace = THREE.SRGBColorSpace;   // 그림 파일 색을 그대로 보이게
  return t;
}

function makeMountain(x, z, baseR, topR, h, color) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(topR, baseR, h, 40, 1),
    new THREE.MeshLambertMaterial({ color, flatShading: true })
  );
  m.position.set(x, h / 2 - 6, z);
  scene.add(m);
  return m;
}

if (CAN_USE_IMAGES) {
  // 직접 그리신 성산일출봉 그림(far_island_v2.png)을 수평선에 세워 둡니다.
  // 그림 원본이 1952x544 이고, 섬과 바다가 맞닿는 물가 선이 위에서 약 63% 지점에 있어서
  // 그 선이 실제 바다 높이(y=0)와 맞도록 판의 위치를 계산합니다.
  const IMG_W = 1952, IMG_H = 544, WATERLINE = 345 / IMG_H;
  const W = 936, H = W * IMG_H / IMG_W;   // 실제 성산일출봉을 들판에서 바라본 정도의 크기 (780에서 20% 키움)
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({
      map: loadTexture('../assets/stage1/far_island_v2.png'),
      transparent: true,
      depthWrite: false,
    })
  );
  backdrop.position.set(0, H * (WATERLINE - 0.5), -480);   // 물가 선이 바다 높이(y=0)에 오도록
  backdrop.renderOrder = -1;
  scene.add(backdrop);

  makeMountain(-360, -300, 120, 14, 74, 0x6f9295);   // 멀리 보이는 한라산
  // (오른쪽 바다에 있던 뾰족한 섬은 성산일출봉과 겹쳐 보여서 없앴습니다)
} else {
  makeMountain(-60, -430, 150, 16, 92, 0x64878a);
  makeMountain(170, -360, 58, 8, 32, 0x6f9088);
  makeMountain(-260, -300, 50, 6, 26, 0x789787);
  makeMountain(260, -220, 38, 5, 20, 0x7d9b8a);
}

// ---------- 6. 바람에 흔들리는 식물 재질 ----------
// MeshLambertMaterial의 셰이더에 흔들림 코드를 살짝 끼워 넣습니다.
const windMaterials = [];
function makeWindMaterial(color) {
  const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    // 양면(DoubleSide) 재질은 뒷면을 그릴 때 빛 방향을 뒤집어서 새까맣게 나옵니다.
    // 풀잎은 어느 쪽에서 봐도 "위에서 빛을 받는" 것으로 고정합니다.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\n normal = vec3(0.0, 1.0, 0.0);'
    );
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
         vec3 wp = instanceMatrix[3].xyz;
       #else
         vec3 wp = vec3(0.0);
       #endif
       float sway = sin(uTime * 1.4 + wp.x * 0.22 + wp.z * 0.35)
                  + 0.45 * sin(uTime * 2.6 + wp.x * 0.7);
       float bend = max(transformed.y, 0.0);
       transformed.x += sway * 0.15 * bend;
       transformed.z += sway * 0.06 * bend;`
    );
    mat.userData.shader = shader;
  };
  windMaterials.push(mat);
  return mat;
}

// ---------- 7. 들판에 흩뿌리기 (풀·꽃·억새·나무 공통) ----------
function scatter(count, maxR, minHeight, callback) {
  let placed = 0, guard = 0;
  while (placed < count && guard < count * 40) {
    guard++;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * maxR;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = groundHeight(x, z);
    if (y < minHeight) continue;
    callback(x, y, z, r);
    placed++;
  }
}

const dummy = new THREE.Object3D();

function buildInstanced(geo, mat, spots, place) {
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  spots.forEach((s, i) => {
    place(s, i);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

// 풀잎처럼 세로로 선 판은 빛을 옆에서 받아 새까맣게 보입니다.
// 법선(빛 계산용 방향)을 전부 위쪽으로 바꿔주면 땅과 같은 밝기로 보입니다.
function normalsUp(geo) {
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  n.needsUpdate = true;
  return geo;
}

// 위로 갈수록 뾰족해지게 (풀잎 모양)
function taper(geo, height) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setX(i, p.getX(i) * (1 - (p.getY(i) / height) * 0.75));
  }
  p.needsUpdate = true;
  return geo;
}

// 7-1. 풀 — 한 뭉텅이씩 모여 자라게 심습니다 (드문드문 꽂힌 느낌을 없애려고)
{
  const spots = [[], [], []];
  scatter(16000, ISLAND_R - 4, 0.9, (x, y, z) => {
    for (let i = 0; i < 8; i++) {                       // 한 자리에 8포기씩
      const ox = x + (Math.random() - 0.5) * 0.9;
      const oz = z + (Math.random() - 0.5) * 0.9;
      spots[(Math.random() * 3) | 0].push([ox, groundHeight(ox, oz), oz]);
    }
  });
  const greens = [0x6ba044, 0x7cb051, 0x8dbe5e];
  const H = 0.42;
  spots.forEach((group, gi) => {
    const blade = normalsUp(taper(new THREE.PlaneGeometry(0.11, H, 1, 3), H));
    blade.translate(0, H / 2, 0);
    buildInstanced(blade, makeWindMaterial(greens[gi]), group, (s) => {
      dummy.position.set(s[0], s[1] - 0.03, s[2]);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.set(1, 0.7 + Math.random() * 0.8, 1);
    });
  });
}

// 7-2. 유채꽃 (줄기 + 노란 꽃송이 — 두 덩어리가 같은 자리에 놓입니다)
{
  const spots = [];
  scatter(3200, ISLAND_R - 10, 1.2, (x, y, z) => spots.push([x, y, z, 0.42 + Math.random() * 0.3]));
  // 유채밭 두 군데는 더 빽빽하게
  [[-30, 30], [55, 20]].forEach(([cx, cz]) => {
    for (let i = 0; i < 2600; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 17;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const y = groundHeight(x, z);
      if (y > 1.2) spots.push([x, y, z, 0.5 + Math.random() * 0.3]);
    }
  });

  const stemGeo = normalsUp(new THREE.CylinderGeometry(0.016, 0.024, 1, 4));
  stemGeo.translate(0, 0.5, 0);
  // 인스턴스마다 세로로 눌리기 때문에(줄기 길이 조절) 꽃송이는 미리 세로로 늘려둡니다
  const headGeo = new THREE.IcosahedronGeometry(0.085, 0);
  headGeo.scale(1, 1.9, 1);
  headGeo.translate(0, 1.0, 0);

  const place = (s) => {
    dummy.position.set(s[0], s[1], s[2]);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.scale.set(1, s[3], 1);
  };
  buildInstanced(stemGeo, makeWindMaterial(0x6d9a46), spots, place);
  buildInstanced(headGeo, makeWindMaterial(0xf5cf3c), spots, place);
}

// 7-3. 억새 (해안 쪽에 키 큰 은빛 풀)
{
  const spots = [];
  scatter(900, ISLAND_R - 2, 0.9, (x, y, z, r) => {
    if (r > ISLAND_R - 34) spots.push([x, y, z, 0.7 + Math.random() * 0.4]);
  });
  const stalk = normalsUp(new THREE.PlaneGeometry(0.09, 1.6, 1, 3));
  stalk.translate(0, 0.8, 0);
  const plume = new THREE.SphereGeometry(0.1, 6, 5);
  plume.scale(1, 2.4, 1);
  plume.translate(0, 1.75, 0);

  const place = (s) => {
    dummy.position.set(s[0], s[1], s[2]);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.scale.set(1, s[3], 1);
  };
  buildInstanced(stalk, makeWindMaterial(0x9faa62), spots, place);
  buildInstanced(plume, makeWindMaterial(0xe8dfc4), spots, place);
}

// ---------- 8. 장애물 목록 (루루가 통과하지 못하는 것들) ----------
const obstacles = []; // { x, z, r }

// 8-1. 돌담 — 제주 밭담처럼 구멍 숭숭한 낮은 현무암 담장
const stoneMat = new THREE.MeshLambertMaterial({ color: 0x6f6f6d, flatShading: true });
const darkStoneMat = new THREE.MeshLambertMaterial({ color: 0x5c5c5b, flatShading: true });

// 돌 하나하나를 따로 만들면 그릴 것이 수백 개로 늘어나 느려집니다.
// 그래서 위치만 모아뒀다가 마지막에 InstancedMesh(같은 모양을 한 번에 여러 개 그리는 방식)로 만듭니다.
const stoneSpots = { light: [], dark: [] };

function buildStoneWall(x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const step = 0.72;
  const n = Math.floor(len / step);

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x1 + dx * t, z = z1 + dz * t;
    const y = groundHeight(x, z);
    if (y < 1.0) continue;

    const layers = 2 + ((Math.random() * 2) | 0);
    for (let L = 0; L < layers; L++) {
      (Math.random() < 0.4 ? stoneSpots.dark : stoneSpots.light).push({
        x: x + (Math.random() - 0.5) * 0.22,
        y: y + 0.25 + L * 0.42,
        z: z + (Math.random() - 0.5) * 0.22,
        s: (0.3 + Math.random() * 0.16) / 0.35,
        rx: Math.random() * 3, ry: Math.random() * 3, rz: Math.random() * 3,
      });
    }
    if (i % 2 === 0) obstacles.push({ x, z, r: 0.62 });
  }
}

// 섬 바깥 자투리 땅에만 남겨두는 자유 돌담 (밭담 격자가 닿지 않는 해안 쪽 풍경용)
buildStoneWall(-92, 22, -66, 44);
buildStoneWall(66, 60, 92, 44);
buildStoneWall(-58, -74, -22, -84);

// 감귤밭을 두르는 밭담. 네 변 중 한 곳은 터놓아야 루루가 들어갈 수 있습니다
// (돌담은 낮아 보여도 통과가 막혀 있어서, 막아두면 밭 안으로 못 들어갑니다)
//
// 제주 들판은 밭담으로 잘게 나뉜 조각보처럼 생겼습니다. 그 느낌을 내려고 밭을 하나씩
// 손으로 적지 않고, 섬 전체에 격자를 깔아 한 칸에 밭 하나씩 앉힙니다.
// 칸(PLOT_CELL)보다 밭(PLOT_SIZE)을 작게 잡은 만큼이 밭과 밭 사이의 길이 됩니다.
const PLOT_CELL = 33;    // 격자 한 칸
const PLOT_SIZE = 29;    // 밭 한 변 — 18개쯤 깔리면 걸어다닐 수 있는 땅의 약 절반이 귤밭이 됩니다
                         // (칸 33 - 밭 29 = 4만큼이 밭과 밭 사이 고샅길)
// 밭을 만들지 않고 비워두는 칸 — 루루가 시작하는 트인 마당입니다.
// 상점(동쪽)과 택배사(서쪽)가 이 한 마당을 나란히 씁니다.
const HOME_GX = 0, HOME_GZ = 1;
const ORCHARDS = [];
for (let gx = -3; gx <= 3; gx++) {
  for (let gz = -3; gz <= 3; gz++) {
    if (gx === HOME_GX && gz === HOME_GZ) continue;
    const cx = gx * PLOT_CELL + (Math.random() - 0.5) * 3;
    const cz = gz * PLOT_CELL + (Math.random() - 0.5) * 3;
    if (Math.hypot(cx, cz) > 78.5) continue;          // 밭 전체가 걸어다닐 수 있는 범위 안에 들어와야 함
    if (groundHeight(cx, cz) > 11) continue;          // 오름(화산 언덕) 꼭대기는 밭으로 덮지 않고 남겨둡니다
    ORCHARDS.push({
      x: cx, z: cz,
      w: PLOT_SIZE, h: PLOT_SIZE,
      rot: (Math.random() - 0.5) * 0.16,              // 칸마다 살짝 비뚤어야 조각보처럼 보입니다
      gap: 5.3,
      cols: 5, rows: 5,
      open: (Math.random() * 4) | 0,                  // 네 변 중 아무 데나 한 곳을 입구로 터놓기
    });
  }
}

function fieldCorners(f) {
  const c = Math.cos(f.rot), s = Math.sin(f.rot);
  const pt = (lx, lz) => [f.x + lx * c - lz * s, f.z + lx * s + lz * c];
  return [pt(-f.w / 2, -f.h / 2), pt(f.w / 2, -f.h / 2), pt(f.w / 2, f.h / 2), pt(-f.w / 2, f.h / 2)];
}

for (const f of ORCHARDS) {
  const p = fieldCorners(f);
  for (let i = 0; i < 4; i++) {
    if (i === f.open) continue;                 // 이 변은 입구로 터놓습니다
    const a = p[i], b = p[(i + 1) % 4];
    buildStoneWall(a[0], a[1], b[0], b[1]);
  }
}

// 모아둔 돌 위치를 한 번에 그리기
{
  const rock = new THREE.DodecahedronGeometry(0.35, 0);
  [[stoneSpots.light, stoneMat], [stoneSpots.dark, darkStoneMat]].forEach(([spots, mat]) => {
    const mesh = buildInstanced(rock, mat, spots, (s) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(s.rx, s.ry, s.rz);
      dummy.scale.setScalar(s.s);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

// 8-2. 돌하르방
function buildDolharubang(x, z, rotY) {
  const g = new THREE.Group();
  const y = groundHeight(x, z);
  g.position.set(x, y, z);
  g.rotation.y = rotY;

  const add = (mesh, px, py, pz) => {
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  add(new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.64, 0.3, 12), stoneMat), 0, 0.15, 0);      // 받침
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.54, 1.3, 12), stoneMat), 0, 0.95, 0);      // 몸통
  add(new THREE.Mesh(new THREE.SphereGeometry(0.46, 14, 12), stoneMat), 0, 1.95, 0);               // 머리
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.5, 0.34, 12), darkStoneMat), 0, 2.36, 0);  // 벙거지 모자
  add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), stoneMat), -0.17, 2.0, 0.38);          // 왼쪽 눈
  add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), stoneMat), 0.17, 2.0, 0.38);           // 오른쪽 눈
  add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), stoneMat), 0, 1.85, 0.45).scale.set(1, 1.3, 1.2); // 코

  // 배 위에 올린 두 손
  const armL = add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.6, 8), stoneMat), -0.34, 1.15, 0.3);
  armL.rotation.set(0.35, 0, 0.5);
  const armR = add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.6, 8), stoneMat), 0.34, 0.95, 0.3);
  armR.rotation.set(0.35, 0, -0.5);

  scene.add(g);
  obstacles.push({ x, z, r: 1.0 });
}

buildDolharubang(-8, -18, 0.4);
buildDolharubang(34, 12, -1.1);
buildDolharubang(-52, 20, 2.2);
buildDolharubang(12, 58, 3.1);

// ---------- 8-2b. 상점 「이장님의 보물창고」 (컨테이너를 묶는 끈을 파는 곳)
// 제주 돌집 그대로 — 현무암 벽에 초가지붕을 얹고, 문을 활짝 열어 안쪽 진열장이 보이게 합니다.
// 순수한 배경 오브젝트라 돌하르방처럼 모양만 만들고 장애물 목록에 등록해둡니다.
// "살 수 있는지/샀는지" 같은 상호작용 로직은 여기 두지 않고 경제(코인) 쪽(12-1c)에서 처리합니다.
// 귤나무·팽나무보다 먼저 만들어야, 나무들이 이 자리를 피해서 심어집니다.
// 귤 색은 가게 진열대(여기)와 귤나무(8-3) 양쪽에서 쓰므로 먼저 만들어 둡니다
const tangerineMat = new THREE.MeshLambertMaterial({ color: 0xf0871c });
const shopWoodMat = new THREE.MeshLambertMaterial({ color: 0x8a6038, flatShading: true });
const shopWoodDarkMat = new THREE.MeshLambertMaterial({ color: 0x5e3f24, flatShading: true });
const shopThatchMat = new THREE.MeshLambertMaterial({ color: 0xd3b97e, flatShading: true });
const shopDarkMat = new THREE.MeshLambertMaterial({ color: 0x2b1d12 });      // 문 안쪽 그늘
const shopRopeMat = new THREE.MeshLambertMaterial({ color: 0xd8a34a });
const shopLeafMat = new THREE.MeshLambertMaterial({ color: 0x4f8a3c, flatShading: true });
const shopPotMat = new THREE.MeshLambertMaterial({ color: 0xb56a3c, flatShading: true });

// 현무암 벽 무늬 — 검은 돌을 모르타르로 붙인 제주 돌담벽을 캔버스에 직접 그려 텍스처로 씁니다
function makeBasaltTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8d8b85';           // 돌 사이를 메운 회반죽
  ctx.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 6; row++) {
    const off = (row % 2) * 11;         // 벽돌처럼 한 줄씩 엇갈리게
    for (let col = -1; col < 7; col++) {
      const cx = col * 22 + off + 11, cy = row * 22 + 11;
      const g = 0x50 + ((Math.random() * 0x22) | 0);
      ctx.fillStyle = `rgb(${g},${g - 4},${g - 8})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 9.5 + Math.random() * 1.5, 8.5 + Math.random() * 1.5, Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const shopStoneMat = new THREE.MeshLambertMaterial({ map: makeBasaltTexture() });

// 지붕에 걸린 나무 간판 — 글씨는 캔버스에 그려 붙입니다
function makeSignTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c08a4e';
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = 'rgba(90, 55, 20, 0.5)';   // 나뭇결
  ctx.lineWidth = 2;
  for (let y = 12; y < 160; y += 19) {
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(y) * 3);
    ctx.bezierCurveTo(170, y - 5, 340, y + 6, 512, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#3d2410';
  ctx.textAlign = 'center';
  ctx.font = '600 34px "맑은 고딕", Malgun Gothic, sans-serif';
  ctx.fillText('제주감성소품', 256, 58);
  ctx.font = 'bold 54px "맑은 고딕", Malgun Gothic, sans-serif';
  ctx.fillText('이장님의 보물창고', 256, 122);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildShop(x, z, rotY) {
  const g = new THREE.Group();
  const y = groundHeight(x, z);
  g.position.set(x, y, z);
  g.rotation.y = rotY;   // 이 그룹 안에서는 +z 쪽이 가게 정면입니다

  const add = (mesh, px, py, pz) => {
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  const W = 4.4, D = 3.0, H = 2.6;   // 돌집 몸통 크기

  // 돌벽: 뒤 한 면 + 옆 두 면 + 정면 문 위 인방. 정면 가운데는 뚫어두어 진열장이 보입니다
  add(new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.34), shopStoneMat), 0, H / 2, -D / 2);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.34, H, D), shopStoneMat), -W / 2, H / 2, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.34, H, D), shopStoneMat), W / 2, H / 2, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.0, H, 0.34), shopStoneMat), -1.7, H / 2, D / 2);   // 정면 왼쪽 기둥
  add(new THREE.Mesh(new THREE.BoxGeometry(1.0, H, 0.34), shopStoneMat), 1.7, H / 2, D / 2);    // 정면 오른쪽 기둥
  add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.34), shopStoneMat), 0, H - 0.25, D / 2); // 문 위 인방

  // 가게 안쪽 그늘 — 문 안이 뻥 뚫려 보이지 않게 어두운 판을 세워둡니다
  add(new THREE.Mesh(new THREE.BoxGeometry(W - 0.7, H - 0.5, 0.1), shopDarkMat), 0, (H - 0.5) / 2, -D / 2 + 0.35);

  // 진열장 선반 3단과 그 위에 올린 물건들 (화분·항아리·바구니)
  for (let s = 0; s < 3; s++) {
    add(new THREE.Mesh(new THREE.BoxGeometry(W - 1.0, 0.09, 0.42), shopWoodMat), 0, 0.5 + s * 0.62, -D / 2 + 0.55);
    for (let i = -1; i <= 1; i++) {
      const px = i * 0.95 + (Math.random() - 0.5) * 0.2;
      const py = 0.55 + s * 0.62, pz = -D / 2 + 0.55;
      if (Math.random() < 0.5) {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.09, 0.2, 7), shopPotMat), px, py + 0.1, pz);
        add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), shopLeafMat), px, py + 0.3, pz);
      } else {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.26, 8), shopPotMat), px, py + 0.13, pz);
      }
    }
  }

  // 활짝 열어둔 두 짝 문 — 바깥쪽으로 젖혀 놓아 안이 들여다보입니다
  [-1, 1].forEach((side) => {
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.0, 0.1), shopWoodMat);
    const pivot = new THREE.Group();
    pivot.position.set(side * 1.2, 1.0, D / 2 + 0.05);
    pivot.rotation.y = side * -1.15;        // 안쪽 경첩을 축으로 바깥으로 열림
    door.position.x = side * 0.55;
    door.castShadow = true;
    pivot.add(door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), shopWoodDarkMat);
    knob.position.set(side * 1.0, 0, 0.08);
    pivot.add(knob);
    g.add(pivot);
  });

  // 초가지붕 — 볏짚을 두툼하게 얹은 모임지붕.
  // 8각 원뿔을 세 단으로 겹쳐 쌓으면 짚단을 층층이 올린 제주 초가처럼 도톰하게 보입니다.
  [[0.30, 3.30, 2.90, 0.75], [0.95, 2.75, 2.05, 0.70], [1.50, 1.85, 0.85, 0.75]].forEach(
    ([dy, rBot, rTop, h]) => {
      const tier = add(new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 8), shopThatchMat), 0, H + dy, 0);
      tier.scale.set(1.0, 1, 0.85);     // 집이 가로로 길어서 지붕도 앞뒤로 눌러줍니다
      tier.rotation.y = Math.PI / 8;
    }
  );
  const cap = add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), shopThatchMat), 0, H + 1.9, 0);
  cap.scale.set(1.0, 0.7, 0.85);        // 꼭대기를 둥글게 여며 마무리한 용마름

  // 지붕 앞에 매단 간판
  const sign = add(
    new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, 0.12), new THREE.MeshLambertMaterial({ map: makeSignTexture() })),
    0, H + 0.95, D / 2 + 1.15   // 지붕 처마보다 앞으로 내밀어야 글씨가 짚에 안 가립니다
  );
  sign.rotation.x = -0.18;

  // 지붕 위에 굴러다니는 귤 몇 알 (레퍼런스 그림의 그 귤들)
  [[-1.85, 0.45], [1.7, 0.3], [2.1, -0.35]].forEach(([px, pz]) => {
    add(new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), tangerineMat), px, H + 0.55, pz);
  });

  // 처마에 걸린 풍경 두 개
  [-1.5, 1.5].forEach((px) => {
    add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshLambertMaterial({ color: 0x9fc4cf })), px, H + 0.02, D / 2 + 0.35);
    const tag = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.02), new THREE.MeshLambertMaterial({ color: 0xf2ead6 })), px, H - 0.25, D / 2 + 0.35);
    tag.castShadow = false;
  });

  // 가게 앞 손수레 — 여기 위에 파는 물건(끈)과 귤 바구니를 올려둡니다
  const cart = new THREE.Group();
  cart.position.set(-2.7, 0, D / 2 + 0.2);
  cart.rotation.y = 0.35;
  const cartAdd = (mesh, px, py, pz) => {
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    cart.add(mesh);
    return mesh;
  };
  cartAdd(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 1.0), shopWoodMat), 0, 0.72, 0);         // 상판
  [[-0.7, -0.4], [0.7, -0.4], [-0.7, 0.4], [0.7, 0.4]].forEach(([px, pz]) => {
    cartAdd(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.72, 6), shopWoodDarkMat), px, 0.36, pz);
  });
  const wheel = cartAdd(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 6, 14), shopWoodDarkMat), 0.85, 0.3, 0);
  wheel.rotation.y = Math.PI / 2;
  // 귤이 담긴 바구니
  const bowl = cartAdd(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.22, 0.2, 10), shopWoodMat), -0.45, 0.88, 0);
  bowl.receiveShadow = true;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    cartAdd(new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), tangerineMat),
      -0.45 + Math.cos(a) * 0.15, 1.0, Math.sin(a) * 0.15);
  }
  g.add(cart);

  // 사기 전까지 손수레 위에 놓인 끈 뭉치 — 사고 나면 이 메쉬만 숨깁니다(visible = false)
  const ropeCoil = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 8, 20), shopRopeMat);
  ropeCoil.rotation.x = Math.PI / 2;
  ropeCoil.position.set(0.4, 0.86, 0);
  ropeCoil.castShadow = true;
  cart.add(ropeCoil);

  // 문 앞 디딤돌
  for (let i = 0; i < 3; i++) {
    const step = add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.4, 0.12, 7), stoneMat),
      (i - 1) * 0.85, 0.06, D / 2 + 1.15);
    step.rotation.y = Math.random();
  }

  scene.add(g);
  obstacles.push({ x, z, r: 2.6 });   // 가게 건물도 돌담처럼 부딪히면 못 지나갑니다
  return { group: g, ropeCoil };
}
// 루루가 시작하는 트인 마당(HOME 칸) 안, 시작 지점 바로 북쪽에 두어 처음부터 눈에 띄게 합니다.
// 시작 지점이 z=34라 가게는 -z(남쪽)를 바라봐야 정면이 보입니다.
const shop = buildShop(6, 45, Math.PI);
const SHOP_RANGE = 4.2;              // 건물이 커진 만큼 말을 걸 수 있는 거리도 넓힙니다
buildDolharubang(2.2, 45.4, Math.PI);   // 가게를 지키는 돌하르방 (손수레 반대편에 세워 겹치지 않게)

// ---------- 8-2c. 택배사 「제주택배 : 이장님네 분소」
// 녹슨 함석(골함석)으로 지은 시골 택배 창고입니다. 가득 찬 귤 상자를 여기까지 끌고 오면
// 육지로 부칠 수 있습니다. 상점과 마찬가지로 모양만 만들고, 배송 처리는 12-1d에서 합니다.
const depotTinDarkMat = new THREE.MeshLambertMaterial({ color: 0x6a7276, flatShading: true });
const depotWoodMat = new THREE.MeshLambertMaterial({ color: 0x9a7748, flatShading: true });
const depotBoxMat = new THREE.MeshLambertMaterial({ color: 0xc79a63 });
const depotDarkMat = new THREE.MeshLambertMaterial({ color: 0x241c16 });
const truckBodyMat = new THREE.MeshLambertMaterial({ color: 0xe8e6e0, flatShading: true });
const truckGlassMat = new THREE.MeshLambertMaterial({ color: 0x4a6a72 });
const tireMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2c });

// 골함석 무늬 — 세로 골이 파인 함석판에 녹이 번진 모습을 캔버스에 그립니다
function makeTinTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8d9aa0';
  ctx.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 8) {          // 세로로 반복되는 골
    ctx.fillStyle = 'rgba(40, 55, 62, 0.28)';
    ctx.fillRect(x, 0, 3, 128);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fillRect(x + 4, 0, 2, 128);
  }
  for (let i = 0; i < 26; i++) {              // 녹슨 얼룩
    ctx.fillStyle = `rgba(150, ${70 + Math.random() * 30 | 0}, 30, ${0.18 + Math.random() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * 128, Math.random() * 128,
      4 + Math.random() * 13, 3 + Math.random() * 9, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const depotTinMat = new THREE.MeshLambertMaterial({ map: makeTinTexture() });

// 택배사 간판 — 상호와 배달문의 전화번호
function makeDepotSignTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 200;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#cfa76d';
  ctx.fillRect(0, 0, 512, 200);
  ctx.strokeStyle = 'rgba(95, 60, 25, 0.42)';
  ctx.lineWidth = 2;
  for (let y = 10; y < 200; y += 21) {        // 나뭇결
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(170, y - 6, 340, y + 7, 512, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#3b2410';
  ctx.textAlign = 'center';
  ctx.font = '600 30px "맑은 고딕", Malgun Gothic, sans-serif';
  ctx.fillText('제주택배 :', 256, 52);
  ctx.font = 'bold 58px "맑은 고딕", Malgun Gothic, sans-serif';
  ctx.fillText('이장님네 분소', 256, 118);
  ctx.font = '500 26px "맑은 고딕", Malgun Gothic, sans-serif';
  ctx.fillText('배달문의 : 064-XXX-XXXX', 256, 165);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 「제주감귤」이라고 인쇄된 골판지 상자 겉면
function makeParcelTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c9a06a';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(120, 80, 40, 0.5)';   // 상자 테두리
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, 122, 122);
  ctx.fillStyle = '#f0871c';                    // 귤 그림
  [[30, 40], [98, 44]].forEach(([x, y]) => {
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = '#5a3a18';
  ctx.textAlign = 'center';
  ctx.font = 'bold 26px "맑은 고딕", Malgun Gothic, sans-serif';
  ctx.fillText('제주감귤', 64, 88);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const parcelMat = new THREE.MeshLambertMaterial({ map: makeParcelTexture() });

function buildDepot(x, z, rotY) {
  const g = new THREE.Group();
  const y = groundHeight(x, z);
  g.position.set(x, y, z);
  g.rotation.y = rotY;   // 이 그룹 안에서는 +z 쪽이 택배사 정면입니다

  const add = (mesh, px, py, pz, parent) => {
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    (parent || g).add(mesh);
    return mesh;
  };

  const W = 7.2, D = 5.0, H = 4.0;   // 창고라 상점보다 훨씬 큽니다

  // 함석 벽 — 뒤·양옆은 막고, 정면은 왼쪽(창고 입구)과 오른쪽(사무실 창)만 남기고 채웁니다
  add(new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.2), depotTinMat), 0, H / 2, -D / 2);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.2, H, D), depotTinMat), -W / 2, H / 2, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.2, H, D), depotTinMat), W / 2, H / 2, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(W, 1.5, 0.2), depotTinMat), 0, H - 0.75, D / 2);   // 정면 윗부분(간판이 붙는 면)
  add(new THREE.Mesh(new THREE.BoxGeometry(1.4, H - 1.5, 0.2), depotTinMat), 0, (H - 1.5) / 2, D / 2);       // 가운데 문 기둥
  add(new THREE.Mesh(new THREE.BoxGeometry(0.5, H - 1.5, 0.2), depotTinMat), -W / 2 + 0.25, (H - 1.5) / 2, D / 2);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.6, H - 1.5, 0.2), depotTinMat), W / 2 - 0.8, (H - 1.5) / 2, D / 2);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.2), depotTinMat), 1.6, H - 2.0, D / 2);               // 창문 위 벽

  // 안쪽 어둠 (뻥 뚫려 보이지 않게)
  add(new THREE.Mesh(new THREE.BoxGeometry(W - 0.5, H - 0.5, 0.1), depotDarkMat), 0, (H - 0.5) / 2, -D / 2 + 0.25);

  // 살짝 기울어진 함석 지붕
  const roof = add(new THREE.Mesh(new THREE.BoxGeometry(W + 0.9, 0.16, D + 0.9), depotTinMat), 0, H + 0.25, 0);
  roof.rotation.x = -0.06;
  add(new THREE.Mesh(new THREE.BoxGeometry(W + 0.9, 0.3, 0.16), depotTinDarkMat), 0, H + 0.36, (D + 0.9) / 2);

  // 간판
  const sign = add(
    new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.35, 0.1), new THREE.MeshLambertMaterial({ map: makeDepotSignTexture() })),
    1.2, H - 0.72, D / 2 + 0.14
  );
  sign.rotation.z = 0.015;   // 오래된 간판이라 살짝 삐뚤게

  // 가운데 출입문 차양 (양철 처마)
  const awning = add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 1.3), depotTinMat), -0.7, 2.75, D / 2 + 0.6);
  awning.rotation.x = 0.22;
  [-2.2, 0.8].forEach((px) => {
    const brace = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), depotWoodMat), px, 2.2, D / 2 + 1.1);
    brace.rotation.x = -0.4;
  });

  // 가운데 방충망 문 (안이 살짝 비치는 어두운 판)
  add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.4, 0.06), depotDarkMat), -0.7, 1.2, D / 2 + 0.02);
  [-1.5, 0.1].forEach((px) => {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.4, 0.12), depotWoodMat), px, 1.2, D / 2 + 0.06);
  });

  // 왼쪽 창고 입구 — 위로 걷어올린 나무 셔터와, 그 안에 쌓인 상자들
  add(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.45, 0.24), depotWoodMat), -2.5, H - 1.85, D / 2 + 0.06);
  add(new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.9, 0.08), depotDarkMat), -2.5, 1.0, D / 2 - 0.02);
  for (let i = 0; i < 5; i++) {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.5), parcelMat),
      -3.3 + (i % 3) * 0.72, 0.3 + ((i / 3) | 0) * 0.54, D / 2 - 0.35);
  }

  // 오른쪽 사무실 창 + 안에 보이는 책상·서류함
  add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.4, 0.06), truckGlassMat), 1.6, 1.9, D / 2 + 0.02);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.4, 0.1), depotWoodMat), 1.6, 1.9, D / 2 + 0.06);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.5), depotTinDarkMat), 1.6, 0.9, D / 2 - 0.5);   // 서류함

  // 벽에 걸린 우편함
  add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.3), depotTinDarkMat), -3.9, 2.3, D / 2 + 0.15);

  // 마당에 쌓아둔 감귤 상자 더미 (팔레트 위 + 바닥에 흩어진 것)
  const stack = (bx, bz, cols, rows, layers) => {
    for (let L = 0; L < layers; L++) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const b = add(new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.56, 0.62), parcelMat),
            bx + c * 0.82, 0.3 + L * 0.58, bz + r * 0.66);
          b.rotation.y = (Math.random() - 0.5) * 0.12;   // 손으로 쌓아서 조금씩 삐뚤
        }
      }
    }
  };
  stack(-6.4, D / 2 + 1.2, 3, 2, 3);    // 왼쪽 큰 더미
  stack(-2.2, D / 2 + 2.4, 2, 1, 2);    // 문 앞 작은 더미
  stack(0.4, D / 2 + 3.4, 2, 1, 1);

  // 바닥에 굴러다니는 귤 몇 알
  for (let i = 0; i < 6; i++) {
    add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), tangerineMat),
      -4.5 + Math.random() * 3.5, 0.16, D / 2 + 3.6 + Math.random() * 1.2);
  }

  // 마당에 세워둔 낡은 1톤 트럭 (짐칸에 상자를 실어 육지로 나갑니다)
  const truck = new THREE.Group();
  truck.position.set(5.6, 0, D / 2 + 1.6);
  truck.rotation.y = -0.25;
  const tAdd = (m, px, py, pz) => add(m, px, py, pz, truck);
  tAdd(new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.25, 1.75), truckBodyMat), 0, 1.25, 1.0);      // 운전실
  tAdd(new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.7, 0.1), truckGlassMat), 0, 1.5, 1.9);       // 앞유리
  tAdd(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.35, 3.0), truckBodyMat), 0, 0.62, -0.3);      // 차대
  tAdd(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 2.0), depotTinDarkMat), 0, 1.05, -0.9);   // 짐칸 바닥틀
  [[0, -1.9, 0.55], [-1.0, -0.9, 0.0], [1.0, -0.9, 0.0]].forEach(([px, pz, _]) => {              // 짐칸 옆판
    const panel = tAdd(new THREE.Mesh(new THREE.BoxGeometry(px === 0 ? 2.0 : 0.1, 0.6, px === 0 ? 0.1 : 2.0), truckBodyMat), px, 1.55, pz);
    panel.receiveShadow = true;
  });
  for (let i = 0; i < 3; i++) {                                                                   // 짐칸에 실린 상자
    tAdd(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.52, 0.58), parcelMat), -0.55 + i * 0.6, 1.58, -0.9);
  }
  [[-0.95, 1.15], [0.95, 1.15], [-0.95, -1.35], [0.95, -1.35]].forEach(([px, pz]) => {
    const w = tAdd(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.28, 12), tireMat), px, 0.42, pz);
    w.rotation.z = Math.PI / 2;
  });
  g.add(truck);

  scene.add(g);
  obstacles.push({ x, z, r: 4.6 });                                  // 건물
  obstacles.push({                                                   // 트럭도 부딪히면 못 지나갑니다
    x: x + (5.6 * Math.cos(rotY) + (D / 2 + 1.6) * Math.sin(rotY)),
    z: z + (-5.6 * Math.sin(rotY) + (D / 2 + 1.6) * Math.cos(rotY)),
    r: 1.9,
  });
  return { group: g, truck };
}
// 시작 마당의 서쪽, 상점(6,45) 바로 옆에 나란히 세웁니다.
// 상점과 14미터 떨어져 있어 F키 인식 범위(상점 4.2 + 택배사 6.5)가 서로 겹치지 않습니다.
const depot = buildDepot(-8, 46, Math.PI);   // 상점과 똑같이 남쪽(-z)을 바라보게
const DEPOT_RANGE = 6.5;   // 이 거리 안에서 F를 누르면 배송할 수 있습니다

// 8-3. 감귤나무 (밭담 안에 줄지어 심는 귤밭)
// 귤은 나무마다 따로 만들면 수백 개가 되어 느려지므로, 위치만 모아뒀다가
// 마지막에 InstancedMesh(같은 모양을 한 번에 여러 개 그리는 방식)로 한꺼번에 그립니다.
const citrusTrunkMat = new THREE.MeshLambertMaterial({ color: 0x6f5540, flatShading: true });
const citrusLeafMat = new THREE.MeshLambertMaterial({ color: 0x336b33, flatShading: true });
const fruitSpots = [];

// 나무 한 그루도 줄기 1 + 잎덩이 5 = 메시 6개입니다. 500그루면 3000개가 되어 화면이 멈춥니다.
// 그래서 나무를 만들 때는 모양을 바로 만들지 않고 "어디에 어떤 크기로 놓을지"만 아래 두 목록에
// 적어두었다가, 밭을 다 심은 뒤 InstancedMesh 두 개로 한꺼번에 그립니다 (그리기 명령 2번으로 끝).
const trunkSpots = [];
const leafSpots = [];

function buildTangerineTree(x, y, z) {
  const treeRotY = Math.random() * Math.PI * 2;

  const trunkH = 1.4 + Math.random() * 0.4;
  trunkSpots.push({ x, y, z, h: trunkH, rot: treeRotY });

  // 잎: 팽나무와 달리 둥글고 낮게 퍼지는 모양
  // 잎덩이 5개의 위치·반지름을 먼저 기억해둡니다 — 귤은 반드시 이 잎덩이들의 "실제 겉면"에만 심습니다.
  // (예전엔 잎과 상관없는 이상적인 구 표면에 귤을 흩뿌려서, 잎이 없는 빈 공간에 귤이 붕 떠 보이거나
  //  반대로 잎 속에 파묻혀 안 보이는 자리에도 귤이 "있는 척"하는 경우가 있었습니다)
  const R = 1.45 + Math.random() * 0.3;
  const cy = trunkH + R * 0.5;
  const rotC = Math.cos(treeRotY), rotS = Math.sin(treeRotY);
  const leafBlobs = [];
  for (let i = 0; i < 5; i++) {
    const br = R * (0.6 + Math.random() * 0.3);
    const bx = (Math.random() - 0.5) * R * 1.15;
    const by = cy + (Math.random() - 0.5) * R * 0.45;
    const bz = (Math.random() - 0.5) * R * 1.15;
    leafBlobs.push({ x: bx, y: by, z: bz, r: br });
    leafSpots.push({
      x: x + bx * rotC + bz * rotS,   // 나무 회전만큼 돌려서 월드 좌표로
      y: y + by,
      z: z - bx * rotS + bz * rotC,
      r: br,
    });
  }

  // 귤: 잎덩이 중 하나를 골라 그 겉면(살짝 바깥쪽)에만 심습니다 → 눈에 보이는 잎이 있는 자리에만 귤이 생깁니다
  // 나무 전체가 랜덤 각도(treeRotY)로 돌아가 있으므로, 잎덩이의 로컬 좌표를 그 각도만큼
  // 직접 회전시켜야 실제로 화면에 그려지는 잎의 월드 위치와 정확히 일치합니다.
  const n = 8 + ((Math.random() * 5) | 0);
  for (let i = 0; i < n; i++) {
    const b = leafBlobs[(Math.random() * leafBlobs.length) | 0];
    const a = Math.random() * Math.PI * 2;
    const p = Math.acos(1 - Math.random() * 1.3);   // 위쪽보다 옆·아래에 더 많이 달리게
    const rr = b.r * (0.94 + Math.random() * 0.1);  // 잎덩이 겉면 반지름 (가로/세로 방향)
    const lx = b.x + Math.sin(p) * Math.cos(a) * rr;   // 잎덩이 로컬 좌표 기준의 귤 위치
    const lz = b.z + Math.sin(p) * Math.sin(a) * rr;
    fruitSpots.push({
      x: x + lx * rotC + lz * rotS,                  // 나무 회전만큼 같이 돌려서 월드 좌표로
      y: y + b.y + Math.cos(p) * rr * 0.78,           // 잎덩이는 세로로만 0.78배 눌려있어서 y에만 곱해줌
      z: z - lx * rotS + lz * rotC,
      s: 0.75 + Math.random() * 0.4,
      picked: false,   // 따 먹으면 true — 인스턴스를 숨기고 다시는 안 딸 수 있게
    });
  }

  obstacles.push({ x, z, r: 0.55 });
}

for (const f of ORCHARDS) {
  const c = Math.cos(f.rot), s = Math.sin(f.rot);
  for (let i = 0; i < f.cols; i++) {
    for (let j = 0; j < f.rows; j++) {
      const lx = (i - (f.cols - 1) / 2) * f.gap + (Math.random() - 0.5) * 0.9;
      const lz = (j - (f.rows - 1) / 2) * f.gap + (Math.random() - 0.5) * 0.9;
      const x = f.x + lx * c - lz * s;
      const z = f.z + lx * s + lz * c;
      const y = groundHeight(x, z);
      if (y < 1.5) continue;                  // 바닷가 모래밭에는 안 심습니다
      // 밭담·돌하르방처럼 이미 자리를 차지한 것 위에는 겹쳐 심지 않습니다
      let blocked = false;
      for (const o of obstacles) {
        if (Math.hypot(o.x - x, o.z - z) < o.r + 1.1) { blocked = true; break; }
      }
      if (blocked) continue;
      buildTangerineTree(x, y, z);
    }
  }
}

// 모아둔 줄기·잎덩이·귤을 각각 한 번에 그리기
{
  // 줄기: 높이 1짜리를 기준으로 만들어두고, 나무마다 세로로만 늘려 씁니다
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.26, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const trunkMesh = buildInstanced(trunkGeo, citrusTrunkMat, trunkSpots, (s) => {
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(0, s.rot, 0);
    dummy.scale.set(1, s.h, 1);
  });
  trunkMesh.castShadow = true;

  // 잎덩이: 반지름 1짜리를 기준으로 만들어두고, 덩이마다 크기를 곱해 씁니다 (세로만 0.78배로 눌림)
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);
  const leafMesh = buildInstanced(leafGeo, citrusLeafMat, leafSpots, (s) => {
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.scale.set(s.r, s.r * 0.78, s.r);
  });
  leafMesh.castShadow = true;
}

let fruitMesh;
{
  const fruit = new THREE.SphereGeometry(0.17, 8, 6);
  fruitMesh = buildInstanced(fruit, tangerineMat, fruitSpots, (s) => {
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(s.s);
  });
  fruitMesh.castShadow = true;
}

// 귤 하나를 따서 숨긴다 (스케일을 0으로 만드는 방식 — 인스턴스는 개수를 못 줄이므로 이렇게 감춤)
function hideFruit(i) {
  const s = fruitSpots[i];
  s.picked = true;
  dummy.position.set(s.x, s.y, s.z);
  dummy.rotation.set(0, 0, 0);
  dummy.scale.setScalar(0);
  dummy.updateMatrix();
  fruitMesh.setMatrixAt(i, dummy.matrix);
  fruitMesh.instanceMatrix.needsUpdate = true;
}

// 8-4. 팽나무 (바람에 한쪽으로 쏠린 제주 들판 나무)
function buildTree(x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.z = (Math.random() - 0.5) * 0.25;   // 바람에 기울어진 느낌

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.42, 3.4, 8),
    new THREE.MeshLambertMaterial({ color: 0x6b513a, flatShading: true })
  );
  trunk.position.y = 1.7;
  trunk.castShadow = true;
  g.add(trunk);

  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f7a3a, flatShading: true });
  for (let i = 0; i < 6; i++) {
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0 + Math.random() * 0.5, 0), leafMat);
    blob.position.set(
      (Math.random() - 0.5) * 2.6,
      3.3 + Math.random() * 1.0,
      (Math.random() - 0.5) * 2.6
    );
    blob.scale.y = 0.68;
    blob.castShadow = true;
    g.add(blob);
  }
  scene.add(g);
  obstacles.push({ x, z, r: 0.7 });
}
// 돌담·귤나무·상점 위에 겹쳐 심지 않도록, 이미 뭔가 있는 자리는 건너뜁니다.
// 상점처럼 덩치가 큰 것(o.r이 큰 것) 앞은 더 넓게 비워야 건물이 가려지지 않습니다.
scatter(16, ISLAND_R - 26, 2.5, (x, y, z) => {
  for (const o of obstacles) {
    if (Math.hypot(o.x - x, o.z - z) < o.r + 4.5) return;
  }
  buildTree(x, y, z);
});

// ---------- 9. 구름과 나비 ----------
const clouds = [];
{
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, fog: false });
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group();
    const n = 4 + ((Math.random() * 4) | 0);
    for (let j = 0; j < n; j++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(4 + Math.random() * 4, 1), cloudMat);
      puff.position.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 10);
      puff.scale.y = 0.55;
      g.add(puff);
    }
    g.position.set((Math.random() - 0.5) * 500, 55 + Math.random() * 35, (Math.random() - 0.5) * 500);
    scene.add(g);
    clouds.push(g);
  }
}

const butterflies = [];
{
  const wingGeo = new THREE.PlaneGeometry(0.3, 0.22);
  for (let i = 0; i < 14; i++) {
    const mat = new THREE.MeshLambertMaterial({
      color: Math.random() < 0.5 ? 0xfff3b0 : 0xffd0e0,
      side: THREE.DoubleSide,
    });
    const g = new THREE.Group();
    const wl = new THREE.Mesh(wingGeo, mat); wl.position.x = -0.15; g.add(wl);
    const wr = new THREE.Mesh(wingGeo, mat); wr.position.x = 0.15; g.add(wr);
    g.userData = {
      wl, wr,
      cx: (Math.random() - 0.5) * 120,
      cz: (Math.random() - 0.5) * 120,
      rad: 4 + Math.random() * 10,
      spd: 0.4 + Math.random() * 0.5,
      off: Math.random() * 10,
    };
    scene.add(g);
    butterflies.push(g);
  }
}

// ---------- 10. 루루 만들기 ----------
const CREAM = new THREE.MeshLambertMaterial({ color: 0xf6ebd8 });
const ORANGE = new THREE.MeshLambertMaterial({ color: 0xe09a52 });
const PINK = new THREE.MeshLambertMaterial({ color: 0xef9aa6 });
const DARK = new THREE.MeshLambertMaterial({ color: 0x2b2622 });
const WHITE = new THREE.MeshBasicMaterial({ color: 0xffffff });

const lulu = new THREE.Group();          // 월드 위치 / 바라보는 방향
const luluBody = new THREE.Group();      // 걸을 때 위아래 흔들림, 앉는 자세
lulu.add(luluBody);
scene.add(lulu);

function part(geo, mat, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  (parent || luluBody).add(m);
  return m;
}

// 몸통 (+Z 방향이 루루의 앞쪽입니다)
const torso = part(new THREE.CapsuleGeometry(0.36, 0.62, 6, 14), CREAM, 0, 0.74, 0);
torso.rotation.x = Math.PI / 2;

// 등에 있는 주황 줄무늬
for (let i = 0; i < 3; i++) {
  const s = part(new THREE.SphereGeometry(0.15, 10, 8), ORANGE, 0, 1.02, 0.24 - i * 0.26);
  s.scale.set(1.5, 0.35, 0.55);
}

// 머리
const head = new THREE.Group();
head.position.set(0, 1.04, 0.6);
luluBody.add(head);
part(new THREE.SphereGeometry(0.34, 16, 14), CREAM, 0, 0, 0, head);
part(new THREE.SphereGeometry(0.3, 14, 12), ORANGE, 0, 0.14, -0.06, head).scale.set(1.02, 0.62, 0.9); // 머리 위 주황 무늬
part(new THREE.SphereGeometry(0.2, 12, 10), CREAM, 0, -0.09, 0.26, head).scale.set(1.25, 0.85, 1);    // 주둥이
part(new THREE.SphereGeometry(0.055, 8, 6), PINK, 0, -0.03, 0.41, head);                              // 코

// 귀 (겉 + 안쪽 분홍)
[-1, 1].forEach((side) => {
  const ear = part(new THREE.ConeGeometry(0.16, 0.3, 5), ORANGE, side * 0.19, 0.32, -0.02, head);
  ear.rotation.set(-0.2, 0, side * 0.28);
  part(new THREE.ConeGeometry(0.09, 0.2, 5), PINK, 0, -0.01, 0.06, ear);
});

// 눈
[-1, 1].forEach((side) => {
  const eye = part(new THREE.SphereGeometry(0.075, 10, 8), DARK, side * 0.15, 0.05, 0.28, head);
  part(new THREE.SphereGeometry(0.028, 6, 5), WHITE, side * 0.02, 0.03, 0.06, eye);
});

// 다리 4개 (엉덩이/어깨에 회전축을 두고 앞뒤로 흔듭니다)
const legs = [];
[[-0.21, 0.4], [0.21, 0.4], [-0.21, -0.36], [0.21, -0.36]].forEach(([lx, lz]) => {
  const pivot = new THREE.Group();
  pivot.position.set(lx, 0.52, lz);
  luluBody.add(pivot);
  const leg = part(new THREE.CapsuleGeometry(0.1, 0.26, 4, 8), CREAM, 0, -0.2, 0, pivot);
  part(new THREE.SphereGeometry(0.12, 10, 8), CREAM, 0, -0.19, 0.03, leg).scale.set(1, 0.75, 1.2); // 발
  legs.push(pivot);
});

// 꼬리 (마디를 이어 붙여 흔들리게)
const tailSegs = [];
{
  let parent = luluBody;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.92 : 0, i === 0 ? -0.52 : -0.19);
    parent.add(seg);
    part(new THREE.CapsuleGeometry(0.095 - i * 0.008, 0.14, 4, 8), i >= 4 ? ORANGE : CREAM, 0, 0, -0.09, seg)
      .rotation.x = Math.PI / 2;
    tailSegs.push(seg);
    parent = seg;
  }
}

// ---------- 10-2. 그림으로 된 루루 (참고 영상에서 뽑은 스프라이트) ----------
// 3D 입체 대신, 그림 한 장을 세워두고 항상 카메라 쪽을 보게 돌립니다.
// (종이 인형을 세워둔 것과 같은 방식이고, 2D 캐릭터를 3D 배경에 넣을 때 흔히 쓰는 방법입니다)
const spriteLulu = new THREE.Group();      // 위치 + 카메라 쪽으로 돌아가는 회전
const spriteBoard = new THREE.Group();     // 걸을 때 위아래로 통통 튀는 부분
spriteLulu.add(spriteBoard);
scene.add(spriteLulu);

let spriteCard = null;                     // 그림이 붙은 판
let spriteBlob = null;                     // 발밑 그림자
const SPRITE_H = 1.5;                      // 화면에 보이는 루루 키(월드 단위)

// assets/farmcat/ 스프라이트 시트. 한 장에 여러 칸이 가로로 이어붙어 있습니다.
// 칸 높이는 전부 256이고 위아래 8px이 여백이라, 캐릭터는 240px, 발바닥은 아래에서 8px 지점.
const CELL_H = 256, CELL_PAD = 8;
const SHEETS = {};

// stand = 멈췄을 때 쓸 칸 (두 발이 가장 모인 자세), leap = 점프 중에 쓸 칸 (다리가 가장 벌어진 자세)
function loadSheet(key, file, frames, frameW, stand, leap) {
  const t = loadTexture('../assets/farmcat/' + file);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;               // 칸 경계에서 옆 칸 색이 번지는 것을 막습니다
  t.minFilter = THREE.LinearFilter;
  t.repeat.set(1 / frames, 1);             // 가로로 1/frames 만큼만 잘라 보여줍니다
  SHEETS[key] = { tex: t, frames, frameW, stand, leap };
}

// 그림 한 칸을 골라 보여주기
function setCell(sheet, i) {
  sheet.tex.offset.x = (((i % sheet.frames) + sheet.frames) % sheet.frames) / sheet.frames;
}

// 1→N→1 로 갔다 되돌아오는 번호 (대기·만세처럼 주기가 없는 동작용)
function pingpong(i, n) {
  const m = (n - 1) * 2;
  const k = ((i % m) + m) % m;
  return k < n ? k : m - k;
}

if (CAN_USE_IMAGES) {
  loadSheet('idle',      'idle_front.png', 8,  212);          // 서 있기 (정면)
  loadSheet('walkSide',  'walk_side.png',  10, 208, 6, 8);    // 걷기 (옆모습, 원본은 왼쪽을 봄)
  loadSheet('walkBack',  'walk_back.png',  10, 195, 3, 4);    // 걷기 (뒷모습)
  loadSheet('walkFront', 'walk_front.png', 10, 198, 4, 5);    // 걷기 (카메라를 마주 보고 다가올 때)
  loadSheet('cheer',     'cheer.png',      8,  192);          // 만세 (카메라를 보고 점프할 때)
  loadSheet('sleep',     'sleep.png',      8,  299);          // 낮잠 (오래 가만히 있으면)
  loadSheet('harvest',   'harvest.png',   10,  181);          // 감귤 따기 (F키로 딸 때, 한 번만 재생)
  loadSheet('pullSide',  'pull_side.png', 10,  255);          // 끈 없이 상자를 몸으로 밀어 끌 때 (옆모습, 원본은 왼쪽을 봄)

  // 판은 1x1 로 만들고, 어느 그림을 쓰느냐에 따라 매 프레임 크기를 바꿉니다.
  // 아래쪽 끝을 기준점으로 옮겨두면 세로로 늘였다 줄여도 발이 땅에서 안 떨어집니다.
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);

  spriteCard = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({          // 그림 색을 그대로 살리려고 빛 계산을 하지 않는 재질
      map: SHEETS.idle.tex,
      transparent: true,
      alphaTest: 0.08,                     // 거의 투명한 가장자리는 아예 안 그림
    })
  );
  spriteCard.userData.sheet = SHEETS.idle;
  spriteCard.userData.headingRight = false;
  // 칸 높이 전체(256) 중 캐릭터는 240이므로 그만큼 키워야 실제 키가 SPRITE_H가 됩니다
  spriteCard.userData.planeH = SPRITE_H * CELL_H / (CELL_H - CELL_PAD * 2);
  // 칸 아래 여백(8px)만큼 판을 내려서 발바닥이 y=0 에 오게 합니다
  spriteCard.position.y = -(CELL_PAD / CELL_H) * spriteCard.userData.planeH;
  spriteBoard.add(spriteCard);

  // 발밑 그림자 (그림 판은 카메라를 따라 돌기 때문에 진짜 그림자를 쓰면 모양이 계속 변합니다.
  //  그래서 바닥에 타원을 하나 깔아주는 쪽이 더 자연스럽습니다)
  spriteBlob = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 22),
    new THREE.MeshBasicMaterial({ color: 0x1d2b17, transparent: true, opacity: 0.4, depthWrite: false })
  );
  spriteBlob.rotation.x = -Math.PI / 2;
  scene.add(spriteBlob);
}

// 어느 쪽 루루를 보여줄지 (T 키로 전환)
let useSprite = CAN_USE_IMAGES;
function applyLuluMode() {
  lulu.visible = !useSprite;
  spriteLulu.visible = useSprite;
  if (spriteBlob) spriteBlob.visible = useSprite;
  const badge = document.getElementById('modeBadge');
  if (badge) badge.textContent = useSprite ? '🐈 루루: 그림 (T로 전환)' : '🐈 루루: 3D 모형 (T로 전환)';
}
applyLuluMode();

// 그냥 더블클릭으로 연 경우 안내문을 띄웁니다
if (!CAN_USE_IMAGES) {
  const warn = document.getElementById('fileWarn');
  if (warn) {
    warn.style.display = 'block';
    warn.addEventListener('click', () => { warn.style.display = 'none'; });
  }
}

// ---------- 11. 조작 ----------
const keys = {};
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyT' && CAN_USE_IMAGES) { useSprite = !useSprite; applyLuluMode(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

// 카메라 조작
// - 키보드: A D로 시야를 좌우로 돌리고, W S로 올려다보거나 내려다보고, Z/X로 줌
//   (이동은 방향키이므로, W A S D는 전부 "보는 방향"에만 씁니다)
// - 마우스: 드래그로 회전, 휠로 줌 — 예전 방식도 그대로 둡니다
let camYaw = 0, camPitch = 0.34, camDist = 9.5;
const CAM_TURN = 2.2;    // 초당 회전 속도(라디안). 한 바퀴 도는 데 약 3초
const CAM_PITCH = 1.1;   // 초당 올려다보기/내려다보기 속도
const CAM_ZOOM = 9.0;    // 초당 줌 속도

// 키를 누르고 있는 동안 매 프레임 조금씩 돌립니다 (톡톡 끊기지 않고 부드럽게 돕니다)
function updateCamera(dt) {
  if (keys['KeyA']) camYaw += CAM_TURN * dt;
  if (keys['KeyD']) camYaw -= CAM_TURN * dt;
  if (keys['KeyW']) camPitch -= CAM_PITCH * dt;     // W = 시선을 눕혀 멀리 보기
  if (keys['KeyS']) camPitch += CAM_PITCH * dt;     // S = 위에서 내려다보기
  if (keys['KeyZ']) camDist += CAM_ZOOM * dt;       // 멀리
  if (keys['KeyX']) camDist -= CAM_ZOOM * dt;       // 가까이
  camPitch = Math.max(0.05, Math.min(1.0, camPitch));
  camDist = Math.max(4, Math.min(22, camDist));
}

let dragging = false, lastX = 0, lastY = 0;
renderer.domElement.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  camYaw -= (e.clientX - lastX) * 0.005;
  camPitch = Math.max(0.05, Math.min(1.0, camPitch + (e.clientY - lastY) * 0.003));
  lastX = e.clientX; lastY = e.clientY;
});
addEventListener('wheel', (e) => {
  camDist = Math.max(4, Math.min(22, camDist + e.deltaY * 0.01));
}, { passive: true });

// ---------- 11-2. 손가락 조작 (폰·태블릿) ----------
// 폰에는 키보드가 없으니 화면을 반으로 나눠 씁니다.
//   왼쪽 절반 : 누른 자리에 조이스틱이 생기고, 끄는 방향으로 루루가 걸어갑니다
//   오른쪽 절반: 손가락을 끌면 시야가 돌아갑니다 (마우스 드래그와 같은 역할)
//   두 손가락으로 벌리고 오므리면 줌
// 손가락 여러 개를 동시에 쓰므로, 어느 손가락이 무슨 역할인지 번호(identifier)로 기억해둡니다.
const touchMove = { f: 0, r: 0 };     // 조이스틱이 만들어내는 앞뒤(f)·좌우(r) 입력 (-1 ~ 1)
let touchJump = false, touchRun = false;   // 화면 버튼을 누르고 있는 동안 true
let stickId = null, stickX = 0, stickY = 0;    // 이동용 손가락
let lookId = null, lookX = 0, lookY = 0;       // 시야용 손가락
let pinchDist = 0;                             // 줌용 두 손가락 사이 거리
const STICK_MAX = 55;                          // 이만큼 끌면 최대 속도 (화면 픽셀)

const stickBase = document.getElementById('stickBase');
const stickKnob = document.getElementById('stickKnob');

function showStick(on, bx, by, kx, ky) {
  if (!stickBase) return;
  stickBase.style.display = on ? 'block' : 'none';
  stickKnob.style.display = on ? 'block' : 'none';
  if (!on) return;
  stickBase.style.left = bx + 'px'; stickBase.style.top = by + 'px';
  stickKnob.style.left = kx + 'px'; stickKnob.style.top = ky + 'px';
}

function handleTouchStart(e) {
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth * 0.5 && stickId === null) {
      stickId = t.identifier; stickX = t.clientX; stickY = t.clientY;
      showStick(true, stickX, stickY, stickX, stickY);
    } else if (lookId === null) {
      lookId = t.identifier; lookX = t.clientX; lookY = t.clientY;
    }
  }
  if (e.touches.length === 2) {
    pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                           e.touches[0].clientY - e.touches[1].clientY);
  }
}

function handleTouchMove(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === stickId) {
      // 처음 누른 자리에서 얼마나 끌었는지를 그대로 걷는 방향으로 씁니다
      let dx = t.clientX - stickX, dy = t.clientY - stickY;
      const d = Math.hypot(dx, dy);
      if (d > STICK_MAX) { dx *= STICK_MAX / d; dy *= STICK_MAX / d; }
      touchMove.r = dx / STICK_MAX;
      touchMove.f = -dy / STICK_MAX;          // 화면 위로 끌면 앞으로
      showStick(true, stickX, stickY, stickX + dx, stickY + dy);
    } else if (t.identifier === lookId) {
      camYaw -= (t.clientX - lookX) * 0.006;
      camPitch = Math.max(0.05, Math.min(1.0, camPitch + (t.clientY - lookY) * 0.004));
      lookX = t.clientX; lookY = t.clientY;
    }
  }
  if (e.touches.length === 2 && pinchDist > 0) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                         e.touches[0].clientY - e.touches[1].clientY);
    camDist = Math.max(4, Math.min(22, camDist - (d - pinchDist) * 0.05));
    pinchDist = d;
  }
  e.preventDefault();   // 손가락을 끌 때 화면이 같이 스크롤되지 않게
}

function handleTouchEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === stickId) { stickId = null; touchMove.f = 0; touchMove.r = 0; showStick(false); }
    else if (t.identifier === lookId) lookId = null;
  }
  if (e.touches.length < 2) pinchDist = 0;
}

if (IS_TOUCH) {
  const c = renderer.domElement;
  c.addEventListener('touchstart', handleTouchStart, { passive: false });
  c.addEventListener('touchmove', handleTouchMove, { passive: false });
  c.addEventListener('touchend', handleTouchEnd);
  c.addEventListener('touchcancel', handleTouchEnd);
  document.body.classList.add('touch');   // 화면의 버튼들이 이때만 보이게
}

// 화면 버튼: 누르고 있는 동안 키를 누른 것과 똑같이 처리합니다.
// (점프처럼 한 번만 반응하는 것도 keys를 켜주면 게임 쪽 코드가 알아서 처리합니다)
function bindTouchButton(id, onPress) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.classList.add('on'); onPress(true); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) =>
    el.addEventListener(ev, () => { el.classList.remove('on'); onPress(false); }));
}

// ---------- 12. 루루 상태 ----------
const state = {
  // 시작 위치. 카메라는 루루보다 9미터쯤 뒤에 서므로, 상점(6,45)에 너무 붙여 두면
  // 게임을 켜자마자 카메라가 가게 간판 속에 박혀 화면이 나무판으로 가려집니다.
  x: 6, z: 28,
  vy: 0,
  onGround: true,
  facing: Math.PI,
  walkPhase: 0,
  speed: 0,      // 0~1, 애니메이션 세기
  idleTime: 0,
  sit: 0,        // 0 = 서 있음, 1 = 앉음
  harvestT: -1,  // 0 이상이면 감귤 따는 애니메이션 재생 중 (초 단위로 증가)
  grabbing: false, // true면 상자를 직접 손으로 잡고 있는 중 (E키로 잡기/놓기)
};
lulu.position.set(state.x, groundHeight(state.x, state.z), state.z);
camera.position.set(state.x, 8, state.z + 12);

// ---------- 12-1. 감귤 따기 (F키) ----------
const HARVEST_RANGE = 2.0;     // 이 거리 안의 귤만 딸 수 있음
const HARVEST_DURATION = 0.6;  // 애니메이션 길이(초). 이 동안은 못 움직임
let coins = 0;
let hasRope = false;              // 상점에서 끈을 샀는지 — 사면 컨테이너가 자동으로 따라오게 바뀝니다
const ROPE_PRICE = 100000;
const coinBadge = document.getElementById('coinBadge');
const ropeBadge = document.getElementById('ropeBadge');
const boxBadge = document.getElementById('boxBadge');
function updateCoinBadge() {
  if (coinBadge) coinBadge.textContent = `🍊 ${coins.toLocaleString()}원`;
}
// 상자에 귤이 몇 개 담겼는지 (가득 차면 색이 바뀌어 배송할 때가 됐음을 알립니다)
// basketCount·BASKET_CAP은 아래 12-1b에서 만들어지지만, 이 함수는 그 뒤에야 불리므로 괜찮습니다.
function updateBasketBadge() {
  if (!boxBadge) return;
  const full = basketCount >= BASKET_CAP;
  boxBadge.textContent = full
    ? `📦 상자 가득! ${basketCount}/${BASKET_CAP} — 택배사로 가져가세요`
    : `📦 상자 ${basketCount}/${BASKET_CAP}`;
  boxBadge.classList.toggle('full', full);
}
// 상자(basketPos)와 잡기 범위(GRAB_RANGE)는 아래 12-1b에서 정의되므로,
// 이 배지 내용은 그쪽 값들이 다 준비된 뒤(매 프레임 updateBasket 안에서) 갱신합니다.
function updateRopeBadge() {
  if (!ropeBadge) return;
  if (hasRope) {
    ropeBadge.textContent = '🪢 끈으로 편하게 끄는 중';
  } else if (state.grabbing) {
    ropeBadge.textContent = '🤝 상자를 잡고 끄는 중 (E로 놓기)';
  } else {
    const dist = Math.hypot(basketPos.x - state.x, basketPos.z - state.z);
    ropeBadge.textContent = dist < GRAB_RANGE
      ? '📦 E를 누르면 상자를 잡을 수 있어요'
      : `📦 밀거나, 가까이 가서 E로 잡아 끌 수 있어요 (끈: ${ROPE_PRICE.toLocaleString()}원)`;
  }
}
updateCoinBadge();

// 화면에 잠깐 떴다 사라지는 "+1000원" 표시. 3D 좌표를 화면 좌표로 투영해서
// 일반 HTML 글자로 띄우는 방식이라(WebGL 텍스트보다 간단), 매 프레임 위치만 갱신해주면 됩니다.
const popups = [];
function spawnMoneyPopup(worldX, worldY, worldZ, text) {
  const el = document.createElement('div');
  el.className = 'moneyPopup';
  el.textContent = text;
  document.getElementById('ui').appendChild(el);
  popups.push({ el, x: worldX, y: worldY, z: worldZ, t: 0 });
}

// ---------- 12-1a. 효과음 ----------
// 소리 파일을 따로 두지 않고, 브라우저에 들어 있는 웹 오디오로 짧은 소리를 그때그때 만들어 냅니다.
// (파일이 없으니 받을 것도, 경로가 틀릴 일도 없습니다)
//
// 브라우저는 사용자가 키를 누르거나 화면을 클릭하기 전에는 소리를 못 내게 막아둡니다.
// 그래서 첫 입력이 들어온 순간에 오디오를 깨웁니다 — 소리를 내는 순간이 곧 키를 누른 순간이라
// 아래 blip()에서 매번 깨우기만 해도 충분합니다.
let audioCtx = null;
function wakeAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;                                  // 아주 오래된 브라우저면 그냥 소리 없이 진행
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return true;
}
addEventListener('keydown', wakeAudio, { once: true });
addEventListener('mousedown', wakeAudio, { once: true });

// 짧은 소리 한 번. f0에서 f1로 음이 미끄러지며 스르르 사라집니다.
function blip(f0, f1, dur, gain, type) {
  if (!wakeAudio()) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.linearRampToValueAtTime(gain, t + 0.012);          // 아주 짧게 커졌다가
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);     // 여운을 남기며 사라짐
  osc.connect(amp).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// 귤을 딸 때: 가지에서 톡 떼어내는 맑고 높은 소리.
// 딸 때마다 음을 조금씩 다르게 해야 여러 번 따도 기계음처럼 안 들립니다.
function playPickSound() {
  const p = 0.92 + Math.random() * 0.18;
  blip(760 * p, 1420 * p, 0.09, 0.13, 'triangle');
}
// 상자에 담길 때: 나무통 바닥에 툭 떨어지는 낮고 둔한 소리
function playDropSound() {
  const p = 0.94 + Math.random() * 0.14;
  blip(300 * p, 92 * p, 0.12, 0.2, 'sine');
}
// 택배 부칠 때: 트럭이 떠나는 "빵— 빵—" 두 번 울리는 경적
function playShipSound() {
  blip(330, 320, 0.18, 0.16, 'square');
  setTimeout(() => blip(262, 255, 0.28, 0.16, 'square'), 200);
}

// 배경음악 — 직접 만드신 파일을 조용히 반복 재생합니다.
// 소리를 못 내게 막는 브라우저가 있으므로, 첫 조작이 들어온 뒤에 틀고 실패해도 게임은 그대로 돌아갑니다.
const bgm = new Audio('../assets/farmcat/lulufarmbgm.mp3');
bgm.loop = true;
bgm.volume = 0.35;      // 효과음이 묻히지 않게 배경음악은 작게
let bgmStarted = false;
function startBgm() {
  if (bgmStarted || document.hidden) return;   // 화면이 안 보이는 상태면 아예 틀지 않습니다
  bgmStarted = true;
  bgm.play().catch(() => { bgmStarted = false; });   // 막히면 다음 조작 때 다시 시도
}
addEventListener('keydown', startBgm);
addEventListener('mousedown', startBgm);

// 게임 화면이 안 보이면(다른 탭으로 넘어갔거나 창을 내렸으면) 음악을 멈춥니다.
// 이게 없으면 게임을 보고 있지 않은데도 배경음악만 계속 흘러나옵니다.
// 다시 돌아오면 껐던 게 아닌 이상 이어서 재생됩니다.
addEventListener('visibilitychange', () => {
  if (document.hidden) bgm.pause();
  else if (bgmStarted && !bgm.muted) bgm.play().catch(() => {});
});
// 창을 닫거나 다른 페이지로 넘어갈 때도 확실히 정리합니다
addEventListener('pagehide', () => { bgm.pause(); });

// M키로 배경음악을 껐다 켤 수 있습니다
const musicBadge = document.getElementById('musicBadge');
function updateMusicBadge() {
  if (musicBadge) musicBadge.textContent = bgm.muted ? '🔇 배경음악 꺼짐 (M)' : '🎵 배경음악 켜짐 (M)';
}
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM') return;
  bgm.muted = !bgm.muted;
  updateMusicBadge();
});
updateMusicBadge();

const harvestVec = new THREE.Vector3();
function updatePopups(dt) {
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.t += dt;
    if (p.t > 1.1) { p.el.remove(); popups.splice(i, 1); continue; }
    harvestVec.set(p.x, p.y + p.t * 0.9, p.z).project(camera);   // 위로 떠오르며
    p.el.style.left = ((harvestVec.x * 0.5 + 0.5) * innerWidth) + 'px';
    p.el.style.top = ((-harvestVec.y * 0.5 + 0.5) * innerHeight) + 'px';
    p.el.style.opacity = Math.max(0, 1 - p.t / 1.1);
  }
}

// 플레이어와 가장 가까운, 아직 안 딴 귤을 찾는다 (나무 높이는 대부분 손 닿는 범위라 2D 거리만 봅니다)
// 더 현실감 있게: 바로 발밑 수준으로 가깝지 않으면, 루루가 "보고 있는 방향"에 있는 귤만 손이 닿습니다.
// (등 뒤에 있는 귤을 안 보고 딸 수는 없으니까요)
function nearestFruit() {
  let best = -1, bestD = HARVEST_RANGE;
  const fwdX = Math.sin(state.facing), fwdZ = Math.cos(state.facing);
  for (let i = 0; i < fruitSpots.length; i++) {
    const s = fruitSpots[i];
    if (s.picked) continue;
    const dx = s.x - state.x, dz = s.z - state.z;
    const d = Math.hypot(dx, dz);
    if (d >= bestD) continue;
    if (d > 0.45) {
      const facingDot = (dx / d) * fwdX + (dz / d) * fwdZ;   // 1=정면, 0=옆, -1=등 뒤
      if (facingDot < 0.35) continue;                        // 대략 앞쪽 70도 안에 있어야 손이 닿음
    }
    bestD = d; best = i;
  }
  return best;
}

// 지금 손 뻗으면 딸 수 있는 귤 하나를 눈에 보이게 표시합니다 (반짝이는 고리).
// 이게 없으면 "어떤 귤을 딴 건지" 안 보여서, 딴 순간 마법처럼 코인만 생기는 느낌이 됩니다.
const targetRingMat = new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.9, depthTest: false });
const targetRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.028, 8, 20), targetRingMat);
targetRing.renderOrder = 999;
targetRing.visible = false;
scene.add(targetRing);

function updateHarvestTarget(dt, t) {
  if (state.harvestT >= 0) { targetRing.visible = false; return; }   // 따는 중엔 표식 끔
  const i = nearestFruit();
  if (i < 0) { targetRing.visible = false; return; }
  const s = fruitSpots[i];
  targetRing.visible = true;
  targetRing.position.set(s.x, s.y, s.z);
  targetRing.rotation.set(Math.PI / 2, t * 2.2, 0);           // 살짝 돌아가며 반짝이는 느낌
  const pulse = 1 + Math.sin(t * 6) * 0.12;                    // 맥박처럼 커졌다 작아졌다
  targetRing.scale.setScalar(pulse);
}

// ---------- 12-1b. 귤 바구니 — 딴 귤이 실제로 포물선을 그리며 날아가 떨어지는 통 ----------
// 루루를 항상 따라다니되(등 뒤에 위치), 걷는 방향으로 돌지는 않고 살짝 뒤에 얌전히 놓여있게 합니다.
// 실제 오렌지색 플라스틱 과일 상자(옆면에 통풍 구멍이 송송 뚫리고 가운데 손잡이 띠가 있는 모양)를
// 캔버스에 직접 그려서 텍스처로 씁니다.
function makeCrateTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e2861f';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(110, 55, 8, 0.55)';
  for (let y = 12; y < 128; y += 18) {
    for (let x = 8; x < 128; x += 15) {
      ctx.beginPath();
      ctx.arc(x, y, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = 'rgba(95, 46, 8, 0.6)';   // 가운데를 가로지르는 손잡이 띠
  ctx.fillRect(0, 56, 128, 12);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const crateSideMat = new THREE.MeshLambertMaterial({ map: makeCrateTexture() });
const crateTopMat = new THREE.MeshLambertMaterial({ color: 0xcf7a1a });
const crateInsideMat = new THREE.MeshLambertMaterial({ color: 0x8a4d16 });
const BASKET_SCALE = 1.2;   // 상자를 기존보다 20% 더 크게
const basket = new THREE.Group();
// 상자 바깥 크기 (루루 몸통만해야 "무거워서 힘들게 끈다"는 느낌이 삽니다)
const CRATE_W = 0.85 * BASKET_SCALE;   // 가로
const CRATE_H = 0.62 * BASKET_SCALE;   // 높이 (이 높이가 상자 아가리 = 귤이 여기까지 차오릅니다)
const CRATE_D = 0.68 * BASKET_SCALE;   // 세로
const CRATE_T = 0.07 * BASKET_SCALE;   // 판 두께
{
  // 예전에는 속이 꽉 찬 네모 하나였습니다. 그러면 안에 귤을 넣어도 뚜껑에 가려 보이지 않으므로,
  // 바닥 + 벽 네 장으로 진짜 뚫린 상자를 만듭니다 (위에서 내려다보면 안이 들여다보입니다).
  const panel = (geo, px, py, pz, mat) => {
    const m = new THREE.Mesh(geo, mat || crateSideMat);
    m.position.set(px, py, pz);
    m.castShadow = true;
    m.receiveShadow = true;
    basket.add(m);
  };
  panel(new THREE.BoxGeometry(CRATE_W, CRATE_T, CRATE_D), 0, CRATE_T / 2, 0, crateInsideMat);   // 바닥
  const front = new THREE.BoxGeometry(CRATE_W, CRATE_H, CRATE_T);
  panel(front, 0, CRATE_H / 2, (CRATE_D - CRATE_T) / 2);                                        // 앞판
  panel(front, 0, CRATE_H / 2, -(CRATE_D - CRATE_T) / 2);                                       // 뒤판
  const side = new THREE.BoxGeometry(CRATE_T, CRATE_H, CRATE_D - CRATE_T * 2);
  panel(side, (CRATE_W - CRATE_T) / 2, CRATE_H / 2, 0);                                         // 오른쪽 판
  panel(side, -(CRATE_W - CRATE_T) / 2, CRATE_H / 2, 0);                                        // 왼쪽 판
  // 네 귀퉁이 테두리 — 판만 세우면 종이상자처럼 얇아 보여서 굵은 모서리를 덧대줍니다
  const rim = new THREE.BoxGeometry(CRATE_W + 0.03, 0.06 * BASKET_SCALE, CRATE_T + 0.03);
  panel(rim, 0, CRATE_H - 0.03 * BASKET_SCALE, (CRATE_D - CRATE_T) / 2, crateTopMat);
  panel(rim, 0, CRATE_H - 0.03 * BASKET_SCALE, -(CRATE_D - CRATE_T) / 2, crateTopMat);
}
scene.add(basket);

// 상자에 실제로 쌓이는 귤 — 딴 귤이 날아와 떨어지면 한 알씩 눈에 보이게 채워집니다.
// 자리를 미리 아래층부터 순서대로 만들어두고, 담긴 개수만큼만 보이게 켜는 방식입니다.
// (매번 새 귤을 만들지 않아서 가볍고, 상자의 자식이라 상자를 끌면 귤도 같이 따라갑니다)
const BASKET_CAP = 36;          // 이만큼 담으면 가득 참 → 택배로 육지에 보낼 수 있는 상태
const filledFruits = [];        // { mesh, pop } — pop은 방금 담겨서 통 튀어오르는 정도(1→0)
let basketCount = 0;
{
  const COLS = 4, ROWS = 3, LAYERS = 3;          // 4×3을 한 층으로 3층까지 = 36알
  const GAP = 0.21, RADIUS = 0.115;
  const packedGeo = new THREE.SphereGeometry(RADIUS, 8, 6);
  // 맨 아래층은 바닥 바로 위, 맨 위층은 상자 아가리에 걸쳐서 소복이 얹힌 것처럼 보이게 합니다
  const yBottom = CRATE_T + RADIUS;
  const yStep = (CRATE_H - yBottom) / (LAYERS - 1);
  for (let L = 0; L < LAYERS; L++) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const m = new THREE.Mesh(packedGeo, tangerineMat);
        // 층마다 반 칸씩 어긋나게 쌓아야 과일이 서로 얹힌 것처럼 보입니다
        const shift = (L % 2) * 0.5;
        m.position.set(
          (c - (COLS - 1) / 2 + shift * 0.5) * GAP + (Math.random() - 0.5) * 0.03,
          yBottom + L * yStep,
          (r - (ROWS - 1) / 2 + shift * 0.5) * GAP + (Math.random() - 0.5) * 0.03
        );
        m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        m.castShadow = true;
        m.visible = false;                         // 담기기 전까지는 안 보입니다
        basket.add(m);
        filledFruits.push({ mesh: m, pop: 0 });
      }
    }
  }
}

// 귤 한 알을 상자에 담습니다 (가득 차면 더 안 담기고 false를 돌려줍니다)
function addFruitToBasket() {
  if (basketCount >= BASKET_CAP) return false;
  const f = filledFruits[basketCount];
  f.mesh.visible = true;
  f.pop = 1;                    // 톡 튀어오르며 자리잡는 연출
  basketCount++;
  updateBasketBadge();
  return true;
}

// 상자를 비웁니다 (나중에 택배사에 배송하면 여기서 다시 0으로 되돌립니다)
function emptyBasket() {
  for (const f of filledFruits) { f.mesh.visible = false; f.pop = 0; }
  basketCount = 0;
  updateBasketBadge();
}

updateBasketBadge();   // 시작할 때 "0/36"으로 한 번 표시

// 방금 담긴 귤이 제자리를 찾아 내려앉는 움직임
function updateFilledFruits(dt) {
  for (let i = 0; i < basketCount; i++) {
    const f = filledFruits[i];
    if (f.pop <= 0) continue;
    f.pop = Math.max(0, f.pop - dt * 4);
    const k = 1 + Math.sin(f.pop * Math.PI) * 0.45;   // 커졌다가 원래 크기로
    f.mesh.scale.setScalar(k);
  }
}

// (예전에는 상자를 잡으면 발밑에 노란 고리가 떴습니다. 루루가 상자를 붙잡은 자세로 바뀌는 것만으로
//  잡았다는 게 충분히 보여서, 화면을 어지럽히는 그 고리는 없앴습니다. 안내는 왼쪽 아래 배지가 합니다)

const flyingFruits = [];
const FLY_TIME = 0.45;     // 나무에서 바구니까지 날아가는 시간(초)
let basketPunch = 0;       // 귤이 떨어질 때 살짝 눌렸다 튀는 애니메이션 진행도

// 컨테이너는 게임 진행에 따라 움직이는 방식 자체가 바뀌는 "물리 오브젝트"입니다.
// - 끈을 사기 전(hasRope=false): 로프 없이 몸으로 부딪혀야만 밀려나는 무거운 상자 (힘들게 끌기)
// - 끈을 산 후(hasRope=true)  : 로프로 묶여 자동으로 뒤따라오는 견인 물리 (편하게 끌기)
// 배경 장식물(나무·돌담 등)과 달리 매 프레임 위치/속도가 갱신되는 게 이 오브젝트의 특징입니다.
const ROPE_LEN = 0.95 * BASKET_SCALE;      // 끈으로 묶었을 때 유지되는 거리 (상자 크기에 맞춰 늘림)
const GRAB_LEN = 0.55 * BASKET_SCALE;      // 손으로 직접 잡았을 때 유지되는 거리 (더 바짝 붙여서 실제로 붙잡은 것처럼)
const PUSH_MIN_DIST = 0.95 * BASKET_SCALE; // 끈이 없을 때, 루루 몸통 반지름 + 상자 반지름 정도의 충돌 거리
const basketPos = {
  x: state.x - Math.sin(state.facing) * ROPE_LEN,
  z: state.z - Math.cos(state.facing) * ROPE_LEN,
};
const basketVel = { x: 0, z: 0 };   // 끈 없이 밀 때만 쓰는 속도(무거운 상자라 마찰로 금방 멈춤)
let basketFacing = state.facing;

function currentBasketPos() {
  return { x: basketPos.x, y: groundHeight(basketPos.x, basketPos.z), z: basketPos.z };
}

function turnBasketToward(wantFacing, dt, speed) {
  let diff = wantFacing - basketFacing;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  basketFacing += diff * Math.min(1, dt * speed);
}

// 끈 없이: 루루가 몸으로 부딪힌 만큼만 밀려납니다 (자동으로 안 따라오고, 계속 부딪혀줘야 움직임)
function updateBasketPushed(dt) {
  const dx = basketPos.x - lulu.position.x, dz = basketPos.z - lulu.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < PUSH_MIN_DIST && dist > 0.0001) {
    const push = (PUSH_MIN_DIST - dist) * 22;
    basketVel.x += (dx / dist) * push * dt;
    basketVel.z += (dz / dist) * push * dt;
  }
  basketVel.x *= 0.86;   // 무거운 상자라 마찰로 금방 멈춥니다
  basketVel.z *= 0.86;
  basketPos.x += basketVel.x * dt;
  basketPos.z += basketVel.z * dt;

  if (Math.hypot(basketVel.x, basketVel.z) > 0.05) {
    turnBasketToward(Math.atan2(basketVel.x, basketVel.z), dt, 6);
  }
}

// 끈으로 묶었거나 손으로 잡은 상태: 항상 루루로부터 정확히 ROPE_LEN만큼 떨어진 거리를 유지합니다.
// (너무 멀어지면 당겨오는 것뿐 아니라, 루루가 상자 쪽으로 다가가면 상자도 같이 밀려나야
//  캐릭터가 상자 속으로 뚫고 들어가는 일이 없습니다 — 팽팽한 막대를 쥐고 있는 것과 같은 느낌)
function updateBasketRoped(dt) {
  const len = state.grabbing ? GRAB_LEN : ROPE_LEN;   // 손으로 잡았을 땐 더 바짝, 끈으로 끌 땐 원래 거리
  const dx = basketPos.x - lulu.position.x, dz = basketPos.z - lulu.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.0001) {
    // 완전히 같은 자리에 겹치면 방향을 정할 수 없으므로, 루루가 보는 방향의 등 뒤로 둡니다
    basketPos.x = lulu.position.x - Math.sin(lulu.rotation.y) * len;
    basketPos.z = lulu.position.z - Math.cos(lulu.rotation.y) * len;
  } else {
    const k = len / dist;
    basketPos.x = lulu.position.x + dx * k;
    basketPos.z = lulu.position.z + dz * k;
  }
  // 상자가 있는 방향을 바구니가 바라보게 (급하게 돌지 않고 부드럽게)
  turnBasketToward(Math.atan2(basketPos.x - lulu.position.x, basketPos.z - lulu.position.z), dt, 10);
}

function updateBasket(dt) {
  // 끈을 샀거나(자동으로 따라옴), 지금 직접 손으로 잡고 있으면 → 항상 팽팽하게 뒤따르는 물리
  // 둘 다 아니면 → 몸으로 부딪혀야만 밀려나는 무거운 상자
  if (hasRope || state.grabbing) updateBasketRoped(dt); else updateBasketPushed(dt);

  const p = currentBasketPos();
  basket.position.set(p.x, p.y, p.z);
  basket.rotation.y = basketFacing;
  basketPunch = Math.max(0, basketPunch - dt * 4);   // 눌렸다 되돌아오는 정도가 시간에 따라 줄어듦
  basket.scale.set(1, Math.max(0.62, 1 - basketPunch * 0.32), 1);
  updateRopeBadge();
}

// 끈이 없어도, 가까이 가서 E를 누르면 상자를 직접 손으로 잡고 원하는 방향으로 끌 수 있습니다.
// 잡은 동안은 끈으로 묶은 것과 똑같이 항상 팽팽하게 따라오므로(updateBasketRoped), 어느 방향으로
// 걷든 상자가 정확히 그 방향으로 딸려옵니다. 다시 E를 누르면 놓습니다.
const GRAB_RANGE = 1.8 * BASKET_SCALE;   // 이 거리 안에 있어야 잡을 수 있음
function tryToggleGrab() {
  if (hasRope) return;   // 끈을 산 뒤에는 항상 자동으로 따라오므로 따로 잡을 필요가 없습니다
  if (state.grabbing) {
    state.grabbing = false;   // 루루가 붙잡은 자세를 풀고 배지 문구가 바뀌는 것으로 놓았음을 보여줍니다
    return;
  }
  const dist = Math.hypot(basketPos.x - state.x, basketPos.z - state.z);
  if (dist > GRAB_RANGE) return;   // 너무 멀면 못 잡음
  state.grabbing = true;          // 잡는 순간부터 상자를 향해 몸을 돌리고, 항상 팽팽히 따라오기 시작합니다
  state.idleTime = 0;
}
addEventListener('keydown', (e) => { if (e.code === 'KeyE') tryToggleGrab(); });

// 딴 귤 하나를 나무 위치에서 바구니까지 실제 중력으로 포물선을 그리며 날려보냅니다
// (도착 시점의 위치를 미리 정해두고, 그 지점에 정확히 떨어지도록 초기 속도를 역산합니다)
function spawnFlyingFruit(x, y, z) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), tangerineMat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  scene.add(mesh);

  const p = currentBasketPos();
  const targetX = p.x, targetY = p.y + 0.56 * BASKET_SCALE, targetZ = p.z;   // 커진 상자의 입구 높이에 맞춤
  const vx = (targetX - x) / FLY_TIME;
  const vz = (targetZ - z) / FLY_TIME;
  const vy = (targetY - y) / FLY_TIME + 0.5 * GRAVITY * FLY_TIME;   // 포물선 도착 지점을 맞추기 위한 역산

  flyingFruits.push({
    mesh, vx, vy, vz, t: 0,
    spinX: (Math.random() - 0.5) * 14, spinZ: (Math.random() - 0.5) * 14,
  });
}

function updateFlyingFruits(dt) {
  for (let i = flyingFruits.length - 1; i >= 0; i--) {
    const f = flyingFruits[i];
    f.t += dt;
    f.vy -= GRAVITY * dt;               // 실제 중력 가속
    f.mesh.position.x += f.vx * dt;
    f.mesh.position.y += f.vy * dt;
    f.mesh.position.z += f.vz * dt;
    f.mesh.rotation.x += f.spinX * dt;   // 날아가며 데굴데굴 회전
    f.mesh.rotation.z += f.spinZ * dt;

    const p = currentBasketPos();
    const landed = f.t >= FLY_TIME * 0.85 && f.mesh.position.y <= p.y + 0.36;
    if (landed || f.t > FLY_TIME + 0.5) {   // 시간이 너무 지나도 안전하게 정리
      scene.remove(f.mesh);
      flyingFruits.splice(i, 1);
      basketPunch = 1;                      // 바구니가 귤 받는 순간 살짝 눌리는 반응
      // 날아온 귤이 여기서 비로소 "상자 안에 쌓인 귤" 한 알로 바뀝니다
      if (addFruitToBasket()) playDropSound();   // 나무통에 툭 떨어지는 소리
      if (basketCount >= BASKET_CAP) {
        spawnMoneyPopup(p.x, p.y + 1.1, p.z, '📦 상자가 가득 찼어요!');
      }
    }
  }
}

function tryHarvest() {
  if (state.harvestT >= 0 || !state.onGround) return;   // 이미 따는 중이거나 공중이면 못 땀
  const i = nearestFruit();
  if (i < 0) return;
  // 상자가 가득 차면 더 딸 수 없습니다 — 택배사에 보내고 빈 상자로 돌아와야 합니다
  if (basketCount + flyingFruits.length >= BASKET_CAP) {
    const p = currentBasketPos();
    spawnMoneyPopup(p.x, p.y + 1.1, p.z, '상자가 가득 찼어요 · 택배사로!');
    return;
  }
  const s = fruitSpots[i];
  state.facing = Math.atan2(s.x - state.x, s.z - state.z);   // 정확히 그 귤 쪽으로 몸을 돌린 다음
  targetRing.visible = false;
  playPickSound();                   // 가지에서 톡 떼어내는 소리
  spawnFlyingFruit(s.x, s.y, s.z);   // 나무에 매달려 있던 바로 그 자리에서 손으로 따서 날려보냄
  hideFruit(i);
  coins += 100;
  updateCoinBadge();
  spawnMoneyPopup(s.x, s.y, s.z, '+100원');
  state.harvestT = 0;
  state.idleTime = 0;
  state.sit = 0;
}

// ---------- 12-1c. 상점 — 끈 사기 (F키, 상점 근처에서) ----------
function tryBuyRope() {
  const popupY = shop.group.position.y + 1.7;
  if (hasRope) {
    spawnMoneyPopup(shop.group.position.x, popupY, shop.group.position.z, '이미 끈이 있어요');
    return;
  }
  if (coins < ROPE_PRICE) {
    spawnMoneyPopup(shop.group.position.x, popupY, shop.group.position.z, `${(ROPE_PRICE - coins).toLocaleString()}원 부족`);
    return;
  }
  coins -= ROPE_PRICE;
  hasRope = true;
  state.grabbing = false;          // 이제부터 항상 자동으로 따라오니 손으로 붙잡고 있을 필요가 없음
  shop.ropeCoil.visible = false;   // 판매대 위 끈 뭉치가 사라짐 (팔렸으니까)
  updateCoinBadge();
  updateRopeBadge();
  spawnMoneyPopup(shop.group.position.x, popupY, shop.group.position.z, '🪢 끈 구매!');
}

// ---------- 12-1d. 택배사 — 육지로 부치기 (F키, 택배사 근처에서) ----------
// 상자에 담긴 귤을 트럭에 실어 보냅니다. 상자는 비워지고, 담겨 있던 만큼 택배 정산을 받습니다.
// 귤을 딸 때 이미 100원씩 받았으므로, 이건 "육지로 부쳐야 제값을 받는다"는 웃돈입니다.
const SHIP_PRICE = 400;     // 귤 한 알을 육지로 부쳤을 때 더 받는 돈 (가득 채운 한 상자 = 14,400원)
function tryShipBox() {
  const dp = depot.group.position;
  const popupY = dp.y + 3.2;
  if (basketCount === 0) {
    spawnMoneyPopup(dp.x, popupY, dp.z, '상자가 비었어요 · 귤을 담아 오세요');
    return;
  }
  const pay = basketCount * SHIP_PRICE;
  const sent = basketCount;
  coins += pay;
  emptyBasket();                 // 트럭에 실었으니 상자는 다시 비워집니다
  updateCoinBadge();
  playShipSound();
  spawnMoneyPopup(dp.x, popupY, dp.z, `🚚 귤 ${sent}알 육지로 출발! +${pay.toLocaleString()}원`);
}

// F키 하나로 상황에 맞는 행동을 합니다:
// 가까운 귤이 있으면 따고, 없으면 상점(끈 사기)이나 택배사(부치기) 중 가까운 쪽을 씁니다.
function handleActionKey() {
  if (state.harvestT >= 0) return;
  if (nearestFruit() >= 0) { tryHarvest(); return; }
  const shopDist = Math.hypot(state.x - shop.group.position.x, state.z - shop.group.position.z);
  if (shopDist < SHOP_RANGE) { tryBuyRope(); return; }
  const depotDist = Math.hypot(state.x - depot.group.position.x, state.z - depot.group.position.z);
  if (depotDist < DEPOT_RANGE) tryShipBox();
}
addEventListener('keydown', (e) => { if (e.code === 'KeyF') handleActionKey(); });

// 시작 화면: 누르면 사라지면서 소리와 배경음악이 깨어납니다.
// (브라우저가 "사용자가 한 번 누르기 전엔 소리 금지"로 막아두기 때문에 이 한 번이 필요합니다)
{
  const startEl = document.getElementById('start');
  if (startEl) {
    const begin = () => {
      startEl.classList.add('gone');
      setTimeout(() => startEl.remove(), 500);   // 사라지고 나면 화면에서 완전히 치웁니다
      wakeAudio();
      startBgm();
    };
    startEl.addEventListener('pointerdown', begin, { once: true });
    addEventListener('keydown', begin, { once: true });
  }
}

// 폰용 화면 버튼을 각 기능에 연결합니다 (키보드 F·E·Shift·Space와 똑같은 일을 합니다)
bindTouchButton('btnAction', (down) => { if (down) { wakeAudio(); startBgm(); handleActionKey(); } });
bindTouchButton('btnGrab',   (down) => { if (down) { wakeAudio(); startBgm(); tryToggleGrab(); } });
bindTouchButton('btnJump',   (down) => { touchJump = down; });
bindTouchButton('btnRun',    (down) => { touchRun = down; });

const WALK = 4.2, RUN = 8.0, GRAVITY = 22, JUMP = 7.4;
const moveDir = new THREE.Vector3();

function updateLulu(dt) {
  // 감귤 따는 중엔 움직임을 멈추고 애니메이션 시간만 흘려보냅니다
  if (state.harvestT >= 0) {
    state.harvestT += dt;
    if (state.harvestT >= HARVEST_DURATION) state.harvestT = -1;
  }

  // 카메라가 보는 방향 기준으로 앞/오른쪽 계산
  const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
  const rgtX = Math.cos(camYaw), rgtZ = -Math.sin(camYaw);

  // 이동은 방향키만 씁니다. W A S D는 시야 회전(updateCamera)이 가져갔습니다.
  // 폰에서는 화면 왼쪽 조이스틱(touchMove)이 같은 자리에 값을 보탭니다.
  let f = 0, r = 0;
  if (state.harvestT < 0) {
    if (keys['ArrowUp']) f += 1;
    if (keys['ArrowDown']) f -= 1;
    if (keys['ArrowRight']) r += 1;
    if (keys['ArrowLeft']) r -= 1;
    f += touchMove.f;
    r += touchMove.r;
  }

  // 조이스틱을 살짝만 기울이면 천천히, 끝까지 밀면 최고 속도로 걷게 합니다.
  // (키보드는 항상 1이므로 이 값이 늘 1이 되어 예전과 똑같이 움직입니다)
  const tilt = Math.min(1, Math.hypot(f, r));
  moveDir.set(fwdX * f + rgtX * r, 0, fwdZ * f + rgtZ * r);
  const moving = moveDir.lengthSq() > 0.0001;
  const running = keys['ShiftLeft'] || keys['ShiftRight'] || touchRun;
  const spd = (running ? RUN : WALK) * tilt;

  if (moving) {
    moveDir.normalize();
    state.x += moveDir.x * spd * dt;
    state.z += moveDir.z * spd * dt;
    state.idleTime = 0;
  } else {
    state.idleTime += dt;
  }

  // 상자를 끌고 있는 동안은 이동 방향과 무관하게 항상 상자 쪽을 바라보게 합니다.
  // (왼쪽으로 가든 오른쪽으로 가든, 상자를 붙잡은 자세 그대로 옆걸음으로 끌고 가는 것처럼 보입니다)
  const isDraggingBox = hasRope || state.grabbing;
  if (isDraggingBox) {
    state.facing = Math.atan2(basketPos.x - state.x, basketPos.z - state.z);
  } else if (moving) {
    state.facing = Math.atan2(moveDir.x, moveDir.z);
  }

  // 돌담·돌하르방·나무에 부딪히면 밀려나기
  for (const o of obstacles) {
    const dx = state.x - o.x, dz = state.z - o.z;
    const d = Math.hypot(dx, dz);
    const min = o.r + 0.35;
    if (d < min && d > 0.0001) {
      state.x = o.x + (dx / d) * min;
      state.z = o.z + (dz / d) * min;
    }
  }

  // 섬 밖으로는 못 나감
  const rr = Math.hypot(state.x, state.z);
  if (rr > WALK_R) {
    state.x *= WALK_R / rr;
    state.z *= WALK_R / rr;
  }

  // 점프와 중력
  const gy = groundHeight(state.x, state.z);
  if ((keys['Space'] || touchJump) && state.onGround && state.harvestT < 0) {
    state.vy = JUMP;
    state.onGround = false;
    state.idleTime = 0;
  }
  state.vy -= GRAVITY * dt;
  let y = lulu.position.y + state.vy * dt;
  if (y <= gy) { y = gy; state.vy = 0; state.onGround = true; }

  lulu.position.set(state.x, y, state.z);

  // 몸 방향을 부드럽게 돌리기 (-π ~ π 경계 처리 포함)
  let diff = state.facing - lulu.rotation.y;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  lulu.rotation.y += diff * Math.min(1, dt * 12);

  // ----- 애니메이션 -----
  const target = moving ? (running ? 1 : 0.62) * tilt : 0;   // 살살 걸으면 다리도 살살 움직입니다
  state.speed += (target - state.speed) * Math.min(1, dt * 9);
  state.walkPhase += dt * (6 + state.speed * 9);

  // 오래 가만히 있으면 앉기
  const wantSit = state.idleTime > 5 && state.onGround ? 1 : 0;
  state.sit += (wantSit - state.sit) * Math.min(1, dt * 3.5);

  const s = state.sit;
  luluBody.position.y = -0.18 * s;
  luluBody.rotation.x = 0.22 * s;

  // 네 발 걷기 (대각선 발이 짝을 이룹니다)
  const offs = [0, Math.PI, Math.PI, 0];
  legs.forEach((leg, i) => {
    const swing = Math.sin(state.walkPhase + offs[i]) * 0.75 * state.speed;
    const sitPose = i < 2 ? 0.1 : -0.85;   // 앉으면 뒷다리를 접습니다
    leg.rotation.x = swing * (1 - s) + sitPose * s;
  });

  // 걸을 때 몸통이 살짝 통통 튀고, 멈추면 숨쉬듯 부풀기
  const bob = Math.abs(Math.sin(state.walkPhase)) * 0.06 * state.speed;
  luluBody.position.y += bob;
  const breath = 1 + Math.sin(performance.now() * 0.002) * 0.012 * (1 - state.speed);
  torso.scale.set(breath, 1, breath);

  // 꼬리: 걸을 땐 좌우로, 멈추면 천천히 말립니다
  const t = performance.now() * 0.001;
  tailSegs.forEach((seg, i) => {
    seg.rotation.y = Math.sin(t * (2.2 + state.speed * 2) - i * 0.55) * (0.1 + state.speed * 0.14);
    seg.rotation.x = 0.3 + Math.sin(t * 1.3 - i * 0.4) * 0.07 + s * 0.1;
  });

  // 머리: 걸을 때 위아래로 까딱, 앉으면 살짝 듭니다
  head.rotation.x = Math.sin(state.walkPhase * 2) * 0.05 * state.speed - 0.16 * s;

  if (spriteCard) updateSpriteLulu(gy);
}

// 그림 루루: 위치 맞추기 → 카메라 쪽으로 돌리기 → 진행 방향에 맞춰 좌우 뒤집기 → 걸음 표현
const camRight = new THREE.Vector3();
const camFwd = new THREE.Vector3();

function updateSpriteLulu(groundY) {
  spriteLulu.position.copy(lulu.position);

  // 판이 항상 카메라를 정면으로 보게 (좌우로만 돌리고 세로로는 세워둡니다)
  spriteLulu.rotation.y = Math.atan2(
    camera.position.x - spriteLulu.position.x,
    camera.position.z - spriteLulu.position.z
  );

  // 루루가 화면상 왼쪽으로 가는지 오른쪽으로 가는지 기억해둡니다
  camera.getWorldDirection(camFwd);
  camRight.set(-camFwd.z, 0, camFwd.x);   // 카메라 기준 오른쪽 방향
  const faceX = Math.sin(lulu.rotation.y), faceZ = Math.cos(lulu.rotation.y);
  const toRight = faceX * camRight.x + faceZ * camRight.z;
  if (Math.abs(toRight) > 0.12) spriteCard.userData.headingRight = toRight > 0;

  // ----- 어느 그림을 쓸지 고르기 -----
  // 규칙: 보고 있는 방향이 우선입니다.
  // 왼쪽으로 가다 멈추면 옆모습 그대로, 등을 보이며 가다 멈추면 뒷모습 그대로 서 있습니다.
  // (예전엔 멈추기만 하면 정면 그림으로 바뀌어서, 뒤돌아 있다가 갑자기 얼굴이 보였습니다)
  const walking = state.speed > 0.08;
  const away = faceX * camFwd.x + faceZ * camFwd.z;   // 카메라가 보는 쪽으로 갈수록 1 (= 멀어짐)
  const view = away > 0.5 ? 'back' : (away < -0.5 ? 'front' : 'side');
  let sheet, cell;
  const t = performance.now() * 0.001;

  if (state.harvestT >= 0) {
    // 감귤 따는 중. 뻗기→내리기→기뻐하기가 한 방향으로 재생되고, 끝나면 마지막(기뻐하는) 칸에 멈춥니다
    sheet = SHEETS.harvest;
    cell = Math.min(sheet.frames - 1, Math.floor((state.harvestT / HARVEST_DURATION) * sheet.frames));
  } else if (!state.onGround) {
    // 점프가 먼저입니다. 방향키를 누른 채 뛰어도 걷는 그림이 아니라 뛰는 자세가 나오게.
    // 카메라를 마주 보고 있을 때만 만세, 아니면 보던 방향 그대로 다리를 벌린 자세.
    sheet = view === 'front' ? SHEETS.cheer
          : view === 'back' ? SHEETS.walkBack : SHEETS.walkSide;
    cell = sheet === SHEETS.cheer ? pingpong(Math.floor(t * 10), sheet.frames) : sheet.leap;
  } else if (state.sit > 0.9) {
    // 오래 가만히 있어서 낮잠 자는 중. 웅크린 그림이라 방향과 상관없이 그대로 씁니다.
    sheet = SHEETS.sleep;
    cell = pingpong(Math.floor(t * 3), sheet.frames);   // 숨쉬듯 느리게
  } else if (walking) {
    // 끈으로 자동으로 끌거나 손으로 직접 잡고 있을 때만, 옆모습을 힘겹게 끄는 그림으로 바꿉니다.
    // (뒤/앞모습은 그 자세를 찍은 영상이 없어서 기존 걷기 그림을 그대로 씁니다)
    const isDraggingBox = hasRope || state.grabbing;
    const sideSheet = (isDraggingBox && SHEETS.pullSide) ? SHEETS.pullSide : SHEETS.walkSide;
    sheet = view === 'back' ? SHEETS.walkBack : view === 'front' ? SHEETS.walkFront : sideSheet;
    // 걸음 번호를 walkPhase에 묶어두면 다리 놀림과 실제 이동 속도가 같이 빨라집니다
    cell = Math.floor(state.walkPhase) % sheet.frames;
  } else if (view === 'front') {
    sheet = SHEETS.idle;                              // 카메라를 마주 본 채 서 있을 때만 정면 그림
    cell = pingpong(Math.floor(t * 7), sheet.frames);
  } else {
    sheet = view === 'back' ? SHEETS.walkBack : SHEETS.walkSide;
    cell = sheet.stand;                               // 두 발이 모인 칸으로 멈춰 세웁니다
  }

  if (spriteCard.material.map !== sheet.tex) {
    spriteCard.material.map = sheet.tex;
    spriteCard.material.needsUpdate = true;
  }
  spriteCard.userData.sheet = sheet;
  setCell(sheet, cell);

  // 걸을 때 통통 튀고 살짝 기우뚱 (그림 한 장이라 이런 움직임으로 생기를 냅니다)
  const hop = Math.abs(Math.sin(state.walkPhase)) * 0.09 * state.speed;
  // sleep 그림은 이미 웅크려 땅에 닿은 모습이라, 앉는 만큼 내리는 이 보정을 적용하면 땅에 파묻힙니다
  const sitDrop = sheet === SHEETS.sleep ? 0 : 0.16 * state.sit;
  spriteBoard.position.y = hop - sitDrop;
  spriteBoard.rotation.z = Math.sin(state.walkPhase) * 0.045 * state.speed;

  // 판 크기: 칸마다 가로 폭이 달라서 그림에 맞춰 그때그때 정합니다.
  // 원본 그림이 왼쪽을 보고 있으므로, 오른쪽으로 갈 때 좌우를 뒤집습니다.
  const Hp = spriteCard.userData.planeH;
  const Wp = Hp * sheet.frameW / CELL_H;
  const breath = 1 - hop * 0.12 + Math.sin(t * 2) * 0.008 * (1 - state.speed);
  // 옆모습일 때만 진행 방향에 맞춰 뒤집습니다. 정면·뒷모습은 어느 쪽으로 가든 그대로 둡니다
  // (정면으로 오면 좌우 성분이 0이라 뒤집기 값이 직전 것으로 남아 방향이 튀었습니다)
  const mirror = (sheet === SHEETS.walkSide || sheet === SHEETS.pullSide) && spriteCard.userData.headingRight;
  spriteCard.scale.set(mirror ? -Wp : Wp, Hp * breath, 1);

  // 발밑 그림자: 점프해서 뜨면 작아지고 옅어집니다
  const air = Math.max(0, lulu.position.y - groundY);
  const shrink = Math.max(0.45, 1 - air * 0.22);
  spriteBlob.position.set(state.x, groundY + 0.06, state.z);
  spriteBlob.scale.set(shrink, shrink, 1);
  spriteBlob.material.opacity = 0.4 * shrink;
}

// ---------- 13. 메인 루프 ----------
const clock = new THREE.Clock();
const camTarget = new THREE.Vector3();
const camWanted = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;

  updateCamera(dt);   // 방향키로 시야 돌리기 — 이동 계산이 카메라 방향을 쓰므로 먼저 갱신합니다
  updateLulu(dt);
  updateBasket(dt);
  updateFlyingFruits(dt);
  updateFilledFruits(dt);
  updateHarvestTarget(dt, t);
  updatePopups(dt);

  // 카메라가 루루를 부드럽게 따라갑니다
  camTarget.set(lulu.position.x, lulu.position.y + 1.0, lulu.position.z);
  const hor = Math.cos(camPitch) * camDist;
  camWanted.set(
    camTarget.x + Math.sin(camYaw) * hor,
    camTarget.y + Math.sin(camPitch) * camDist,
    camTarget.z + Math.cos(camYaw) * hor
  );
  const minY = groundHeight(camWanted.x, camWanted.z) + 1.2;
  if (camWanted.y < minY) camWanted.y = minY;
  camera.position.lerp(camWanted, 1 - Math.pow(0.0015, dt));
  camera.lookAt(camTarget);

  // 그림자용 태양은 루루를 따라다닙니다 (넓은 들판을 한 번에 못 비추기 때문)
  sun.position.set(lulu.position.x + 26, lulu.position.y + 40, lulu.position.z + 18);
  sun.target.position.copy(lulu.position);
  sun.target.updateMatrixWorld();

  // 하늘과 바다는 항상 카메라를 따라옵니다 (끝이 보이지 않게)
  sky.position.set(camera.position.x, 0, camera.position.z);
  sea.position.x = camera.position.x;
  sea.position.z = camera.position.z;

  // 바닷물결
  const sp = sea.geometry.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = seaBase[i * 3], z = seaBase[i * 3 + 2];
    sp.setY(i, Math.sin(x * 0.06 + t * 1.1) * 0.28 + Math.cos(z * 0.05 + t * 0.8) * 0.22);
  }
  sp.needsUpdate = true;
  sea.geometry.computeVertexNormals();

  // 풀·꽃이 바람에 흔들리도록 시간 전달
  for (const m of windMaterials) {
    if (m.userData.shader) m.userData.shader.uniforms.uTime.value = t;
  }

  // 구름 흘러가기
  for (const c of clouds) {
    c.position.x += dt * 1.4;
    if (c.position.x > 300) c.position.x = -300;
  }

  // 나비 날갯짓
  for (const b of butterflies) {
    const d = b.userData;
    const a = t * d.spd + d.off;
    const bx = d.cx + Math.cos(a) * d.rad;
    const bz = d.cz + Math.sin(a * 1.3) * d.rad;
    b.position.set(bx, groundHeight(bx, bz) + 1.6 + Math.sin(a * 3) * 0.5, bz);
    b.rotation.y = -a;
    const flap = Math.sin(t * 22 + d.off) * 0.9;
    d.wl.rotation.y = flap;
    d.wr.rotation.y = -flap;
  }

  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
