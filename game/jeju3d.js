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
// 섬 배치(나무·바위·밭·풀 위치)는 접속할 때마다 바뀌면 안 됩니다 — 항상 같은 우리 섬이어야죠.
// 그래서 세계를 만드는 동안은 "씨앗 있는 난수"를 씁니다: 씨앗이 같으면 결과가 늘 같습니다.
// 세계가 다 만들어지면(스크립트 맨 아래) 원래 난수로 되돌려서,
// 경마 승패나 이장님 잡담 같은 게임 중의 우연은 진짜 랜덤으로 굴러갑니다.
const trueRandom = Math.random;
{
  let seed = 20260807;   // 이 숫자를 바꾸면 완전히 새로운 섬이 나옵니다
  Math.random = function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
// 물질할 때 물속 분위기로 바꿔야 해서 이름을 붙여둡니다
const hemi = new THREE.HemisphereLight(0xbcdcf5, 0x6c8a4a, 1.15);
scene.add(hemi);

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

// 물질하는 곳 — 포구(배 대는 자리) 앞바다입니다.
// 지형 높이 함수보다 먼저 정해둬야, 이 자리를 움푹 파낸 지형을 만들 수 있습니다.
//
// ※ 처음에는 바닷속 바닥을 따로 만들어 -13에 깔았는데, 섬 지형 판이 그 위(-6.5)를 덮고 있어서
//    물에 들어가면 지형 판만 보이고 루루도 미역도 하나도 안 보였습니다.
//    그래서 바닥을 따로 만들지 않고 지형 자체를 파내는 방식으로 바꿨습니다.
// 포구는 물가에 바짝 붙은 마른 땅에 둡니다. (0,92)는 물가에서 1.2미터 위,
// 여기서 두 걸음만 나가면 바로 물이라 "여기서 바다로 들어간다"는 게 한눈에 보입니다.
const PORT = { x: 0, z: 92 };
// 루루의 집터 — 남쪽 비탈을 완만하게 다져 평평한 터를 만듭니다.
// (지형 함수보다 먼저 정해둬야 집터를 다진 지형을 만들 수 있습니다. 집 좌표도 여기서 나옵니다)
const HOUSE_SITE = { x: 64, z: -58, flatR: 10, blendR: 20, h: 6.5 };
// 물질장은 물가(z≈93)에서 충분히 떨어뜨려야 합니다. 가장자리가 뭍에 닿으면
// 마른 땅 위에서도 잠수 상태로 서 있게 됩니다.
const DIVE = { x: 0, z: 118, r: 20 };    // 물질장 (포구 앞바다)
const DIVE_DEPTH = 9;                    // 이만큼 더 파 내려갑니다
const SEA_Y = -0.5;                      // 바다 표면 높이 (아래 4번에서 만드는 바다 판과 같은 값)

let pierTopY = null;   // 포구 축대 윗면 높이 (처음 밟을 때 한 번 재서 기억합니다)
function groundHeight(x, z) {
  // 집 내부·상점 내부는 섬에서 멀리 떨어진 곳에 지은 별도의 방들입니다 — 그 안은 평평한 방바닥
  if (x > 380 && x < 480 && z > 380 && z < 420) return 20;
  // 포구 축대 위 — 바다 쪽으로 걸어나가도 축대 윗면 높이로 평평합니다
  // (이게 없으면 축대 끝으로 갈수록 지형이 바다로 꺼져서 루루가 돌 밑에 파묻힙니다)
  if (x > -2.6 && x < 2.6 && z > 92.5 && z < 102.4) {
    if (pierTopY === null) pierTopY = groundHeight(0, 92);
    return pierTopY;
  }
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
  let y = h * edge - (1 - edge) * 7;

  // 물질장은 우묵한 웅덩이로 파냅니다. 가장자리는 완만하게 이어져야
  // 포구에서 헤엄쳐 들어갈 때 벽에 막히지 않습니다.
  const dr = Math.hypot(x - DIVE.x, z - DIVE.z);
  y -= DIVE_DEPTH * (1 - smoothstep(0, DIVE.r + 8, dr));

  // 루루의 집터 — 비탈을 다져 평평하게. 안쪽은 완전 평지, 바깥쪽은 언덕과 부드럽게 이어집니다.
  // (집이 경사면에 반쯤 떠 보이던 것을 지형 쪽에서 해결)
  const hs = Math.hypot(x - HOUSE_SITE.x, z - HOUSE_SITE.z);
  if (hs < HOUSE_SITE.blendR) {
    const t = smoothstep(HOUSE_SITE.flatR, HOUSE_SITE.blendR, hs);
    y = HOUSE_SITE.h * (1 - t) + y * t;
  }
  return y;
}

// 해저 바닥 높이 = 그냥 지형 높이입니다 (지형을 파냈으므로 따로 계산할 게 없습니다)
const seabedHeight = groundHeight;

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
  // 양면(DoubleSide)으로 그려야 합니다 — 한쪽 면만 그리면 수면에 떠 있을 때
  // 카메라가 물보다 조금만 낮아져도 바다가 사라져서, 루루가 허공에 서 있는 것처럼 보입니다.
  new THREE.MeshPhongMaterial({ color: 0xffffff, vertexColors: true, shininess: 80, transparent: true, opacity: 0.94, side: THREE.DoubleSide })
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
sea.position.y = SEA_Y;
scene.add(sea);
const seaBase = sea.geometry.attributes.position.array.slice();

// ---------- 5. 성산일출봉(그림)과 먼 산들 ----------
const texLoader = new THREE.TextureLoader();

function loadTexture(path) {
  const t = texLoader.load(path);
  t.colorSpace = THREE.SRGBColorSpace;   // 그림 파일 색을 그대로 보이게
  return t;
}

// 물속에 들어가면 감춰야 하는 "하늘 쪽" 것들 — 수평선 너머 풍경입니다.
// 물속에서 이것들이 보이면 물이 유리처럼 투명해 보여서 분위기가 깨집니다.
const skyStuff = [];

function makeMountain(x, z, baseR, topR, h, color) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(topR, baseR, h, 40, 1),
    new THREE.MeshLambertMaterial({ color, flatShading: true })
  );
  m.position.set(x, h / 2 - 6, z);
  scene.add(m);
  skyStuff.push(m);
  return m;
}

if (CAN_USE_IMAGES) {
  // 직접 그리신 성산일출봉 그림(far_island_v2.webp)을 수평선에 세워 둡니다.
  // 그림 원본이 1952x544 이고, 섬과 바다가 맞닿는 물가 선이 위에서 약 63% 지점에 있어서
  // 그 선이 실제 바다 높이(y=0)와 맞도록 판의 위치를 계산합니다.
  const IMG_W = 1952, IMG_H = 544, WATERLINE = 345 / IMG_H;
  const W = 936, H = W * IMG_H / IMG_W;   // 실제 성산일출봉을 들판에서 바라본 정도의 크기 (780에서 20% 키움)
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({
      map: loadTexture('../assets/stage1/far_island_v2.webp'),
      transparent: true,
      depthWrite: false,
    })
  );
  backdrop.position.set(0, H * (WATERLINE - 0.5), -480);   // 물가 선이 바다 높이(y=0)에 오도록
  backdrop.renderOrder = -1;
  scene.add(backdrop);
  skyStuff.push(backdrop);

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
    // 포구 축대 위는 걸어다니는 길이라 바위·풀을 심지 않습니다
    // (축대 바닥을 평평하게 만든 뒤로 여기가 "땅"으로 인식되어 바위가 길을 막는 일이 있었습니다)
    if (x > -3.4 && x < 3.4 && z > 90.5 && z < 103.5) continue;
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
// { x, z, r, topY } — topY는 "이 높이보다 위로 뜨면 그냥 지나갈 수 있다"는 뜻입니다.
// 돌담처럼 낮은 것은 점프해서 뛰어넘을 수 있고, 나무나 건물은 넘을 수 없게 아주 높게 둡니다.
// 매 프레임 장애물 1700개를 훑으므로, 땅 높이를 그때그때 계산하지 않고 만들 때 미리 적어둡니다.
const NO_JUMP = 9999;
const obstacles = [];

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
    // 돌담은 낮으니 점프로 넘을 수 있게 합니다. 담 꼭대기는 돌을 layers장 쌓은 높이입니다.
    if (i % 2 === 0) obstacles.push({ x, z, r: 0.62, topY: y + 0.25 + (layers - 1) * 0.42 + 0.3 });
  }
}

// 섬 바깥 자투리 땅에만 남겨두는 자유 돌담 (밭담 격자가 닿지 않는 해안 쪽 풍경용)
buildStoneWall(-92, 22, -66, 44);
buildStoneWall(66, 60, 92, 44);
buildStoneWall(-58, -74, -22, -84);
// 헌집으로 안내하는 남쪽 돌담길 — 밭 사이에서 시작해 언덕 끝 집 앞까지 죽 내려갑니다
buildStoneWall(46, -18, 52, -44);
buildStoneWall(52, -44, 53, -66);

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
  obstacles.push({ x, z, r: 1.0, topY: NO_JUMP });
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


  // 문 앞 디딤돌
  for (let i = 0; i < 3; i++) {
    const step = add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.4, 0.12, 7), stoneMat),
      (i - 1) * 0.85, 0.06, D / 2 + 1.15);
    step.rotation.y = Math.random();
  }

  scene.add(g);
  obstacles.push({ x, z, r: 2.6, topY: NO_JUMP });   // 가게 건물은 뛰어넘을 수 없습니다
  return { group: g };
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
  // (트럭 옆에 두 개 더 흩어놨었는데, 다니는 길에 걸리적거려서 치웠습니다)

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
  obstacles.push({ x, z, r: 4.6, topY: NO_JUMP });                   // 건물
  obstacles.push({                                                   // 트럭도 부딪히면 못 지나갑니다
    x: x + (5.6 * Math.cos(rotY) + (D / 2 + 1.6) * Math.sin(rotY)),
    z: z + (-5.6 * Math.sin(rotY) + (D / 2 + 1.6) * Math.cos(rotY)),
    r: 1.9, topY: NO_JUMP,
  });
  return { group: g, truck };
}
// 시작 마당의 서쪽, 상점(6,45) 바로 옆에 나란히 세웁니다.
// 상점과 14미터 떨어져 있어 F키 인식 범위(상점 4.2 + 택배사 6.5)가 서로 겹치지 않습니다.
const depot = buildDepot(-8, 46, Math.PI);   // 상점과 똑같이 남쪽(-z)을 바라보게
const DEPOT_RANGE = 6.5;   // 이 거리 안에서 F를 누르면 배송할 수 있습니다

// 나무 줄기 색 — 헌집의 팻말·세간과 귤나무(8-3) 양쪽에서 쓰므로 먼저 만들어 둡니다
const citrusTrunkMat = new THREE.MeshLambertMaterial({ color: 0x6f5540, flatShading: true });

// ---------- 8-2d. 헌집 (사서 고치는 제주 돌집) ----------
// 남쪽 돌담길을 죽 내려가면, 바다가 내려다보이는 언덕 끝에 버려진 돌집이 서 있습니다.
// 사서 세 번 고치면(벽→지붕→페인트) 내 집이 됩니다.
// 집은 직접 그리신 그림을 판에 세워 쓰고, 수리 단계마다 그림만 바꿔 끼웁니다.
//   old_house_0: 폐가 / 1: 벽 고침 / 2: 지붕 고침 / 3: 완성 (원본 그대로)
const HOUSE = { x: HOUSE_SITE.x, z: HOUSE_SITE.z };   // 평평하게 다진 집터 한가운데.
// 바다에서 물러난 자리 + 귤밭 돌담(동쪽 x≈53)과 간격. 집 뒤(남쪽)는 야자수 자리입니다.
const HOUSE_RANGE = 5.5;
const HOUSE_W = 8.5, HOUSE_H = 8.5 * 520 / 1110;   // 그림 비율 그대로
let houseStage = 0;    // 루루가 처음부터 살고 있는 집입니다. 0~2 = 수리 중(허름함), 3 = 완성
let roofUpgraded = false;    // 상점의 "새 지붕"을 샀는가 — 사기 전엔 낡아 거뭇한 지붕입니다
let hasHouseDoor = false;    // 「대문」을 샀는가 — 사기 전엔 문간이 뻥 뚫려 있습니다
let hasHouseWindow = false;  // 「창문」을 샀는가 — 사기 전엔 시커먼 구멍 두 개뿐입니다
let housePaintColor = 0;     // 공구대에서 고른 외벽 페인트 색 (0 = 아직 안 칠함)
const house = (() => {
  const g = new THREE.Group();
  // 절벽 비탈 위의 집 — 발밑 네 귀퉁이 땅높이 중 "가장 높은 곳"에 바닥을 맞추고,
  // 낮은 쪽으로 생기는 틈은 현무암 기단으로 받칩니다. (가운데 높이에 맞추면
  // 내리막 쪽 벽이 공중에 둥둥 떠서, 집이 절벽에서 날아가는 것처럼 보였습니다)
  let floorY = -Infinity, lowY = Infinity;
  for (const [dx, dz] of [[-3.9, -2.8], [3.9, -2.8], [-3.9, 2.8], [3.9, 2.8], [0, 0]]) {
    const h = groundHeight(HOUSE.x + dx, HOUSE.z + dz);
    floorY = Math.max(floorY, h); lowY = Math.min(lowY, h);
  }
  floorY += 0.05;
  g.position.set(HOUSE.x, floorY, HOUSE.z);

  // ----- 제주 돌집 본채 (그림판 대신 진짜 입체) -----
  // 현무암 몸통 + 초가 맞배지붕 + 북쪽(마을 쪽)으로 문과 창 둘.
  // 수리 단계에 따라: 0 허름(어두운 벽·주저앉은 지붕·삐딱한 문) → 1 벽 고침(밝아짐)
  // → 2 지붕 고침(반듯한 새 지붕) → 3 완성(칠한 문·창틀).
  const W = 7.4, D = 5.2, WALL = 2.55;

  // 기단 — 집보다 한 뼘 넓은 받침. 비탈 아래쪽까지 내려가 땅에 닿습니다. (흙갈색)
  const fh = (floorY - lowY) + 1.4;
  const foundationMat = new THREE.MeshLambertMaterial({ color: 0x7d5f42, flatShading: true });
  const foundation = new THREE.Mesh(new THREE.BoxGeometry(W + 0.7, fh, D + 0.7), foundationMat);
  foundation.position.y = -fh / 2 + 0.06;
  foundation.castShadow = true;
  g.add(foundation);

  // 현무암 몸통 — 허름할 때는 그을린 듯 어두운 재질을 씁니다
  const wallDarkMat = shopStoneMat.clone();
  wallDarkMat.color = new THREE.Color(0x9a9a9a);   // 곱하기 색이라 어둡게 눌립니다
  const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(W, WALL, D), shopStoneMat);
  wallMesh.position.y = WALL / 2;
  wallMesh.castShadow = true;
  g.add(wallMesh);

  // 지붕 재질 둘 — 기본은 세월에 거뭇해진 낡은 짚, 상점의 "새 지붕"을 사면 환한 새 짚빛
  const roofOldMat = new THREE.MeshLambertMaterial({ color: 0x5f5340, flatShading: true });
  const roofNewMat = new THREE.MeshLambertMaterial({ color: 0xdcbd6a, flatShading: true });
  // 반듯한 지붕 골조 (수리 2단계부터)
  const roofFine = makeGableRoof(W + 1.3, D + 0.9, 1.5, roofOldMat);
  roofFine.position.y = WALL;
  g.add(roofFine);
  // 주저앉은 옛 지붕 — 살짝 기울고, 마루가 처지고, 군데군데 뚫려 있습니다
  const roofBad = new THREE.Group();
  const rb = makeGableRoof(W + 1.3, D + 0.9, 1.15, roofOldMat);
  rb.rotation.z = 0.055;                       // 한쪽으로 살짝 주저앉음
  rb.position.y = -0.12;
  roofBad.add(rb);
  [[-2.2, 0.72, -1.1], [1.6, 0.8, 1.2], [3.0, 0.55, -0.4]].forEach(([px, py, pz]) => {
    const hole = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 0.9),
      new THREE.MeshLambertMaterial({ color: 0x17130e }));
    hole.position.set(px, py, pz);
    hole.rotation.set(0.2, 0.4, 0.15);
    roofBad.add(hole);
  });
  roofBad.position.y = WALL;
  g.add(roofBad);

  // 문간 — 처음엔 문짝이 없어 시커멓게 뻥 뚫려 있습니다. 상점에서 「대문」을 사면 문짝이 달립니다.
  const doorway = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.05, 0.06),
    new THREE.MeshLambertMaterial({ color: 0x15110c }));
  doorway.position.set(0, 1.0, D / 2 + 0.03);
  g.add(doorway);
  const doorFine = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2.05, 0.1), shopWoodMat);
  doorFine.position.set(0, 1.02, D / 2 + 0.06);
  g.add(doorFine);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), shopWoodDarkMat);
  knob.position.set(0.42, 1.0, D / 2 + 0.13);
  doorFine.userData.knob = knob;
  g.add(knob);
  // 문 위 처마 그늘 띠 — 문간이 벽에 묻히지 않게
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 0.2), shopWoodDarkMat);
  lintel.position.set(0, 2.14, D / 2 + 0.08);
  g.add(lintel);

  // 창 두 짝 — 처음엔 창도 없이 시커먼 구멍만. 상점에서 「창문」을 사면 틀·유리·창살이 달립니다.
  const winHoles = [];
  const winGroup = new THREE.Group();
  const winFrames = [];
  [-2.35, 2.35].forEach((wx) => {
    const hole = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 0.05),
      new THREE.MeshLambertMaterial({ color: 0x15110c }));
    hole.position.set(wx, 1.45, D / 2 + 0.03);
    g.add(hole);
    winHoles.push(hole);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 0.12), shopWoodDarkMat);
    frame.position.set(wx, 1.45, D / 2 + 0.05);
    winGroup.add(frame);
    winFrames.push(frame);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.85, 0.1), truckGlassMat);
    glass.position.set(wx, 1.45, D / 2 + 0.08);
    winGroup.add(glass);
    // 창살 十자
    const barV = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.85, 0.12), shopWoodDarkMat);
    barV.position.set(wx, 1.45, D / 2 + 0.09);
    winGroup.add(barV);
    const barH = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.07, 0.12), shopWoodDarkMat);
    barH.position.set(wx, 1.45, D / 2 + 0.09);
    winGroup.add(barH);
  });
  g.add(winGroup);

  // 문 앞 돌계단 — 기단 위의 문과 마당 땅 사이를 잇습니다
  {
    const gy = groundHeight(HOUSE.x, HOUSE.z + 3.4) - floorY;   // 마당이 바닥보다 얼마나 낮은가 (음수)
    const steps = Math.max(1, Math.min(3, Math.round(-gy / 0.35)));
    for (let i = 0; i < steps; i++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 0.55), shopStoneMat);
      st.position.set(0, -0.11 - i * 0.24, D / 2 + 0.45 + i * 0.5);
      st.castShadow = true;
      g.add(st);
    }
  }

  // 앞마당의 버려진 세간 — 폐가 시절에만 보이고, 다 고치면 치워집니다
  const junk = new THREE.Group();
  [[-2.6, 1.6, 0.5], [2.2, 2.0, 0.4], [0.6, 2.6, 0.3]].forEach(([px, pz, s]) => {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), darkStoneMat);
    rock.position.set(px, s * 0.5, pz);
    rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    rock.castShadow = true;
    junk.add(rock);
  });
  const plank = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.5), citrusTrunkMat);
  plank.position.set(-1.2, 0.1, 2.4);
  plank.rotation.y = 0.6;
  junk.add(plank);
  g.add(junk);

  // 「팝니다」 팻말 — 사고 나면 사라집니다
  const saleC = document.createElement('canvas');
  saleC.width = 192; saleC.height = 96;
  {
    const c2 = saleC.getContext('2d');
    c2.fillStyle = '#c9a06a'; c2.fillRect(0, 0, 192, 96);
    c2.fillStyle = '#3b2410'; c2.textAlign = 'center';
    c2.font = 'bold 40px "맑은 고딕", Malgun Gothic, sans-serif';
    c2.fillText('팝니다', 96, 46);
    c2.font = '500 28px "맑은 고딕", Malgun Gothic, sans-serif';
    c2.fillText('50,000원', 96, 82);
  }
  const saleTex = new THREE.CanvasTexture(saleC);
  saleTex.colorSpace = THREE.SRGBColorSpace;
  const sale = new THREE.Group();
  const salePost = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 6), citrusTrunkMat);
  salePost.position.set(-3.6, 0.8, 3.2);
  sale.add(salePost);
  const saleBoard = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 0.08),
    new THREE.MeshLambertMaterial({ map: saleTex }));
  saleBoard.position.set(-3.6, 1.6, 3.2);
  saleBoard.rotation.y = -0.2;
  sale.add(saleBoard);
  g.add(sale);

  scene.add(g);
  obstacles.push({ x: HOUSE.x, z: HOUSE.z, r: 3.4, topY: NO_JUMP });
  // 지붕 널빤지들(구멍 제외)을 모아둡니다 — "새 지붕"을 사면 이것들만 환한 재질로 바뀝니다
  const roofMeshes = [...roofFine.children, ...rb.children].filter((o) => o.isMesh);
  // 외벽 페인트용 재질 — 칠을 마치면 골라 둔 색이 여기 입혀집니다
  const paintMat = new THREE.MeshLambertMaterial({ color: 0xe8e2d4, flatShading: true });
  return { group: g, wallMesh, wallDarkMat, paintMat, roofFine, roofBad, roofMeshes, roofOldMat, roofNewMat,
           doorway, doorFine, winGroup, winHoles, winFrames, junk, sale };
})();
// (예전의 "그림판 + 뒤채 몸통" 조합은 뺐습니다 — 옆·뒤에서 보면 그림 위로 뒤채 지붕이
//  뚫고 나와 보였고, 비탈에서 뒤채가 공중에 떠 보였습니다. 이제 위의 진짜 돌집 하나입니다)

function applyHouseLook() {
  const s = houseStage;
  // 외벽 — 페인트칠(s>=3)을 마치면 골라 둔 색으로, 그 전엔 그을린 현무암
  if (s >= 3 && housePaintColor) {
    house.paintMat.color.setHex(housePaintColor);
    house.wallMesh.material = house.paintMat;
  } else {
    house.wallMesh.material = house.wallDarkMat;
  }
  // 지붕 — 상점의 "새 지붕"을 사면 주저앉은 골조가 반듯해지고 환한 새 짚빛이 됩니다
  house.roofFine.visible = roofUpgraded;
  house.roofBad.visible = !roofUpgraded;
  const rm = roofUpgraded ? house.roofNewMat : house.roofOldMat;
  for (const m of house.roofMeshes) m.material = rm;
  // 대문·창문은 상점에서 사야 달립니다 — 사기 전엔 시커먼 구멍
  house.doorFine.visible = hasHouseDoor;
  house.doorFine.userData.knob.visible = hasHouseDoor;
  house.winGroup.visible = hasHouseWindow;
  for (const h of house.winHoles) h.visible = !hasHouseWindow;
  for (const f of house.winFrames) f.material = s >= 3 ? shopWoodMat : shopWoodDarkMat;   // 칠 끝나면 창틀도 밝게
  house.junk.visible = s < 3;             // 칠까지 끝나면 마당의 잡동사니가 치워집니다
  house.sale.visible = s < 0;             // 처음부터 루루의 집이라 팻말은 안 보입니다
}
applyHouseLook();

// ---------- 8-2e. 마구간과 조랑말 ----------
// 서쪽 벌판에 초가 마구간이 있고, 안에 제주 조랑말이 서 있습니다 (직접 그리신 그림).
// 이장님 상점에서 당근(1,000원)을 사다 먹이면 애정이 쌓입니다 — 나중에 경마의 밑천이 됩니다.
// 맞배 초가지붕 한 채 — 길이 방향이 X축. 마구간과 헌집 몸통 양쪽에서 돌려 씁니다.
function makeGableRoof(len, span, peak, mat) {
  const g = new THREE.Group();
  const s = span / 2;
  const slope = Math.hypot(s, peak) + 0.25;
  const tilt = Math.atan2(peak, s);
  [1, -1].forEach((side) => {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(len, 0.22, slope), mat);
    panel.position.set(0, peak / 2, side * s / 2);
    panel.rotation.x = side * tilt;
    panel.castShadow = true;
    g.add(panel);
  });
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, len, 6), mat);
  ridge.rotation.z = Math.PI / 2;
  ridge.position.y = peak;
  g.add(ridge);
  return g;
}

const STABLE = { x: -79, z: 8 };   // 서쪽 벌판 (바다에 걸치지 않게 물가에서 한 발 물림)
const STABLE_RANGE = 6.0;
const FEED_RANGE = 3.0;   // 당근은 조랑말 앞까지 가까이 가야 먹일 수 있습니다
const PONY_PRICE = 100000;   // 처음 조랑말은 공짜지만, 죽으면 새로 데려오는 데 이만큼 듭니다
const STABLE_W = 9.0, STABLE_H = 9.0 * 684 / 1019;   // 그림 비율 그대로
// 예전에는 그림 한 장을 세워 뒀는데, 옆에서 보면 종이처럼 얇았습니다.
// 이제 돌벽·나무 기둥·초가지붕의 진짜 헛간을 짓고, 그 안에 조랑말도 통통하게 빚어 세웁니다.
const stable = (() => {
  const g = new THREE.Group();
  const y = groundHeight(STABLE.x, STABLE.z);
  g.position.set(STABLE.x, y, STABLE.z);

  // ----- 초가 헛간 (동쪽으로 열린 마구간) -----
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(3.6, 18),
    new THREE.MeshLambertMaterial({ color: 0x8a6f4d }));
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.y = 0.02;
  g.add(dirt);
  // 뒷벽(서쪽) — 현무암
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.7, 6.6), shopStoneMat);
  back.position.set(-2.2, 1.35, 0);
  back.castShadow = true;
  g.add(back);
  // 옆의 낮은 돌담 두 장
  [-3.3, 3.3].forEach((z) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.9, 0.45), shopStoneMat);
    w.position.set(-0.2, 0.95, z);
    w.castShadow = true;
    g.add(w);
  });
  // 앞 기둥 두 개 (나무)
  [-3.1, 3.1].forEach((z) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 2.9, 7), shopWoodDarkMat);
    p.position.set(2.0, 1.45, z);
    p.castShadow = true;
    g.add(p);
  });
  // 초가 지붕 — 용마루가 남북(z)으로 걸린 맞배지붕
  const roof = makeGableRoof(7.8, 6.0, 1.6, shopThatchMat);
  roof.rotation.y = Math.PI / 2;
  roof.position.set(-0.1, 2.7, 0);
  g.add(roof);
  // 구석의 건초 더미
  const hay = new THREE.Mesh(new THREE.SphereGeometry(0.55, 9, 7),
    new THREE.MeshLambertMaterial({ color: 0xd8b45e, flatShading: true }));
  hay.scale.y = 0.6;
  hay.position.set(-1.4, 0.33, -2.2);
  hay.castShadow = true;
  g.add(hay);

  // ----- 제주 조랑말 — 통통한 몸에 짙은 갈기, 동쪽(섬 안쪽)을 바라봅니다 -----
  const pony = new THREE.Group();
  const coatMat = new THREE.MeshLambertMaterial({ color: 0xa5713f, flatShading: true });
  const maneMat = new THREE.MeshLambertMaterial({ color: 0x46331f, flatShading: true });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.52, 1.05, 5, 10), coatMat);
  body.rotation.z = Math.PI / 2;
  body.position.set(0, 1.15, 0);
  body.castShadow = true;
  pony.add(body);
  const neckM = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.55, 4, 8), coatMat);
  neckM.position.set(0.78, 1.62, 0);
  neckM.rotation.z = -0.7;
  pony.add(neckM);
  const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 8), coatMat);
  head.position.set(1.13, 1.86, 0);
  head.rotation.z = Math.PI / 2 - 0.25;   // 코가 앞으로 살짝 숙인 자세
  head.castShadow = true;
  pony.add(head);
  [-0.11, 0.11].forEach((dz) => {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 5), maneMat);
    ear.position.set(0.98, 2.08, dz);
    pony.add(ear);
  });
  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.12), maneMat);
  mane.position.set(0.68, 1.82, 0);
  mane.rotation.z = -0.7;
  pony.add(mane);
  [[0.55, -0.26], [0.55, 0.26], [-0.55, -0.26], [-0.55, 0.26]].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.85, 6), coatMat);
    leg.position.set(lx, 0.42, lz);
    leg.castShadow = true;
    pony.add(leg);
    const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 6), maneMat);
    hoof.position.set(lx, 0.05, lz);
    pony.add(hoof);
  });
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.75, 6), maneMat);
  tail.position.set(-0.95, 1.0, 0);
  tail.rotation.z = 0.5;
  pony.add(tail);
  pony.position.set(0.1, 0, 0);
  g.add(pony);

  scene.add(g);
  obstacles.push({ x: STABLE.x, z: STABLE.z, r: 2.0, topY: NO_JUMP });   // 조랑말 앞까지 바짝 갈 수 있게 좁힘
  obstacles.push({ x: STABLE.x - 0.2, z: STABLE.z - 3.3, r: 1.4, topY: NO_JUMP });   // 옆 돌담
  obstacles.push({ x: STABLE.x - 0.2, z: STABLE.z + 3.3, r: 1.4, topY: NO_JUMP });
  return { group: g, pony };
})();

// 공구 — 헌집을 고치는 데 필요한 망치·톱·페인트. 이장님 상점 앞 공구대에서 팝니다.
// 공구대 → 페인트 판매대. 망치·톱은 뺐습니다 (벽·지붕은 이제 상점에서 사서 해결).
// 페인트는 색을 골라 사고, 집 앞에서 직접 칠합니다 — 외벽이 고른 색으로 바뀝니다.
const tools = { paint: false };
const PAINT_PRICE = 5000000;      // 외벽 페인트 — 집공사 1억의 한 조각입니다
const PAINT_COLORS = [
  { name: '회벽 하양', color: 0xe8e2d4 },
  { name: '귤빛 노랑', color: 0xe0c368 },
  { name: '노을 주황', color: 0xd98d5a },
  { name: '바다 하늘', color: 0x9fc0d8 },
  { name: '들판 연두', color: 0xa8c078 },
  { name: '동백 분홍', color: 0xd8a8b0 },
  { name: '한라 초록', color: 0x6a9a6a },
  { name: '자주 포도', color: 0x9a6a9a },
  { name: '깊은 바다', color: 0x4a6a8a },
  { name: '벽돌 빨강', color: 0xb05a4a },
  { name: '까망 먹빛', color: 0x4a4a48 },
  { name: '보리 베이지', color: 0xcab894 },
];
// (예전에는 상점 앞 공구대에서 페인트를 팔았지만, 이제 상점 안 인테리어 코너에서 팝니다)

let carrots = 0;      // 들고 있는 당근
let ponyLove = 0;     // 조랑말과 쌓은 애정 (당근 하나에 1씩)
let hasTank = false;  // 해녀 산소통 — 사면 숨이 60초에서 3분으로 늘어납니다
const CARROT_PRICE = 1000;
const TANK_PRICE = 100000;
const TANK_BREATH = 180;   // 산소통을 멘 뒤의 숨 — 3분

// 산소통 판매대 — 상점 정면 동쪽. 당근 바구니(서쪽)와 반대편에 나란히 놓입니다.
const TANK_SPOT = { x: 9.4, z: 42.4 };
const TANK_RANGE = 2.4;
let tankMeshes = null;
{
  const y = groundHeight(TANK_SPOT.x, TANK_SPOT.z);
  const g = new THREE.Group();
  g.position.set(TANK_SPOT.x, y, TANK_SPOT.z);
  const tankMat = new THREE.MeshLambertMaterial({ color: 0xd8862a, flatShading: true });
  const valveMat = new THREE.MeshLambertMaterial({ color: 0x8b8f94, flatShading: true });
  // 받침대와 산소통 두 개 (하나 팔려도 진열은 계속 남습니다)
  const stand = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.6), shopWoodMat);
  stand.position.y = 0.08;
  stand.castShadow = true;
  g.add(stand);
  [-0.26, 0.26].forEach((px) => {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.62, 4, 10), tankMat);
    body.position.set(px, 0.66, 0);
    body.castShadow = true;
    g.add(body);
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 6), valveMat);
    valve.position.set(px, 1.12, 0);
    g.add(valve);
  });
  scene.add(g);
  tankMeshes = g;
}

function tryBuyTank() {
  const y = groundHeight(TANK_SPOT.x, TANK_SPOT.z) + 1.6;
  if (hasTank) {
    spawnMoneyPopup(TANK_SPOT.x, y, TANK_SPOT.z, '이미 산소통이 있어요');
    return;
  }
  if (coins < TANK_PRICE) {
    spawnMoneyPopup(TANK_SPOT.x, y, TANK_SPOT.z, `${(TANK_PRICE - coins).toLocaleString()}원 부족`);
    return;
  }
  coins -= TANK_PRICE;
  hasTank = true;
  BREATH_MAX = TANK_BREATH;   // 지금 물질 중이 아니어도, 다음 잠수부터 바로 적용됩니다
  updateCoinBadge();
  playShipSound();
  spawnMoneyPopup(TANK_SPOT.x, y, TANK_SPOT.z, '🤿 산소통 구입! 숨이 3분으로 늘었어요');
}
// 당근 바구니 — 상점 정면 서쪽에 놓인 판매대입니다. 상점(끈)과 자리를 나눠 씁니다.
const CARROT_SPOT = { x: 3.2, z: 42.6 };
const CARROT_RANGE = 2.4;
{
  const y = groundHeight(CARROT_SPOT.x, CARROT_SPOT.z);
  const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.38, 0.34, 10), shopWoodMat);
  tub.position.set(CARROT_SPOT.x, y + 0.17, CARROT_SPOT.z);
  tub.castShadow = true;
  scene.add(tub);
  const carrotMat = new THREE.MeshLambertMaterial({ color: 0xe06a1d, flatShading: true });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.34, 6), carrotMat);
    c.position.set(CARROT_SPOT.x + Math.cos(a) * 0.24, y + 0.42, CARROT_SPOT.z + Math.sin(a) * 0.24);
    c.rotation.set((Math.random() - 0.5) * 0.9, 0, (Math.random() - 0.5) * 0.9);
    c.castShadow = true;
    scene.add(c);
  }
}

// ---------- 8-2h. 실내 방들 (집 내부 · 상점 내부) ----------
// 문 앞에 서면 화면이 어두워지며 안으로 들어갑니다. 방은 섬에서 멀리 떨어진
// 좌표에 지어두고 루루를 순간이동시키는 방식이라, 밖의 섬과 서로 보이지 않습니다.
// (groundHeight가 이 좌표 범위에서는 방바닥 높이 20을 돌려줍니다)
// 벽은 안쪽 면만 그려서, 카메라가 벽 밖에 있어도 인형의 집처럼 안이 들여다보입니다.
const ROOM = { cx: 400, cz: 400, y: 20, w: 12, d: 9 };        // 루루의 집 내부
const SHOP_ROOM = { cx: 450, cz: 400, y: 20, w: 13, d: 9 };   // 이장님 상점 내부

function buildRoom(R, floorColor, wallColor) {
  const g = new THREE.Group();
  const y0 = R.y;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(R.w, R.d),
    new THREE.MeshLambertMaterial({ color: floorColor })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(R.cx, y0 + 0.01, R.cz);
  floor.receiveShadow = true;
  g.add(floor);
  const wallMat = new THREE.MeshLambertMaterial({ color: wallColor });
  const WALL_H = 3.2;
  const mkWall = (wdt, x, z, ry) => {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(wdt, WALL_H), wallMat);
    w.position.set(x, y0 + WALL_H / 2, z);
    w.rotation.y = ry;
    g.add(w);
  };
  mkWall(R.w, R.cx, R.cz - R.d / 2, 0);            // 북쪽 벽 (안쪽 = +z)
  mkWall(R.w, R.cx, R.cz + R.d / 2, Math.PI);      // 남쪽 벽 (문이 있는 쪽)
  mkWall(R.d, R.cx - R.w / 2, R.cz, Math.PI / 2);  // 서쪽 벽
  mkWall(R.d, R.cx + R.w / 2, R.cz, -Math.PI / 2); // 동쪽 벽
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(R.w, R.d),
    new THREE.MeshLambertMaterial({ color: 0x4a4038 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(R.cx, y0 + WALL_H, R.cz);
  g.add(ceil);
  // 남쪽 벽의 문 — 밖으로 나가는 자리 표시
  const doorMark = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 2.5),
    new THREE.MeshLambertMaterial({ color: 0x2b1d12 })
  );
  doorMark.position.set(R.cx, y0 + 1.25, R.cz + R.d / 2 - 0.03);
  doorMark.rotation.y = Math.PI;
  g.add(doorMark);
  // 문틀 — 어두운 문이 벽에 묻히지 않게 밝은 테두리를 두릅니다
  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 2.9),
    new THREE.MeshLambertMaterial({ color: 0xc9a86a })
  );
  frame.position.set(R.cx, y0 + 1.4, R.cz + R.d / 2 - 0.02);
  frame.rotation.y = Math.PI;
  g.add(frame);
  // 문 위의 안내 팻말 — 여기로 걸어가면 밖으로 나갑니다
  const signC = document.createElement('canvas');
  signC.width = 256; signC.height = 64;
  const sg = signC.getContext('2d');
  sg.fillStyle = '#5e3f24'; sg.fillRect(0, 0, 256, 64);
  sg.strokeStyle = '#c9a86a'; sg.lineWidth = 5; sg.strokeRect(2, 2, 252, 60);
  sg.fillStyle = '#f6edd8'; sg.textAlign = 'center';
  sg.font = 'bold 32px "맑은 고딕", Malgun Gothic, sans-serif';
  sg.fillText('🚪 나가는 곳', 128, 43);
  const signTex = new THREE.CanvasTexture(signC);
  signTex.colorSpace = THREE.SRGBColorSpace;
  const doorSign = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.42),
    new THREE.MeshBasicMaterial({ map: signTex }));
  doorSign.position.set(R.cx, y0 + 3.0, R.cz + R.d / 2 - 0.04);
  doorSign.rotation.y = Math.PI;
  g.add(doorSign);
  // 방을 밝히는 따뜻한 등불
  const lamp = new THREE.PointLight(0xffe0b0, 1.2, 22);
  lamp.position.set(R.cx, y0 + 2.6, R.cz);
  g.add(lamp);
  scene.add(g);
  // 바닥·벽 재질을 돌려줘서, 나중에 바닥재·벽지를 사서 갈 수 있게 합니다
  return { group: g, floorMat: floor.material, wallMat };
}
const houseRoomLook = buildRoom(ROOM, 0x7a6a52, 0x8d8b85);   // 집 안 — 다져진 흙바닥에 돌벽 (폐가답게)
buildRoom(SHOP_ROOM, 0x9a7748, 0xd3b97e);                    // 상점 안 — 나무 바닥에 초가빛 벽

// ---------- 8-2h-2. 가구 (상점에서 사서 집을 꾸밉니다) ----------
// 처음엔 집이 텅 비어서 맨땅에서 잡니다. 상점 안에서 가구를 사면 집 안에 놓입니다.
const FURN_ORDER = ['bed', 'chair', 'closet', 'rug', 'lamp', 'plant', 'shelf', 'painting', 'window', 'tv', 'tvstand', 'kitchen',
                    'island', 'sofa', 'sink', 'coffeetable', 'washer', 'fridge', 'roof', 'door',
                    'palm', 'lawn', 'stones', 'gardenlight', 'cycad'];
// 마당 조경 아이템 — 방 안이 아니라 집 앞마당(실제 지형 위)에 심습니다
const YARD_KEYS = new Set(['palm', 'lawn', 'stones', 'gardenlight', 'cycad']);
// 집 자체에 다는 것들 — 방에 놓는 물건이 아니라 집의 겉모습을 바꿉니다 (처음엔 지붕은 낡고, 문·창문은 아예 없음)
const HOUSE_PART_KEYS = new Set(['roof', 'door', 'window']);
// 집공사 총액은 딱 1억 원입니다:
// 실내 18종 5,200만 + 지붕·대문 900만 + 외벽 페인트 500만 + 마당 조경 5종 2,400만 + 바닥 400만 + 벽지 600만.
// 서울의 20억 아파트 대신, 제주에서 1억으로 완성하는 내 집 — 루루의 꿈의 가격표입니다.
const FURNITURE = {
  bed:      { name: '침대',        price: 4000000 },
  chair:    { name: '의자',        price: 1500000 },
  closet:   { name: '옷장',        price: 3500000 },
  rug:      { name: '러그',        price: 1000000 },
  lamp:     { name: '스탠드 조명', price: 2000000 },
  plant:    { name: '화분',        price: 500000 },
  shelf:    { name: '책장',        price: 2500000 },
  painting: { name: '벽걸이 그림', price: 1500000 },
  window:   { name: '창문',        price: 4000000 },
  tv:       { name: '텔레비전',    price: 5000000 },   // 티비다이가 먼저 있어야 놓을 수 있습니다
  tvstand:  { name: '티비다이',    price: 1500000 },
  kitchen:  { name: '부엌 찬장',   price: 5000000 },
  island:   { name: '아일랜드 식탁', price: 2500000 },
  sofa:     { name: '소파',        price: 4500000 },
  sink:     { name: '싱크대',      price: 3000000 },
  coffeetable: { name: '소파 테이블', price: 2000000 },
  washer:   { name: '세탁기',      price: 3500000 },
  fridge:   { name: '냉장고',      price: 4500000 },
  roof:     { name: '새 지붕',     price: 5000000 },   // 낡아 거뭇한 지붕이 환한 새 짚빛으로
  door:     { name: '대문',        price: 4000000 },   // 처음엔 문짝 없이 뻥 뚫려 있습니다
  palm:        { name: '야자수',    price: 7000000 },
  lawn:        { name: '잔디밭',    price: 5000000 },
  stones:      { name: '조경석',    price: 4000000 },
  gardenlight: { name: '마당 조명', price: 5000000 },
  cycad:       { name: '소철나무',  price: 3000000 },   // 잔디 마당에 심는 둥근 소철
};
function emptyFurnOwned() {
  const o = {};
  for (const k of FURN_ORDER) o[k] = false;
  return o;
}
let furnitureOwned = emptyFurnOwned();

// 가구 만들기 — 집 배치용과 상점 진열용 양쪽에서 씁니다
const furnWoodMat = new THREE.MeshLambertMaterial({ color: 0x8a6038, flatShading: true });
const furnDarkMat = new THREE.MeshLambertMaterial({ color: 0x5e3f24, flatShading: true });
const furnClothMat = new THREE.MeshLambertMaterial({ color: 0xf6ebd8, flatShading: true });
const furnBlanketMat = new THREE.MeshLambertMaterial({ color: 0xe09a52, flatShading: true });
function makeBedMesh() {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 1.4), furnWoodMat);
  frame.position.y = 0.18;
  g.add(frame);
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.2, 1.25), furnClothMat);
  mattress.position.y = 0.45;
  g.add(mattress);
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 1.28), furnBlanketMat);
  blanket.position.set(-0.4, 0.58, 0);
  g.add(blanket);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.8), furnClothMat);
  pillow.position.set(0.8, 0.6, 0);
  g.add(pillow);
  return g;
}
function makeChairMesh() {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.55), furnWoodMat);
  seat.position.y = 0.45;
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.08), furnWoodMat);
  back.position.set(0, 0.78, 0.24);
  g.add(back);
  [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.45, 0.07), furnDarkMat);
    leg.position.set(lx, 0.22, lz);
    g.add(leg);
  });
  return g;
}
function makeTableMesh() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 1.1), furnWoodMat);
  top.position.y = 0.78;
  g.add(top);
  [[-0.8, -0.42], [0.8, -0.42], [-0.8, 0.42], [0.8, 0.42]].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.78, 0.1), furnDarkMat);
    leg.position.set(lx, 0.39, lz);
    g.add(leg);
  });
  return g;
}
function makeClosetMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.5, 0.7), furnWoodMat);
  body.position.y = 1.25;
  g.add(body);
  const split = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.3, 0.04), furnDarkMat);
  split.position.set(0, 1.25, 0.36);
  g.add(split);
  [-0.28, 0.28].forEach((hx) => {
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), furnDarkMat);
    knob.position.set(hx, 1.25, 0.38);
    g.add(knob);
  });
  return g;
}
function makeRugMesh() {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.04, 20),
    new THREE.MeshLambertMaterial({ color: 0xc96a4a }));
  outer.position.y = 0.02;
  g.add(outer);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.05, 20),
    new THREE.MeshLambertMaterial({ color: 0xe8b88a }));
  inner.position.y = 0.025;
  g.add(inner);
  return g;
}
function makeLampMesh() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.08, 10), furnDarkMat);
  base.position.y = 0.04;
  g.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 6), furnDarkMat);
  pole.position.y = 0.8;
  g.add(pole);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.45, 10, 1, true),
    new THREE.MeshLambertMaterial({ color: 0xf2d8a0, side: THREE.DoubleSide }));
  shade.position.y = 1.65;
  g.add(shade);
  const glow = new THREE.PointLight(0xffe0b0, 0.7, 7);
  glow.position.y = 1.5;
  g.add(glow);
  return g;
}
function makePlantMesh() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.4, 10),
    new THREE.MeshLambertMaterial({ color: 0xb56a3c, flatShading: true }));
  pot.position.y = 0.2;
  g.add(pot);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x4f8a3c, flatShading: true });
  [[0, 0.75, 0, 0.34], [-0.18, 0.6, 0.1, 0.22], [0.16, 0.62, -0.12, 0.24]].forEach(([x, y, z, r]) => {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leafMat);
    leaf.position.set(x, y, z);
    g.add(leaf);
  });
  return g;
}
function makeShelfMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.0, 0.45), furnWoodMat);
  body.position.y = 1.0;
  g.add(body);
  const bookCols = [0xc0574f, 0x4f7ac0, 0x5a9a55, 0xd9a441, 0x8a5fa0];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 5; i++) {
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4, 0.3),
        new THREE.MeshLambertMaterial({ color: bookCols[(row * 2 + i) % 5] }));
      book.position.set(-0.55 + i * 0.27, 0.5 + row * 0.6, 0.1);
      g.add(book);
    }
  }
  return g;
}
function makePaintingMesh() {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.08), furnDarkMat);
  frame.position.y = 2.0;
  g.add(frame);
  const canvasMat = CAN_USE_IMAGES
    ? new THREE.MeshLambertMaterial({ map: loadTexture('../assets/farmcat/scene_farm.webp') })
    : new THREE.MeshLambertMaterial({ color: 0xf6ebd8 });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(1.32, 0.94), canvasMat);
  art.position.set(0, 2.0, 0.05);
  g.add(art);
  return g;
}
function makeWindowMesh() {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.3, 0.1), furnWoodMat);
  frame.position.y = 1.9;
  g.add(frame);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1),
    new THREE.MeshBasicMaterial({ color: 0xa9d3ea }));
  pane.position.set(0, 1.9, 0.06);
  g.add(pane);
  const barV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.15, 0.04), furnWoodMat);
  barV.position.set(0, 1.9, 0.08);
  g.add(barV);
  const barH = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.06, 0.04), furnWoodMat);
  barH.position.set(0, 1.9, 0.08);
  g.add(barH);
  return g;
}
function makeTvMesh() {
  const g = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.5), furnDarkMat);
  stand.position.y = 0.25;
  g.add(stand);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.12),
    new THREE.MeshLambertMaterial({ color: 0x22242a, flatShading: true }));
  body.position.y = 1.05;
  g.add(body);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.76),
    new THREE.MeshBasicMaterial({ color: 0x3a5a7a }));
  screen.position.set(0, 1.05, 0.07);
  g.add(screen);
  return g;
}
function makeKitchenMesh() {
  const g = new THREE.Group();
  const lower = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 0.7), furnWoodMat);
  lower.position.y = 0.45;
  g.add(lower);
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 0.78),
    new THREE.MeshLambertMaterial({ color: 0x8d8b85 }));
  top.position.y = 0.94;
  g.add(top);
  const sink = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.06, 12),
    new THREE.MeshLambertMaterial({ color: 0xc9ccd0 }));
  sink.position.set(-0.5, 0.99, 0);
  g.add(sink);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.6, 0.4), furnWoodMat);
  upper.position.set(0, 2.0, -0.15);
  g.add(upper);
  [-0.5, 0.5].forEach((x) => {
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), furnDarkMat);
    knob.position.set(x, 0.55, 0.36);
    g.add(knob);
  });
  return g;
}
// ----- 아일랜드 식탁 (부엌 앞에 놓는 조리대 겸 식탁) -----
function makeIslandMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.72, 0.7), furnWoodMat);
  body.position.y = 0.36;
  g.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.07, 0.9),
    new THREE.MeshLambertMaterial({ color: 0xd8cdb8, flatShading: true }));
  top.position.y = 0.76;
  g.add(top);
  [-0.45, 0.45].forEach((x) => {                          // 앞에 걸린 등받이 없는 의자 둘
    const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.42, 8), furnDarkMat);
    stool.position.set(x, 0.21, 0.62);
    g.add(stool);
  });
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xc9762e, flatShading: true }));
  bowl.position.set(0.3, 0.85, 0);
  bowl.scale.y = 0.55;
  g.add(bowl);
  return g;
}
// ----- 마당 조경 — 야자수·잔디밭·조경석·마당 조명 (집 밖 지형 위에 놓입니다) -----
function makePalmMesh() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 2.8, 7), furnWoodMat);
  trunk.position.set(0.08, 1.4, 0);
  trunk.rotation.z = -0.1;
  trunk.castShadow = true;
  g.add(trunk);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f8a4a, flatShading: true });
  for (let i = 0; i < 6; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 6) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.8, 4), leafMat);
    leaf.position.x = 0.8;
    leaf.rotation.z = Math.PI / 2 + 0.55;   // 바깥으로 뻗으며 살짝 처진 잎
    leaf.scale.z = 0.35;
    leaf.castShadow = true;
    arm.add(leaf);
    arm.position.y = 2.85;
    g.add(arm);
  }
  const nutMat = new THREE.MeshLambertMaterial({ color: 0x6b4a26, flatShading: true });
  [[0.2, 0.1], [-0.12, 0.18], [0, -0.2]].forEach(([x, z]) => {
    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 6), nutMat);
    nut.position.set(x, 2.7, z);
    g.add(nut);
  });
  return g;
}
function makeLawnMesh() {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CircleGeometry(2.1, 20),
    new THREE.MeshLambertMaterial({ color: 0x69b04a }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.05;
  g.add(pad);
  const flowerMat = new THREE.MeshLambertMaterial({ color: 0xfff3d6 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), flowerMat);
    f.position.set(Math.cos(a) * (0.6 + (i % 3) * 0.4), 0.1, Math.sin(a) * (0.6 + (i % 3) * 0.4));
    g.add(f);
  }
  return g;
}
function makeStonesMesh() {
  const g = new THREE.Group();
  const stoneMat2 = new THREE.MeshLambertMaterial({ color: 0xb9b4a8, flatShading: true });
  [[0, 0, 0.55, 0.4], [0.75, 0.25, 0.36, 1.9], [-0.62, 0.3, 0.42, 3.1]].forEach(([px, pz, s, r]) => {
    const st = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), stoneMat2);
    st.position.set(px, s * 0.55, pz);
    st.rotation.set(r, r * 1.3, r * 0.7);
    st.castShadow = true;
    g.add(st);
  });
  return g;
}
function makeGardenLightMesh() {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.0, 7), furnDarkMat);
  post.position.y = 1.0;
  post.castShadow = true;
  g.add(post);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 9, 7),
    new THREE.MeshBasicMaterial({ color: 0xffdca0 }));   // 스스로 빛나는 갓
  head.position.y = 2.08;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.16, 8), furnDarkMat);
  cap.position.y = 2.26;
  g.add(cap);
  const glow = new THREE.PointLight(0xffdca0, 0.9, 9);
  glow.position.y = 2.08;
  g.add(glow);
  return g;
}
// 상점 진열용 모형 — 새 지붕(견본 지붕 조각)과 대문(문짝)
function makeRoofItemMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xdcbd6a, flatShading: true });
  const r = makeGableRoof(1.6, 1.2, 0.5, mat);
  r.position.y = 0.55;
  g.add(r);
  [-0.6, 0.6].forEach((x) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6), shopWoodDarkMat);
    p.position.set(x, 0.28, 0);
    g.add(p);
  });
  return g;
}
function makeDoorItemMesh() {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.62, 0.05), shopWoodDarkMat);
  frame.position.set(0, 0.78, -0.03);
  g.add(frame);
  const plank = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.5, 0.08), shopWoodMat);
  plank.position.y = 0.75;
  g.add(plank);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), shopWoodDarkMat);
  knob.position.set(0.28, 0.72, 0.08);
  g.add(knob);
  return g;
}
// ----- 거실 세간 — 소파·소파 테이블·티비다이, 부엌의 싱크대 -----
function makeSofaMesh() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 0.75), furnClothMat);
  base.position.y = 0.32;
  g.add(base);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 0.22), furnClothMat);
  back.position.set(0, 0.72, -0.28);
  g.add(back);
  [-0.78, 0.78].forEach((x) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.7), furnClothMat);
    arm.position.set(x, 0.62, 0);
    g.add(arm);
  });
  [-0.42, 0.42].forEach((x) => {                        // 방석 자국
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.1, 0.6),
      new THREE.MeshLambertMaterial({ color: 0xc9a86a, flatShading: true }));
    cushion.position.set(x, 0.56, 0.04);
    g.add(cushion);
  });
  return g;
}
function makeCoffeeTableMesh() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.07, 0.6), furnWoodMat);
  top.position.y = 0.38;
  g.add(top);
  [[-0.46, -0.22], [0.46, -0.22], [-0.46, 0.22], [0.46, 0.22]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.38, 0.07), furnDarkMat);
    leg.position.set(x, 0.19, z);
    g.add(leg);
  });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.09, 8),
    new THREE.MeshLambertMaterial({ color: 0xe8e0cc }));
  cup.position.set(0.25, 0.46, 0.1);
  g.add(cup);
  return g;
}
function makeTvStandMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 0.5), furnWoodMat);
  body.position.y = 0.32;
  g.add(body);
  [[-0.6, 0], [0.6, 0]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.4), furnDarkMat);
    leg.position.set(x, 0.06, z);
    g.add(leg);
  });
  const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.04), furnDarkMat);
  drawer.position.set(0, 0.32, 0.26);
  g.add(drawer);
  return g;
}
function makeSinkMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.6), furnWoodMat);
  body.position.y = 0.4;
  g.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.68),
    new THREE.MeshLambertMaterial({ color: 0xc7c9c4, flatShading: true }));
  top.position.y = 0.83;
  g.add(top);
  const basin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.4),
    new THREE.MeshLambertMaterial({ color: 0x9aa0a2, flatShading: true }));
  basin.position.set(-0.25, 0.85, 0);
  g.add(basin);
  const faucet = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6),
    new THREE.MeshLambertMaterial({ color: 0x8a9094 }));
  faucet.position.set(-0.25, 1.0, -0.2);
  g.add(faucet);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 6),
    new THREE.MeshLambertMaterial({ color: 0x8a9094 }));
  spout.rotation.x = Math.PI / 2;
  spout.position.set(-0.25, 1.13, -0.1);
  g.add(spout);
  return g;
}
// ----- 가전 — 세탁기·냉장고 -----
const applianceMat = new THREE.MeshLambertMaterial({ color: 0xe6e4de, flatShading: true });
const applianceDarkMat = new THREE.MeshLambertMaterial({ color: 0x8f948f, flatShading: true });
function makeWasherMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.85, 0.7), applianceMat);
  body.position.y = 0.43;
  g.add(body);
  const doorRing = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 14), applianceDarkMat);
  doorRing.rotation.x = Math.PI / 2;
  doorRing.position.set(0, 0.45, 0.36);
  g.add(doorRing);
  const glassM = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 12),
    new THREE.MeshLambertMaterial({ color: 0x5a6a72 }));
  glassM.rotation.x = Math.PI / 2;
  glassM.position.set(0, 0.45, 0.38);
  g.add(glassM);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.04), applianceDarkMat);
  panel.position.set(0, 0.8, 0.34);
  g.add(panel);
  return g;
}
function makeFridgeMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.7, 0.7), applianceMat);
  body.position.y = 0.85;
  g.add(body);
  const split = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.03, 0.72), applianceDarkMat);
  split.position.y = 1.15;
  g.add(split);
  [[1.32, 0.5], [0.85, 0.45]].forEach(([hy, hl]) => {   // 손잡이 둘 (냉장/냉동)
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.05, hl, 0.05), applianceDarkMat);
    h.position.set(-0.3, hy, 0.39);
    g.add(h);
  });
  return g;
}
// ----- 소철나무 — 잔디 마당에 심는 둥근 소철 -----
function makeCycadMesh() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.55, 8),
    new THREE.MeshLambertMaterial({ color: 0x7a6244, flatShading: true }));
  trunk.position.y = 0.28;
  trunk.castShadow = true;
  g.add(trunk);
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x2f6e38, flatShading: true });
  for (let i = 0; i < 10; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 10) * Math.PI * 2;
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.11, 1.0, 4), frondMat);
    frond.position.x = 0.42;
    frond.rotation.z = Math.PI / 2 + 0.85;   // 낮게 활처럼 휘어진 잎
    frond.scale.z = 0.3;
    frond.castShadow = true;
    arm.add(frond);
    arm.position.y = 0.55;
    g.add(arm);
  }
  return g;
}
const FURN_BUILDERS = {
  bed: makeBedMesh, chair: makeChairMesh, closet: makeClosetMesh,
  rug: makeRugMesh, lamp: makeLampMesh, plant: makePlantMesh, shelf: makeShelfMesh,
  painting: makePaintingMesh, window: makeWindowMesh, tv: makeTvMesh, tvstand: makeTvStandMesh,
  kitchen: makeKitchenMesh, island: makeIslandMesh, sofa: makeSofaMesh, sink: makeSinkMesh,
  coffeetable: makeCoffeeTableMesh, washer: makeWasherMesh, fridge: makeFridgeMesh,
  roof: makeRoofItemMesh, door: makeDoorItemMesh,
  palm: makePalmMesh, lawn: makeLawnMesh, stones: makeStonesMesh, gardenlight: makeGardenLightMesh,
  cycad: makeCycadMesh,
};

// 집 안에 실제로 놓이는 가구 — 사기 전에는 숨겨져 있습니다
const furnitureMeshes = {};
{
  const spots = {
    bed:      [ROOM.cx - 4.2, ROOM.cz - 2.4, 0],
    chair:    [ROOM.cx - 1.6, ROOM.cz - 1.0, 0],           // 아일랜드 식탁 곁
    closet:   [ROOM.cx + 4.4, ROOM.cz - 3.7, 0],
    rug:      [ROOM.cx + 2.4, ROOM.cz + 0.6, 0],           // 소파와 테이블 아래 깔개
    lamp:     [ROOM.cx - 4.6, ROOM.cz + 2.6, 0],           // 남서쪽 구석
    plant:    [ROOM.cx + 4.8, ROOM.cz + 2.8, 0],           // 남동쪽 구석
    shelf:    [ROOM.cx - 1.4, ROOM.cz - 3.9, 0],           // 북쪽 벽
    painting: [ROOM.cx - 3.2, ROOM.cz - 4.4, 0],           // 북쪽 벽에 걸림
    window:   [ROOM.cx + 1.0, ROOM.cz - 4.4, 0],           // 북쪽 벽 창문
    tv:       [ROOM.cx + 4.9, ROOM.cz + 0.8, -Math.PI / 2],// 동쪽 벽을 등지고 — 티비다이 위에 올라갑니다
    tvstand:  [ROOM.cx + 4.9, ROOM.cz + 0.8, -Math.PI / 2],// 티비 받침장 (같은 자리 아래)
    kitchen:  [ROOM.cx - 4.5, ROOM.cz - 3.9, 0],           // 북서쪽 부엌 자리
    sink:     [ROOM.cx - 2.9, ROOM.cz - 3.9, 0],           // 부엌 찬장 옆 싱크대
    island:   [ROOM.cx - 3.0, ROOM.cz - 2.0, 0],           // 부엌 앞의 조리대 겸 식탁
    sofa:     [ROOM.cx + 2.4, ROOM.cz + 1.9, Math.PI],     // 거실 — 방 안쪽을 바라보는 소파
    coffeetable: [ROOM.cx + 2.4, ROOM.cz + 0.6, 0],        // 소파 앞 테이블
    fridge:   [ROOM.cx - 4.8, ROOM.cz - 0.6, Math.PI / 2], // 서쪽 벽 — 부엌 가까이 냉장고
    washer:   [ROOM.cx - 4.8, ROOM.cz + 0.9, Math.PI / 2], // 그 옆에 세탁기
  };
  // 마당 조경은 방이 아니라 집 바깥 실제 지형 위에 심습니다
  const yardSpots = {
    palm:        [HOUSE.x - 1.5, HOUSE.z - 5.4, 0.5],      // 집 뒤(남쪽 바다 쪽) 야자수
    lawn:        [HOUSE.x + 4.6, HOUSE.z + 5.2, 0],        // 앞마당 잔디밭
    stones:      [HOUSE.x - 4.6, HOUSE.z + 5.8, 0.9],      // 앞마당 조경석
    gardenlight: [HOUSE.x + 2.6, HOUSE.z + 4.0, 0],        // 문 앞 돌계단 옆 마당 조명
    cycad:       [HOUSE.x + 5.5, HOUSE.z + 4.4, 1.2],      // 잔디밭 가장자리의 소철나무
  };
  for (const k of FURN_ORDER) {
    if (k === 'roof' || k === 'door') continue;   // 지붕·대문은 물건이 아니라 집 자체를 바꿉니다 (applyHouseLook)
    const g = FURN_BUILDERS[k]();
    const ys = yardSpots[k];
    if (ys) {
      g.position.set(ys[0], groundHeight(ys[0], ys[1]), ys[1]);
      g.rotation.y = ys[2];
    } else {
      // 텔레비전은 티비다이 위에 올라갑니다 (다이 높이만큼 띄움)
      const lift = k === 'tv' ? 0.48 : 0;
      g.position.set(spots[k][0], ROOM.y + lift, spots[k][1]);
      g.rotation.y = spots[k][2];
    }
    g.visible = false;
    scene.add(g);
    furnitureMeshes[k] = g;
  }
}
function applyFurniture() {
  for (const k of FURN_ORDER) {
    if (furnitureMeshes[k]) furnitureMeshes[k].visible = furnitureOwned[k];
  }
  // 지붕·대문·창문은 놓는 물건이 아니라 집 자체의 모습을 바꿉니다
  roofUpgraded = !!furnitureOwned.roof;
  hasHouseDoor = !!furnitureOwned.door;
  hasHouseWindow = !!furnitureOwned.window;
  applyHouseLook();
}

// ---------- 8-2h-3. 망사리 (물질 필수품 — 등에 메고 다니는 실물) ----------
// 해녀는 망사리(그물 자루)에 잡은 것을 담습니다. 이게 있어야 물질을 나갈 수 있고,
// 상자처럼 실제 물건이라 등에 메고 다니다가 내려놓을 수도 있습니다. 상점 안에서 팝니다.
let hasNet = false;       // 망사리를 샀는지
let netCarried = false;   // 지금 등에 메고 있는지 (내려놓으면 그 자리에 놓입니다)
const NET_PRICE = 10000;
const NET_PICK_RANGE = 2.2;

// 망사리 한 개 — 그물을 씌운 자루에, 해녀들이 쓰는 주황 부표(테왁)를 달았습니다
function makeNetBag() {
  const g = new THREE.Group();
  const bagMat = new THREE.MeshLambertMaterial({ color: 0xc9a86a, flatShading: true });
  const netMat = new THREE.MeshBasicMaterial({ color: 0x6b5537, wireframe: true });
  const tewakMat = new THREE.MeshLambertMaterial({ color: 0xe0762e, flatShading: true });
  const bag = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 7), bagMat);
  bag.scale.set(1, 1.25, 1);
  bag.position.y = 0.34;
  bag.castShadow = true;
  g.add(bag);
  const netOver = new THREE.Mesh(new THREE.SphereGeometry(0.29, 8, 7), netMat);
  netOver.scale.copy(bag.scale);
  netOver.position.copy(bag.position);
  g.add(netOver);
  const tewak = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 7), tewakMat);
  tewak.position.set(0.17, 0.76, 0);
  tewak.castShadow = true;
  g.add(tewak);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.028, 6, 10), shopRopeMat);
  ring.position.y = 0.7;
  g.add(ring);
  return g;
}
// 루루가 실제로 들고 다니는 망사리 — 사기 전에는 숨겨져 있습니다
const netObj = makeNetBag();
netObj.visible = false;
scene.add(netObj);

// 등에서 내려 발 앞에 놓기 / 다시 주워 메기
function dropNet() {
  netCarried = false;
  const fx = state.x + Math.sin(state.facing) * 0.8;
  const fz = state.z + Math.cos(state.facing) * 0.8;
  netObj.position.set(fx, groundHeight(fx, fz), fz);
  netObj.rotation.y = state.facing;
  playDropSound();
  spawnMoneyPopup(fx, groundHeight(fx, fz) + 1.2, fz, '🧺 망사리를 내려놨어요');
}
function pickUpNet() {
  netCarried = true;
  playPickSound();
  spawnMoneyPopup(state.x, groundHeight(state.x, state.z) + 1.4, state.z, '🧺 망사리를 챙겼어요');
}
// 메고 있는 동안 루루 등(허리께)에 딱 붙어 다닙니다 (매 프레임 호출)
const netFollow = new THREE.Vector3();
function updateNet(dt, t) {
  if (!netCarried) return;
  // 잠수복 차림 그림(물속·포구)에는 망사리가 이미 그려져 있어서,
  // 실물까지 보이면 루루를 가립니다 — 그때는 실물을 숨깁니다.
  netObj.visible = hasNet && !state.diving && !inWetsuitZone();
  if (!netObj.visible) return;
  const back = state.facing + Math.PI;
  // 몸에 살짝 겹칠 만큼 바짝(0.28), 허리 높이(0.35)에 붙입니다 — 허공에 떠 보이지 않게
  netFollow.set(
    state.x + Math.sin(back) * 0.28,
    lulu.position.y + 0.35 + Math.sin(t * 5) * 0.015,
    state.z + Math.cos(back) * 0.28
  );
  netObj.position.lerp(netFollow, 1 - Math.pow(0.000001, dt));   // 거의 즉시 따라붙습니다
  netObj.rotation.y = state.facing;
}

// ---------- 8-2h-4. 상점 안 진열대 (가격표 달고, F로 구입) ----------
// 상점 문으로 들어오면 당근·산소통·망사리·가구가 가격표와 함께 진열되어 있습니다.
// 물건 앞에 서서 F(🐾)를 누르면 삽니다.
function makePriceSign(name, price) {
  const c = document.createElement('canvas');
  c.width = 192; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#f0e4c8'; g.fillRect(0, 0, 192, 96);
  g.strokeStyle = '#8a6038'; g.lineWidth = 6; g.strokeRect(3, 3, 186, 90);
  g.fillStyle = '#3b2410'; g.textAlign = 'center';
  g.font = 'bold 34px "맑은 고딕", Malgun Gothic, sans-serif';
  g.fillText(name, 96, 40);
  g.fillStyle = '#b3541e';
  g.font = 'bold 30px "맑은 고딕", Malgun Gothic, sans-serif';
  g.fillText(price.toLocaleString() + '원', 96, 78);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 판매 물품 목록 — 진열 위치는 북쪽 벽을 따라 한 줄입니다
const SHOP_GOODS = [
  { key: 'carrot', name: '당근',   emoji: '🥕', get price() { return CARROT_PRICE; },
    x: SHOP_ROOM.cx - 4.6, z: SHOP_ROOM.cz - 3.4 },
  { key: 'tank',   name: '산소통', emoji: '🤿', get price() { return TANK_PRICE; },
    x: SHOP_ROOM.cx - 3.0, z: SHOP_ROOM.cz - 3.4 },
  { key: 'net',    name: '망사리', emoji: '🧺', get price() { return NET_PRICE; },
    x: SHOP_ROOM.cx - 1.4, z: SHOP_ROOM.cz - 3.4 },
  { key: 'bed',    name: '침대',   emoji: '🛏', get price() { return FURNITURE.bed.price; },
    x: SHOP_ROOM.cx + 0.6, z: SHOP_ROOM.cz - 3.3 },
  { key: 'sofa',   name: '소파',   emoji: '🛋', get price() { return FURNITURE.sofa.price; },
    x: SHOP_ROOM.cx + 2.4, z: SHOP_ROOM.cz - 3.3 },
  { key: 'chair',  name: '의자',   emoji: '🪑', get price() { return FURNITURE.chair.price; },
    x: SHOP_ROOM.cx + 3.9, z: SHOP_ROOM.cz - 3.3 },
  { key: 'closet', name: '옷장',   emoji: '🧥', get price() { return FURNITURE.closet.price; },
    x: SHOP_ROOM.cx + 5.3, z: SHOP_ROOM.cz - 3.3 },
  // ----- 동쪽 벽 — 집꾸미기 소품 코너 -----
  { key: 'rug',      name: '러그',        emoji: '🧶', get price() { return FURNITURE.rug.price; },
    x: SHOP_ROOM.cx + 5.5, z: SHOP_ROOM.cz - 2.2, rot: -Math.PI / 2 },
  { key: 'lamp',     name: '스탠드 조명', emoji: '💡', get price() { return FURNITURE.lamp.price; },
    x: SHOP_ROOM.cx + 5.5, z: SHOP_ROOM.cz - 1.25, rot: -Math.PI / 2 },
  { key: 'plant',    name: '화분',        emoji: '🪴', get price() { return FURNITURE.plant.price; },
    x: SHOP_ROOM.cx + 5.5, z: SHOP_ROOM.cz - 0.3, rot: -Math.PI / 2 },
  { key: 'shelf',    name: '책장',        emoji: '📚', get price() { return FURNITURE.shelf.price; },
    x: SHOP_ROOM.cx + 5.5, z: SHOP_ROOM.cz + 0.65, rot: -Math.PI / 2 },
  { key: 'painting', name: '벽걸이 그림', emoji: '🖼', get price() { return FURNITURE.painting.price; },
    x: SHOP_ROOM.cx + 5.5, z: SHOP_ROOM.cz + 1.6, rot: -Math.PI / 2 },
  { key: 'window',   name: '창문',        emoji: '🪟', get price() { return FURNITURE.window.price; },
    x: SHOP_ROOM.cx + 5.5, z: SHOP_ROOM.cz + 2.55, rot: -Math.PI / 2 },
  { key: 'tv',       name: '텔레비전',    emoji: '📺', get price() { return FURNITURE.tv.price; },
    x: SHOP_ROOM.cx + 5.5, z: SHOP_ROOM.cz + 3.5, rot: -Math.PI / 2 },
  { key: 'kitchen',  name: '부엌 찬장',   emoji: '🍳', get price() { return FURNITURE.kitchen.price; },
    x: SHOP_ROOM.cx + 4.2, z: SHOP_ROOM.cz + 3.6, rot: Math.PI },
  { key: 'island',   name: '아일랜드 식탁', emoji: '🍽', get price() { return FURNITURE.island.price; },
    x: SHOP_ROOM.cx + 2.6, z: SHOP_ROOM.cz + 3.6, rot: Math.PI },
  { key: 'roof',     name: '새 지붕',     emoji: '🛖', get price() { return FURNITURE.roof.price; },
    x: SHOP_ROOM.cx + 1.2, z: SHOP_ROOM.cz + 3.6, rot: Math.PI },
  { key: 'door',     name: '대문',        emoji: '🚪', get price() { return FURNITURE.door.price; },
    x: SHOP_ROOM.cx - 0.4, z: SHOP_ROOM.cz - 3.4 },
  // ----- 매장 가운데 통로 — 거실·부엌 세간 진열 -----
  { key: 'tvstand',     name: '티비다이',    emoji: '🗄', get price() { return FURNITURE.tvstand.price; },
    x: SHOP_ROOM.cx + 1.4, z: SHOP_ROOM.cz + 1.9, rot: Math.PI },
  { key: 'coffeetable', name: '소파 테이블', emoji: '🫖', get price() { return FURNITURE.coffeetable.price; },
    x: SHOP_ROOM.cx + 3.6, z: SHOP_ROOM.cz + 1.9, rot: Math.PI },
  { key: 'sink',        name: '싱크대',      emoji: '🚰', get price() { return FURNITURE.sink.price; },
    x: SHOP_ROOM.cx - 3.4, z: SHOP_ROOM.cz + 1.8 },
  // ----- 남쪽 벽(문 서쪽) — 마당 조경 코너 -----
  { key: 'palm',        name: '야자수',    emoji: '🌴', get price() { return FURNITURE.palm.price; },
    x: SHOP_ROOM.cx - 5.6, z: SHOP_ROOM.cz + 3.5, rot: Math.PI },
  { key: 'lawn',        name: '잔디밭',    emoji: '🌱', get price() { return FURNITURE.lawn.price; },
    x: SHOP_ROOM.cx - 4.5, z: SHOP_ROOM.cz + 3.5, rot: Math.PI },
  { key: 'stones',      name: '조경석',    emoji: '🪨', get price() { return FURNITURE.stones.price; },
    x: SHOP_ROOM.cx - 3.4, z: SHOP_ROOM.cz + 3.5, rot: Math.PI },
  { key: 'gardenlight', name: '마당 조명', emoji: '🏮', get price() { return FURNITURE.gardenlight.price; },
    x: SHOP_ROOM.cx - 2.3, z: SHOP_ROOM.cz + 3.5, rot: Math.PI },
  { key: 'cycad',       name: '소철나무',  emoji: '🌵', get price() { return FURNITURE.cycad.price; },
    x: SHOP_ROOM.cx - 1.2, z: SHOP_ROOM.cz + 3.5, rot: Math.PI },
  // ----- 매장 가운데 통로 — 가전 -----
  { key: 'washer', name: '세탁기', emoji: '👕', get price() { return FURNITURE.washer.price; },
    x: SHOP_ROOM.cx - 1.2, z: SHOP_ROOM.cz + 1.9 },
  { key: 'fridge', name: '냉장고', emoji: '🧊', get price() { return FURNITURE.fridge.price; },
    x: SHOP_ROOM.cx - 2.3, z: SHOP_ROOM.cz + 2.0 },
];

// 진열: 받침대 + 물건 + 가격표
{
  const y0 = SHOP_ROOM.y;
  for (const good of SHOP_GOODS) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.8), shopWoodMat);
    stand.position.set(good.x, y0 + 0.08, good.z);
    scene.add(stand);
    let item = null;
    if (good.key === 'carrot') {
      item = new THREE.Group();
      const carrotMat = new THREE.MeshLambertMaterial({ color: 0xe06a1d, flatShading: true });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const cn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.34, 6), carrotMat);
        cn.position.set(Math.cos(a) * 0.16, 0.3, Math.sin(a) * 0.16);
        cn.rotation.set((Math.random() - 0.5) * 0.9, 0, (Math.random() - 0.5) * 0.9);
        item.add(cn);
      }
    } else if (good.key === 'tank') {
      item = new THREE.Group();
      const tankMat = new THREE.MeshLambertMaterial({ color: 0xd8862a, flatShading: true });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.62, 4, 10), tankMat);
      body.position.y = 0.66;
      item.add(body);
      const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 6),
        new THREE.MeshLambertMaterial({ color: 0x8b8f94, flatShading: true }));
      valve.position.y = 1.12;
      item.add(valve);
    } else if (good.key === 'net') {
      item = makeNetBag();
      item.scale.setScalar(0.9);
    } else {
      item = FURN_BUILDERS[good.key]();
      item.scale.setScalar(0.55);   // 진열용은 아담하게
    }
    item.position.set(good.x, y0 + 0.16, good.z);
    if (good.rot) item.rotation.y = good.rot;
    scene.add(item);
    // 가격표 — 물건 위에 걸린 나무 팻말 (벽 방향에 맞춰 돌립니다)
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.58),
      new THREE.MeshBasicMaterial({ map: makePriceSign(good.name, good.price) }));
    const sdx = good.rot === -Math.PI / 2 ? -0.1 : 0;
    const sdz = good.rot ? (good.rot === Math.PI ? -0.1 : 0) : 0.1;
    sign.position.set(good.x + sdx, y0 + 2.0, good.z + sdz);
    if (good.rot) sign.rotation.y = good.rot;
    scene.add(sign);
  }
}

// ---------- 8-2h-4b. 상점 왼쪽 인테리어 코너 — 바닥재·벽지 (누르면 색 고르기 팝업) ----------
// 견본대 앞에서 F를 누르면 색 고르기 창이 뜨고, 색을 고르면 그 자리에서 결제·시공됩니다.
const RENO_GOODS = [
  { type: 'floor', name: '바닥재',      price: 4000000, dz: -1.6 },
  { type: 'wall',  name: '벽지',        price: 6000000, dz: 0 },
  { type: 'paint', name: '외벽 페인트', get price() { return PAINT_PRICE; }, dz: 1.6 },
];
const FLOOR_COLORS = [
  { name: '원목',     color: 0x9a7748 },
  { name: '밝은나무', color: 0xc9a86a },
  { name: '현무암',   color: 0x8d8b85 },
  { name: '붉은흙',   color: 0x9a6a4d },
  { name: '쪽빛',     color: 0x6a8a9a },
  { name: '먹빛',     color: 0x55504a },
  { name: '흰대리석', color: 0xdcd8d0 },
  { name: '체리목',   color: 0x8a4a3a },
  { name: '올리브',   color: 0x7a7a52 },
  { name: '모래빛',   color: 0xc0ac88 },
];
const WALL_COLORS = [
  { name: '크림',   color: 0xf0e4c8 },
  { name: '하늘',   color: 0xa8c8e0 },
  { name: '연분홍', color: 0xe8b8c0 },
  { name: '연두',   color: 0xbcd8a0 },
  { name: '라벤더', color: 0xc8b8e0 },
  { name: '미색',   color: 0xe8e0d0 },
  { name: '민트',   color: 0xa8d8c8 },
  { name: '레몬',   color: 0xe8dc9a },
  { name: '살구',   color: 0xe8c0a0 },
  { name: '잿빛',   color: 0xb0b0ac },
  { name: '청록',   color: 0x7ab0b0 },
  { name: '흰색',   color: 0xf2f0ea },
];
let houseFloorColor = 0;   // 0 = 아직 기본 (폐가 흙바닥·돌벽)
let houseWallColor = 0;
{
  const y0 = SHOP_ROOM.y, x = SHOP_ROOM.cx - 5.3;
  for (const rg of RENO_GOODS) {
    rg.x = x;
    rg.z = SHOP_ROOM.cz + rg.dz;
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), shopWoodMat);
    stand.position.set(rg.x, y0 + 0.25, rg.z);
    scene.add(stand);
    // 색 견본 부채 — 여러 색을 늘어놓아 "골라 살 수 있음"을 보여줍니다
    const colors = rg.type === 'floor' ? FLOOR_COLORS : rg.type === 'wall' ? WALL_COLORS : PAINT_COLORS;
    colors.slice(0, 4).forEach((c, i) => {
      const chip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.34),
        new THREE.MeshLambertMaterial({ color: c.color }));
      chip.position.set(rg.x + (i % 2 ? 0.2 : -0.2), y0 + 0.56 + Math.floor(i / 2) * 0.11, rg.z + (i % 2 ? 0.16 : -0.14));
      chip.rotation.y = i * 0.35;
      scene.add(chip);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.58),
      new THREE.MeshBasicMaterial({ map: makePriceSign(rg.name, rg.price) }));
    sign.position.set(rg.x + 0.1, y0 + 2.0, rg.z);
    sign.rotation.y = Math.PI / 2;
    scene.add(sign);
  }
}
function applyRoomLook() {
  if (houseFloorColor) houseRoomLook.floorMat.color.setHex(houseFloorColor);
  if (houseWallColor) houseRoomLook.wallMat.color.setHex(houseWallColor);
}
function nearestReno() {
  let best = null, bestD = 0.9;
  for (const rg of RENO_GOODS) {
    const d = Math.hypot(state.x - rg.x, state.z - rg.z);
    if (d < bestD) { bestD = d; best = rg; }
  }
  return best;
}
function buyReno(rg) {
  const py = SHOP_ROOM.y + 1.6;
  const price = shopPrice(rg.price);   // 장날이면 반값!
  // 페인트는 한 통이면 충분합니다 (이미 있으면 다시 안 삽니다)
  if (rg.type === 'paint' && tools.paint) {
    spawnMoneyPopup(state.x, py, state.z, '이미 페인트가 있어요 — 집 앞에서 칠하세요');
    return;
  }
  // 색 고르기 창을 띄우고, 색을 고른 뒤 가격 단추를 눌러야 결제됩니다
  const colors = rg.type === 'floor' ? FLOOR_COLORS : rg.type === 'wall' ? WALL_COLORS : PAINT_COLORS;
  openColorPicker(`🎨 ${rg.name} — 색을 고르세요`, colors, (c) => {
    if (coins < price) {
      spawnMoneyPopup(state.x, py, state.z, `${(price - coins).toLocaleString()}원 부족`);
      return;
    }
    coins -= price;
    updateCoinBadge();
    if (rg.type === 'floor') { houseFloorColor = c.color; applyRoomLook(); }
    else if (rg.type === 'wall') { houseWallColor = c.color; applyRoomLook(); }
    else { tools.paint = true; housePaintColor = c.color; }
    playShipSound();
    spawnMoneyPopup(state.x, py, state.z, rg.type === 'paint'
      ? `${c.name} 페인트 구입! 집 앞에서 칠해보세요`
      : `🎨 ${c.name} ${rg.name} 시공 완료! 집이 바뀌었어요`);
    saveGame(true);
  }, price);
}

// 물건 하나 사기 — 물건 앞에서 F를 눌렀을 때.
// 바로 사지지 않고, 물건과 가격을 크게 보여주는 창이 먼저 뜹니다.
// 창 안의 가격 단추를 눌러야 최종 구입됩니다 (잘못 눌러 사지는 일 방지).
function buyShopGood(good) {
  const px = state.x, pz = state.z;
  const py = SHOP_ROOM.y + 1.6;
  const already =
    (good.key === 'tank' && hasTank) ||
    (good.key === 'net' && hasNet) ||
    (FURNITURE[good.key] && furnitureOwned[good.key]);
  if (already) {
    spawnMoneyPopup(px, py, pz, `이미 ${good.name}${good.key === 'tank' ? '이' : '가'} 있어요`);
    return;
  }
  // 텔레비전은 올려놓을 티비다이가 먼저 있어야 합니다
  if (good.key === 'tv' && !furnitureOwned.tvstand) {
    spawnMoneyPopup(px, py, pz, '📺 티비다이가 먼저 있어야 놓을 수 있어요 (매장 가운데 진열)');
    return;
  }
  const price = shopPrice(good.price);   // 장날이면 반값!
  openBuyDialog(good.emoji, good.name, price, () => doBuyShopGood(good, price, px, py, pz));
}
function doBuyShopGood(good, price, px, py, pz) {
  if (coins < price) {
    spawnMoneyPopup(px, py, pz, `${(price - coins).toLocaleString()}원 부족`);
    return;
  }
  coins -= price;
  updateCoinBadge();
  if (good.key === 'carrot') {
    carrots++;
    updateCarrotBadge();
    playPickSound();
    spawnMoneyPopup(px, py, pz, `🥕 당근 구입! (${carrots}개)`);
  } else if (good.key === 'tank') {
    hasTank = true;
    BREATH_MAX = TANK_BREATH;
    playShipSound();
    spawnMoneyPopup(px, py, pz, '🤿 산소통 구입! 숨이 3분으로 늘었어요');
  } else if (good.key === 'net') {
    hasNet = true;
    netCarried = true;
    netObj.visible = true;
    netObj.position.set(px, SHOP_ROOM.y + 1, pz);
    playShipSound();
    spawnMoneyPopup(px, py, pz, '🧺 망사리 구입! 등에 메고 포구로 가면 물질할 수 있어요');
  } else {
    furnitureOwned[good.key] = true;
    applyFurniture();
    playShipSound();
    spawnMoneyPopup(px, py, pz,
      good.key === 'roof'   ? '🛖 새 지붕 구입! 지붕이 환한 새 짚빛이 됐어요'
      : good.key === 'door' ? '🚪 대문 구입! 뚫려 있던 문간에 문짝을 달았어요'
      : good.key === 'window' ? '🪟 창문 구입! 시커먼 구멍에 창을 달았어요'
      : YARD_KEYS.has(good.key) ? `🌴 ${good.name} 구입! 집 마당에 심어뒀어요`
      : `🛋 ${good.name} 구입! 집 안에 놓아뒀어요`);
  }
}
// 지금 서 있는 자리에서 살 수 있는 물건 (없으면 null)
function nearestShopGood() {
  let best = null, bestD = 1.5;
  for (const good of SHOP_GOODS) {
    const d = Math.hypot(state.x - good.x, state.z - good.z);
    if (d < bestD) { bestD = d; best = good; }
  }
  return best;
}

// ---------- 8-2h-5. 문 드나들기 (집 · 상점) ----------
// 밖에서 문 앞에 서면 안으로, 안에서 남쪽 문 쪽으로 걸어가면 밖으로.
// 화면이 잠깐 어두워졌다 밝아지는 사이 순간이동합니다.
const SHOP_DOOR = { x: 6, z: 42.2 };    // 상점 문 앞 (밖)
let transitioning = false;
const sceneFade = document.getElementById('sceneFade');
function fadeTeleport(fn) {
  transitioning = true;
  if (sceneFade) sceneFade.classList.add('show');
  setTimeout(() => {
    fn();
    if (sceneFade) sceneFade.classList.remove('show');
    setTimeout(() => { transitioning = false; }, 300);
  }, 380);
}
function teleportInto(R, insideFlagName, greet) {
  fadeTeleport(() => {
    state[insideFlagName] = true;
    state.x = R.cx; state.z = R.cz + 2.2;
    state.vy = 0; state.onGround = true;
    state.facing = Math.PI;   // 방 안쪽을 바라봅니다
    state.idleTime = 0; state.sit = 0;
    lulu.position.set(state.x, R.y, state.z);
    camYaw = 0;               // 카메라는 문 쪽(남쪽)에서 방 안을 들여다봅니다
    camera.position.set(state.x, R.y + 4, state.z + 8);
    if (greet) spawnMoneyPopup(state.x, R.y + 2, state.z, greet);
  });
}
function teleportOut(outX, outZ) {
  fadeTeleport(() => {
    state.inside = false; state.inShop = false;
    state.x = outX; state.z = outZ;
    state.vy = 0;
    state.facing = 0;         // 마을 쪽(북쪽)을 바라봅니다
    state.idleTime = 0; state.sit = 0;
    lulu.position.set(state.x, groundHeight(state.x, state.z), state.z);
    camYaw = Math.PI;
    camera.position.set(state.x, groundHeight(state.x, state.z) + 5, state.z - 8);
  });
}
// 매 프레임 문 앞에 서 있는지 확인합니다
function updateDoors() {
  if (transitioning || state.diving) return;
  if (state.inside) {
    if (Math.hypot(state.x - ROOM.cx, state.z - (ROOM.cz + ROOM.d / 2 - 0.3)) < 1.0) {
      teleportOut(HOUSE.x, HOUSE.z + 5.4);
    }
    return;
  }
  if (state.inShop) {
    if (Math.hypot(state.x - SHOP_ROOM.cx, state.z - (SHOP_ROOM.cz + SHOP_ROOM.d / 2 - 0.3)) < 1.0) {
      teleportOut(SHOP_DOOR.x, SHOP_DOOR.z - 1.6);
    }
    return;
  }
  // 밖: 집 문 앞 (내 집이니 자동으로 들어갑니다)
  if (Math.hypot(state.x - HOUSE.x, state.z - (HOUSE.z + 3.6)) < 1.2) {
    const empty = !FURN_ORDER.some((k) => furnitureOwned[k]);
    teleportInto(ROOM, 'inside',
      empty ? '🏚 텅 빈 집… 맨땅이라도 몸 누일 곳은 되네요' : '🏡 내 집에 왔어요');
    return;
  }
  // (상점은 자동 입장이 아닙니다 — 이장님이 문 앞에 와서 열어줘야 F로 들어갑니다)
}

// 상점 문 앞에서 F — 이장님이 계셔야 문을 열어줍니다
const SHOP_DOOR_RANGE = 1.8;
function mayorAtShop() {
  return Math.hypot(mayor.x - MAYOR_POSTS.shop.x, mayor.z - MAYOR_POSTS.shop.z) < 2.5;
}
function tryEnterShop() {
  const y = groundHeight(SHOP_DOOR.x, SHOP_DOOR.z) + 2.2;
  if (!mayorAtShop()) {
    spawnMoneyPopup(SHOP_DOOR.x, y, SHOP_DOOR.z, '이장님이 오고 계세요 — 잠깐만요');
    return;
  }
  teleportInto(SHOP_ROOM, 'inShop', '🏪 어서 오세요! 물건 앞에서 사면 됩니다');
}

// 8-3. 감귤나무 (밭담 안에 줄지어 심는 귤밭)
// 귤은 나무마다 따로 만들면 수백 개가 되어 느려지므로, 위치만 모아뒀다가
// 마지막에 InstancedMesh(같은 모양을 한 번에 여러 개 그리는 방식)로 한꺼번에 그립니다.
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

  obstacles.push({ x, z, r: 0.55, topY: NO_JUMP });
}

// 건물 곁에는 나무를 심지 않습니다 — 걸어다니는 충돌 반경(일부러 좁게 둠)보다
// 건물 지붕이 훨씬 커서, 그 반경만 피하면 나무가 지붕을 뚫고 자라기 때문입니다.
const NO_PLANT = [
  { x: STABLE.x, z: STABLE.z, r: 7.5 },   // 마구간 (지붕 폭 6m + 잎 반경)
  { x: HOUSE.x, z: HOUSE.z, r: 8 },       // 헌집 (그림 폭 8.5m + 뒤채)
];
function plantBlocked(x, z) {
  for (const n of NO_PLANT) {
    if (Math.hypot(n.x - x, n.z - z) < n.r) return true;
  }
  return false;
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
      if (plantBlocked(x, z)) continue;       // 마구간·헌집 곁은 비워둡니다
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
  obstacles.push({ x, z, r: 0.7, topY: NO_JUMP });
}
// 돌담·귤나무·상점 위에 겹쳐 심지 않도록, 이미 뭔가 있는 자리는 건너뜁니다.
// 상점처럼 덩치가 큰 것(o.r이 큰 것) 앞은 더 넓게 비워야 건물이 가려지지 않습니다.
scatter(16, ISLAND_R - 26, 2.5, (x, y, z) => {
  for (const o of obstacles) {
    if (Math.hypot(o.x - x, o.z - z) < o.r + 4.5) return;
  }
  if (plantBlocked(x, z)) return;   // 마구간·헌집 곁은 비워둡니다
  buildTree(x, y, z);
});

// ---------- 8-6. 해녀 물질 — 포구와 바닷속 ----------
// 포구는 배를 대는 작은 선착장입니다. 물질의 들고나는 문 역할을 합니다:
// 여기서 F를 누르면 바다로 들어가고, 나올 때도 여기로 올라옵니다.
// 물가에 바짝 붙여 두어야 "여기서 바다로 들어간다"는 게 한눈에 보입니다.
const BULTEOK = PORT;   // 예전 이름 — 코드 곳곳에서 쓰고 있어 그대로 둡니다

// 바닷속 재료들. 포구의 그물 더미에도 쓰므로 먼저 만들어 둡니다.
const kelpMat = new THREE.MeshLambertMaterial({ color: 0x3f6b4a, side: THREE.DoubleSide });
const abaloneMat = new THREE.MeshLambertMaterial({ color: 0x4a5f6b, flatShading: true });
const conchMat = new THREE.MeshLambertMaterial({ color: 0xd9b98c, flatShading: true });

// 8-6a. 포구 — 바다로 뻗은 돌 축대, 계류 기둥, 매어둔 테왁, 그리고 작은 나무배
{
  const y = groundHeight(PORT.x, PORT.z);
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x9a9689, flatShading: true });

  // 바다 쪽으로 뻗어나간 돌 축대(부두).
  // 윗면을 물가 땅높이에 딱 맞춰야 잔디밭에서 그대로 이어져 보입니다.
  // (예전에는 축대를 바다 표면에 맞춰 놓아서, 잔디밭보다 3미터 아래로 파묻혀 보였습니다)
  const DECK_TOP = y;                       // y = 포구 자리의 땅높이
  const DECK_H = DECK_TOP - SEA_Y + 5;       // 물 밑으로 5미터 더 내려가 바닥에 닿게
  const deck = new THREE.Mesh(new THREE.BoxGeometry(5.0, DECK_H, 11), deckMat);
  deck.position.set(PORT.x, DECK_TOP - DECK_H / 2, PORT.z + 5.0);
  deck.castShadow = true; deck.receiveShadow = true;
  scene.add(deck);
  // 축대 옆면을 두른 현무암 — 제주 포구의 거친 돌쌓기
  for (let i = 0; i < 44; i++) {
    const side = i % 2 ? 1 : -1;
    const t = (i / 44) * 11;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), i % 3 ? darkStoneMat : stoneMat);
    rock.position.set(PORT.x + side * 2.5, DECK_TOP - 0.25 - Math.random() * 0.5, PORT.z - 0.5 + t);
    rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    rock.castShadow = true;
    scene.add(rock);
  }
  // 배 매는 기둥 네 개
  [[-1.9, 2.0], [1.9, 2.0], [-1.9, 8.4], [1.9, 8.4]].forEach(([px, pz]) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 1.5, 7), citrusTrunkMat);
    post.position.set(PORT.x + px, DECK_TOP + 0.75, PORT.z + pz);
    post.castShadow = true;
    scene.add(post);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), shopRopeMat);
    cap.position.set(PORT.x + px, DECK_TOP + 1.5, PORT.z + pz);
    scene.add(cap);
  });
  // 물에 띄워둔 테왁(해녀가 붙잡고 뜨는 주황 부표) — 물질하는 곳임을 알려주는 표식
  [[-4.0, 7.0], [4.2, 9.0], [-3.0, 11.5], [4.6, 4.5]].forEach(([px, pz]) => {
    const tewak = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10),
      new THREE.MeshLambertMaterial({ color: 0xf2a03c }));
    tewak.position.set(PORT.x + px, SEA_Y + 0.2, PORT.z + pz);
    tewak.scale.y = 0.8;
    tewak.castShadow = true;
    scene.add(tewak);
  });
  // 축대 옆에 매어둔 작은 나무배
  {
    const boat = new THREE.Group();
    boat.position.set(PORT.x + 3.6, SEA_Y - 0.1, PORT.z + 6.0);
    boat.rotation.y = 0.22;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 3.8), citrusTrunkMat);
    hull.castShadow = true;
    boat.add(hull);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.5, 3.3), shopDarkMat);
    inner.position.y = 0.28;
    boat.add(inner);
    scene.add(boat);
  }
  // 축대 위에 쌓아둔 그물 더미
  const netPile = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), kelpMat);
  netPile.position.set(PORT.x - 1.4, DECK_TOP + 0.2, PORT.z + 2.4);
  netPile.scale.y = 0.5;
  netPile.castShadow = true;
  scene.add(netPile);

  // 「해녀 물질」 나무 푯말 — 밝은 바탕에 큼직한 글씨로, 멀리서도 또렷하게
  const signC = document.createElement('canvas');
  signC.width = 320; signC.height = 110;
  {
    const g2 = signC.getContext('2d');
    g2.fillStyle = '#f0e4c8'; g2.fillRect(0, 0, 320, 110);
    g2.strokeStyle = '#8a6038'; g2.lineWidth = 8; g2.strokeRect(4, 4, 312, 102);
    g2.fillStyle = '#2b1a0c'; g2.textAlign = 'center';
    g2.font = '900 44px "맑은 고딕", Malgun Gothic, sans-serif';
    g2.fillText('🤿 해녀물질', 160, 70);
  }
  const signTex = new THREE.CanvasTexture(signC);
  signTex.colorSpace = THREE.SRGBColorSpace;
  const signPost = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.8, 6), citrusTrunkMat);
  signPost.position.set(PORT.x - 3.6, y + 1.4, PORT.z - 1.4);
  signPost.castShadow = true;
  scene.add(signPost);
  const signBoard = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.85, 0.1),
    new THREE.MeshLambertMaterial({ map: signTex }));
  signBoard.position.set(PORT.x - 3.6, y + 2.65, PORT.z - 1.4);
  signBoard.rotation.y = 0.3;
  signBoard.castShadow = true;
  scene.add(signBoard);
}

// 8-6b. 바닷속 — 바위, 미역, 그리고 전복·소라
// (해저 바닥은 따로 만들지 않습니다. 지형 함수가 이 자리를 이미 우묵하게 파냈습니다)

// 채집물 한 종류의 설명. 값이 비쌀수록 드물게 놓습니다.
// 미역이 흔하고, 소라·전복은 귀하고, 문어는 물질장에 딱 두 마리 — 찾으면 한탕(5만원)입니다.
const CATCH_KINDS = {
  octopus: { name: '문어', price: 50000, count: 2 },
  abalone: { name: '전복', price: 20000, count: 12 },
  conch:   { name: '소라', price: 10000, count: 24 },
  kelp:    { name: '미역', price: 1000,  count: 86 },
};
const catchSpots = [];        // { x, y, z, kind, picked }
const catchMeshes = {};       // 종류별 InstancedMesh

{
  // 바위 무더기 — 전복이 붙어 살 자리이자 물속 지형지물
  const rockSpots = [];
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * DIVE.r;
    const x = DIVE.x + Math.cos(a) * rr, z = DIVE.z + Math.sin(a) * rr;
    const s = 0.7 + Math.random() * 1.5;
    // 포구 축대 끝 앞은 비워둡니다 — 얕은 데 큰 바위가 서면 수면 위로 머리를 내밀어
    // 축대 길과 입수 자리를 가로막습니다 (실제로 길을 막고 서 있었습니다)
    if (x > -5 && x < 5 && z < 108) continue;
    rockSpots.push({ x, y: seabedHeight(x, z), z, s });
  }
  const rockMesh = buildInstanced(new THREE.DodecahedronGeometry(1, 0), darkStoneMat, rockSpots, (s) => {
    dummy.position.set(s.x, s.y + s.s * 0.35, s.z);
    dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    dummy.scale.setScalar(s.s);
  });
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;

  // 미역 숲 — 물살에 흔들리도록 풀과 같은 바람 재질을 씁니다.
  // 판 한 장만 세우면 옆에서 볼 때 종잇장처럼 납작해 보이므로, 십자로 두 장을 겹칩니다.
  const kelpSpots = [];
  for (let i = 0; i < 380; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * DIVE.r;
    const x = DIVE.x + Math.cos(a) * rr, z = DIVE.z + Math.sin(a) * rr;
    const h = 1.4 + Math.random() * 1.8, ry = Math.random() * Math.PI;
    // 축대 끝 앞 얕은 구역은 비웁니다 — 바위처럼 미역도 여기서는 수면 위로 삐져나옵니다
    if (x > -5 && x < 5 && z < 108) continue;
    kelpSpots.push([x, seabedHeight(x, z), z, h, ry]);
  }
  const blade = normalsUp(new THREE.PlaneGeometry(0.34, 1, 1, 4));
  blade.translate(0, 0.5, 0);
  const kelpWindMat = makeWindMaterial(0x37624a);
  for (const turn of [0, Math.PI / 2]) {
    buildInstanced(blade, kelpWindMat, kelpSpots, (s) => {
      dummy.position.set(s[0], s[1], s[2]);
      dummy.rotation.set(0, s[4] + turn, 0);
      dummy.scale.set(1, s[3], 1);
    });
  }

  // 채집물 놓기 — 전복은 바위에, 소라와 미역은 모래바닥에
  for (const [kind, info] of Object.entries(CATCH_KINDS)) {
    for (let i = 0; i < info.count; i++) {
      let x, z, y;
      if (kind === 'abalone') {
        const r = rockSpots[(Math.random() * rockSpots.length) | 0];
        const a = Math.random() * Math.PI * 2;
        x = r.x + Math.cos(a) * r.s * 0.8;
        z = r.z + Math.sin(a) * r.s * 0.8;
        y = r.y + r.s * 0.45;
      } else {
        // 축대 끝 앞 얕은 구역에 걸리면 자리를 다시 뽑습니다 (채집물 개수는 지켜야 하므로)
        do {
          const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * (DIVE.r - 2);
          x = DIVE.x + Math.cos(a) * rr;
          z = DIVE.z + Math.sin(a) * rr;
        } while (x > -5 && x < 5 && z < 108);
        y = seabedHeight(x, z) + 0.12;
      }
      catchSpots.push({ x, y, z, kind, picked: false });
    }
  }
  // 종류별로 한 번에 그리기. 인스턴스 번호와 catchSpots 번호를 맞춰두어야 딸 때 숨길 수 있습니다.
  // 그림을 쓸 수 있으면 직접 그리신 해산물 그림을 작은 판에 세워 씁니다 (진짜 전복·소라·미역 모양).
  // 그림을 못 읽는 경우(더블클릭으로 열었을 때)에는 예전처럼 공·원뿔로 대신합니다.
  const CATCH_SIZE = { abalone: 0.55, conch: 0.5, kelp: 1.0, octopus: 0.7 };   // 판 한 변의 크기(미터)
  for (const kind of Object.keys(CATCH_KINDS)) {
    const mine = catchSpots.map((s, i) => ({ s, i })).filter((o) => o.s.kind === kind);
    let m;
    if (CAN_USE_IMAGES) {
      const sz = CATCH_SIZE[kind];
      const geo = new THREE.PlaneGeometry(sz, sz);
      geo.translate(0, sz * 0.42, 0);   // 아래끝을 바닥에 맞춰 세웁니다
      m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({
        map: loadTexture(`../assets/farmcat/catch_${kind}.webp`),
        transparent: true, alphaTest: 0.5, side: THREE.DoubleSide,
      }), mine.length);
      mine.forEach((o, j) => {
        o.s.slot = j;
        dummy.position.set(o.s.x, o.s.y, o.s.z);
        dummy.rotation.set(0, Math.random() * Math.PI, 0);   // 아무 방향이나 보고 서 있게
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        m.setMatrixAt(j, dummy.matrix);
      });
    } else {
      const GEO = {
        abalone: new THREE.SphereGeometry(0.26, 8, 6),
        conch:   new THREE.ConeGeometry(0.2, 0.42, 7),
        kelp:    new THREE.SphereGeometry(0.3, 6, 5),
        octopus: new THREE.SphereGeometry(0.32, 8, 6),
      };
      const MAT = { abalone: abaloneMat, conch: conchMat, kelp: kelpMat,
        octopus: new THREE.MeshLambertMaterial({ color: 0xc96a4a, flatShading: true }) };
      m = new THREE.InstancedMesh(GEO[kind], MAT[kind], mine.length);
      mine.forEach((o, j) => {
        o.s.slot = j;
        dummy.position.set(o.s.x, o.s.y, o.s.z);
        dummy.rotation.set(kind === 'abalone' ? Math.PI / 2 : 0, Math.random() * 3, 0);
        dummy.scale.set(1, kind === 'abalone' ? 0.45 : 1, 1);
        dummy.updateMatrix();
        m.setMatrixAt(j, dummy.matrix);
      });
    }
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
    m.castShadow = true;
    scene.add(m);
    catchMeshes[kind] = m;
  }
}

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
let mayorGroup = null, mayorCard = null;   // 이장님 (상점·택배사를 오가는 NPC)
let ponyCard = null;                       // 조랑말 (웃는 평소 / 우는 배고픔 — 경마 영상에서 오려낸 그림)
const PONY_H = 2.05;                       // 조랑말 키 (미터)
let halmangCard = null;                    // 해녀 할망 (포구 옆에 앉아 있는 흰 고양이 할머니)
const HALMANG_H = 1.7;
const MAYOR_H = 1.9;                       // 이장님 키 — 어른이라 루루보다 큼직합니다

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
  loadSheet('idle',      'idle_front.webp', 8,  212);          // 서 있기 (정면)
  loadSheet('walkSide',  'walk_side.webp',  10, 208, 6, 8);    // 걷기 (옆모습, 원본은 왼쪽을 봄)
  loadSheet('walkBack',  'walk_back.webp',  10, 195, 3, 4);    // 걷기 (뒷모습)
  loadSheet('walkFront', 'walk_front.webp', 10, 198, 4, 5);    // 걷기 (카메라를 마주 보고 다가올 때)
  loadSheet('cheer',     'cheer.webp',      8,  192);          // 만세 (카메라를 보고 점프할 때)
  loadSheet('sleep',     'sleep.webp',      8,  299);          // 낮잠 (오래 가만히 있으면)
  loadSheet('harvest',   'harvest.webp',   10,  181);          // 감귤 따기 (F키로 딸 때, 한 번만 재생)
  loadSheet('pullSide',  'pull_side.webp', 10,  255);          // 끈 없이 상자를 몸으로 밀어 끌 때 (옆모습, 원본은 왼쪽을 봄)
  // 해녀 물질 — 헤엄·둥둥·수면은 영상에서 뽑아 8칸씩이라 훨씬 부드럽게 움직입니다
  loadSheet('diveSwim',  'dive_swim.webp',  8,  164);          // 물속 활공 (옆모습, 원본은 왼쪽을 봄)
  loadSheet('diveIdle',  'dive_idle.webp',  8,  139);          // 물속에 가만히 떠 있기 (정면)
  loadSheet('diveFloat', 'dive_float.webp', 8,  202);          // 수면에 떠서 숨 고르기 — 입수 첫 모습 (직접 뽑으신 영상)
  loadSheet('divePick',  'dive_pick.webp',  6,  190);          // 전복·소라를 딸 때 (한 번만 재생)
  loadSheet('diveUp',    'dive_up.webp',    8,  165);          // 수면으로 떠오를 때 (직접 뽑으신 영상)
  loadSheet('diveDown',  'dive_down.webp',  8,  175);          // 아래로 잠수할 때 (직접 뽑으신 영상에서 변환)
  loadSheet('ponyHappy', 'pony_happy.webp', 8,  128);          // 조랑말 — 웃는 평소 모습 (경마 1등 영상에서)
  loadSheet('ponySad',   'pony_sad.webp',   8,  227);          // 조랑말 — 굶어서 우는 모습 (경마 꼴등 영상에서)
  loadSheet('halmang',   'halmang.webp',    8,  185);          // 해녀 할망 — 포구 옆에 앉아 같은 말만 되뇌입니다
  loadSheet('wetsuitLand', 'wetsuit_land.webp', 5, 204);       // 잠수복 차림 뭍 자세 (해녀 시트에서: 뒤0·뒤1·옆2·옆3·정면4)
  // 헌집 고치기 — 망치질(0) · 톱질(1) · 페인트칠(2). 수리 단계에 맞는 칸 하나를 보여줍니다
  loadSheet('fixHouse',  'fix_house.webp',  3,  167);
  // 이장님 (상점과 택배사를 오가는 NPC). 걷기 원본은 루루와 반대로 "오른쪽"을 봅니다
  // ?v=2 — 다리 사이 흰 여백을 지운 새 그림. 주소가 바뀌어야 폰들이 캐시 대신 새로 받습니다
  loadSheet('mayorIdle', 'mayor_idle.webp?v=2', 8,  194);
  loadSheet('mayorWalk', 'mayor_walk.webp?v=2', 8,  202);

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

  // ----- 이장님 그림판 (루루와 같은 방식의 서 있는 종이 인형) -----
  const mGeo = new THREE.PlaneGeometry(1, 1);
  mGeo.translate(0, 0.5, 0);
  mayorCard = new THREE.Mesh(
    mGeo,
    new THREE.MeshBasicMaterial({ map: SHEETS.mayorIdle.tex, transparent: true, alphaTest: 0.08 })
  );
  mayorCard.userData.planeH = MAYOR_H * CELL_H / (CELL_H - CELL_PAD * 2);
  mayorCard.position.y = -(CELL_PAD / CELL_H) * mayorCard.userData.planeH;
  mayorGroup = new THREE.Group();
  mayorGroup.add(mayorCard);
  scene.add(mayorGroup);

  // ----- 해녀 할망 그림판 — 포구 옆에 앉아 있습니다 -----
  if (SHEETS.halmang) {
    const hGeo = new THREE.PlaneGeometry(1, 1);
    hGeo.translate(0, 0.5, 0);
    halmangCard = new THREE.Mesh(
      hGeo,
      new THREE.MeshBasicMaterial({ map: SHEETS.halmang.tex, transparent: true, alphaTest: 0.08 })
    );
    halmangCard.userData.planeH = HALMANG_H * CELL_H / (CELL_H - CELL_PAD * 2);
    scene.add(halmangCard);
  }

  // ----- 조랑말 그림판 — 마구간 안에 서 있습니다 (그림띠가 있을 때만) -----
  if (SHEETS.ponyHappy) {
    const pGeo = new THREE.PlaneGeometry(1, 1);
    pGeo.translate(0, 0.5, 0);
    ponyCard = new THREE.Mesh(
      pGeo,
      new THREE.MeshBasicMaterial({ map: SHEETS.ponyHappy.tex, transparent: true, alphaTest: 0.08 })
    );
    ponyCard.userData.planeH = PONY_H * CELL_H / (CELL_H - CELL_PAD * 2);
    scene.add(ponyCard);
    if (stable.pony) stable.pony.visible = false;   // 그림이 있으면 3D 조랑말은 숨깁니다
  }
  const mBlob = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 22),
    new THREE.MeshBasicMaterial({ color: 0x1d2b17, transparent: true, opacity: 0.4, depthWrite: false })
  );
  mBlob.rotation.x = -Math.PI / 2;
  mBlob.position.y = 0.06;
  mayorGroup.add(mBlob);
}

// 어느 쪽 루루를 보여줄지.
// 예전에는 T키로 그림 루루와 3D 모형 루루를 오갈 수 있었지만, 그림 쪽이 훨씬 보기 좋아서
// 전환 기능을 없앴습니다. 3D 모형은 그림 파일을 못 읽는 경우(파일을 그냥 더블클릭했을 때)의
// 대비책으로만 남겨둡니다.
const useSprite = CAN_USE_IMAGES;
function applyLuluMode() {
  lulu.visible = !useSprite;
  spriteLulu.visible = useSprite;
  if (spriteBlob) spriteBlob.visible = useSprite;
}
applyLuluMode();

// ---------- 10-3. 3D 루루 (직접 만드신 GLB 모델) ----------
// 그림 판 대신 진짜 입체 루루입니다. 뭍에서는 이 모델이 걸어다니고,
// 물속·포구(잠수복 구간)는 전용 그림이 있으므로 그대로 그림을 씁니다.
// 최신 three.js는 옛날처럼 끼워 쓰는 GLTFLoader를 주지 않아서,
// 이 파일 하나(정지 메시 1개 + PNG 한 장)만 읽는 작은 판독기를 직접 씁니다.
const luluModel = new THREE.Group();      // 위치 + 진행 방향 회전
const luluModelInner = new THREE.Group(); // 통통 튀기·기우뚱·숨쉬기는 이 안에서
luluModel.add(luluModelInner);
luluModel.visible = false;
scene.add(luluModel);
let luluModelReady = false;
let luluModelYaw = 0;                     // 몸을 홱 돌리지 않고 스르륵 돌기 위한 현재 각도
const LULU_MODEL_YAW = 0;                 // 모델 원본이 보는 방향 보정 (필요하면 ±Math.PI/2)

// GLB 파일 하나(정지 메시 1개 + 그림 한 장)를 읽어 게임에 세울 수 있는 메시로 만듭니다.
// 발끝이 y=0에 닿고 키가 height가 되게 맞춰서 돌려줍니다.
// 모델 파일을 갈아끼우면 주소 뒤의 ?v= 숫자도 올려야 합니다 (서비스워커가 옛것을 물고 있지 않게)
async function loadGlbCharacter(url, height) {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('glTF 아님');   // 'glTF' 서명 확인
  const jsonLen = dv.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8;                      // JSON 덩어리 다음이 이진 덩어리
  const prim = gltf.meshes[0].primitives[0];
  const readAcc = (i) => {
    const acc = gltf.accessors[i];
    const bv = gltf.bufferViews[acc.bufferView];
    const off = binStart + (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const n = acc.count * ({ SCALAR: 1, VEC2: 2, VEC3: 3 }[acc.type]);
    return acc.componentType === 5125 ? new Uint32Array(buf.slice(off, off + n * 4))
         : acc.componentType === 5123 ? new Uint16Array(buf.slice(off, off + n * 2))
         : new Float32Array(buf.slice(off, off + n * 4));
  };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(readAcc(prim.attributes.POSITION), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(readAcc(prim.attributes.TEXCOORD_0), 2));
  geo.setIndex(new THREE.BufferAttribute(readAcc(prim.indices), 1));
  geo.computeVertexNormals();
  // 껴묻어 온 그림 한 장을 꺼내 입힙니다
  const imgBv = gltf.bufferViews[gltf.images[0].bufferView];
  const blob = new Blob([new Uint8Array(buf, binStart + (imgBv.byteOffset || 0), imgBv.byteLength)],
    { type: gltf.images[0].mimeType || 'image/png' });
  const bmp = await createImageBitmap(blob);
  const tex = new THREE.Texture(bmp);
  tex.flipY = false;                       // GLB의 그림 좌표는 위아래 기준이 반대입니다
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  // 이런 텍스처는 명암(그림자·음영)이 이미 그려져 있습니다. 게임 조명을 또 얹으면
  // 음영이 두 번 겹쳐 때 묻은 것처럼 보여서, 종이 인형들과 똑같이 "조명 없이 원색 그대로" 그립니다.
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
  mesh.castShadow = true;                  // 종이 인형과 달리 진짜 그림자를 드리웁니다
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const s = height / (bb.max.y - bb.min.y);
  mesh.scale.setScalar(s);
  mesh.position.y = -bb.min.y * s;
  return mesh;
}

async function loadLuluModel() {
  try {
    luluModelInner.add(await loadGlbCharacter('../assets/lulu.glb?v=7', SPRITE_H));
    luluModelReady = true;
  } catch (e) { /* 읽기에 실패하면 그림 루루를 그대로 씁니다 */ }
}
// ※ 루루 3D는 잠시 쉬는 중 — 걷기 애니메이션 모델이 준비되면 다시 켭니다.
//   그때까지는 원래의 그림(종이 인형) 루루가 걸어다닙니다.
//   다시 켜려면 아래 loadHalmangModel() 옆에 loadLuluModel()을 함께 불러주면 됩니다.
// 해녀 할망 3D — 잠수복에 테왁(주황 부표)·망사리를 멘, 직접 만드신 할망 모델
let halmangModel = null;
async function loadHalmangModel() {
  try {
    const mesh = await loadGlbCharacter('../assets/halmang.glb', HALMANG_H);
    halmangModel = new THREE.Group();
    halmangModel.add(mesh);
    halmangModel.rotation.y = Math.PI;   // 뭍(남쪽)을 바라보고 계십니다 — 포구로 걸어오는 루루를 정면으로 맞습니다
    scene.add(halmangModel);
  } catch (e) { /* 실패하면 그림 할망 그대로 */ }
}
// ※ 할망 3D도 잠시 쉬는 중 — 사용자 결정으로 원래 그림 할망으로 복원했습니다.
//   다시 켜려면: if (CAN_USE_IMAGES) { loadHalmangModel(); }
//   (모델 파일 assets/halmang.glb 과 위의 불러오기 코드는 그대로 보관)

// 매 프레임 — 위치·방향·걸음짓. 종이 인형과 달리 카메라가 아니라 "가는 방향"을 봅니다.
function updateLuluModel() {
  luluModel.position.copy(lulu.position);
  // 진행 방향으로 스르륵 돌기 (한 바퀴 넘게 돌지 않게 가까운 쪽으로)
  let d = state.facing - luluModelYaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  luluModelYaw += d * 0.18;
  luluModel.rotation.y = luluModelYaw + LULU_MODEL_YAW;
  // 걸을 때 통통 튀며 살짝 기우뚱, 서 있을 때는 숨쉬듯 부풀기
  const hop = Math.abs(Math.sin(state.walkPhase)) * 0.09 * state.speed;
  luluModelInner.position.y = hop;
  luluModelInner.rotation.z = Math.sin(state.walkPhase) * 0.05 * state.speed;
  const br = 1 + Math.sin(performance.now() * 0.002) * 0.015 * (1 - state.speed);
  luluModelInner.scale.set(br, 1, br);
  // 귤 따기·집 고치기 — 절하듯 까딱까딱 (팔 그림이 없으므로 몸짓으로 표현합니다)
  let bow = 0;
  if (state.harvestT >= 0) bow = Math.abs(Math.sin((state.harvestT / HARVEST_DURATION) * Math.PI * 3)) * 0.25;
  else if (state.fixT >= 0) bow = Math.abs(Math.sin((state.fixT / FIX_DURATION) * Math.PI * 2)) * 0.3;
  luluModelInner.rotation.x = bow;
}

// 그냥 더블클릭으로 연 경우 안내문을 띄웁니다
if (!CAN_USE_IMAGES) {
  const warn = document.getElementById('fileWarn');
  if (warn) {
    warn.style.display = 'block';
    warn.addEventListener('click', () => { warn.style.display = 'none'; });
  }
}

// ---------- 11. 조작 ----------
// 한글 입력 상태(IME)에서는 브라우저가 e.code를 비워서 보내는 일이 있습니다.
// 그때는 글자(e.key)와 옛 키번호(keyCode)까지 함께 봐야 키가 먹습니다.
// 한글 자판에서 F 자리는 'ㄹ', M 자리는 'ㅡ' 입니다.
const KEY_ALIAS = {
  KeyF: ['f', 'F', 'ㄹ', 70],
  KeyM: ['m', 'M', 'ㅡ', 77],
  Escape: ['Escape', 'Esc', 27],
};
function isKey(e, code) {
  if (e.code === code) return true;
  const alias = KEY_ALIAS[code];
  if (!alias) return false;
  return alias.includes(e.key) || alias.includes(e.keyCode);
}
const keys = {};
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
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
// (걷는 방향을 따라 도는 자동 추적은 써봤다가 뺐습니다 — 시야는 온전히 플레이어의 것)
function updateCamera(dt) {
  if (keys['KeyA']) camYaw += CAM_TURN * dt;
  if (keys['KeyD']) camYaw -= CAM_TURN * dt;
  if (keys['KeyW']) camPitch -= CAM_PITCH * dt;     // W = 시선을 눕혀 멀리 보기
  if (keys['KeyS']) camPitch += CAM_PITCH * dt;     // S = 위에서 내려다보기
  if (keys['KeyZ']) camDist += CAM_ZOOM * dt;       // 멀리
  if (keys['KeyX']) camDist -= CAM_ZOOM * dt;       // 가까이
  camPitch = Math.max(pitchMin(), Math.min(1.0, camPitch));
  camDist = Math.max(4, Math.min(22, camDist));
}

// 물속에서는 위를 올려다볼 수 있어야 "보는 방향으로 헤엄"이 됩니다. 뭍에서는 예전 그대로.
function pitchMin() { return state.diving ? -0.85 : 0.05; }

// 포구에 들어서면 루루가 잠수복으로 갈아입습니다 — 물질 나갈 채비!
function inWetsuitZone() {
  if (state.diving || state.inside || state.inShop) return false;
  return Math.hypot(state.x - PORT.x, state.z - PORT.z) < 9 ||
         (state.z > 92 && Math.abs(state.x - PORT.x) < 4);   // 축대 위 전체
}

let dragging = false, lastX = 0, lastY = 0;
renderer.domElement.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  camYaw -= (e.clientX - lastX) * 0.005;
  camPitch = Math.max(pitchMin(), Math.min(1.0, camPitch + (e.clientY - lastY) * 0.003));
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
      camPitch = Math.max(pitchMin(), Math.min(1.0, camPitch + (t.clientY - lookY) * 0.004));
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
  facing: 0,     // 시작할 때 카메라를 마주 봅니다 — 등 뒤 멀리 성산일출봉이 보이는 구도

  walkPhase: 0,
  speed: 0,      // 0~1, 애니메이션 세기
  idleTime: 0,
  sit: 0,        // 0 = 서 있음, 1 = 앉음
  harvestT: -1,  // 0 이상이면 감귤 따는 애니메이션 재생 중 (초 단위로 증가)
  grabbing: false, // true면 상자를 직접 손으로 잡고 있는 중 (E키로 잡기/놓기)
  diving: false,   // true면 물질 중 (바닷속에 있음)
  inside: false,   // true면 집 안에 있음 (문 앞에 서면 드나듭니다)
  inShop: false,   // true면 상점 안에 있음
  pickT: -1,       // 0 이상이면 전복 따는 동작 재생 중 (물속 전용)
  fixT: -1,        // 0 이상이면 집 고치는 동작 재생 중
};
lulu.position.set(state.x, groundHeight(state.x, state.z), state.z);
camera.position.set(state.x, 8, state.z + 12);

// ---------- 12-1. 감귤 따기 (F키) ----------
const HARVEST_RANGE = 2.0;     // 이 거리 안의 귤만 딸 수 있음
const HARVEST_DURATION = 0.6;  // 애니메이션 길이(초). 이 동안은 못 움직임
let coins = 0;
const hasRope = false;            // 끈 아이템은 게임에서 뺐습니다. 상자는 E로 손잡고 끕니다
                                  // (상자 물리 코드 곳곳이 이 이름을 참조해서 변수만 남겨둡니다)
const coinBadge = document.getElementById('coinBadge');
const ropeBadge = document.getElementById('ropeBadge');
const boxBadge = document.getElementById('boxBadge');
function updateCoinBadge() {
  if (coinBadge) coinBadge.textContent = `💵 ${coins.toLocaleString()}원`;
}
// 상자에 귤이 몇 개 담겼는지 (가득 차면 색이 바뀌어 배송할 때가 됐음을 알립니다)
// basketCount·BASKET_CAP은 아래 12-1b에서 만들어지지만, 이 함수는 그 뒤에야 불리므로 괜찮습니다.
// 상자를 끌고 다닐 때만 보입니다 — 평소에는 화면 구석을 차지하지 않게.
function updateBasketBadge() {
  if (!boxBadge) return;
  const dragging = hasRope || state.grabbing;
  boxBadge.style.display = dragging ? 'block' : 'none';
  if (!dragging) return;
  const full = basketCount >= BASKET_CAP;
  boxBadge.textContent = full
    ? `📦 상자 가득! ${basketCount}/${BASKET_CAP} — 택배사의 이장님께 (한 박스 10,000원)`
    : `📦 상자 ${basketCount}/${BASKET_CAP} — 가득 채우면 10,000원`;
  boxBadge.classList.toggle('full', full);
}
// 상자(basketPos)와 잡기 범위(GRAB_RANGE)는 아래 12-1b에서 정의되므로,
// 이 배지 내용은 그쪽 값들이 다 준비된 뒤(매 프레임 updateBasket 안에서) 갱신합니다.
// 안내 문구에 쓸 조작 이름. 폰에는 키보드가 없으므로 화면 버튼 이름으로 바꿔 말해줍니다.
// (예전에는 폰에서도 "F를 누르세요"라고만 해서, 누를 F가 없어 물질하러 못 들어갔습니다)
const KEY_ACTION = IS_TOUCH ? '🐾 버튼' : 'F';
const KEY_GRAB = KEY_ACTION;   // 상호작용 키를 하나로 통일했습니다
const KEY_UP = IS_TOUCH ? '⤴ 버튼' : 'Space';

function updateRopeBadge() {
  if (!ropeBadge) return;
  // 구입 창·자산 창·대화가 떠 있는 동안은 뒤쪽 안내 배지를 감춥니다 (화면이 겹쳐 지저분해집니다)
  const popupOpen =
    (pickWrap && pickWrap.style.display === 'flex') ||
    (bookWrap && bookWrap.style.display === 'flex') ||
    (talkBoxEl && talkBoxEl.style.display === 'block');
  if (popupOpen) { ropeBadge.style.display = 'none'; return; }
  ropeBadge.style.display = 'block';   // 아래 분기 중 하나가 걸리면 보입니다 (없으면 끝에서 숨김)
  // 물속에서는 상자 안내 대신 물질 안내를 보여줍니다
  if (state.diving) {
    ropeBadge.textContent = IS_TOUCH
      ? '🤿 🐾 채집 · ↑ 떠오르기 · ↓ 잠수 · ←→ 헤엄 · 수면에서 🐾 나가기'
      : '🤿 F 채집 · ↑ 떠오르기 · ↓ 잠수 · ←→ 헤엄 · 수면에서 F 나가기';
    return;
  }
  // 상점 안: 앞에 있는 물건의 이름·가격을 알려줍니다
  if (state.inShop) {
    const rg = nearestReno();
    if (rg) {
      ropeBadge.textContent = (rg.type === 'paint' && tools.paint)
        ? '🖌 페인트 보유 중 — 집 앞에서 칠하세요'
        : `🎨 ${rg.name} — ${shopPrice(rg.price).toLocaleString()}원${dayEvent === 'market' ? ' (장날 반값!)' : ''} (${KEY_ACTION}으로 색 고르기)`;
      return;
    }
    const good = nearestShopGood();
    if (good) {
      const owned =
        (good.key === 'tank' && hasTank) ||
        (good.key === 'net' && hasNet) ||
        (FURNITURE[good.key] && furnitureOwned[good.key]);
      ropeBadge.textContent = owned
        ? `${good.emoji} ${good.name} — 보유 중`
        : `${good.emoji} ${good.name} ${shopPrice(good.price).toLocaleString()}원${dayEvent === 'market' ? ' (장날 반값!)' : ''} — ${KEY_ACTION}으로 구입`;
    } else {
      ropeBadge.textContent = '🏪 상점 안 — 물건 앞에 서면 살 수 있어요 (문 쪽으로 가면 밖으로)';
    }
    return;
  }
  // 집 안: 꾸미기 안내
  if (state.inside) {
    const missing = FURN_ORDER.filter((k) => !furnitureOwned[k]).length;
    ropeBadge.textContent = missing === 0
      ? '🏡 아늑한 내 집 — 문 쪽으로 걸어가면 밖으로 나갑니다'
      : '🏚 텅 빈 집 — 상점 안에서 가구를 사서 꾸며보세요 (문 쪽으로 가면 밖으로)';
    return;
  }
  // 해녀 할망 — 포구 안내보다 먼저 (할망 곁에 서 있을 때)
  if (typeof HALMANG_SPOT !== 'undefined' &&
      Math.hypot(state.x - HALMANG_SPOT.x, state.z - HALMANG_SPOT.z) < HALMANG_RANGE) {
    ropeBadge.textContent = `👵 해녀 할망과 이야기 (${KEY_ACTION})`;
    return;
  }
  // 포구 가까이 오면 물질하러 들어가는 법을 알려줍니다 (망사리가 없으면 그것부터)
  if (typeof PORT !== 'undefined' &&
      Math.hypot(state.x - PORT.x, state.z - PORT.z) < BULTEOK_RANGE + 5) {
    const nearEnd = Math.hypot(state.x - DIVE_ENTRY.x, state.z - DIVE_ENTRY.z) < DIVE_ENTRY_RANGE;
    if (dayEvent === 'storm') {
      ropeBadge.textContent = '🌀 태풍이 몰아쳐요 — 오늘은 물질을 쉽니다';
    } else if (!nearEnd) {
      ropeBadge.textContent = '🤿 축대 끝까지 걸어나가면 물질하러 들어갈 수 있어요';
    } else {
      ropeBadge.textContent = netCarried
        ? `🤿 ${KEY_ACTION}을 누르면 바다로 물질하러 들어갑니다` +
          (isNight() ? '\n야간물질은 값을 2배로 쳐줘요! 대신 숨이 빨리 차요' : '')
        : (hasNet
          ? '🧺 망사리를 두고 왔어요 — 메고 와야 물질할 수 있어요'
          : `🧺 망사리가 있어야 물질합니다 — 상점 안에서 ${NET_PRICE.toLocaleString()}원`);
    }
    return;
  }
  // 헌집 가까이 오면 지금 할 수 있는 일(구입/수리)을 알려줍니다
  if (typeof HOUSE !== 'undefined' &&
      Math.hypot(state.x - HOUSE.x, state.z - HOUSE.z) < HOUSE_RANGE + 3) {
    ropeBadge.textContent = houseBadgeText();
    return;
  }
  // 상점 문 앞 안내 — 이장님이 오셨는지에 따라
  if (typeof SHOP_DOOR !== 'undefined' &&
      Math.hypot(state.x - SHOP_DOOR.x, state.z - SHOP_DOOR.z) < SHOP_DOOR_RANGE) {
    ropeBadge.textContent = mayorAtShop()
      ? `🏪 ${KEY_ACTION}으로 상점에 들어가기 — 이장님이 문을 열어줍니다`
      : '🏪 이장님이 오고 계세요 — 문 앞에서 잠깐 기다려주세요';
    return;
  }
  // 이장님·돌하르방 안내 (이장님 바로 곁에서는 이야기가 우선입니다)
  if (typeof mayor !== 'undefined' && mayorGroup &&
      Math.hypot(state.x - mayor.x, state.z - mayor.z) < MAYOR_TALK_RANGE) {
    ropeBadge.textContent = `🧢 이장님과 이야기 (${KEY_ACTION})`;
    return;
  }
  if (typeof TUTOR_SPOT !== 'undefined' &&
      Math.hypot(state.x - TUTOR_SPOT.x, state.z - TUTOR_SPOT.z) < TUTOR_RANGE) {
    ropeBadge.textContent = `🗿 돌하르방과 이야기 (${KEY_ACTION})`;
    return;
  }
  // 택배사 앞 안내 — 이장님이 계셔야 정산이 됩니다
  if (typeof depot !== 'undefined' &&
      Math.hypot(state.x - depot.group.position.x, state.z - depot.group.position.z) < DEPOT_RANGE) {
    const mayorHere = Math.hypot(mayor.x - MAYOR_POSTS.depot.x, mayor.z - MAYOR_POSTS.depot.z) < 2.5;
    ropeBadge.textContent = mayorHere
      ? (basketCount >= BASKET_CAP
        ? `🚚 ${KEY_ACTION}으로 귤 박스 부치기 (10,000원) — 이장님이 계세요`
        : `🚚 택배사 — 상자를 가득 채워 오면 이장님이 사 줍니다 (${basketCount}/${BASKET_CAP})`)
      : '🚚 이장님이 오고 계세요 — 문 앞에서 잠깐 기다려주세요';
    return;
  }
  // 당근 바구니·산소통·마구간 안내
  if (typeof CARROT_SPOT !== 'undefined' &&
      Math.hypot(state.x - CARROT_SPOT.x, state.z - CARROT_SPOT.z) < CARROT_RANGE) {
    ropeBadge.textContent = `🥕 ${KEY_ACTION}으로 당근 구입 (${CARROT_PRICE.toLocaleString()}원)`;
    return;
  }
  if (typeof TANK_SPOT !== 'undefined' &&
      Math.hypot(state.x - TANK_SPOT.x, state.z - TANK_SPOT.z) < TANK_RANGE) {
    ropeBadge.textContent = hasTank
      ? '🤿 산소통 보유 중 — 숨 3분'
      : `🤿 해녀 산소통 — ${KEY_ACTION}으로 구입 (${TANK_PRICE.toLocaleString()}원, 숨 60초→3분)`;
    return;
  }
  if (typeof RACE_SPOT !== 'undefined' &&
      Math.hypot(state.x - RACE_SPOT.x, state.z - RACE_SPOT.z) < RACE_RANGE) {
    ropeBadge.textContent = ponyLove < RACE_MIN_LOVE
      ? `🏇 경마 — 애정 ${RACE_MIN_LOVE} 이상부터 출전 (지금 ${ponyLove})`
      : `🏇 경마 출전 ${RACE_FEE.toLocaleString()}원 · 1등 상금 ${racePrize().toLocaleString()}원(당근 먹인 만큼 커짐) · 승률 ${Math.round(raceWinChance() * 100)}% (${KEY_ACTION})`;
    return;
  }
  if (typeof STABLE !== 'undefined' &&
      Math.hypot(state.x - STABLE.x, state.z - STABLE.z) < STABLE_RANGE) {
    if (!ponyAlive) {
      ropeBadge.textContent = `💔 마구간이 비었어요 — ${KEY_ACTION}으로 새 조랑말 데려오기 (${PONY_PRICE.toLocaleString()}원)`;
    } else if (carrots > 0) {
      ropeBadge.textContent = `🐴 ${KEY_ACTION}으로 당근 먹이기 (${carrots}개 있음)` +
        (ponyFedToday() ? '' : ' · 오늘 아직 안 먹였어요');
    } else {
      ropeBadge.textContent = '🐴 조랑말한테 당근을 주세요 — 당근은 이장님 상점에서';
    }
    return;
  }
  if (state.grabbing) {
    ropeBadge.style.display = 'block';
    ropeBadge.textContent = `🤝 상자를 끄는 중 (${KEY_ACTION}로 놓기)`;
    return;
  }
  // 알려줄 것이 없으면 배지를 아예 숨깁니다 (화면을 어지럽히지 않게)
  ropeBadge.style.display = 'none';
}
updateCoinBadge();

// 화면에 잠깐 떴다 사라지는 "+1000원" 표시. 3D 좌표를 화면 좌표로 투영해서
// 일반 HTML 글자로 띄우는 방식이라(WebGL 텍스트보다 간단), 매 프레임 위치만 갱신해주면 됩니다.
const popups = [];
// life를 주면 그 시간(초)만큼 떠 있습니다 — 중요한 문구는 길게 (기본 1.1초)
function spawnMoneyPopup(worldX, worldY, worldZ, text, life) {
  const el = document.createElement('div');
  el.className = 'moneyPopup';
  el.textContent = text;
  document.getElementById('ui').appendChild(el);
  popups.push({ el, x: worldX, y: worldY, z: worldZ, t: 0, life: life || 1.1 });
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

// 배경음악 켜고 끄기 — 키보드는 M, 폰은 배지를 손가락으로 누르면 됩니다.
// (화면 안내표는 전부 pointer-events: none 이라 손가락 입력을 안 받습니다.
//  이 배지만 auto로 되돌려 놔야 눌러도 반응합니다 — CSS의 .tappable 이 그 일을 합니다)
const musicBadge = document.getElementById('musicBadge');
function updateMusicBadge() {
  if (musicBadge) musicBadge.textContent = bgm.muted ? '🔇' : '🎵';
}
function toggleMusic() {
  bgm.muted = !bgm.muted;
  if (!bgm.muted) startBgm();   // 아직 한 번도 안 틀었으면 이참에 틀어줍니다
  updateMusicBadge();
}
// M키는 지도가 가져갔습니다. 음악은 왼쪽 아래 🎵 배지를 눌러 켜고 끕니다.
if (musicBadge) {
  musicBadge.classList.add('tappable');
  musicBadge.addEventListener('pointerdown', (e) => { e.preventDefault(); toggleMusic(); });
}
updateMusicBadge();

const harvestVec = new THREE.Vector3();
function updatePopups(dt) {
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.t += dt;
    if (p.t > p.life) { p.el.remove(); popups.splice(i, 1); }
  }
  // 알림은 세계 좌표를 따라다니지 않고, 화면 가운데 위쪽에 차곡차곡 쌓입니다
  let stackTop = 64;
  for (let i = 0; i < popups.length; i++) {
    const p = popups[i];
    p.el.style.left = '50%';
    p.el.style.top = stackTop + 'px';
    stackTop += (p.el.offsetHeight || 34) + 8;
    // 수명의 마지막 30% 구간에서만 서서히 사라집니다
    p.el.style.opacity = p.t < p.life * 0.7 ? 1 : Math.max(0, 1 - (p.t - p.life * 0.7) / (p.life * 0.3));
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
let BASKET_CAP = 20;            // 이만큼 담으면 가득 참(한 박스 10,000원). 집을 다 고치면 창고가 생겨 30으로 늘어납니다
const filledFruits = [];        // { mesh, pop } — pop은 방금 담겨서 통 튀어오르는 정도(1→0)
let basketCount = 0;
{
  // 4×3을 한 층으로 4층까지 = 48자리를 미리 만들어 둡니다.
  // 평소 정원은 36(3층)이고, 집을 다 고쳐 정원이 48로 늘면 4층째가 수북이 쌓입니다.
  const COLS = 4, ROWS = 3, LAYERS = 4;
  const GAP = 0.21, RADIUS = 0.115;
  const packedGeo = new THREE.SphereGeometry(RADIUS, 8, 6);
  // 맨 아래층은 바닥 바로 위, 3층째가 상자 아가리에 걸치고, 4층째(확장분)는 그 위에 수북이
  const yBottom = CRATE_T + RADIUS;
  const yStep = (CRATE_H - yBottom) / 2;   // 층 간격은 예전 3층 기준 그대로
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

  // 그래도 깊이 겹치면 루루 쪽을 밀어냅니다 — 상자가 밀려나는 속도보다 루루 걸음이
  // 빨라서(특히 달리기) 몸이 상자를 뚫고 지나가던 오류를 여기서 막습니다.
  const px = basketPos.x - state.x, pz = basketPos.z - state.z;
  const pd = Math.hypot(px, pz);
  const minD = PUSH_MIN_DIST * 0.72;
  if (pd < minD && pd > 0.0001) {
    state.x = basketPos.x - (px / pd) * minD;
    state.z = basketPos.z - (pz / pd) * minD;
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
// E키는 상황에 따라 다르게 씁니다: 뭍에서는 상자 잡기, 물속에서는 물질 끝내고 나오기.
// 상호작용 키는 F 하나로 통일했습니다. E는 손에 익은 분들을 위한 같은 기능의 별칭입니다.
// (E 별칭은 뺐습니다 — 상호작용은 F 하나뿐입니다)

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
      if (addFruitToBasket()) {
        playDropSound();                            // 나무통에 툭 떨어지는 소리
        // 황금향이 열리는 날엔 열 알에 하나꼴로 황금향이 섞여 있습니다.
        // 황금향은 일반 귤의 세 배 값이라, 상자에 세 알 몫으로 담깁니다.
        if (dayEvent === 'gold' && Math.random() < 0.10) {
          addFruitToBasket();   // 이미 한 알 담겼으니 두 알을 더 얹으면 세 알 몫
          addFruitToBasket();
          stat.gold++;
          playShipSound();
          spawnMoneyPopup(p.x, p.y + 1.1, p.z, '✨ 황금향! 귤 3알 몫으로 담았어요', 3);
        } else {
          spawnMoneyPopup(p.x, p.y + 0.9, p.z, '🍊 +1');   // 한 알 담겼습니다 (돈은 박스로 팔 때 한꺼번에)
        }
      }
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
  // 딸 때는 돈을 바로 받지 않습니다. 상자에 한 알씩 쌓이고, 가득 채워 배송해야 박스값을 받습니다.
  // 택배사에서 이장님과 정산해야 비로소 현금이 됩니다.
  state.harvestT = 0;
  state.idleTime = 0;
  state.sit = 0;
}

// (예전에는 상점에서 10만원짜리 끈을 팔았고, 사면 상자가 자동으로 따라왔습니다.
//  상자는 E로 손잡고 끄는 것으로 충분해서 끈 아이템은 뺐습니다. 이제 상점 앞에서는
//  당근(왼쪽 바구니)과 해녀 산소통(오른쪽 판매대)을 팝니다.)

// ---------- 12-1d. 택배사 — 이장님과 정산하고 육지로 부치기 ----------
// 귤은 낱개로 값을 세지 않습니다. 상자를 가득 채워 가면 이장님이 한 박스 10,000원에 사 줍니다.
// (덜 찬 상자는 안 사 줍니다 — "가득 채워서 오게!")
// 이장님이 택배사에 계셔야 정산이 됩니다 — 루루가 문앞에 서면 이장님이 걸어오니 잠깐 기다리세요.
const BOX_PRICE = 10000;
function tryShipBox() {
  const dp = depot.group.position;
  const popupY = dp.y + 3.2;
  if (basketCount === 0) {
    spawnMoneyPopup(dp.x, popupY, dp.z, '상자가 비었어요 · 귤을 담아 오세요');
    return;
  }
  if (basketCount < BASKET_CAP) {
    spawnMoneyPopup(dp.x, popupY, dp.z,
      `상자를 가득 채워서 오게 (${basketCount}/${BASKET_CAP}) — 한 박스 ${BOX_PRICE.toLocaleString()}원`);
    return;
  }
  // 이장님이 아직 오는 중이면 정산할 사람이 없습니다
  const mayorHere = Math.hypot(mayor.x - MAYOR_POSTS.depot.x, mayor.z - MAYOR_POSTS.depot.z) < 2.5;
  if (!mayorHere) {
    spawnMoneyPopup(dp.x, popupY, dp.z, '이장님이 오고 계세요 — 잠깐만요');
    return;
  }
  coins += BOX_PRICE;
  stat.boxes++;
  emptyBasket();                 // 트럭에 실었으니 상자는 다시 비워집니다
  updateCoinBadge();
  playShipSound();
  spawnMoneyPopup(dp.x, popupY, dp.z, `🚚 이장님이 귤 한 박스를 사셨어요! +${BOX_PRICE.toLocaleString()}원`);
  checkAchievements();
}

// ---------- 12-1e. 해녀 물질 ----------
// 불턱에서 F를 누르면 바닷속으로 들어갑니다. 숨은 한정돼 있어서, 다 떨어지기 전에
// 수면으로 올라와야 합니다. 딴 것은 망사리에 담기고, 뭍으로 나올 때 한꺼번에 팝니다.
// 물질은 포구 축대 끝(바다 쪽 끝자락)에서 들어갑니다 — 축대를 끝까지 걸어나가야 합니다.
const DIVE_ENTRY = { x: 0, z: 101 };
const DIVE_ENTRY_RANGE = 2.6;
// 포구는 축대가 넓어서 인식 범위도 넉넉해야 합니다.
// ※ 예전에는 안내 문구가 5.2미터부터 뜨는데 실제 인식은 3.2미터라, 그 사이 2미터 구간에서
//   "누르세요"라고 해놓고 눌러도 아무 일이 안 일어났습니다. 이제 둘을 같은 값으로 맞춥니다.
const BULTEOK_RANGE = 6.0;
let BREATH_MAX = 60;           // 한 번 잠수해서 버틸 수 있는 시간(초). 산소통을 사면 3분으로 늘어납니다
const NET_CAP = 24;            // 망사리에 담을 수 있는 개수
const CATCH_RANGE = 1.7;       // 이 거리 안의 것만 딸 수 있음
let breath = BREATH_MAX;
let net = [];                  // 이번 물질에서 딴 것들의 종류 목록
let netNight = [];             // 각각을 밤에 땄는가 — 야간물질은 값을 2배로 쳐줍니다
let breathLow = false;         // 숨이 얼마 안 남아 몸이 무거워진 상태
let surfacing = 0;             // (예전 "저절로 떠오르기"의 잔재 — 이제 안 쓰지만 다른 코드가 참조합니다)
let drowning = 0;              // 0보다 크면 숨이 다해 정신을 잃는 중 (남은 시간)
const vignette = document.getElementById('vignette');

const breathBar = document.getElementById('breathFill');
const breathBox = document.getElementById('breathBar');
const netBadge = document.getElementById('netBadge');

function updateDiveUI() {
  if (breathBox) breathBox.style.display = state.diving ? 'block' : 'none';
  if (breathBar) {
    const pct = Math.max(0, breath / BREATH_MAX);
    breathBar.style.width = (pct * 100) + '%';
    breathBar.style.background = pct > 0.4 ? '#5fc6e8' : pct > 0.18 ? '#f0b429' : '#e2553d';
  }
  if (netBadge) {
    netBadge.style.display = state.diving || net.length ? 'block' : 'none';
    netBadge.textContent = `🧺 망사리 ${net.length}/${NET_CAP}`;
    netBadge.classList.toggle('full', net.length >= NET_CAP);
  }
}

// 물속과 뭍은 안개 색과 빛만 바꿔도 완전히 다른 곳처럼 보입니다
const LAND_FOG = { color: 0xd2e6ee, near: 150, far: 700, sun: 2.1 };
// 물빛 — 수면 가까이는 볕이 들어 밝은 청록, 깊이 내려갈수록 짙푸르게 잠깁니다
const SEA_SHALLOW = new THREE.Color(0x1d7d92);
const SEA_DEEP = new THREE.Color(0x093243);
function applyDiveLook() {
  if (state.diving) {
    scene.fog.color.copy(SEA_SHALLOW);
    scene.fog.near = 1;
    scene.fog.far = 40;                 // 멀리 못 보게 해서 물속 답답함을 냅니다
    sun.intensity = 0.75;               // 물속은 볕이 잘 안 들지만, 아주 캄캄하면 아무것도 안 보입니다
    hemi.intensity = 1.0;
    // 하늘·구름·나비·성산일출봉을 감춥니다. 물속에서 이것들이 비치면
    // 물이 유리처럼 투명해 보여서 "잠수했다"는 느낌이 사라집니다.
    // 하늘을 그냥 끄면 그 자리가 시커먼 빈 공간으로 남으므로, 화면 바탕을 물빛으로 칠해둡니다.
    scene.background = SEA_SHALLOW.clone();
    sky.visible = false;
    for (const o of skyStuff) o.visible = false;
    for (const c of clouds) c.visible = false;
    for (const b of butterflies) b.visible = false;
    // 수면을 아래에서 올려다보면 은빛 천장처럼 보여야 합니다
    sea.material.side = THREE.DoubleSide;
    sea.material.opacity = 0.75;
  } else {
    scene.fog.color.setHex(LAND_FOG.color);
    scene.fog.near = LAND_FOG.near;
    scene.fog.far = LAND_FOG.far;
    sun.intensity = LAND_FOG.sun;
    hemi.intensity = 1.15;
    scene.background = null;   // 뭍에서는 하늘 구가 배경 노릇을 합니다
    sky.visible = true;
    for (const o of skyStuff) o.visible = true;
    for (const c of clouds) c.visible = true;
    for (const b of butterflies) b.visible = true;
    sea.material.side = THREE.FrontSide;
    sea.material.opacity = 0.94;
  }
  sea.material.needsUpdate = true;
}

function enterDive() {
  stat.dives++;
  checkAchievements();
  state.diving = true;
  breath = BREATH_MAX;
  breathLow = false;
  surfacing = 0;
  drowning = 0;
  swimVel.x = 0; swimVel.z = 0;
  net = [];
  netNight = [];
  state.x = DIVE.x;
  state.z = DIVE.z - DIVE.r * 0.6;
  state.vy = 0;
  lulu.position.set(state.x, SEA_Y, state.z);   // 수면에서 시작해 가라앉습니다
  state.grabbing = false;
  state.idleTime = 0; state.sit = 0;
  applyDiveLook();
  updateDiveUI();
  // 야간물질 안내는 포구 배지가 이미 해줍니다 — 입수 알림은 하나로 통일
  spawnMoneyPopup(state.x, SEA_Y + 1.5, state.z, '🤿 물질 시작! 숨 조심하세요');
}

// 뭍으로 나오면서 딴 것을 전부 팝니다.
// 단, 숨이 다해 정신을 잃고 나온 것(reason === 'drown')이면 망사리를 통째로 잃습니다.
function leaveDive(reason) {
  let pay = 0;
  const tally = {};
  let nightSold = false;
  net.forEach((kind, i) => {
    // 밤에 딴 것은 값을 2배로 쳐줍니다 (야간물질 보너스)
    pay += CATCH_KINDS[kind].price * (netNight[i] ? 2 : 1);
    if (netNight[i]) nightSold = true;
    tally[kind] = (tally[kind] || 0) + 1;
  });
  const caught = reason === 'drown' ? 0 : net.length;
  const lost = net.length;
  state.diving = false;
  net = [];
  netNight = [];
  breath = BREATH_MAX;
  breathLow = false;
  surfacing = 0;
  drowning = 0;
  state.pickT = -1;
  swimVel.x = 0; swimVel.z = 0;
  if (vignette) vignette.style.opacity = 0;
  state.x = PORT.x; state.z = PORT.z - 1.5;      // 포구의 마른 땅 쪽으로 올라옵니다
  state.vy = 0;
  lulu.position.set(state.x, groundHeight(state.x, state.z), state.z);
  state.onGround = true;
  state.idleTime = 0; state.sit = 0;
  applyDiveLook();
  updateDiveUI();

  const py = groundHeight(BULTEOK.x, BULTEOK.z) + 2.2;
  if (reason === 'drown') {
    // 정신을 잃고 뭍에 떠밀려 왔습니다 — 기절한 사이 도둑이 들어 돈이 전부 사라졌습니다.
    // 그게 숨을 아껴야 하는 진짜 이유입니다. (죽는 순간 바로 저장해 새로고침 꼼수도 안 통합니다)
    const lostCoins = coins;
    coins = 0;
    stat.drowns++;
    updateCoinBadge();
    saveGame(true);
    checkAchievements();
    // DIE 화면은 뭍에서 깨어난 뒤에도 한동안 머물다가 천천히 걷힙니다
    if (deathOverlay) setTimeout(() => deathOverlay.classList.remove('show'), 2800);
    spawnMoneyPopup(BULTEOK.x, py, BULTEOK.z,
      lostCoins > 0
        ? '💸 의식을 잃은 사이 누군가 집에 들어와 돈을 다 훔쳐갔습니다'
        : '😵 정신을 잃고 떠밀려 왔어요', 5.5);
    if (lost > 0) {
      setTimeout(() => spawnMoneyPopup(BULTEOK.x, py + 0.9, BULTEOK.z,
        `🧺 망사리에 담았던 ${lost}개도 바다에 흘렸습니다`, 5), 2600);
    }
  } else if (caught > 0) {
    if (dayEvent === 'haul') pay = Math.round(pay * 1.5);   // 물반 고기반 — 오늘은 1.5배!
    coins += pay;
    for (const [k, n] of Object.entries(tally)) stat[k] = (stat[k] || 0) + n;
    updateCoinBadge();
    playShipSound();
    const list = Object.entries(tally).map(([k, n]) => `${CATCH_KINDS[k].name} ${n}`).join(' · ');
    spawnMoneyPopup(BULTEOK.x, py, BULTEOK.z,
      `${list} → +${pay.toLocaleString()}원` +
      (nightSold ? ' (야간물질 2배!)' : '') +
      (dayEvent === 'haul' ? ' (물반 고기반!)' : ''));
    checkAchievements();
  } else {
    spawnMoneyPopup(BULTEOK.x, py, BULTEOK.z, '뭍으로 나왔어요');
  }
}

// 물속에서 정신을 잃을 때 — 낮게 잦아드는 소리
function playDrownSound() {
  blip(220, 55, 0.9, 0.18, 'sine');
}

// 손 닿는 곳에 있는, 아직 안 딴 채집물 찾기
function nearestCatch() {
  let best = -1, bestD = CATCH_RANGE;
  for (let i = 0; i < catchSpots.length; i++) {
    const s = catchSpots[i];
    if (s.picked) continue;
    const d = Math.hypot(s.x - state.x, s.z - state.z, );
    const dy = Math.abs(s.y - lulu.position.y);
    if (d < bestD && dy < 2.0) { bestD = d; best = i; }
  }
  return best;
}

function hideCatch(i) {
  const s = catchSpots[i];
  s.picked = true;
  dummy.position.set(s.x, s.y, s.z);
  dummy.rotation.set(0, 0, 0);
  dummy.scale.setScalar(0);
  dummy.updateMatrix();
  const m = catchMeshes[s.kind];
  m.setMatrixAt(s.slot, dummy.matrix);
  m.instanceMatrix.needsUpdate = true;
}

function tryCollect() {
  if (drowning > 0) return;   // 정신을 잃는 중
  if (net.length >= NET_CAP) {
    spawnMoneyPopup(state.x, lulu.position.y + 1.2, state.z, '망사리가 가득 찼어요 · 뭍으로!');
    return;
  }
  if (state.pickT >= 0) return;          // 이미 따는 중
  const i = nearestCatch();
  if (i < 0) return;
  const s = catchSpots[i];
  state.facing = Math.atan2(s.x - state.x, s.z - state.z);
  state.pickT = 0;                       // 손 뻗어 떼어내는 동작 시작
  hideCatch(i);
  net.push(s.kind);
  // 야간물질 보너스 — 밤에 딴 것은 팔 때 값을 2배로 쳐줍니다
  const night = isNight();
  netNight.push(night);
  playPickSound();
  updateDiveUI();
  spawnMoneyPopup(s.x, s.y + 0.6, s.z,
    night ? `${CATCH_KINDS[s.kind].name} (야간 2배)` : CATCH_KINDS[s.kind].name);
  state.idleTime = 0;
}

// 매 프레임 숨을 관리합니다. 수면 가까이 올라오면 숨을 다시 채웁니다.
//
// 숨이 다했을 때 툭 하고 뭍으로 순간이동시키면 너무 갑작스럽습니다. 「인사이드」처럼
// 서서히 조여오게 만듭니다: 숨이 얼마 안 남으면 화면 가장자리가 어두워지고 몸이 무거워지고,
// 다 떨어지면 루루가 스스로 수면을 향해 떠오른 다음 뭍으로 나옵니다.
const BREATH_LOW = 0.3;        // 이 아래로 떨어지면 "숨이 차는" 구간
const PICK_DURATION = 0.55;    // 전복 따는 동작이 재생되는 시간(초)
// 숨이 다하면 화면이 어두워지며 제주 속담과 DIE 자막이 떠오릅니다
const deathOverlay = document.getElementById('deathOverlay');
// 물속 부유물(플랑크톤 티끌) — 물이 텅 비어 있으면 옆으로 헤엄쳐도 화면에
// 아무 변화가 없어서 "키가 안 먹는다"고 느껴집니다. 작은 티끌들이 곁을
// 스쳐 지나가면 내가 어느 쪽으로 얼마나 움직이는지 눈에 보입니다.
let motes = null;
// 점(Points)은 그냥 두면 네모로 그려집니다. 물속 티끌·기포가 흰 사각형으로 보이면
// 아주 어색하므로, 가장자리가 부드럽게 흐려지는 동그란 그림을 만들어 씌웁니다.
function makeRoundSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(32, 32, 32, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  return t;
}
const ROUND_SPRITE = makeRoundSprite();
function buildMotes() {
  const n = 140, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * DIVE.r;
    pos[i * 3] = DIVE.x + Math.cos(a) * rr;
    pos[i * 3 + 1] = SEA_Y - 0.6 - Math.random() * (DIVE_DEPTH - 0.5);
    pos[i * 3 + 2] = DIVE.z + Math.sin(a) * rr;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  motes = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xcdeae6, size: 0.15, transparent: true, opacity: 0.6,
    map: ROUND_SPRITE, alphaTest: 0.02,
    sizeAttenuation: true, depthWrite: false,
  }));
  motes.visible = false;
  scene.add(motes);
}
buildMotes();

// ---------- 물속 풍경 — 빛줄기·기포·해초 ----------
// 안개 색 하나만으로는 "불 꺼진 방"처럼 보입니다. 물속답게 보이려면 겹이 필요합니다:
// 수면에서 비스듬히 내려오는 빛줄기, 떠오르는 기포, 앞뒤로 겹친 해초.
// 폰에서도 돌아가도록 전부 단순한 판·점으로만 만듭니다.
let seaRays = null, bubbles = null, weeds = null;
const bubbleData = [];
const weedData = [];

function buildSeaRays() {
  seaRays = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xbdf0f4, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
    const rr = 3 + Math.random() * (DIVE.r - 5);
    // 위는 넓고 아래는 좁은 사다리꼴 판 — 수면에서 쏟아지는 빛기둥
    const w = 1.6 + Math.random() * 2.4;
    const g = new THREE.PlaneGeometry(w, DIVE_DEPTH + 3);
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) {
      if (p.getY(v) < 0) p.setX(v, p.getX(v) * 0.35);   // 아래쪽을 좁혀 빛기둥 모양으로
    }
    p.needsUpdate = true;
    // 빛줄기마다 따로 일렁이게 하려면 재질을 각자 하나씩 가져야 합니다
    const m = new THREE.Mesh(g, mat.clone());
    m.position.set(DIVE.x + Math.cos(a) * rr, SEA_Y - DIVE_DEPTH * 0.45, DIVE.z + Math.sin(a) * rr);
    m.rotation.set(0.22 + Math.random() * 0.1, a, 0);   // 비스듬히 기울여 내리꽂히게
    m.userData.spin = a;
    seaRays.add(m);
  }
  seaRays.visible = false;
  scene.add(seaRays);
}

function buildBubbles() {
  const n = 90, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * DIVE.r;
    const x = DIVE.x + Math.cos(a) * rr, z = DIVE.z + Math.sin(a) * rr;
    const y = SEA_Y - Math.random() * DIVE_DEPTH;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    bubbleData.push({ x, z, speed: 0.35 + Math.random() * 0.75, sway: Math.random() * Math.PI * 2 });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  bubbles = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xdff4f8, size: 0.2, transparent: true, opacity: 0.55,
    map: ROUND_SPRITE, alphaTest: 0.02,
    sizeAttenuation: true, depthWrite: false, fog: false,
  }));
  bubbles.visible = false;
  scene.add(bubbles);
}

function buildWeeds() {
  weeds = new THREE.Group();
  // 물속은 볕이 약해 그림자 지는 재질을 쓰면 새까맣게 묻힙니다.
  // 빛을 안 타는 재질에 밝은 물풀 색을 직접 입혀야 형체가 보입니다.
  const mats = [
    new THREE.MeshBasicMaterial({ color: 0x1f6b57, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0x2a7a48, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0x4a7a33, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  ];
  // 미역 잎 한 장 — 밑동은 넓고 끝으로 갈수록 가늘어지며 살짝 휩니다.
  // (그냥 네모 판을 세우면 초록 막대기처럼 보여서 물풀로 안 보입니다)
  function makeBlade(w, h) {
    const g = new THREE.PlaneGeometry(w, h, 1, 6);
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const ratio = (p.getY(v) + h / 2) / h;          // 0 = 밑동, 1 = 잎끝
      p.setX(v, p.getX(v) * (1 - ratio * 0.82));      // 끝으로 갈수록 가늘게
      p.setY(v, p.getY(v) + h / 2);                   // 밑동을 원점에 맞춥니다
      p.setZ(v, p.getZ(v) + ratio * ratio * h * 0.18); // 물살에 밀린 듯 살짝 휘게
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }
  for (let i = 0; i < 34; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * (DIVE.r - 3);
    const x = DIVE.x + Math.cos(a) * rr, z = DIVE.z + Math.sin(a) * rr;
    const gy = groundHeight(x, z);
    if (gy > SEA_Y - 2.5) continue;   // 물이 얕은 가장자리에는 심지 않습니다 (수면 위로 솟아 보입니다)
    // 한 포기에서 잎 서너 장이 부챗살처럼 뻗어 나옵니다
    const clump = new THREE.Group();
    clump.position.set(x, gy, z);
    const mat = mats[i % mats.length];
    const blades = 3 + Math.floor(Math.random() * 2);
    for (let b = 0; b < blades; b++) {
      const h = 1.2 + Math.random() * 2.2;
      const m = new THREE.Mesh(makeBlade(0.3 + Math.random() * 0.22, h), mat);
      m.rotation.y = (b / blades) * Math.PI * 2 + Math.random() * 0.5;
      m.rotation.z = (Math.random() - 0.5) * 0.4;     // 제각기 다른 쪽으로 기울어지게
      clump.add(m);
    }
    weeds.add(clump);
    weedData.push({ mesh: clump, phase: Math.random() * Math.PI * 2, amp: 0.08 + Math.random() * 0.13 });
  }
  weeds.visible = false;
  scene.add(weeds);
}
buildSeaRays();
buildBubbles();
buildWeeds();

// 물속 풍경을 살아 움직이게 합니다 — 기포는 떠오르고, 해초는 물결에 흔들리고,
// 빛줄기는 수면 물결처럼 아주 천천히 일렁입니다.
function updateSeaScenery(dt, t) {
  if (bubbles) {
    const p = bubbles.geometry.attributes.position;
    for (let i = 0; i < bubbleData.length; i++) {
      const b = bubbleData[i];
      let y = p.getY(i) + b.speed * dt;
      if (y > SEA_Y - 0.15) {                       // 수면에 닿으면 바닥에서 다시 올라옵니다
        y = SEA_Y - DIVE_DEPTH + Math.random() * 0.8;
      }
      p.setY(i, y);
      p.setX(i, b.x + Math.sin(t * 0.8 + b.sway) * 0.12);   // 오르며 살랑살랑
      p.setZ(i, b.z + Math.cos(t * 0.7 + b.sway) * 0.12);
    }
    p.needsUpdate = true;
  }
  for (const w of weedData) {
    w.mesh.rotation.z = Math.sin(t * 0.9 + w.phase) * w.amp;
    w.mesh.rotation.x = Math.cos(t * 0.6 + w.phase) * w.amp * 0.5;
  }
  if (seaRays) {
    for (const m of seaRays.children) {
      m.material.opacity = 0.12 + (Math.sin(t * 0.55 + m.userData.spin) + 1) * 0.045;
    }
  }
}

function updateDiving(dt) {
  if (state.pickT >= 0) {
    state.pickT += dt;
    if (state.pickT >= PICK_DURATION) state.pickT = -1;
  }
  if (motes) motes.visible = state.diving;
  if (seaRays) seaRays.visible = state.diving;
  if (bubbles) bubbles.visible = state.diving;
  if (weeds) weeds.visible = state.diving;
  if (state.diving) updateSeaScenery(dt, performance.now() * 0.001);
  if (!state.diving) { if (vignette) vignette.style.opacity = 0; return; }
  const atSurface = lulu.position.y > SEA_Y - 1.2;

  if (drowning > 0) {
    // 숨이 다해 정신을 잃는 중 — 몸이 축 처져 가라앉고, 화면이 조여들다가 뭍에서 깨어납니다.
    // 이 동안 딴 것(망사리)은 전부 바다에 흘려보냅니다. 그게 숨을 아껴야 하는 이유입니다.
    drowning -= dt;
    state.vy = Math.min(state.vy, -0.35);   // 몸에 힘이 빠져 아주 천천히 가라앉습니다
    swimVel.x *= 0.9; swimVel.z *= 0.9;
    if (vignette) vignette.style.opacity = Math.min(1, 1.4 - drowning * 0.6);
    if (drowning <= 0) { leaveDive('drown'); return; }
    updateDiveUI();
    return;
  }

  if (atSurface) {
    breath = Math.min(BREATH_MAX, breath + dt * 12);   // 수면에서 숨을 몰아쉽니다
    // 그림의 물결선(가슴께)이 실제 수면과 맞도록, 떠 있으면 그 높이에 살며시 붙습니다
    const goingDown = keys['ArrowDown'] || touchMove.f < -0.3;
    if (!goingDown && drowning <= 0) {
      // 물결 따라 몸이 천천히 오르내려야 "떠 있다"는 느낌이 납니다 (붙박이면 서 있는 것처럼 보입니다)
      const floatY = SEA_Y - 0.8 + Math.sin(performance.now() * 0.0016) * 0.09;
      lulu.position.y += (floatY - lulu.position.y) * Math.min(1, dt * 5);
      if (state.vy > 0.3) state.vy = 0.3;
    }
  } else {
    // 밤에는 물이 차고 어두워 숨이 1.5배 빨리 닳습니다 (야간물질 값 2배의 대가)
    breath -= dt * (isNight() ? 1.5 : 1);
    if (breath <= 0) {
      breath = 0;
      drowning = 4.2;                                   // 정신을 잃습니다 — 문구를 읽을 만큼 천천히 가라앉습니다
      if (deathOverlay) deathOverlay.classList.add('show');   // '욕심내민 바당이 데려간다' + DIE
      playDrownSound();
    }
  }

  const ratio = breath / BREATH_MAX;
  breathLow = ratio < BREATH_LOW;
  // 숨이 줄수록 화면 가장자리가 조여오고 물빛이 어두워집니다
  if (vignette) vignette.style.opacity = breathLow ? (1 - ratio / BREATH_LOW) * 0.75 : 0;
  if (atSurface) {
    // 수면에 떠 있을 때는 멀리까지 보여야 물과 하늘의 경계(수평선)가 삽니다
    scene.fog.color.setHex(0xd2e6ee);
    scene.fog.near = 150;
    scene.fog.far = 700;
    for (const o of skyStuff) o.visible = true;
    for (const c of clouds) c.visible = true;
  } else {
    // 물속 — 얕은 곳은 볕이 들어 밝고, 깊이 내려갈수록 짙푸르게 잠깁니다.
    // 이 깊이 그라데이션이 "얼마나 깊이 왔는지"를 눈으로 알려줍니다.
    const depth = Math.min(1, Math.max(0, (SEA_Y - lulu.position.y) / DIVE_DEPTH));
    scene.fog.color.copy(SEA_SHALLOW).lerp(SEA_DEEP, depth);
    if (scene.background && scene.background.copy) {
      scene.background.copy(SEA_SHALLOW).lerp(SEA_DEEP, depth);
    }
    scene.fog.near = 1;
    scene.fog.far = (40 - depth * 12) - (breathLow ? (1 - ratio / BREATH_LOW) * 16 : 0);
    for (const o of skyStuff) o.visible = false;
    for (const c of clouds) c.visible = false;
  }
  updateDiveUI();
}

// ---------- 12-1f. 페인트칠 — 집수리의 마지막 손길 ----------
// (망치·톱 수리는 뺐습니다 — 벽·지붕·문·창은 이제 상점 구매로 해결하고,
//  집에서 직접 하는 일은 골라 온 색으로 외벽을 칠하는 것 하나입니다)
// 공구대에서 페인트(색 고르기)를 사 온 뒤, 집 앞에서 F를 눌러 여섯 번 칠하면 완성.
const SWINGS_PER_STAGE = 6;    // 페인트칠을 끝내는 데 드는 붓질 횟수
const FIX_DURATION = 0.9;      // 한 번 휘두르는 동작 시간(초)
let fixSwings = 0;             // 붓질 몇 번 했나

function houseBadgeText() {
  if (endingState >= 2) return '🏚 곧 카페가 들어선다는 내 집… · 문 앞에 서면 안으로';
  if (houseStage >= 3) return '🏡 내 집! 창고(30알) · 문 앞에 서면 안으로 들어갑니다';
  if (!tools.paint) {
    return `🏚 외벽 페인트칠을 하려면 공구대에서 페인트를 사 오세요 (${PAINT_PRICE.toLocaleString()}원 · 색 고르기)`;
  }
  return `🖌 페인트칠 ${fixSwings}/${SWINGS_PER_STAGE} — ${KEY_ACTION}으로 계속 · 문 앞에 서면 안으로`;
}

function tryFixHouse() {
  const py = groundHeight(HOUSE.x, HOUSE.z) + HOUSE_H + 0.6;
  if (houseStage >= 3) {
    spawnMoneyPopup(HOUSE.x, py, HOUSE.z,
      endingState >= 2 ? '🏚 …이 집도 곧 카페가 된다고 한다' : '🏡 다 고쳤어요. 좋은 집이네요!');
    return;
  }
  if (!tools.paint) {
    spawnMoneyPopup(HOUSE.x, py, HOUSE.z, '🖌 페인트가 필요해요 — 상점 안 인테리어 코너에서 색을 골라 사 오세요');
    return;
  }
  // 붓질 한 번 — 동작이 끝나는 순간(updateHouse) 횟수가 올라갑니다
  state.fixT = 0;
  state.facing = Math.atan2(HOUSE.x - state.x, HOUSE.z - state.z);
  state.idleTime = 0; state.sit = 0;
  playHammerSound();
}

// 휘두르는 동작이 끝날 때마다 한 번으로 칩니다 (매 프레임 호출)
function updateHouse(dt) {
  if (state.fixT < 0) return;
  state.fixT += dt;
  if (state.fixT < FIX_DURATION) return;
  state.fixT = -1;
  fixSwings++;
  const py = groundHeight(HOUSE.x, HOUSE.z) + HOUSE_H + 0.6;
  if (fixSwings < SWINGS_PER_STAGE) {
    spawnMoneyPopup(HOUSE.x, py, HOUSE.z, `🖌 페인트칠 ${fixSwings}/${SWINGS_PER_STAGE}`);
    return;
  }
  // 칠 완성!
  fixSwings = 0;
  houseStage = 3;
  applyHouseLook();
  BASKET_CAP = 30;
  updateBasketBadge();
  playShipSound();
  spawnMoneyPopup(HOUSE.x, py, HOUSE.z, '🏡 페인트칠 끝! 창고가 생겨 상자가 30알로 커졌어요');
}

// 망치질 소리 — 탕, 탕, 탕 세 번
function playHammerSound() {
  for (let i = 0; i < 3; i++) {
    setTimeout(() => blip(190, 90, 0.09, 0.22, 'square'), i * 420);
  }
}

// ---------- 12-1f-2. 이장님 (상점 ↔ 택배사를 오가는 NPC) ----------
// 이장님은 상점과 택배사 두 집 문앞을 오갑니다. 평소에는 느긋하게 왔다갔다 산책하고,
// 루루가 어느 집 문앞으로 다가가면 장사하러 그쪽으로 걸어옵니다.
const MAYOR_POSTS = {
  shop:  { x: 6.0, z: 41.6 },     // 상점 문앞
  depot: { x: -7.3, z: 42.2 },    // 택배사 문앞
};
const mayor = {
  x: MAYOR_POSTS.shop.x, z: MAYOR_POSTS.shop.z,
  post: 'shop',        // 지금 향하는 집
  stroll: 9,           // 손님이 없을 때, 이 시간이 지나면 반대편으로 산책
  headingRight: false,
};
const MAYOR_SPEED = 1.7;   // 뚱뚱한 어른의 느긋한 걸음

function updateMayor(dt, t) {
  if (!mayorGroup) return;
  // 루루가 어느 집 가까이에 있으면 그쪽으로 (손님이 먼저입니다)
  const nearShop = Math.hypot(state.x - MAYOR_POSTS.shop.x, state.z - MAYOR_POSTS.shop.z) < 6;
  const nearDepot = Math.hypot(state.x - MAYOR_POSTS.depot.x, state.z - MAYOR_POSTS.depot.z) < 6;
  if (nearShop) mayor.post = 'shop';
  else if (nearDepot) mayor.post = 'depot';
  else {
    mayor.stroll -= dt;
    if (mayor.stroll <= 0) {
      mayor.post = mayor.post === 'shop' ? 'depot' : 'shop';
      mayor.stroll = 8 + Math.random() * 10;
    }
  }

  // 목표 지점으로 걷기
  const goal = MAYOR_POSTS[mayor.post];
  const dx = goal.x - mayor.x, dz = goal.z - mayor.z;
  const d = Math.hypot(dx, dz);
  const walking = d > 0.25;
  if (walking) {
    mayor.x += (dx / d) * MAYOR_SPEED * dt;
    mayor.z += (dz / d) * MAYOR_SPEED * dt;
  }

  // 그림판 놓기 + 카메라 쪽으로 돌리기 (루루와 같은 방식)
  const gy = groundHeight(mayor.x, mayor.z);
  mayorGroup.position.set(mayor.x, gy, mayor.z);
  mayorGroup.rotation.y = Math.atan2(camera.position.x - mayor.x, camera.position.z - mayor.z);

  // 걷는 중이면 걷기 그림, 서 있으면 몸을 흔드는 그림
  const sheet = walking ? SHEETS.mayorWalk : SHEETS.mayorIdle;
  if (mayorCard.material.map !== sheet.tex) {
    mayorCard.material.map = sheet.tex;
    mayorCard.material.needsUpdate = true;
  }
  setCell(sheet, Math.floor(t * (walking ? 9 : 6)) % sheet.frames);

  // 걷는 방향이 화면상 왼쪽인지 오른쪽인지 (걷기 원본은 오른쪽을 봅니다 — 루루와 반대)
  if (walking) {
    camera.getWorldDirection(camFwd);
    const rightX = -camFwd.z, rightZ = camFwd.x;
    const toRight = dx / d * rightX + dz / d * rightZ;
    if (Math.abs(toRight) > 0.12) mayor.headingRight = toRight > 0;
  }
  const Hp = mayorCard.userData.planeH;
  const Wp = Hp * sheet.frameW / CELL_H;
  const mirrorM = walking && !mayor.headingRight;   // 왼쪽으로 갈 때 뒤집기
  mayorCard.scale.set(mirrorM ? -Wp : Wp, Hp, 1);
}

// ---------- 12-1f-2a. 게임 시간 — 해가 뜨고 지는 하루, 그리고 말의 끼니 ----------
// 하루는 10분. 해뜰녘에 하루가 바뀌면서 "말에게 당근을 주세요" 알림이 옵니다.
// 당근은 얼마든지 줘도 되지만, 하루에 한 번은 꼭 줘야 합니다:
// 하루라도 거르면 말이 울고, 3일째·6일째엔 경고가 오고, 7일을 굶기면 죽습니다.
const DAY_LEN = 600;                 // 하루 길이 (초)
let gameT = DAY_LEN * 0.06;          // 아침 직후에서 시작
let dayCount = 1;
let lastFedDay = 0;                  // 마지막으로 당근을 준 날 (0 = 아직 한 번도 안 줌)
let ponyAlive = true;
let ponyDeaths = 0;   // 이번 게임에서 말을 굶겨 죽인 횟수 — 한 번도 없어야 새드엔딩이 안 옵니다
function ponyFedToday() { return lastFedDay >= dayCount; }
function hungerDays() { return Math.max(0, dayCount - lastFedDay); }

function applyPonyAlive() {
  // 그림 조랑말(ponyCard)이 있으면 3D 조랑말은 숨기고, 죽었으면 마구간을 비웁니다
  if (stable.pony) stable.pony.visible = ponyAlive && !ponyCard;
  if (ponyCard) ponyCard.visible = ponyAlive;
}

function morningNotice() {
  if (!ponyAlive) return;
  const px = state.x, py = lulu.position.y + 2.4, pz = state.z;
  const h = hungerDays();
  if (h >= 7) {
    // 7일을 굶겼습니다 — 마구간이 빕니다
    ponyAlive = false;
    ponyDeaths++;
    applyPonyAlive();
    saveGame(true);
    spawnMoneyPopup(px, py, pz, '💔 조랑말이 굶어 죽었습니다…', 8);
    return;
  }
  if (h >= 6) spawnMoneyPopup(px, py, pz, '🚨 오늘도 말먹이를 주지 않으면 말이 죽어요', 7);
  else if (h >= 3) spawnMoneyPopup(px, py, pz, '⚠️ 말이 배고파서 죽을지도 몰라요', 7);
  else spawnMoneyPopup(px, py, pz, '🌅 아침이에요 — 매일 아침 말에게 당근을 주세요', 6);
}

// ----- 오늘의 사건 — 아침마다 그날만의 일이 벌어집니다 (접속할 이유!) -----
// null(평온) 40% · 태풍 15% · 황금귤 15% · 물반고기반 15% · 장날 15%
let dayEvent = null;
function rollDayEvent() {
  const r = Math.random();
  dayEvent = r < 0.4 ? null : r < 0.55 ? 'storm' : r < 0.7 ? 'gold' : r < 0.85 ? 'haul' : 'market';
}
function dayEventNotice() {
  if (!dayEvent) return;
  const msg = {
    storm:  '🌀 태풍이 와요! 오늘은 물질을 쉽니다',
    gold:   '✨ 황금향이 열리는 날! 황금향 하나는 귤 3알 몫으로 담깁니다',
    haul:   '🌊 물반 고기반! 오늘 물질 채집물은 1.5배 값',
    market: '🎪 오늘은 장날! 상점 물건이 전부 반값',
  }[dayEvent];
  spawnMoneyPopup(state.x, lulu.position.y + 3.0, state.z, msg, 7);
}
// 장날이면 상점 물건값이 반값이 됩니다 (사는 곳마다 이 함수를 거칩니다)
function shopPrice(p) { return dayEvent === 'market' ? Math.round(p / 2) : p; }

// ----- 엔딩 — 꿈의 완성, 그리고 땅주인의 등장 -----
// 0 = 진행 중 · 1 = 해피엔딩(제주 최고의 집) · 2 = 새드엔딩(땅주인 등장 — 이야기의 끝)
let endingState = 0;
let happyDay = 0;          // 해피엔딩을 본 날 (며칠 뒤 땅주인이 옵니다)
function dreamDone() {
  return houseStage >= 3 &&
         FURN_ORDER.every((k) => furnitureOwned[k]) &&
         houseFloorColor !== 0 && houseWallColor !== 0;
}
const ENDING_HAPPY = [
  '집 수리가 끝났다. 가구가 들어오고, 벽지와 바닥도 새로 갈았다.',
  '이장님도, 해녀 할망도 구경을 왔다. "허, 제주에서 제일가는 집이구먼!"',
  '서울에서는 이룰 수 없던 꿈을, 루루는 제주에서 이뤘다. 🏡 — 꿈 달성! —',
];
const ENDING_SAD = [
  '어느 아침, 낯선 고양이가 서류 가방을 들고 찾아왔다.',
  '"여기, 무허가 건물인 거 아시죠? 제가 이 땅 주인입니다."',
  '"비워주세요. 여기다 카페를 지을 겁니다. …오션뷰 카페요."',
  '그리고 그 뒤에 — 낯익은 밀짚모자가 서 있었다.',
  '이 집을 4,000만 원에 판 사람. …이장님이었다.',
  '"미안하게 됐네. 카페 개업하면… 음료는 한 잔 서비스함세."',
  '4,000만 원에 사서, 1억을 들여 고치고 꾸민 내 집이… 루루는 눈앞이 캄캄해졌다. ㅠㅠ',
  '서울에는, 내가 살 수 있는 집이 없었다.',
  '…제주에도, 내 집은 없었다.',
  '— 끝 —',
];
// 아침마다 엔딩 차례가 됐는지 확인합니다. 엔딩이 나오는 아침에는 다른 알림을 쉽니다.
function checkEndingMorning() {
  if (endingState === 0 && dreamDone()) {
    endingState = 1;
    happyDay = dayCount;
    startTalk('루루의 이야기', ENDING_HAPPY, () => { checkAchievements(); saveGame(true); });
    return true;
  }
  // 말을 한 번도 굶겨 죽이지 않고 여기까지 왔다면 — 땅주인은 나타나지 않습니다.
  // 생명을 끝까지 지킨 루루에게는 해피엔딩이 그대로 남습니다.
  if (endingState === 1 && dayCount >= happyDay + 3 && ponyDeaths > 0) {
    endingState = 2;
    startTalk('루루의 이야기', ENDING_SAD, () => saveGame(true));
    return true;
  }
  return false;
}

// 하늘·해·안개를 시간에 맞춰 물들입니다
const SKY_DAY_TOP = new THREE.Color(0x2f7fd0), SKY_DAY_BOT = new THREE.Color(0xe2eff8);
const SKY_NGT_TOP = new THREE.Color(0x0a1230), SKY_NGT_BOT = new THREE.Color(0x1c2a4a);
const SKY_DUSK = new THREE.Color(0xf2a35e);
const FOG_DAY = new THREE.Color(0xd2e6ee), FOG_NGT = new THREE.Color(0x101a2c);
const DAY_PORTION = 0.62;            // 하루 중 낮의 비율 (나머지는 밤)
let sunAngCur = Math.PI / 2;         // 해의 각도 (동쪽 0 → 정오 π/2 → 서쪽 π, 밤이면 -1)
function updateDayNight(dt) {
  gameT += dt;
  if (gameT >= DAY_LEN) {
    gameT -= DAY_LEN;
    dayCount++;
    rollDayEvent();
    // 엔딩이 나오는 아침에는 다른 알림을 쉬고 이야기에 집중합니다
    if (!checkEndingMorning()) {
      morningNotice();
      setTimeout(dayEventNotice, 2200);   // 아침 인사 다음에 오늘의 소식
    }
  }
  const t01 = gameT / DAY_LEN;
  let daylight;
  if (t01 < DAY_PORTION) {
    sunAngCur = (t01 / DAY_PORTION) * Math.PI;
    daylight = Math.max(0, Math.sin(sunAngCur));
  } else {
    sunAngCur = -1;
    daylight = 0;
  }
  // 해뜰녘·해질녘의 주황기 — 해가 낮게 걸렸을 때만
  const dusk = Math.max(0, 1 - Math.abs(daylight - 0.18) / 0.18) * 0.6;
  sun.intensity = 0.12 + 1.95 * daylight;
  hemi.intensity = 0.22 + 0.95 * daylight;
  const top = sky.material.uniforms.topColor.value;
  const bot = sky.material.uniforms.bottomColor.value;
  top.copy(SKY_NGT_TOP).lerp(SKY_DAY_TOP, daylight);
  bot.copy(SKY_NGT_BOT).lerp(SKY_DAY_BOT, daylight).lerp(SKY_DUSK, dusk);
  if (!state.diving) scene.fog.color.copy(FOG_NGT).lerp(FOG_DAY, daylight).lerp(SKY_DUSK, dusk * 0.5);
  // 태풍이 오는 날은 종일 잿빛으로 어둑합니다
  if (dayEvent === 'storm') {
    sun.intensity *= 0.5;
    hemi.intensity *= 0.65;
    top.lerp(STORM_GRAY, 0.55);
    bot.lerp(STORM_GRAY, 0.4);
    if (!state.diving) scene.fog.color.lerp(STORM_GRAY, 0.5);
  }
}
const STORM_GRAY = new THREE.Color(0x6a7078);

// 조랑말 그림 갱신 — 오늘 당근을 먹었으면 웃는 모습, 아니면 우는 모습 (매 프레임)
function updatePony(t) {
  if (!ponyCard || !ponyAlive) return;
  const sheet = ponyFedToday() ? SHEETS.ponyHappy : SHEETS.ponySad;
  if (!sheet) return;
  if (ponyCard.material.map !== sheet.tex) ponyCard.material.map = sheet.tex;
  // 웃는 그림띠의 첫 칸에는 '1ST' 리본 조각이 남아 있어 건너뜁니다
  const cellIdx = sheet === SHEETS.ponyHappy ? 1 + (Math.floor(t * 7) % 7) : Math.floor(t * 8) % sheet.frames;
  setCell(sheet, cellIdx);
  const gy = groundHeight(STABLE.x, STABLE.z);
  ponyCard.position.set(STABLE.x + 0.2, gy, STABLE.z);
  // 루루 그림과 같은 종이 인형 방식 — 항상 카메라를 바라봅니다
  ponyCard.rotation.y = Math.atan2(camera.position.x - STABLE.x, camera.position.z - STABLE.z);
  const Hp = ponyCard.userData.planeH;
  const Wp = Hp * sheet.frameW / CELL_H;
  ponyCard.scale.set(Wp, Hp, 1);
}

// ---------- 12-1f-2a3. 대화 — 이장님·돌하르방과 이야기 ----------
// NPC 앞에서 F(🐾)를 누르면 화면 아래 종이 카드에 대사가 뜨고,
// 다시 누르면 다음 줄로 넘어갑니다. 이장님은 지금 섬 상황을 보고 말합니다.
const talkBoxEl = document.getElementById('talkBox');
const talkNameEl = document.getElementById('talkName');
const talkTextEl = document.getElementById('talkText');
let talkLines = [], talkIdx = -1, talkDone = null;
function talkOpen() { return talkIdx >= 0; }
function startTalk(name, lines, onDone) {
  talkLines = lines;
  talkIdx = 0;
  talkDone = onDone || null;
  if (talkNameEl) talkNameEl.textContent = name;
  if (talkBoxEl) talkBoxEl.style.display = 'block';
  if (talkTextEl) talkTextEl.textContent = talkLines[0];
}
function advanceTalk() {
  talkIdx++;
  if (talkIdx >= talkLines.length) {
    talkIdx = -1;
    if (talkBoxEl) talkBoxEl.style.display = 'none';
    if (talkDone) { const f = talkDone; talkDone = null; f(); }
    return;
  }
  if (talkTextEl) talkTextEl.textContent = talkLines[talkIdx];
}
if (talkBoxEl) talkBoxEl.addEventListener('pointerdown', (e) => { e.preventDefault(); advanceTalk(); });

function isNight() { return (gameT / DAY_LEN) >= DAY_PORTION; }

// 이장님 대사 — 급한 일부터 챙겨주는 참견쟁이 어른입니다
const MAYOR_TALK_RANGE = 2.2;
function mayorTalkLines() {
  if (!ponyAlive) return [
    '말이 그리 되다니… 마음이 아프네.',
    '마구간에 가면 새 친구를 데려올 수 있다네. 이번엔 꼭 매일 챙겨주게.',
  ];
  if (hungerDays() >= 3) return [
    '자네 말이 며칠째 울던데… 당근은 줬는가?',
    '산 것은 끼니를 거르면 못 버티네. 어서 가보게.',
  ];
  if (basketCount >= BASKET_CAP) return [
    '오, 귤이 실하네! 상자가 가득이야.',
    '택배사 앞으로 가져오게 — 한 박스 만 원, 후하게 쳐줌세.',
  ];
  if (!ponyFedToday()) return [
    '오늘 말한테 당근은 줬는가?',
    '아침마다 한 개씩 — 그게 말 키우는 법이라네.',
  ];
  if (isNight()) return [
    '밤바람이 차다, 얼른 들어가게.',
    '별 보며 걷는 것도 제주 맛이긴 하지만 말이야.',
  ];
  if (!hasNet) return [
    '물질을 해보고 싶으면 상점 안에서 망사리부터 사게.',
    '망사리 없이 바다에 드는 건 안 될 말이지.',
  ];
  const idle = [
    ['혼저 옵서예~ 오늘도 부지런하구만.'],
    ['귤은 알이 굵을 때 따야 제값을 받네.'],
    ['우리 섬 바다는 인심이 좋아. 욕심만 안 부리면 말이야.'],
    ['집은 좀 고쳐놨는가? 다 고치면 창고가 생겨 상자가 커진다네.'],
    ['자네 말, 요즘 눈빛이 다르던데? 경마에 한번 내보내 보게.'],
    ['바닥재랑 벽지도 들여놨네. 상점 왼쪽을 둘러보게.'],
    ['자네 집 말인가? …좋은 집이지. 아무렴, 좋은 집이고말고.', '(이장님은 왠지 눈을 피했다)'],
  ];
  return idle[Math.floor(Math.random() * idle.length)];
}

// 해녀 할망 — 포구 축대 중간에 앉아 계십니다. 물질하러 축대 끝까지 걸어나가려면
// 반드시 할망 곁을 지나게 되고, 지날 때마다 등 뒤로 잔소리 한마디를 듣고 갑니다.
// 물질하다 숨이 다하면 나오는 바로 그 말입니다. 새겨들읍시다.
const HALMANG_SPOT = { x: 0, z: 97.3 };   // 축대 한가운데 — 물질 가는 길목을 지키고 앉아 계십니다
const HALMANG_RANGE = 1.6;
let halmangNear = false;   // 곁을 지나는 중인가 — 범위에 새로 들어설 때 한 번만 말씀하십니다
obstacles.push({ x: HALMANG_SPOT.x, z: HALMANG_SPOT.z, r: 0.7, topY: NO_JUMP });
function halmangTalk() {
  // 밤에는 야간물질을 나서는 이에게 한마디 — "까불다간 이어도(저승 섬)에 간다"는 제주 말
  startTalk('해녀 할망', isNight()
    ? ['까불다 이어도 가주.']
    : ['욕심내민, 바당이 데려간다.']);
}
// 매 프레임 — 3D 모델이 있으면 모델로, 아직 없으면(내려받는 중) 그림 판으로 서 계십니다
function updateHalmang() {
  const gy = groundHeight(HALMANG_SPOT.x, HALMANG_SPOT.z);
  if (halmangModel) {
    halmangModel.position.set(HALMANG_SPOT.x, gy, HALMANG_SPOT.z);
    // 숨쉬듯 아주 살짝 부풀기 — 정지 모델이라도 살아 계신 느낌이 나게
    const br = 1 + Math.sin(performance.now() * 0.0016) * 0.012;
    halmangModel.scale.set(br, 1, br);
    if (halmangCard) halmangCard.visible = false;
  } else if (halmangCard) {
    halmangCard.visible = true;
    halmangCard.position.set(HALMANG_SPOT.x, gy, HALMANG_SPOT.z);
    halmangCard.rotation.y = Math.atan2(camera.position.x - HALMANG_SPOT.x, camera.position.z - HALMANG_SPOT.z);
    const sheet = SHEETS.halmang;
    setCell(sheet, Math.floor(performance.now() * 0.004) % sheet.frames);
    const Hp = halmangCard.userData.planeH;
    halmangCard.scale.set(Hp * sheet.frameW / CELL_H, Hp, 1);
  }
  // 곁을 지나면 잔소리 한마디 — 물질 나가는 길에 반드시 듣게 됩니다
  const near = !state.diving &&
    Math.hypot(state.x - HALMANG_SPOT.x, state.z - HALMANG_SPOT.z) < 3.2;
  if (near && !halmangNear) {
    spawnMoneyPopup(HALMANG_SPOT.x, gy + HALMANG_H + 0.5, HALMANG_SPOT.z,
      isNight() ? '👵 "까불다 이어도 가주."' : '👵 "욕심내민, 바당이 데려간다."', 4);
  }
  halmangNear = near;
}

// 루루의 이야기 — 처음 시작할 때 딱 한 번 들려줍니다.
// 게임이 0원에서 시작하는 이유이자, 낡은 집을 고치는 이유이자, 이 섬에서 사는 이유입니다.
let introSeen = false;
// 문장마다 줄을 바꿔(\n) 읽기 편하게 보여줍니다 (#talkBox p 의 white-space: pre-line)
const INTRO_LINES = [
  '루루는 제주에서 태어난 고양이가 아니다.\n원래는 서울에서 살았다.',
  '스무 살의 루루가 눈여겨본 서울의 작은 아파트는 5억이었다.\n"10년만 열심히 모으면, 대출 끼고 살 수 있을 거야."',
  '10년을 쉬지 않고 일하고, 아끼고, 모았다.\n서른 살이 된 루루의 전 재산은 — 4,000만 원.',
  '그사이 그 아파트는 20억이 되어 있었다.\n집값은 월급보다, 저축보다, 꿈보다 훨씬 빨랐다.',
  '루루는 꿈을 접었다.\n그리고 마지막 희망을 품고 — 마을 이장이 소개해 준 제주 외딴 마을의 빈집 하나를, 전 재산을 털어 샀다.',
  '집은 비가 새고, 전기는 끊겼고, 잡초는 허리까지 자라 있었다.\n하지만 루루는 웃었다.',
  '"적어도… 여긴 내 집이다."',
  '서른 살, 루루의 두 번째 인생이 시작된다.\n언젠가 이 낡은 집을 제주 최고의 집으로 만드는 것 — 그것이 루루의 새로운 꿈이다. 🍊',
];

// 돌하르방 — 상점 앞을 지키는 안내석. 처음 온 사람에게 섬 사는 법을 알려줍니다
const TUTOR_SPOT = { x: 2.2, z: 45.4 };
const TUTOR_RANGE = 2.6;
let tutorialSeen = false;
const TUTOR_LINES = [
  '안녕하세요! 저는 이 섬을 지키는 돌하르방입니다. 섬에서 사는 법을 알려드릴게요.',
  '🍊 귤나무 앞에서 🐾(F)를 누르면 귤을 딸 수 있어요. 상자를 가득 채워 택배사에 가져가면 한 박스 10,000원에 팔립니다.',
  '🏪 상점 문 앞에 서면 안으로 들어갑니다. 당근을 사서 말에게 매일 한 개씩 먹여주세요 — 굶기면 위험해요!',
  '🤿 물질을 하려면 상점에서 망사리를 사고, 포구 축대 끝까지 걸어가세요. 물속에서는 ↑ 떠오르기 · ↓ 잠수 · ←→ 헤엄이에요. 숨이 다하면 죽을 위험이 있어요!',
  '🏠 남쪽 언덕의 돌집이 루루의 집입니다. 문 앞에 서면 들어가지고, 가구를 사서 꾸밀 수도 있어요.',
  '🏇 말과 애정이 쌓이면 마구간 옆 팻말에서 경마에 나갈 수 있습니다. 좋은 하루 되세요!',
];
function tutorTalk() {
  startTalk('돌하르방', TUTOR_LINES, () => {
    if (!tutorialSeen) { tutorialSeen = true; saveGame(true); }
  });
}

// ---------- 12-1f-2a4. 도감(업적) — 섬 살이의 발자취 ----------
// 게임 곳곳에서 한 일을 세어두고(stat), 조건을 채우면 업적이 달성됩니다.
// 왼쪽 아래 📖 버튼으로 언제든 펼쳐볼 수 있습니다.
const stat = { boxes: 0, dives: 0, drowns: 0, races: 0, raceWins: 0, abalone: 0, conch: 0, kelp: 0, octopus: 0, gold: 0 };
const ACHIEVEMENTS = [
  { id: 'box1',    name: '첫 출하',     desc: '귤 한 박스를 처음 팔았다' },
  { id: 'box10',   name: '귤 부자',     desc: '귤 박스 10개 판매' },
  { id: 'box50',   name: '감귤 명인',   desc: '귤 박스 50개 판매' },
  { id: 'dive1',   name: '초보 해녀',   desc: '처음으로 물질을 나갔다' },
  { id: 'dive20',  name: '상군 해녀',   desc: '물질 20회' },
  { id: 'abal10',  name: '전복 사냥꾼', desc: '전복 10개 채집' },
  { id: 'drown1',  name: '바당의 경고', desc: '욕심내다 바다에 잡혀갔다…' },
  { id: 'race1',   name: '첫 우승',     desc: '경마에서 처음 이겼다' },
  { id: 'race5',   name: '경마왕',      desc: '경마 5승' },
  { id: 'love100', name: '단짝',        desc: '조랑말 애정 100 달성' },
  { id: 'house',   name: '내 집 마련',  desc: '돌집 수리를 끝냈다' },
  { id: 'furn',    name: '아늑한 집',   desc: '가구와 소품 12가지를 모두 들여놓았다' },
  { id: 'gold1',   name: '황금향!',     desc: '황금향을 처음 발견했다' },
  { id: 'octo1',   name: '문어 한탕',   desc: '문어를 처음 잡았다 (한 마리 5만원!)' },
  { id: 'rich',    name: '백만장자',    desc: '돈 1,000,000원 모으기' },
  { id: 'dream',   name: '제주 최고의 집', desc: '수리·가구·인테리어까지 — 꿈을 이뤘다' },
];
const ACH_TESTS = {
  box1: () => stat.boxes >= 1,
  box10: () => stat.boxes >= 10,
  box50: () => stat.boxes >= 50,
  dive1: () => stat.dives >= 1,
  dive20: () => stat.dives >= 20,
  abal10: () => stat.abalone >= 10,
  drown1: () => stat.drowns >= 1,
  race1: () => stat.raceWins >= 1,
  race5: () => stat.raceWins >= 5,
  love100: () => ponyLove >= 100,
  house: () => houseStage >= 3,
  furn: () => FURN_ORDER.every((k) => furnitureOwned[k]),
  gold1: () => stat.gold >= 1,
  octo1: () => stat.octopus >= 1,
  dream: () => endingState >= 1,
  rich: () => coins >= 1000000,
};
let achieved = {};
// 업적 기능은 뺐습니다 (사용자 결정) — 그 자리는 🎒 아이템 보기가 대신합니다.
// 달성 기록(achieved)은 저장 파일에 그대로 남겨둬서, 나중에 되살리고 싶으면 이 함수만 복구하면 됩니다.
function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (!achieved[a.id] && ACH_TESTS[a.id]()) achieved[a.id] = true;   // 조용히 기록만
  }
}
// 가방 화면 (🎒 버튼) — 예전의 업적 도감 자리를 "갖고 있는 아이템 보기"로 바꿨습니다
const bookWrap = document.getElementById('bookWrap');
const bookList = document.getElementById('bookList');
const bookBadge = document.getElementById('bookBadge');
function openBag() {
  if (!bookWrap || !bookList) return;
  // 모을 수 있는 것 전부를 아이콘으로 — 가진 것은 또렷하게(개수는 ×N), 없는 것은 회색으로
  const items = [];
  const add = (owned, emoji, name, count) => items.push({ owned, emoji, name, count: count || 0 });
  add(basketCount > 0, '🍊', '귤', basketCount);
  add(carrots > 0, '🥕', '당근', carrots);
  add(hasNet, '🧺', hasNet && !netCarried ? '망사리(내려둠)' : '망사리');
  add(hasTank, '🤿', '산소통');
  add(tools.paint, '🖌', '페인트');
  if (state.diving && net.length) {
    const em = { kelp: '🌿', conch: '🐚', abalone: '🦪', octopus: '🐙' };
    const cnt = {};
    for (const k of net) cnt[k] = (cnt[k] || 0) + 1;
    for (const [k, n] of Object.entries(cnt)) add(true, em[k] || '🌊', CATCH_KINDS[k].name, n);
  }
  for (const k of FURN_ORDER) {
    const g = SHOP_GOODS.find((s) => s.key === k);
    add(!!furnitureOwned[k], g ? g.emoji : '🛋', g ? g.name : k);
  }
  add(houseFloorColor !== 0, '🟫', '바닥재');
  add(houseWallColor !== 0, '🎨', '벽지');
  // 집공사 진행 금액 — 가구·소품 9,000만 + 바닥 400만 + 벽지 600만 = 딱 1억.
  // 1억을 다 채우면(=전부 들여놓으면) 다음 날 아침, 꿈의 집 엔딩이 찾아옵니다.
  let spent = 0;
  for (const k of FURN_ORDER) if (furnitureOwned[k]) spent += FURNITURE[k].price;
  if (tools.paint) spent += PAINT_PRICE;      // 외벽 페인트
  if (houseFloorColor !== 0) spent += 4000000;
  if (houseWallColor !== 0) spent += 6000000;
  bookList.innerHTML =
    `<div class="bookHead">🎒 자산</div>` +
    `<div class="bagMoney">💵 ${coins.toLocaleString()}원</div>` +
    `<div class="bookTip" style="margin-bottom:10px">🏠 집꾸미기 ${spent.toLocaleString()} / 100,000,000원` +
    (spent >= 100000000 ? ' — 꿈을 이뤘어요!' : ' — 1억을 채우면 꿈의 집 완성') + `</div>` +
    `<div class="bagGrid">` + items.map((it) =>
      `<div class="bagItem${it.owned ? '' : ' off'}">` +
      `${it.owned && it.count > 0 ? `<div class="ct">×${it.count}</div>` : ''}` +
      `<div class="em">${it.emoji}</div><div class="nm">${it.name}</div></div>`
    ).join('') + `</div>` +
    `<div class="bookTip" style="margin-top:10px">바깥을 누르면 닫힘</div>`;
  bookWrap.style.display = 'flex';
}
// 🎒 버튼은 여닫이 — 열려 있으면 닫고, 닫혀 있으면 엽니다
if (bookBadge) bookBadge.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (bookWrap && bookWrap.style.display === 'flex') bookWrap.style.display = 'none';
  else openBag();
});
// 목록 안을 만지면 스크롤, 바깥(어두운 곳)을 누르면 닫기
if (bookWrap) bookWrap.addEventListener('pointerdown', (e) => {
  if (bookList && bookList.contains(e.target)) return;   // 목록 안 — 스크롤하게 둡니다
  bookWrap.style.display = 'none';
});
// 게임의 손가락 조작(조이스틱·시야)이 목록 스크롤을 가로채지 않게 막습니다
if (bookList) {
  ['touchstart', 'touchmove', 'pointermove'].forEach((ev) =>
    bookList.addEventListener(ev, (e) => e.stopPropagation()));
}

// ---------- 색 고르기 팝업 — 벽지(집 안)·바닥재·외벽 페인트가 함께 씁니다 ----------
const pickWrap = document.getElementById('pickWrap');
const pickBox = document.getElementById('pickBox');
const pickTitle = document.getElementById('pickTitle');
const pickPrice = document.getElementById('pickPrice');
const pickGrid = document.getElementById('pickGrid');
// 색을 누르면 일단 골라두기만 하고(테두리 표시), 아래 가격 단추를 눌러야 실제로 삽니다.
// 실수로 색을 잘못 눌러 바로 결제되는 일을 막습니다.
const pickTip = document.getElementById('pickTip');
function openColorPicker(title, colors, onPick, price) {
  if (!pickWrap) return;
  pickTitle.textContent = title;
  pickGrid.innerHTML = '';
  pickPrice.innerHTML = '';
  if (pickTip) pickTip.textContent = IS_TOUCH
    ? '관광지라 물가가 비싸구나 ㅠㅠ'
    : '관광지라 물가가 비싸구나 ㅠㅠ (F 구입 · ESC 나가기)';
  let selected = null;
  const swatches = [];
  const buyBtn = document.createElement('button');
  buyBtn.className = 'buyBtn';
  const refreshBtn = () => {
    buyBtn.disabled = !selected;
    buyBtn.textContent = selected
      ? `${selected.name} · ${price.toLocaleString()}원 — 눌러서 구입`
      : '먼저 색을 골라주세요';
  };
  for (const c of colors) {
    const item = document.createElement('div');
    item.className = 'swItem';
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = '#' + c.color.toString(16).padStart(6, '0');
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      selected = c;
      swatches.forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      refreshBtn();
    });
    swatches.push(b);
    const nm = document.createElement('div');
    nm.className = 'swName';
    nm.textContent = c.name;
    item.appendChild(b);
    item.appendChild(nm);
    pickGrid.appendChild(item);
  }
  // 컴퓨터에서 F키로도 누를 수 있게, 단추가 하는 일을 따로 담아둡니다
  buyBtn.activate = () => {
    if (!selected) return;
    pickWrap.style.display = 'none';
    onPick(selected);
  };
  buyBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    buyBtn.activate();
  });
  refreshBtn();
  pickPrice.appendChild(buyBtn);
  pickWrap.style.display = 'flex';
}

// 물건 하나짜리 구입 확인 창 — 물건을 크게 미리 보여주고, 가격을 눌러야 사집니다
function openBuyDialog(emoji, name, price, onBuy) {
  if (!pickWrap) return;
  pickTitle.textContent = name;
  pickGrid.innerHTML = '';
  pickPrice.innerHTML = '';
  if (pickTip) pickTip.textContent = IS_TOUCH
    ? '관광지라 물가가 비싸구나 ㅠㅠ'
    : '관광지라 물가가 비싸구나 ㅠㅠ (F 구입 · ESC 나가기)';
  const prev = document.createElement('div');
  prev.className = 'bigPreview';
  prev.textContent = emoji;
  pickGrid.appendChild(prev);
  const buyBtn = document.createElement('button');
  buyBtn.className = 'buyBtn';
  buyBtn.textContent = `${price.toLocaleString()}원 — 눌러서 구입`;
  // 컴퓨터에서 F키로도 누를 수 있게, 단추가 하는 일을 따로 담아둡니다
  buyBtn.activate = () => {
    pickWrap.style.display = 'none';
    onBuy();
  };
  buyBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    buyBtn.activate();
  });
  pickPrice.appendChild(buyBtn);
  pickWrap.style.display = 'flex';
}
// 상자 바깥(어두운 곳)을 누르면 취소
if (pickWrap) pickWrap.addEventListener('pointerdown', (e) => {
  if (pickBox && pickBox.contains(e.target)) return;
  pickWrap.style.display = 'none';
});
// 지금 떠 있는 창을 닫습니다 (닫을 것이 있었으면 true).
// 컴퓨터에서는 F·ESC로, 폰에서는 ✕ 단추와 바깥 누르기로 빠져나갑니다.
function closeOpenPopup() {
  if (pickWrap && pickWrap.style.display === 'flex') { pickWrap.style.display = 'none'; return true; }
  if (bookWrap && bookWrap.style.display === 'flex') { bookWrap.style.display = 'none'; return true; }
  if (mapWrap && mapWrap.style.display === 'flex') { toggleMap(); return true; }
  return false;
}
addEventListener('keydown', (e) => { if (isKey(e, 'Escape')) closeOpenPopup(); });
// 창 오른쪽 위 ✕ — 어느 기기에서든 눈에 보이는 빠져나가기
if (pickBox) {
  const x = document.createElement('button');
  x.className = 'closeX';
  x.textContent = '✕';
  x.title = '닫기';
  x.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    pickWrap.style.display = 'none';
  });
  pickBox.appendChild(x);
}
if (pickBox) {
  ['touchstart', 'touchmove', 'pointermove'].forEach((ev) =>
    pickBox.addEventListener(ev, (e) => e.stopPropagation()));
}

// ---------- 12-1f-2b. 저장 · 처음부터 · 종료 ----------
// 진행 상황을 브라우저 안(localStorage)에 남깁니다. 게임을 켜면 자동으로 이어집니다.
// (딴 귤·채집물 위치까지는 저장하지 않습니다 — 자원은 켤 때마다 새로 차 있습니다)
const SAVE_KEY = 'lulu_jeju_save';
function saveGame(quiet) {
  try {
    // 실내(집·상점)에 있을 때는 그 집 문 앞 위치로 저장합니다 — 다시 켜면 문 앞에서 시작
    const outX = state.inside ? HOUSE.x : (state.inShop ? SHOP_DOOR.x : state.x);
    const outZ = state.inside ? HOUSE.z + 5.4 : (state.inShop ? SHOP_DOOR.z - 1.6 : state.z);
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      coins, carrots, ponyLove, hasTank, houseStage, fixSwings,
      tools, basketCount, cap: BASKET_CAP, x: outX, z: outZ,
      hasNet, netCarried, netX: netObj.position.x, netZ: netObj.position.z,
      furn: furnitureOwned,
      gameT, dayCount, lastFedDay, ponyAlive, ponyDeaths, tutorialSeen, introSeen, dayEvent,
      endingState, happyDay,
      floorC: houseFloorColor, wallC: houseWallColor, paintC: housePaintColor,
      stat, achieved,
    }));
    if (!quiet) spawnMoneyPopup(state.x, lulu.position.y + 1.6, state.z, '💾 저장했어요');
  } catch (e) { /* 시크릿 창 등에서는 저장이 막힐 수 있습니다 */ }
}
function loadGame() {
  let d;
  try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return; }
  if (!d) return;
  coins = d.coins || 0;
  carrots = d.carrots || 0;
  ponyLove = d.ponyLove || 0;
  hasTank = !!d.hasTank;
  if (hasTank) BREATH_MAX = TANK_BREATH;
  houseStage = (d.houseStage === undefined) ? 0 : Math.max(0, d.houseStage);   // 집은 처음부터 루루의 것
  fixSwings = d.fixSwings || 0;
  if (d.tools) Object.assign(tools, d.tools);
  BASKET_CAP = houseStage >= 3 ? 30 : 20;   // 예전 저장(36/48)도 새 기준으로 맞춥니다
  applyHouseLook();
  for (let i = 0; i < (d.basketCount || 0); i++) addFruitToBasket();
  // 망사리 — 메고 있었으면 다시 등에, 내려놨었으면 그 자리에 그대로
  hasNet = !!d.hasNet;
  if (hasNet) {
    netObj.visible = true;
    netCarried = d.netCarried !== false;
    if (!netCarried && typeof d.netX === 'number' && typeof d.netZ === 'number') {
      netObj.position.set(d.netX, groundHeight(d.netX, d.netZ), d.netZ);
    }
  }
  // 가구 — 산 것들을 집 안에 다시 놓습니다
  furnitureOwned = Object.assign(emptyFurnOwned(), d.furn || {});
  applyFurniture();
  // 게임 시간과 말의 끼니
  if (typeof d.gameT === 'number') gameT = d.gameT;
  dayCount = d.dayCount || 1;
  lastFedDay = d.lastFedDay || 0;
  ponyAlive = d.ponyAlive !== false;
  ponyDeaths = d.ponyDeaths || 0;
  tutorialSeen = !!d.tutorialSeen;
  introSeen = !!d.introSeen;
  dayEvent = d.dayEvent || null;
  endingState = d.endingState || 0;
  happyDay = d.happyDay || 0;
  if (d.stat) Object.assign(stat, d.stat);
  achieved = d.achieved || {};
  applyPonyAlive();
  // 집 인테리어 (바닥재·벽지·외벽 페인트)
  houseFloorColor = d.floorC || 0;
  houseWallColor = d.wallC || 0;
  housePaintColor = d.paintC || 0;
  applyRoomLook();
  // 예전 저장이 실내 좌표를 담고 있으면 무시하고 섬의 시작 자리에서 깨어납니다
  if (typeof d.x === 'number' && d.x < 380) {
    state.x = d.x; state.z = d.z;
    lulu.position.set(state.x, groundHeight(state.x, state.z), state.z);
  }
  updateCoinBadge(); updateCarrotBadge(); updateBasketBadge();
}
// (불러오기는 스크립트 맨 아래에서 합니다 — 여기서 부르면 아직 안 만들어진
//  배지들을 건드려 게임 전체가 멈춥니다)

const btnSave = document.getElementById('btnSave');
if (btnSave) btnSave.addEventListener('pointerdown', (e) => { e.preventDefault(); saveGame(); });

// 자동 저장은 뺐습니다 — 저장은 💾 버튼으로 직접, 그리고 죽음·업적·엔딩 같은
// 중요한 순간에만 됩니다. (돈·애정·집 업적은 몇 초마다 확인만 합니다)
setInterval(checkAchievements, 5000);

// 새로 시작 — 화면 위쪽 버튼. 저장을 지우고 루루의 이야기부터 다시.
const restartTop = document.getElementById('restartTop');
if (restartTop) restartTop.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (confirm('처음부터 다시할까요?\n저장된 진행이 모두 지워집니다.')) {
    try { localStorage.removeItem(SAVE_KEY); } catch (err) {}
    location.reload();
  }
});

// ---------- 12-1f-3. 전체 지도 (M키 / 🗺 배지) ----------
// 지도는 따로 그림을 만들지 않고, 게임이 쓰는 지형 높이 함수(groundHeight)를 그대로
// 캔버스에 칠해서 만듭니다. 그래서 지형을 고치면 지도도 저절로 맞습니다.
const MAP_WORLD = 112;   // 지도에 담는 범위 (-112 ~ +112)
let mapBase = null;      // 한 번 그려두는 바탕 (지형·나무·돌담·건물)

function buildMapBase() {
  const S = 560;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  // 게임에서는 +z가 북쪽(위)인데 캔버스 y는 아래로 갈수록 커지므로, 세로를 뒤집어야 방향이 맞습니다.
  // 가로도 뒤집습니다 — 바다(북쪽)를 바라보고 섰을 때 내 오른손 방향(-x)이 동쪽이므로,
  // 지도에서도 그쪽이 오른쪽에 와야 "바다 보고 오른쪽으로 갔는데 지도에선 왼쪽으로 가네"가 안 생깁니다.
  const w2m = (wx, wz) => [(1 - (wx + MAP_WORLD) / (MAP_WORLD * 2)) * S, (1 - (wz + MAP_WORLD) / (MAP_WORLD * 2)) * S];

  // 지형 — 픽셀마다 땅 높이를 재서 바다/모래/풀밭/오름 색을 칠합니다
  const img = g.createImageData(S, S);
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const wx = (1 - px / S) * MAP_WORLD * 2 - MAP_WORLD;   // 가로 뒤집기 (동쪽 = -x)
      const wz = (1 - py / S) * MAP_WORLD * 2 - MAP_WORLD;
      const h = groundHeight(wx, wz);
      let r, gg, b;
      if (h < -0.4) { r = 31; gg = 107; b = 125; }         // 바다
      else if (h < 0.6) { r = 216; gg = 199; b = 155; }    // 물가 모래
      else {
        const t = Math.min(1, (h - 0.6) / 14);             // 높을수록 밝은 풀빛
        r = 106 + t * 40; gg = 152 + t * 26; b = 72 + t * 20;
      }
      const i = (py * S + px) * 4;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  // 물질장 — 물속 사냥터를 점선 동그라미로
  {
    const [cx, cy] = w2m(DIVE.x, DIVE.z);
    g.strokeStyle = 'rgba(255,255,255,.75)';
    g.setLineDash([6, 5]);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, DIVE.r / (MAP_WORLD * 2) * S, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }

  // 귤나무 — 점 하나가 나무 한 그루입니다
  g.fillStyle = '#2e5c2a';
  for (const t of trunkSpots) {
    const [px, py] = w2m(t.x, t.z);
    g.fillRect(px - 1, py - 1, 2.4, 2.4);
  }
  // 돌담 — 뛰어넘을 수 있는 낮은 장애물(topY가 낮은 것)이 담입니다
  g.fillStyle = 'rgba(70,70,72,.8)';
  for (const o of obstacles) {
    if (o.topY >= NO_JUMP) continue;
    const [px, py] = w2m(o.x, o.z);
    g.fillRect(px - 1, py - 1, 2, 2);
  }

  // 건물·장소 이름표
  g.textAlign = 'center';
  const label = (wx, wz, emoji, name) => {
    const [px, py] = w2m(wx, wz);
    g.font = '20px sans-serif';
    g.fillText(emoji, px, py + 6);
    g.font = 'bold 12.5px "맑은 고딕", Malgun Gothic, sans-serif';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,.65)';
    g.strokeText(name, px, py + 21);
    g.fillStyle = '#fff';
    g.fillText(name, px, py + 21);
  };
  label(shop.group.position.x, shop.group.position.z, '🏪', '이장님 상점');
  label(depot.group.position.x - 8, depot.group.position.z, '🚚', '택배사');
  label(STABLE.x, STABLE.z, '🐴', '마구간');
  label(HOUSE.x, HOUSE.z, '🏠', houseStage >= 3 ? '내 집' : '헌집');
  label(PORT.x, PORT.z, '⚓', '포구');
  return c;
}

const mapWrap = document.getElementById('mapWrap');
const mapCanvas = document.getElementById('mapCanvas');
let mapOpen = false;
function toggleMap() {
  mapOpen = !mapOpen;
  if (!mapWrap) return;
  mapWrap.style.display = mapOpen ? 'flex' : 'none';
  if (mapOpen) drawMap();
}
function drawMap() {
  if (!mapCanvas) return;
  if (!mapBase) mapBase = buildMapBase();          // 처음 열 때 한 번만 그립니다
  const g = mapCanvas.getContext('2d');
  mapCanvas.width = mapBase.width; mapCanvas.height = mapBase.height;
  g.drawImage(mapBase, 0, 0);
  // 루루의 현재 위치 — 주황 점과 이름
  const S = mapBase.width;
  const px = (1 - (state.x + MAP_WORLD) / (MAP_WORLD * 2)) * S;   // 바탕 지도와 같은 방향 (가로 뒤집기)
  const py = (1 - (state.z + MAP_WORLD) / (MAP_WORLD * 2)) * S;
  g.fillStyle = '#ff8c1a';
  g.strokeStyle = '#fff';
  g.lineWidth = 2.5;
  g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.fill(); g.stroke();
  g.textAlign = 'center';
  g.font = 'bold 13px "맑은 고딕", Malgun Gothic, sans-serif';
  g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.65)';
  g.strokeText('루루', px, py - 12);
  g.fillStyle = '#ffd88a';
  g.fillText('루루', px, py - 12);
}
addEventListener('keydown', (e) => { if (isKey(e, 'KeyM')) toggleMap(); });
if (mapWrap) mapWrap.addEventListener('pointerdown', (e) => { e.preventDefault(); toggleMap(); });
const mapBadge = document.getElementById('mapBadge');
if (mapBadge) {
  mapBadge.classList.add('tappable');
  mapBadge.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); toggleMap(); });
}

// ---------- 12-1g. 당근 사서 조랑말 먹이기 ----------
const carrotBadge = document.getElementById('carrotBadge');
function updateCarrotBadge() {
  if (!carrotBadge) return;
  carrotBadge.style.display = carrots > 0 ? 'block' : 'none';
  carrotBadge.textContent = `🥕 당근 ${carrots}개`;
}

function tryBuyCarrot() {
  const y = groundHeight(CARROT_SPOT.x, CARROT_SPOT.z) + 1.3;
  if (coins < CARROT_PRICE) {
    spawnMoneyPopup(CARROT_SPOT.x, y, CARROT_SPOT.z, `${(CARROT_PRICE - coins).toLocaleString()}원 부족`);
    return;
  }
  coins -= CARROT_PRICE;
  carrots++;
  updateCoinBadge();
  updateCarrotBadge();
  playPickSound();
  spawnMoneyPopup(CARROT_SPOT.x, y, CARROT_SPOT.z, `🥕 당근 구입! (${carrots}개)`);
}

// ---------- 12-1g-2. 조랑말 경마 ----------
// 마구간 옆 팻말에서 참가비를 내면 경주가 열립니다. 직접 뽑으신 경주 영상이
// 그대로 중계가 됩니다: 이기면 1등으로 웃는 영상, 지면 꼴등으로 우는 영상.
// 승률은 애정(먹인 당근)만큼 올라갑니다 — 잘 먹인 말이 잘 뜁니다.
const RACE_LOVE = 100;        // 애정이 이만큼이면 승률이 최고치에 닿습니다
const RACE_MIN_LOVE = 10;     // 최소 이만큼은 정이 들어야 출전합니다
const RACE_FEE = 20000;
// 1등 상금은 당근을 먹인 횟수(애정)에 따라 10번마다 두 배씩 커집니다 — 최대 1억.
// 10번대 10만 → 20번대 20만 → 30번대 40만 → … → 110번대 1억(최대) (10번 미만은 5만)
function racePrize() {
  const tier = Math.floor(ponyLove / 10);
  if (tier <= 0) return 50000;
  return Math.min(100000000, 100000 * Math.pow(2, tier - 1));
}
const RACE_SPOT = { x: STABLE.x + 3.5, z: STABLE.z + 5.5 };
const RACE_RANGE = 2.2;
let racing = false;
// 경마 팻말
{
  const y = groundHeight(RACE_SPOT.x, RACE_SPOT.z);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 6), citrusTrunkMat);
  post.position.set(RACE_SPOT.x, y + 1.3, RACE_SPOT.z);
  post.castShadow = true;
  scene.add(post);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75),
    new THREE.MeshBasicMaterial({ map: makePriceSign('🏇 경마', RACE_FEE), side: THREE.DoubleSide }));
  board.position.set(RACE_SPOT.x, y + 2.4, RACE_SPOT.z);
  board.rotation.y = Math.PI / 2;
  scene.add(board);
}
// 승률 = 기본 10% + 당근 1개당 1% 가산 (예: 당근 30개면 40%, 90개부터는 100%)
function raceWinChance() {
  return Math.min(1, 0.1 + ponyLove / 100);
}
function tryRace() {
  const y = groundHeight(RACE_SPOT.x, RACE_SPOT.z) + 1.8;
  if (racing) return;
  if (!ponyAlive) {
    spawnMoneyPopup(RACE_SPOT.x, y, RACE_SPOT.z, '💔 조랑말이 있어야 경마에 나갑니다');
    return;
  }
  if (ponyLove < RACE_MIN_LOVE) {
    spawnMoneyPopup(RACE_SPOT.x, y, RACE_SPOT.z,
      `🐴 애정이 ${RACE_MIN_LOVE}은 되어야 출전해요 (지금 ${ponyLove}) — 당근을 먹여주세요`);
    return;
  }
  if (coins < RACE_FEE) {
    spawnMoneyPopup(RACE_SPOT.x, y, RACE_SPOT.z, `${(RACE_FEE - coins).toLocaleString()}원 부족`);
    return;
  }
  coins -= RACE_FEE;
  stat.races++;
  updateCoinBadge();
  const win = Math.random() < raceWinChance();
  startRaceVideo(win);
}
function startRaceVideo(win) {
  racing = true;
  const wrap = document.getElementById('raceWrap');
  const vid = document.getElementById('raceVideo');
  if (!wrap || !vid) { racing = false; return; }
  vid.src = win ? '../assets/farmcat/race_win.mp4' : '../assets/farmcat/race_lose.mp4';
  wrap.style.display = 'flex';
  vid.currentTime = 0;
  const tryPlay = vid.play();
  if (tryPlay && tryPlay.catch) tryPlay.catch(() => { vid.muted = true; vid.play().catch(() => {}); });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    wrap.style.display = 'none';
    vid.pause();
    racing = false;
    const py = groundHeight(state.x, state.z) + 2;
    if (win) {
      const prize = racePrize();
      coins += prize;
      stat.raceWins++;
      updateCoinBadge();
      playShipSound();
      spawnMoneyPopup(state.x, py, state.z, `🏆 1등! 상금 ${prize.toLocaleString()}원을 받았어요`, 5);
      checkAchievements();
    } else {
      spawnMoneyPopup(state.x, py, state.z, '😢 꼴등… 당근을 더 먹이면 더 잘 뜁니다', 5);
    }
    saveGame(true);
  };
  vid.onended = finish;
  wrap.onpointerdown = finish;
}

// (예전 주석: 당근을 이만큼 먹이면 경마장에 나갈 수 있습니다)
// 먹이는 순간 조랑말 입가에 나타나 냠냠 줄어드는 당근 (직접 그리신 그림)
let carrotFx = null, carrotFxT = -1;
const CARROT_FX_TIME = 1.0;
if (CAN_USE_IMAGES) {
  carrotFx = new THREE.Mesh(
    new THREE.PlaneGeometry(0.85, 0.68),
    new THREE.MeshBasicMaterial({ map: loadTexture('../assets/farmcat/carrot.webp'),
      transparent: true, alphaTest: 0.3, side: THREE.DoubleSide })
  );
  carrotFx.visible = false;
  scene.add(carrotFx);
}
function updateCarrotFx(dt) {
  if (carrotFxT < 0 || !carrotFx) return;
  carrotFxT += dt;
  const k = carrotFxT / CARROT_FX_TIME;
  if (k >= 1) {
    carrotFx.visible = false; carrotFxT = -1;
    // 다 먹은 순간 입가에서 반짝! (짧고 맑은 소리와 함께)
    const gy2 = groundHeight(STABLE.x, STABLE.z);
    spawnMoneyPopup(STABLE.x + 1.55, gy2 + 2.2, STABLE.z, '✨');
    blip(880, 1320, 0.14, 0.14, 'sine');
    return;
  }
  // 조랑말 입 앞에서 조금씩 작아지며(먹히며) 살짝 위아래로 흔들립니다
  const gy = groundHeight(STABLE.x, STABLE.z);
  carrotFx.position.set(STABLE.x + 1.55, gy + 1.9 + Math.sin(carrotFxT * 18) * 0.05, STABLE.z);   // 조랑말 입가 (3D 머리 앞)
  carrotFx.rotation.y = Math.atan2(camera.position.x - STABLE.x, camera.position.z - STABLE.z);
  carrotFx.scale.setScalar(1 - k * 0.85);
}

// 조랑말 울음소리 (직접 준비하신 소리) — F로 말을 상대할 때 웁니다
const ponySfx = new Audio('../assets/farmcat/pony_sound.mp3');
ponySfx.volume = 0.75;
function playPonySfx() {
  try { ponySfx.currentTime = 0; ponySfx.play().catch(() => {}); } catch (e) {}
}

function tryFeedPony() {
  const y = groundHeight(STABLE.x, STABLE.z) + STABLE_H * 0.75;
  if (!ponyAlive) {
    // 빈 마구간에서 F — 새 조랑말을 데려옵니다
    if (coins < PONY_PRICE) {
      spawnMoneyPopup(STABLE.x, y, STABLE.z,
        `💔 마구간이 비었어요 — 새 조랑말은 ${PONY_PRICE.toLocaleString()}원 (${(PONY_PRICE - coins).toLocaleString()}원 부족)`);
      return;
    }
    coins -= PONY_PRICE;
    ponyAlive = true;
    ponyLove = 0;            // 새 친구와는 처음부터 정을 쌓아야 합니다
    lastFedDay = dayCount;   // 데려온 날은 배불리 먹고 왔습니다
    applyPonyAlive();
    updateCoinBadge();
    playShipSound();
    saveGame(true);
    spawnMoneyPopup(STABLE.x, y, STABLE.z, '🐴 새 조랑말을 데려왔어요! 이번엔 매일 챙겨주세요', 5);
    return;
  }
  // 멀리서 던져 주는 게 아니라, 조랑말 앞까지 가서 손으로 먹입니다
  const d = Math.hypot(state.x - STABLE.x, state.z - STABLE.z);
  if (d > FEED_RANGE) {
    spawnMoneyPopup(state.x, groundHeight(state.x, state.z) + 1.6, state.z, '🐴 조랑말 앞까지 더 가까이 가세요');
    return;
  }
  playPonySfx();   // 말 곁에서 F — 히힝!
  if (carrots <= 0) {
    spawnMoneyPopup(STABLE.x, y, STABLE.z, '당근이 없어요 · 이장님 상점에서 1,000원');
    return;
  }
  carrots--;
  ponyLove++;
  lastFedDay = dayCount;   // 오늘 끼니를 챙겼습니다 — 말이 웃는 얼굴로 돌아옵니다
  updateCarrotBadge();
  playDropSound();
  state.facing = Math.atan2(STABLE.x - state.x, STABLE.z - state.z);   // 조랑말을 바라보고 먹입니다
  state.idleTime = 0; state.sit = 0;
  if (carrotFx) { carrotFx.visible = true; carrotFxT = 0; }   // 당근 그림이 냠냠 사라집니다
  if (ponyLove >= RACE_LOVE) {
    spawnMoneyPopup(STABLE.x, y, STABLE.z, `🏇 애정 ${ponyLove}! 승률이 최고예요 — 옆 팻말에서 경마 출전!`);
  } else {
    spawnMoneyPopup(STABLE.x, y, STABLE.z, `🥕 냠냠! ❤️ ${ponyLove}/${RACE_LOVE}`);
  }
  state.idleTime = 0;
}

// F키 하나로 "그 자리에서 할 수 있는 일"을 전부 합니다 — 상호작용 키는 이것 하나뿐입니다.
// 물속: 채집 (수면에 떠 있으면 뭍으로 나가기)
// 뭍:   귤 따기 → 당근·산소통 사기 → 택배 부치기 → 집 사기·고치기 → 말 먹이기 → 물질 들어가기
//       → 아무것도 없으면 상자 잡기/놓기
function handleActionKey() {
  // 구입 창이 떠 있으면 F는 "구입"입니다 (나가기는 ESC·✕·바깥 누르기)
  if (pickWrap && pickWrap.style.display === 'flex') {
    const btn = pickBox && pickBox.querySelector('.buyBtn');
    if (btn && !btn.disabled && btn.activate) btn.activate();
    return;
  }
  // 그 밖의 창(자산·지도)이 떠 있으면 F는 "창 닫기"입니다
  if (closeOpenPopup()) return;
  // 대화 중이면 F는 "다음 줄"입니다
  if (talkOpen()) { advanceTalk(); return; }
  if (state.harvestT >= 0 || state.fixT >= 0) return;
  if (state.diving) {
    if (drowning > 0) return;
    // 수면에 떠 있으면 F로 뭍에 나갑니다 (물속에서는 채집)
    if (lulu.position.y > SEA_Y - 1.2) { leaveDive('exit'); return; }
    tryCollect();
    return;
  }
  // 상점 안: 물건(또는 왼쪽 인테리어 견본) 앞이면 그것을 삽니다
  if (state.inShop) {
    const rg = nearestReno();
    if (rg) { buyReno(rg); return; }
    const good = nearestShopGood();
    if (good) buyShopGood(good);
    return;
  }
  // 집 안: 내려놓은 망사리를 줍거나, 멘 망사리를 내려놓습니다
  if (state.inside) {
    if (hasNet && !netCarried &&
        Math.hypot(state.x - netObj.position.x, state.z - netObj.position.z) < NET_PICK_RANGE) {
      pickUpNet();
    } else if (netCarried) {
      dropNet();
    }
    return;
  }
  if (nearestFruit() >= 0) {
    // 딴 귤은 상자에 담아야 하니, 상자가 곁에 있어야 딸 수 있습니다
    if (Math.hypot(basketPos.x - state.x, basketPos.z - state.z) > 6) {
      spawnMoneyPopup(state.x, lulu.position.y + 1.8, state.z, '📦 귤 상자를 옆에 끌고 와야 담을 수 있어요');
      return;
    }
    tryHarvest();
    return;
  }
  // 상점 문 앞 — 이장님이 열어주면 들어갑니다 (문 앞에서는 입장이 대화보다 우선)
  if (Math.hypot(state.x - SHOP_DOOR.x, state.z - SHOP_DOOR.z) < SHOP_DOOR_RANGE) {
    tryEnterShop();
    return;
  }
  // 이장님·돌하르방과 이야기하기
  if (mayorGroup && Math.hypot(state.x - mayor.x, state.z - mayor.z) < MAYOR_TALK_RANGE) {
    startTalk('이장님', mayorTalkLines());
    return;
  }
  if (Math.hypot(state.x - TUTOR_SPOT.x, state.z - TUTOR_SPOT.z) < TUTOR_RANGE) {
    tutorTalk();
    return;
  }
  if (Math.hypot(state.x - HALMANG_SPOT.x, state.z - HALMANG_SPOT.z) < HALMANG_RANGE) {
    halmangTalk();
    return;
  }
  const carrotDist = Math.hypot(state.x - CARROT_SPOT.x, state.z - CARROT_SPOT.z);
  if (carrotDist < CARROT_RANGE) { tryBuyCarrot(); return; }
  const tankDist = Math.hypot(state.x - TANK_SPOT.x, state.z - TANK_SPOT.z);
  if (tankDist < TANK_RANGE) { tryBuyTank(); return; }
  const depotDist = Math.hypot(state.x - depot.group.position.x, state.z - depot.group.position.z);
  if (depotDist < DEPOT_RANGE) { tryShipBox(); return; }
  // 내려놓은 망사리 줍기 — 작은 물건이라 집수리 같은 넓은 범위보다 먼저 확인합니다
  if (hasNet && !netCarried &&
      Math.hypot(state.x - netObj.position.x, state.z - netObj.position.z) < NET_PICK_RANGE) {
    pickUpNet();
    return;
  }
  const houseDist = Math.hypot(state.x - HOUSE.x, state.z - HOUSE.z);
  if (houseDist < HOUSE_RANGE + 3) { tryFixHouse(); return; }
  const raceDist = Math.hypot(state.x - RACE_SPOT.x, state.z - RACE_SPOT.z);
  if (raceDist < RACE_RANGE) { tryRace(); return; }
  const stableDist = Math.hypot(state.x - STABLE.x, state.z - STABLE.z);
  if (stableDist < STABLE_RANGE) { tryFeedPony(); return; }
  // 물질은 포구 축대 끝에서만 들어갈 수 있습니다
  const entryDist = Math.hypot(state.x - DIVE_ENTRY.x, state.z - DIVE_ENTRY.z);
  if (entryDist < DIVE_ENTRY_RANGE) {
    // 태풍이 오는 날은 바다가 위험해 물질을 쉽니다
    if (dayEvent === 'storm') {
      spawnMoneyPopup(DIVE_ENTRY.x, groundHeight(DIVE_ENTRY.x, DIVE_ENTRY.z) + 2.2, DIVE_ENTRY.z,
        '🌀 태풍이 몰아쳐요 — 오늘은 물질을 쉽니다');
      return;
    }
    // 망사리를 메고 있어야만 바다에 들어갈 수 있습니다
    if (!netCarried) {
      const py = groundHeight(DIVE_ENTRY.x, DIVE_ENTRY.z) + 2.2;
      spawnMoneyPopup(DIVE_ENTRY.x, py, DIVE_ENTRY.z,
        hasNet ? '🧺 망사리를 두고 왔어요 — 메고 와야 물질할 수 있어요'
               : `🧺 망사리가 있어야 물질할 수 있어요 — 상점 안에서 ${NET_PRICE.toLocaleString()}원`);
      return;
    }
    enterDive();
    return;
  }
  // 망사리를 멘 채 빈 데서 누르면 내려놓습니다 (상자 근처면 상자 잡기가 먼저)
  if (netCarried && !state.grabbing &&
      Math.hypot(basketPos.x - state.x, basketPos.z - state.z) >= GRAB_RANGE) {
    dropNet();
    return;
  }
  // 마지막으로: 상자 근처면 잡기/놓기 (잡은 채로 다른 일을 하면 그쪽이 먼저입니다)
  tryToggleGrab();
}

// (예전의 E키 전용 함수는 상호작용 통일로 handleActionKey에 합쳐졌습니다)
addEventListener('keydown', (e) => { if (isKey(e, 'KeyF')) handleActionKey(); });

// 시작 화면의 일거리 그림 — 바로 불러와서, 뜨는 순간 부드럽게 나타나게 합니다.
// (예전에는 "파일이 있는지 먼저 재보고" 붙여서 두 번 기다렸고, 그 사이 이모지 화면이
//  먼저 보였다가 그림이 뒤늦게 튀어나왔습니다. 이제 한 번에 불러옵니다)
for (const img of document.querySelectorAll('#startJobs img[data-src]')) {
  img.onload = () => img.classList.add('on');      // 다 받아지면 스르륵 나타남
  img.onerror = () => img.remove();                // 파일이 없으면 이모지가 그대로 자리를 지킴
  img.src = img.getAttribute('data-src');
}

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
      const tutorHint = () => {
        if (!tutorialSeen) {
          setTimeout(() => spawnMoneyPopup(TUTOR_SPOT.x, groundHeight(TUTOR_SPOT.x, TUTOR_SPOT.z) + 3.4, TUTOR_SPOT.z,
            '돌하르방 앞으로 가면 할 일을 알려줄 거예요\n가까이 가보세요', 8), 900);
        }
      };
      // 처음 온 사람에게는 루루의 사연부터, 그다음 돌하르방이 손짓합니다
      if (!introSeen) {
        setTimeout(() => startTalk('루루의 이야기', INTRO_LINES, () => {
          introSeen = true;
          saveGame(true);
          tutorHint();
        }), 600);
      } else {
        tutorHint();
      }
    };
    startEl.addEventListener('pointerdown', begin, { once: true });
    addEventListener('keydown', begin, { once: true });
  }
}

// 폰용 화면 버튼을 각 기능에 연결합니다 (키보드 F·E·Shift·Space와 똑같은 일을 합니다)
bindTouchButton('btnAction', (down) => { if (down) { wakeAudio(); startBgm(); handleActionKey(); } });
bindTouchButton('btnJump',   (down) => { touchJump = down; });
// 달리기는 꾹 누르고 있는 대신, 한 번 누르면 켜지고 다시 누르면 꺼지는 토글입니다.
// (왼손은 조이스틱을 잡고 있어서 버튼까지 계속 누르고 있기 어렵기 때문)
{
  const runBtn = document.getElementById('btnRun');
  if (runBtn) runBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    touchRun = !touchRun;
    runBtn.classList.toggle('on', touchRun);
  });
}

// 점프 높이는 JUMP²/(2×GRAVITY). 7.4이면 1.24미터라 돌담(1.3미터쯤)을 아슬아슬하게 못 넘었습니다.
// 고양이답게 8.9로 올리면 1.8미터까지 떠서 담을 여유 있게 뛰어넘습니다.
const WALK = 4.2, RUN = 8.0, GRAVITY = 22, JUMP = 8.9;
// 물속 움직임 — 「인사이드」의 물속 구간을 참고했습니다.
// 몸에 부력이 있어서 가만히 있으면 가라앉지 않고 살며시 떠오르고,
// 방향키는 화면에 보이는 그대로: ↑ 떠오르기 · ↓ 잠수 · ← → 좌우 헤엄.
const SWIM_ACCEL = 8.0;     // 물을 밀어내며 붙는 속도 (천천히 붙습니다)
const SWIM_DRAG = 2.4;      // 손을 놨을 때 물이 잡아주는 정도
const SWIM_MAX = 2.6;       // 물속 최고 속도 — 뭍 걷기(4.2)보다 한참 느립니다
const SWIM_UP = 7.0;        // 위아래로 헤엄치는 힘 (↑↓ 방향키 · ⤴ 버튼)
const SWIM_DOWN = 7.0;      // (지금은 위와 같은 힘 — 따로 조절하고 싶을 때를 위해 남겨둠)
const BUOYANCY = 0.9;       // 부력 — 아무것도 안 누르면 이 힘으로 살며시 떠오릅니다
const swimVel = { x: 0, z: 0 };   // 물속에서만 쓰는 좌우 관성
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
  if (state.harvestT < 0 && state.fixT < 0) {   // 귤 따기·집 고치기 중엔 못 움직입니다
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

  if (state.diving) {
    // 물속 조작(최종): 화면에 보이는 그대로 움직입니다.
    // ↑ 부상(위로) · ↓ 잠수(아래로) · ← → 좌우로 헤엄 · ⤴(점프 버튼)도 부상.
    // 아무것도 안 누르면 부력으로 천천히 떠오릅니다.
    moveDir.set(rgtX * r, f, rgtZ * r);
    const swimTilt = Math.min(1, Math.hypot(f, r));
    if (moveDir.lengthSq() > 0.0001) {
      moveDir.normalize();
      swimVel.x += moveDir.x * SWIM_ACCEL * swimTilt * dt;
      swimVel.z += moveDir.z * SWIM_ACCEL * swimTilt * dt;
      state.vy += moveDir.y * SWIM_UP * swimTilt * dt;   // ↑는 위로, ↓는 아래로 바로 밉니다
      state.idleTime = 0;
    } else {
      state.idleTime += dt;
    }
    const drag = Math.max(0, 1 - SWIM_DRAG * dt);
    swimVel.x *= drag;
    swimVel.z *= drag;
    const sp = Math.hypot(swimVel.x, swimVel.z);
    if (sp > SWIM_MAX) { swimVel.x *= SWIM_MAX / sp; swimVel.z *= SWIM_MAX / sp; }
    // 숨이 차면 팔다리에 힘이 빠져 느려집니다
    const weak = breathLow ? 0.55 : 1;
    state.x += swimVel.x * weak * dt;
    state.z += swimVel.z * weak * dt;
  } else if (moving) {
    moveDir.normalize();
    state.x += moveDir.x * spd * dt;
    state.z += moveDir.z * spd * dt;
    state.idleTime = 0;
  } else {
    state.idleTime += dt;
  }

  // 상자를 끌고 있는 동안은 이동 방향과 무관하게 항상 상자 쪽을 바라보게 합니다.
  // (왼쪽으로 가든 오른쪽으로 가든, 상자를 붙잡은 자세 그대로 옆걸음으로 끌고 가는 것처럼 보입니다)
  const isDraggingBox = !state.diving && (hasRope || state.grabbing);
  if (isDraggingBox) {
    state.facing = Math.atan2(basketPos.x - state.x, basketPos.z - state.z);
  } else if (state.diving) {
    // 물속에서는 실제로 흘러가는 방향을 봅니다 (관성이 있어 키를 놔도 그쪽을 계속 봄)
    if (Math.hypot(swimVel.x, swimVel.z) > 0.25) state.facing = Math.atan2(swimVel.x, swimVel.z);
  } else if (moving) {
    state.facing = Math.atan2(moveDir.x, moveDir.z);
  }

  // 돌담·돌하르방·나무에 부딪히면 밀려나기 (물속에는 이런 것들이 없습니다).
  // 단, 발이 장애물 꼭대기보다 위에 있으면 그냥 지나갑니다 — 그래야 돌담을 뛰어넘을 수 있습니다.
  if (!state.diving) {
    const footY = lulu.position.y;
    for (const o of obstacles) {
      if (footY > o.topY) continue;                 // 담 위로 훌쩍 넘는 중
      const dx = state.x - o.x, dz = state.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + 0.35;
      if (d < min && d > 0.0001) {
        state.x = o.x + (dx / d) * min;
        state.z = o.z + (dz / d) * min;
      }
    }
  }

  // 돌아다닐 수 있는 범위 — 뭍에서는 섬 안, 물속에서는 물질장 안
  if (state.diving) {
    const dx = state.x - DIVE.x, dz = state.z - DIVE.z;
    const dr = Math.hypot(dx, dz);
    if (dr > DIVE.r) {
      state.x = DIVE.x + (dx / dr) * DIVE.r;
      state.z = DIVE.z + (dz / dr) * DIVE.r;
    }
  } else if (state.inside || state.inShop) {
    // 실내에서는 벽 안쪽까지만 다닐 수 있습니다
    const R = state.inside ? ROOM : SHOP_ROOM;
    state.x = Math.min(R.cx + R.w / 2 - 0.6, Math.max(R.cx - R.w / 2 + 0.6, state.x));
    state.z = Math.min(R.cz + R.d / 2 - 0.4, Math.max(R.cz - R.d / 2 + 0.6, state.z));
  } else if (state.z > 94 && state.z < PORT.z + 10.3 && Math.abs(state.x - PORT.x) < 2.4) {
    // 포구 축대 위 — 섬 경계(원) 밖이지만 축대 폭 안에서는 끝까지 걸어나갈 수 있습니다
    // (양옆 현무암 장식과 겹치지 않게 폭을 살짝 좁힙니다)
    state.x = Math.min(PORT.x + 1.85, Math.max(PORT.x - 1.85, state.x));
    state.z = Math.min(PORT.z + 10.1, state.z);
  } else {
    const rr = Math.hypot(state.x, state.z);
    if (rr > WALK_R) {
      state.x *= WALK_R / rr;
      state.z *= WALK_R / rr;
    }
  }

  // 점프와 중력 — 물속에서는 몸이 뜨므로 훨씬 느리게 가라앉고, 스페이스로 계속 떠오릅니다
  const gy = state.diving ? seabedHeight(state.x, state.z) : groundHeight(state.x, state.z);
  const wantUp = keys['Space'] || touchJump;
  if (state.diving) {
    if (wantUp) state.vy += SWIM_UP * dt;                    // ⤴ — 위로 헤엄치기
    else if (Math.abs(f) <= 0.1) state.vy += BUOYANCY * dt;  // 부력 — 가만히 있으면 살며시 떠오릅니다
    state.vy *= Math.max(0, 1 - 2.6 * dt);          // 물의 저항 — 움직임이 부드럽게 잦아듭니다
    state.vy = Math.max(-2.4, Math.min(2.4, state.vy));
  } else {
    if (wantUp && state.onGround && state.harvestT < 0) {
      state.vy = JUMP;
      state.onGround = false;
      state.idleTime = 0;
    }
    state.vy -= GRAVITY * dt;
  }
  let y = lulu.position.y + state.vy * dt;
  if (y <= gy) { y = gy; state.vy = 0; state.onGround = true; }
  // 물속에서는 수면 위로 머리를 내밀 수 있지만 하늘로 날아오르지는 못합니다
  if (state.diving && y > SEA_Y + 0.4) { y = SEA_Y + 0.4; state.vy = 0; }

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
  // (예전에는 5초 넘게 가만히 있으면 앉았다가 낮잠을 잤는데, 그 연출은 뺐습니다)
  const wantSit = 0;
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
  // 뭍에서는 3D 루루 모델, 물속·포구(잠수복 구간)는 전용 그림.
  // 모델을 아직 못 읽었으면(다운로드 중) 그때까지는 그림이 나옵니다.
  const useModel = luluModelReady && !state.diving && !inWetsuitZone();
  luluModel.visible = useModel;
  spriteLulu.visible = !useModel;
  if (spriteBlob) spriteBlob.visible = !useModel;   // 모델은 진짜 그림자를 쓰므로 가짜 그림자를 끕니다
  if (useModel) { updateLuluModel(); return; }

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

  if (state.diving && SHEETS.diveSwim) {
    // 물속에서는 해녀 차림 그림만 씁니다.
    const sp = Math.hypot(swimVel.x, swimVel.z);
    if (state.pickT >= 0) {
      // 전복을 따는 중 — 손을 뻗어 떼어내는 동작이 한 방향으로 재생됩니다
      sheet = SHEETS.divePick;
      cell = Math.min(sheet.frames - 1, Math.floor((state.pickT / PICK_DURATION) * sheet.frames));
    } else if (lulu.position.y > SEA_Y - 1.2 && SHEETS.diveFloat && sp <= 0.4) {
      // 수면에 떠서 숨 고르는 중.
      // (좌우로 헤엄칠 땐 이 정면 그림 대신 아래의 옆헤엄 그림을 씁니다 —
      //  예전엔 수면에서 무조건 이 그림이라, 옆으로 가도 그림이 안 변해 "키가 안 먹는" 것처럼 보였습니다)
      sheet = SHEETS.diveFloat;
      cell = Math.floor(t * 6) % sheet.frames;
    } else if (state.vy > 0.5 || surfacing > 0) {
      // 위로 헤엄쳐 떠오르는 중 (↑)
      sheet = SHEETS.diveUp;
      cell = Math.floor(t * 8) % sheet.frames;
    } else if (state.vy < -0.4) {
      // 아래로 잠수하는 중 (💨·Shift) — 전용 잠수 그림이 있으면 그걸, 없으면 활공 그림을 기울여 씁니다
      sheet = SHEETS.diveDown || SHEETS.diveSwim;
      cell = Math.floor(t * 8) % sheet.frames;
    } else if (sp > 0.4) {
      // 헤엄치기 — 빨리 갈수록 팔다리가 빨리 움직입니다
      sheet = SHEETS.diveSwim;
      cell = Math.floor(t * (4 + sp * 2.4)) % sheet.frames;
    } else if (SHEETS.diveIdle) {
      // 가만히 물에 떠 있기
      sheet = SHEETS.diveIdle;
      cell = Math.floor(t * 6) % sheet.frames;
    } else {
      sheet = SHEETS.diveSwim;
      cell = 0;
    }
  } else if (SHEETS.wetsuitLand && inWetsuitZone()) {
    // 포구 구역 — 해녀 시트에서 오린 잠수복 차림.
    // (2번 컷은 고개가 어깨 너머를 보는 자세라 걷기에 쓰면 목이 돌아가 보여서 안 씁니다)
    sheet = SHEETS.wetsuitLand;
    cell = view === 'back' ? 0 : view === 'front' ? 4 : 3;
  } else if (SHEETS.diveIdle && inWetsuitZone()) {
    // (시트가 없을 때의 예비 — 물속 대기 자세)
    sheet = SHEETS.diveIdle;
    cell = Math.floor(t * 6) % sheet.frames;
  } else if (state.fixT >= 0 && SHEETS.fixHouse) {
    // 페인트칠 중 — 붓을 든 그림(시트의 3번째 칸)만 씁니다 (망치·톱 수리는 뺐습니다)
    sheet = SHEETS.fixHouse;
    cell = 2;
  } else if (state.harvestT >= 0) {
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
  // 물속에서 오르내리는 방향으로 몸이 기웁니다 — 잠수하면 머리가 아래로, 수평이면 원래대로
  if (state.diving && sheet === SHEETS.diveSwim) {
    spriteBoard.rotation.z = Math.max(-1, Math.min(1, -state.vy)) * 0.5;
  }

  // 판 크기: 칸마다 가로 폭이 달라서 그림에 맞춰 그때그때 정합니다.
  // 원본 그림이 왼쪽을 보고 있으므로, 오른쪽으로 갈 때 좌우를 뒤집습니다.
  const Hp = spriteCard.userData.planeH;
  const Wp = Hp * sheet.frameW / CELL_H;
  const breath = 1 - hop * 0.12 + Math.sin(t * 2) * 0.008 * (1 - state.speed);
  // 옆모습일 때만 진행 방향에 맞춰 뒤집습니다. 정면·뒷모습은 어느 쪽으로 가든 그대로 둡니다
  // (정면으로 오면 좌우 성분이 0이라 뒤집기 값이 직전 것으로 남아 방향이 튀었습니다)
  // 옆모습 그림들은 원본이 왼쪽을 보므로, 오른쪽으로 갈 때 좌우를 뒤집습니다.
  // (물속의 둥둥·수면 그림은 정면이라 뒤집지 않습니다)
  // 잠수 그림(diveDown)·잠수복 뭍 자세도 옆모습이라, 오른쪽으로 갈 땐 좌우를 뒤집습니다
  const sideSheets = [SHEETS.walkSide, SHEETS.pullSide, SHEETS.diveSwim, SHEETS.divePick, SHEETS.diveDown, SHEETS.wetsuitLand];
  // 잠수복 뭍 자세(해녀 시트에서 오린 것)만은 원본이 "오른쪽"을 봅니다 — 그래서 뒤집는 조건이 반대입니다.
  // (이걸 다른 옆모습들과 똑같이 다루면, 왼쪽으로 걸을 때 머리가 오른쪽을 보는 우스운 꼴이 됩니다)
  const facesRight = sheet === SHEETS.wetsuitLand;
  const mirror = sideSheets.includes(sheet) &&
    (facesRight ? !spriteCard.userData.headingRight : spriteCard.userData.headingRight);
  spriteCard.scale.set(mirror ? -Wp : Wp, Hp * breath, 1);

  // 발밑 그림자: 점프해서 뜨면 작아지고 옅어집니다
  const air = Math.max(0, lulu.position.y - groundY);
  const shrink = Math.max(0.45, 1 - air * 0.22);
  spriteBlob.position.set(state.x, groundY + 0.06, state.z);
  spriteBlob.scale.set(shrink, shrink, 1);
  spriteBlob.material.opacity = 0.4 * shrink;
}

// ---------- 13. 메인 루프 ----------
// 세계 만들기가 끝났습니다 — 이제부터의 우연(경마 승패·잡담 고르기)은 진짜 랜덤으로
Math.random = trueRandom;

loadGame();   // 모든 것이 준비된 뒤에 저장을 불러와 이어합니다

const clock = new THREE.Clock();
const camTarget = new THREE.Vector3();
const camWanted = new THREE.Vector3();

// (카메라 자동 추적·가림 방지 기능은 써봤다가 전부 뺐습니다 — 카메라는 원래 방식 그대로)

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;

  updateCamera(dt);   // 방향키로 시야 돌리기 — 이동 계산이 카메라 방향을 쓰므로 먼저 갱신합니다
  updateLulu(dt);
  updateBasket(dt);
  updateFlyingFruits(dt);
  updateFilledFruits(dt);
  updateDiving(dt);   // 물질 중이면 숨을 깎고, 다 떨어지면 뭍으로 올려보냅니다
  updateNet(dt, t);   // 망사리를 멨으면 등 뒤를 따라다닙니다
  updateDoors();      // 문 앞에 서면 집·상점 안팎을 드나듭니다
  updateDayNight(dt); // 해가 뜨고 지고, 아침마다 하루가 바뀝니다
  updatePony(t);      // 조랑말 — 오늘 먹였으면 웃고, 굶었으면 웁니다
  updateHalmang();    // 해녀 할망 — 포구 옆에 앉아 있습니다
  updateHouse(dt);    // 집 고치는 동작이 끝나면 수리 단계를 올립니다
  updateMayor(dt, t); // 이장님이 상점과 택배사 사이를 오갑니다
  updateCarrotFx(dt); // 먹인 당근이 조랑말 입가에서 냠냠 사라집니다
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
  // 카메라가 땅을 뚫고 들어가지 않게 바닥보다 조금 위로 띄웁니다.
  // 물속에서는 해저에 바짝 붙어야 하므로 여유를 훨씬 적게 둡니다.
  const minY = groundHeight(camWanted.x, camWanted.z) + (state.diving ? 0.5 : 1.2);
  if (camWanted.y < minY) camWanted.y = minY;
  // 물속에서 카메라가 수면 위로 튀어나오면 바다가 사라져 보입니다. 물 아래에 붙들어 둡니다.
  if (state.diving && lulu.position.y < SEA_Y - 0.6) camWanted.y = Math.min(camWanted.y, SEA_Y - 0.4);
  camera.position.lerp(camWanted, 1 - Math.pow(0.0015, dt));
  camera.lookAt(camTarget);

  // 그림자용 태양은 루루를 따라다니며, 게임 시간에 맞춰 동쪽에서 서쪽으로 갑니다
  const sunA = sunAngCur >= 0 ? sunAngCur : Math.PI / 2;
  sun.position.set(
    lulu.position.x + Math.cos(sunA) * 42,
    lulu.position.y + 10 + Math.sin(sunA) * 38,
    lulu.position.z + 18
  );
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
