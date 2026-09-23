import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let scene, camera, renderer, controls, model;
const targetMeshes = [];

const targetScales = {
    shoulder: 1.0,
    chest: 1.0,
    waist: 1.0,
    pelvis: 1.0, // 골반 (좌우 골격 너비)
    glute: 1.0,  // 엉덩이 (뒤쪽 볼륨/힙업)
    arm: 1.0,
    thigh: 1.0,
    calf: 1.0
};

// 🎯 팔 3D 중심선 자동 측정 테이블
let armCenterTable = [];

function init() {
    const container = document.getElementById('canvas-container');
    if (!container) return;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1117);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 1.2, 3.2);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(3, 5, 4);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const gridHelper = new THREE.GridHelper(10, 20, 0x00f2fe, 0x222233);
    scene.add(gridHelper);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.9, 0);
    controls.update();

    loadYBot();
    setupUI();
    window.addEventListener('resize', onWindowResize);
    animate();
}

function loadYBot() {
    const loader = new GLTFLoader();
    const badge = document.getElementById('status-badge');

    const paths = ['./models/Ybot.glb', './Ybot.glb', 'models/Ybot.glb', 'Ybot.glb'];
    let pathIdx = 0;

    function tryNext() {
        if (pathIdx >= paths.length) {
            if (badge) {
                badge.innerText = "Ybot.glb 못찾음";
                badge.style.color = "#ff4444";
            }
            return;
        }

        const currentPath = paths[pathIdx];
        if (badge) badge.innerText = `YBot 모델 로드 중...`;

        loader.load(
            currentPath,
            (gltf) => {
                model = gltf.scene;

                const box = new THREE.Box3().setFromObject(model);
                const size = box.getSize(new THREE.Vector3());
                if (size.y > 0) {
                    const scaleFactor = 1.8 / size.y;
                    model.scale.set(scaleFactor, scaleFactor, scaleFactor);
                }
                model.position.set(0, 0, 0);
                scene.add(model);

                targetMeshes.length = 0;

                model.traverse((child) => {
                    if (child.isMesh && child.geometry) {
                        child.castShadow = true;
                        child.receiveShadow = true;

                        const posAttr = child.geometry.attributes.position;
                        child.userData.origPositions = new Float32Array(posAttr.array);
                        targetMeshes.push(child);
                    }
                });

                // 팔의 실제 3D 뼈대 중심선 정밀 측정
                calculateArmCenterline();

                if (badge) {
                    badge.innerText = "YBot 로드 완료";
                    badge.style.color = "#00f2fe";
                }

                applyVertexBodyDeformation();
            },
            undefined,
            () => {
                pathIdx++;
                tryNext();
            }
        );
    }

    tryNext();
}

// 📐 팔 메쉬 단면별 중심축(Y, Z) 자동 계산
function calculateArmCenterline() {
    if (targetMeshes.length === 0) return;

    const xStep = 0.03;
    const xMin = 0.15;
    const xMax = 0.85;

    armCenterTable = [];

    for (let x = xMin; x <= xMax; x += xStep) {
        let sumY = 0;
        let sumZ = 0;
        let count = 0;

        targetMeshes.forEach((mesh) => {
            const orig = mesh.userData.origPositions;
            if (!orig) return;

            for (let i = 0; i < orig.length; i += 3) {
                const vx = orig[i];
                const vy = orig[i + 1];
                const vz = orig[i + 2];
                const absX = Math.abs(vx);

                if (absX >= x && absX < x + xStep && vy > 0.8) {
                    sumY += vy;
                    sumZ += vz;
                    count++;
                }
            }
        });

        if (count > 0) {
            armCenterTable.push({
                x: x + xStep / 2,
                centerY: sumY / count,
                centerZ: sumZ / count
            });
        }
    }
}

// 📍 팔 중심 Y, Z 보정 보간
function getArmCenter(absX) {
    if (armCenterTable.length === 0) {
        return { centerY: 1.38, centerZ: 0 };
    }

    if (absX <= armCenterTable[0].x) return armCenterTable[0];
    if (absX >= armCenterTable[armCenterTable.length - 1].x) {
        return armCenterTable[armCenterTable.length - 1];
    }

    for (let i = 0; i < armCenterTable.length - 1; i++) {
        const p1 = armCenterTable[i];
        const p2 = armCenterTable[i + 1];
        if (absX >= p1.x && absX <= p2.x) {
            const t = (absX - p1.x) / (p2.x - p1.x);
            return {
                centerY: p1.centerY + t * (p2.centerY - p1.centerY),
                centerZ: p1.centerZ + t * (p2.centerZ - p1.centerZ)
            };
        }
    }

    return armCenterTable[0];
}

// Smooth Blending Interpolation (부드러운 가중치 보정)
function getSmoothWeight(val, start, peak, end) {
    if (val < start || val > end) return 0.0;
    if (val < peak) {
        const t = (val - start) / (peak - start);
        return t * t * (3 - 2 * t);
    } else {
        const t = (end - val) / (end - peak);
        return t * t * (3 - 2 * t);
    }
}

// 💥 정밀 부위별 정점 변형 연산
function applyVertexBodyDeformation() {
    if (targetMeshes.length === 0) return;

    const S = targetScales;

    const bbox = new THREE.Box3().setFromObject(model);
    const minY = bbox.min.y;
    const maxY = bbox.max.y;
    const totalHeight = Math.max(0.1, maxY - minY);

    targetMeshes.forEach((mesh) => {
        const geom = mesh.geometry;
        const posAttr = geom.attributes.position;
        const orig = mesh.userData.origPositions;

        if (!orig) return;

        for (let i = 0; i < posAttr.count; i++) {
            const ix = i * 3;
            const iy = i * 3 + 1;
            const iz = i * 3 + 2;

            let x = orig[ix];
            let y = orig[iy];
            let z = orig[iz];

            const relY = (y - minY) / totalHeight;
            const absX = Math.abs(x);

            // 가중치 계산
            const calfWeight = getSmoothWeight(relY, 0.02, 0.16, 0.28);
            const thighWeight = getSmoothWeight(relY, 0.26, 0.38, 0.48);
            
            // 🎯 1. 골반 가중치 (0.40 ~ 0.60): 골반 프레임 및 좌우 폭
            const pelvisWeight = getSmoothWeight(relY, 0.40, 0.50, 0.60);

            // 🎯 2. 엉덩이 가중치 (0.35 ~ 0.56): 뒤쪽 힙 볼륨
            const gluteWeight = getSmoothWeight(relY, 0.35, 0.46, 0.56);

            // 3. 허리/복부
            const waistWeight = getSmoothWeight(relY, 0.46, 0.59, 0.72);
            
            // 4. 가슴
            const chestWeight = (relY >= 0.68 && relY <= 0.83 && absX < 0.18) ? getSmoothWeight(relY, 0.68, 0.75, 0.83) : 0.0;

            let finalX = x;
            let finalY = y;
            let finalZ = z;

            // 🦵 다리 영역 (relY < 0.48): 각 다리 중심축 기준 균등 확장
            if (relY < 0.48 && absX > 0.02) {
                const legSign = x >= 0 ? 1 : -1;
                const legCenterX = legSign * 0.115;
                const localX = x - legCenterX;

                const legScale = 1.0 + calfWeight * (S.calf - 1.0) + thighWeight * (S.thigh - 1.0);

                finalX = legCenterX + localX * legScale;
                finalZ = z * legScale;
            } 
            // 🦾 팔 영역
            else if (relY >= 0.60 && absX >= 0.15) {
                const armCenter = getArmCenter(absX);

                let armWeight = 1.0;
                if (absX < 0.22) {
                    const t = (absX - 0.15) / 0.07;
                    armWeight = t * t * (3 - 2 * t);
                }

                const armScale = 1.0 + armWeight * (S.arm - 1.0);

                const localY = y - armCenter.centerY;
                const localZ = z - armCenter.centerZ;

                finalY = armCenter.centerY + localY * armScale;
                finalZ = armCenter.centerZ + localZ * armScale;

                const shoulderShift = 0.18 * (S.shoulder - 1.0);
                finalX = x + (x > 0 ? 1 : -1) * shoulderShift * armWeight;
            }
            // 🧍 몸통 영역 (골반, 엉덩이, 허리, 가슴, 어깨)
            else {
                // 골반(S.pelvis)은 주로 좌우 너비(X축)에 영향을 줌
                let torsoScaleX = 1.0 + 
                    pelvisWeight * (S.pelvis - 1.0) +
                    waistWeight * (S.waist - 1.0) +
                    chestWeight * (S.chest - 1.0);

                let torsoScaleZ = 1.0 +
                    pelvisWeight * 0.4 * (S.pelvis - 1.0) +
                    waistWeight * (S.waist - 1.0) +
                    chestWeight * (S.chest - 1.0);

                // 어깨 넓이
                if (relY >= 0.70 && relY <= 0.85 && absX < 0.18) {
                    const shoulderW = getSmoothWeight(relY, 0.70, 0.78, 0.85);
                    torsoScaleX += shoulderW * (S.shoulder - 1.0);
                }

                finalX = x * torsoScaleX;
                finalZ = z * torsoScaleZ;

                // 🍑 [독립 엉덩이 조절] 몸 뒤쪽 정점(z < 0.02)에 대해 입체적 볼륨 확대 (-Z 방향)
                if (gluteWeight > 0 && z < 0.02) {
                    // 뒤쪽으로 갈수록 가중치 향상
                    const rearFactor = Math.min(1.0, Math.max(0.0, (-z + 0.02) / 0.1));
                    const gluteEffect = gluteWeight * rearFactor * (S.glute - 1.0);

                    // Z축 뒤쪽 부풀림
                    finalZ += z * gluteEffect;

                    // 자연스러운 애플힙 라인을 위한 약간의 X축 보정
                    finalX += x * (gluteEffect * 0.3);
                }
            }

            posAttr.setXYZ(i, finalX, finalY, finalZ);
        }

        posAttr.needsUpdate = true;
        geom.computeVertexNormals();
    });
}

function setupUI() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            document.getElementById(targetId)?.classList.add('active');
        });
    });

    const updateScaleVal = (key, val) => {
        const floatVal = parseFloat(val);
        targetScales[key] = floatVal;

        const badge = document.getElementById(`val-${key}`);
        if (badge) badge.innerText = `${floatVal.toFixed(2)}x`;

        applyVertexBodyDeformation();
    };

    // 🎯 glute 추가
    const keys = ['shoulder', 'chest', 'waist', 'pelvis', 'glute', 'arm', 'thigh', 'calf'];
    keys.forEach(key => {
        const slider = document.getElementById(`slider-${key}`);
        if (slider) {
            slider.addEventListener('input', (e) => {
                updateScaleVal(key, e.target.value);
            });
        }
    });

    document.getElementById('reset-btn')?.addEventListener('click', () => {
        keys.forEach(key => {
            const slider = document.getElementById(`slider-${key}`);
            if (slider) slider.value = 1.0;
            updateScaleVal(key, 1.0);
        });
    });

    document.getElementById('cam-front')?.addEventListener('click', () => { camera.position.set(0, 1.0, 2.8); controls.target.set(0, 0.9, 0); });
    document.getElementById('cam-side')?.addEventListener('click', () => { camera.position.set(2.5, 1.0, 0); controls.target.set(0, 0.9, 0); });
    document.getElementById('cam-back')?.addEventListener('click', () => { camera.position.set(0, 1.0, -2.8); controls.target.set(0, 0.9, 0); });
    document.getElementById('cam-reset')?.addEventListener('click', () => { camera.position.set(0, 1.2, 3.2); controls.target.set(0, 0.9, 0); });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

init();