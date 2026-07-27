import * as THREE from "three";
import gsap from "gsap";
import GUI from "lil-gui";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";

// Config
// REEMPLAZAR: pon aquí tus propias imágenes.
// El orden determina en qué posición del carrusel aparece cada una.
const IMAGES = [
	"img/valekids.png",     
	"img/valemansion.jpg",    
	"img/valemansion2.jpg", 
	"img/valemansion3.jpg", 
	"img/valepiano.jpg",     
	"img/valeviolin.png",     
	"img/valeharp.jpg",       
	"img/valeflute.png",    
];

const CARD_COUNT = IMAGES.length;
const RADIUS = 4.3;
const CARD_HEIGHT = 2.7;
const CAMERA_Z = 11;
const OPEN_DISTANCE = 5;

const IMG = (i) => IMAGES[i - 1];

const params = {
	bloomStrength: 0,
	bloomRadius: 0.4,
	bloomThreshold: 0.85,
	holo: 1.0,
	facetScale: 18.0,
	facetStrength: 0.3,
	aberration: 0.0012,
	floorReflect: 0.5,
	floorGlow: 0.55,
};

// Scene
const scene = new THREE.Scene();
// Sin scene.background: dejamos la escena transparente para que se vea
// el degradado carmesí/negro del body (definido en gallery-style.css) detrás del carrusel.

const camera = new THREE.PerspectiveCamera(
	55,
	window.innerWidth / window.innerHeight,
	0.1,
	100,
);
camera.position.set(0, 0, CAMERA_Z);
camera.lookAt(0, 0, 0);

// en pantallas estrechas la camara se aleja para encuadrar el carrusel
function fitCameraDistance() {
	camera.position.z = camera.aspect < 0.75 ? 15 : CAMERA_Z;
}
fitCameraDistance();

const renderer = new THREE.WebGLRenderer({
	canvas: document.querySelector(".webgl"),
	antialias: true,
	alpha: true, // fondo transparente para ver el degradado carmesí del body
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

// Texturas
const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");
const textures = [];
for (let i = 1; i <= CARD_COUNT; i++) {
	const tex = textureLoader.load(IMG(i));
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
	textures.push(tex);
}

// Shaders tarjeta holografica
const cardVertexShader = /* glsl */ `
	varying vec2 vUv;
	varying vec3 vWorldPos;
	varying vec3 vNormal;
	varying vec3 vTangent;
	varying vec3 vBitangent;

	void main() {
		vUv = uv;
		vec4 worldPos = modelMatrix * vec4(position, 1.0);
		vWorldPos = worldPos.xyz;
		vNormal = normalize(mat3(modelMatrix) * normal);
		vTangent = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
		vBitangent = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
		gl_Position = projectionMatrix * viewMatrix * worldPos;
	}
`;

const cardFragmentShader = /* glsl */ `
	uniform sampler2D uMap;
	uniform float uTime;
	uniform float uHolo;
	uniform float uFocus;
	uniform float uOpen;
	uniform float uFacetScale;
	uniform float uFacetStrength;
	uniform float uSeed;
	uniform vec2 uPointer;
	uniform float uTheta;
	uniform float uMotion;

	varying vec2 vUv;
	varying vec3 vWorldPos;
	varying vec3 vNormal;
	varying vec3 vTangent;
	varying vec3 vBitangent;

	float hash(vec2 p) {
		return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
	}

	vec2 hash2(vec2 p) {
		return fract(sin(vec2(
			dot(p, vec2(127.1, 311.7)),
			dot(p, vec2(269.5, 183.3))
		)) * 43758.5453);
	}

	vec3 cosPalette(float t) {
		return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
	}

	vec3 diamondPalette(float t) {
		return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
	}

	float noise(vec2 st) {
		vec2 i = floor(st);
		vec2 f = fract(st);
		float a = hash(i);
		float b = hash(i + vec2(1.0, 0.0));
		float c = hash(i + vec2(0.0, 1.0));
		float d = hash(i + vec2(1.0, 1.0));
		vec2 u = f * f * (3.0 - 2.0 * f);
		return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
	}

	// voronoi F1/F2 + id de celda
	vec3 voronoi(vec2 g, out vec2 cellId) {
		vec2 ci = floor(g);
		vec2 cf = fract(g);
		float F1 = 8.0;
		float F2 = 8.0;
		cellId = vec2(0.0);
		for (int y = -1; y <= 1; y++) {
			for (int x = -1; x <= 1; x++) {
				vec2 n = vec2(float(x), float(y));
				vec2 p = hash2(ci + n);
				float d = length(n + p - cf);
				if (d < F1) { F2 = F1; F1 = d; cellId = ci + n; }
				else if (d < F2) { F2 = d; }
			}
		}
		return vec3(F1, F2, F2 - F1);
	}

	void main() {
		vec3 V = normalize(cameraPosition - vWorldPos);
		vec3 N = normalize(vNormal);
		bool backFace = !gl_FrontFacing;
		if (backFace) N = -N;

		// esquirlas cristalinas alargadas en diagonal (dos escalas)
		mat2 rot = mat2(0.7071, -0.7071, 0.7071, 0.7071);
		vec2 suv = rot * vUv;
		vec2 cellId;
		vec3 vor = voronoi(suv * uFacetScale * vec2(1.0, 0.75) + uSeed, cellId);
		vec2 cellId2;
		vec3 vor2 = voronoi(suv * uFacetScale * vec2(2.1, 1.6) + 13.7 + uSeed, cellId2);

		vec2 rnd = hash2(cellId + 7.3) - 0.5;
		vec3 Nf = normalize(N + (rnd.x * vTangent + rnd.y * vBitangent) * uFacetStrength);

		float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);

		// intensidad holo: sube con foco, baja al abrir para ver imagen limpia
		float holo = uHolo * (0.55 + 0.45 * uFocus) * (1.0 - 0.75 * uOpen);
		holo *= 1.0 + uMotion * (0.5 + 1.2 * uFocus);

		// el centro de la imagen queda mas limpio; el foil manda en los bordes
		float centerMask = smoothstep(0.12, 0.52, length(vUv - 0.5));
		holo *= mix(0.4, 1.0, centerMask);

		// barrido periodico: franja diagonal RECTA de bordes definidos
		float cycle = fract(uTime * 0.32);
		float diag = (1.0 - vUv.y) * 0.72 + vUv.x * 0.28;
		float sweepPos = cycle * 3.4 - 1.2;
		float sweepD = abs(diag - sweepPos);
		float sweep = exp(-pow(sweepD * 7.0, 2.0));
		float sweepCore = exp(-pow(sweepD * 18.0, 2.0));
		float sweepFringe = max(sweep - sweepCore, 0.0);

		// de frente dot(V,N) casi no varia al girar: se compensa con el angulo del carrusel
		float facing = pow(max(dot(N, V), 0.0), 3.0);
		float bandBase = dot(V, Nf) + sweep * 0.45 + uTheta * (1.2 + 2.4 * facing);
		float band = bandBase + dot(uPointer, rnd * 2.0) * 0.55 * uFocus;
		float n1 = noise(vUv * 3.0 + uSeed + uTime * 0.09);
		float n2 = noise(vUv * 4.5 + uSeed - uTime * 0.075 + n1 * 1.8);
		float flow = n1 + n2;
		float hue = flow * 0.85 + band * 1.9 + hash(cellId) * 0.25 + uTime * 0.03;
		vec3 iri = cosPalette(hue);
		iri = mix(iri, diamondPalette(hue), sweep * 0.6);
		iri = mix(vec3(1.0), iri, 0.55);

		// marea liquida
		float liquid = pow(0.5 + 0.5 * sin(flow * 4.0 + bandBase * 9.0 + uTime * 0.4), 2.0);

		// esquirlas que se encienden en oleada lenta, tono hielo
		float gleam = pow(0.5 + 0.5 * sin(hash(cellId) * 6.28318 + bandBase * 6.0 + uTime * 0.12), 3.0);
		float gleam2 = pow(0.5 + 0.5 * sin(hash(cellId2) * 6.28318 - bandBase * 5.0 + uTime * 0.09), 4.0);

		// marco de plata pulida: bisel doble
		float fw = 0.028;
		vec2 edge = min(vUv, 1.0 - vUv);
		float edgeD = min(edge.x, edge.y);
		float frame = 1.0 - smoothstep(fw, fw + 0.004, edgeD);
		float bevel = 0.5 + 0.5 * cos((edgeD / fw) * 6.28318);

		// imagen nitida, sin distorsion
		vec3 image = texture2D(uMap, vUv).rgb;

		// grading premium sutil
		float luma = dot(image, vec3(0.299, 0.587, 0.114));
		image = mix(vec3(luma), image, 1.1);
		image = clamp(mix(vec3(0.5), image, 1.07), 0.0, 1.0);

		// brillo especular satinado sobre las teselas
		vec3 L = normalize(vec3(0.4, 0.7, 0.6));
		float glass = pow(max(dot(reflect(-L, Nf), V), 0.0), 22.0);

		// reverso: foil oscuro sin imagen
		if (backFace) {
			image = vec3(0.03, 0.02, 0.08) + iri * 0.15;
		}

		// destellos color cristal: hielo frio tenido por la iridiscencia, nunca blanco plano
		vec3 crystal = mix(iri, vec3(0.72, 0.85, 1.0), 0.5);
		vec3 iceGleam = mix(iri, vec3(0.5, 0.72, 1.0), 0.45);
		vec3 iceCrack = mix(iri, vec3(0.6, 0.78, 1.0), 0.5);
		vec3 imgTint = 0.25 + 0.75 * image;
		vec3 iriChroma = iri - dot(iri, vec3(0.299, 0.587, 0.114));
		vec3 color = image * (0.98 + 0.05 * uFocus + 0.025 * sweep)
							 + iriChroma * liquid * (0.3 + 0.3 * sweep) * holo
							 + iri * liquid * (0.05 + 0.06 * sweep) * holo
							 + iceGleam * imgTint * gleam * (0.14 + 0.25 * sweep) * holo
							 + iceGleam * imgTint * gleam2 * (0.06 + 0.12 * sweep) * holo
							 + crystal * glass * (0.18 + 0.3 * sweep) * holo
							 + iri * fres * (0.16 + 0.12 * sweep) * holo;

		// brillo suave que sigue al puntero
		vec2 pUv = uPointer * 0.5 + 0.5;
		float sheen = exp(-dot(vUv - pUv, vUv - pUv) * 6.0) * uFocus * (1.0 - uOpen);
		color += crystal * sheen * 0.10;

		// plata cromada: valle oscuro y filos claros
		float metalSheen = pow(0.5 + 0.5 * sin((vUv.x - vUv.y) * 5.0 + bandBase * 3.0 + uTime * 0.3), 8.0);
		vec3 silver = mix(vec3(0.52, 0.55, 0.62), vec3(0.94, 0.96, 1.0), bevel);
		silver *= 0.88 + 0.35 * fres;
		silver += iri * metalSheen * 0.9;
		silver += iri * 0.07;
		silver += vec3(0.9, 0.92, 0.95) * sweepCore * 0.45 * holo;
		silver += iri * sweepFringe * 0.15 * holo;
		silver += crystal * sheen * 0.25;
		color = mix(color, silver, frame * 0.95);

		gl_FragColor = vec4(color, 1.0);
	}
`;

// Tarjetas
const carousel = new THREE.Group();
scene.add(carousel);

const cardGeometry = new THREE.PlaneGeometry(CARD_HEIGHT, CARD_HEIGHT);
const cards = [];
const pointerSmooth = new THREE.Vector2(); // compartido por todos los materiales

for (let i = 0; i < CARD_COUNT; i++) {
	const angle = (i / CARD_COUNT) * Math.PI * 2;
	const material = new THREE.ShaderMaterial({
		uniforms: {
			uMap: { value: textures[i] },
			uTime: { value: 0 },
			uHolo: { value: params.holo },
			uFocus: { value: 0 },
			uOpen: { value: 0 },
			uFacetScale: { value: params.facetScale },
			uFacetStrength: { value: params.facetStrength },
			uSeed: { value: Math.random() * 100 },
			uPointer: { value: pointerSmooth },
			uTheta: { value: 0 },
			uMotion: { value: 0 },
		},
		vertexShader: cardVertexShader,
		fragmentShader: cardFragmentShader,
		side: THREE.DoubleSide,
	});

	const card = new THREE.Mesh(cardGeometry, material);
	card.position.set(Math.sin(angle) * RADIUS, 0, Math.cos(angle) * RADIUS);
	card.rotation.y = angle;
	card.userData = {
		angle,
		phase: Math.random() * Math.PI * 2,
		basePos: card.position.clone(),
		focus: 0,
	};
	carousel.add(card);
	cards.push(card);
}

// Plataforma circular: espejo tenue + desvanecido radial + aro champan
const FLOOR_Y = -1.62;
const FLOOR_R = 5.6;

const flatVertexShader = /* glsl */ `
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

const mirror = new Reflector(new THREE.CircleGeometry(FLOOR_R, 96), {
	clipBias: 0.003,
	textureWidth: 1024,
	textureHeight: 1024,
	color: 0x1e1c26,
});
mirror.rotation.x = -Math.PI / 2;
mirror.position.y = FLOOR_Y;
scene.add(mirror);

const floorFade = new THREE.Mesh(
	new THREE.CircleGeometry(FLOOR_R + 0.05, 96),
	new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		uniforms: { uStrength: { value: params.floorReflect } },
		vertexShader: flatVertexShader,
		fragmentShader: /* glsl */ `
			uniform float uStrength;
			varying vec2 vUv;
			void main() {
				float d = length(vUv - 0.5) * 2.0;
				float fade = smoothstep(0.12, 0.85, d);
				float alpha = 1.0 - uStrength * (1.0 - fade);
				gl_FragColor = vec4(vec3(0.0), alpha);
			}
		`,
	}),
);
floorFade.rotation.x = -Math.PI / 2;
floorFade.position.y = FLOOR_Y + 0.005;
scene.add(floorFade);

const floorRing = new THREE.Mesh(
	new THREE.CircleGeometry(FLOOR_R + 0.35, 96),
	new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		uniforms: { uGlow: { value: params.floorGlow } },
		vertexShader: flatVertexShader,
		fragmentShader: /* glsl */ `
			uniform float uGlow;
			varying vec2 vUv;
			void main() {
				float d = length(vUv - 0.5) * 2.0;
				float ring = exp(-pow((d - 0.92) * 55.0, 2.0));
				float front = mix(0.15, 1.0, pow(1.0 - vUv.y, 1.8));
				float glow = ring * front * uGlow;
				gl_FragColor = vec4(vec3(0.92, 0.55, 0.42), glow);
			}
		`,
	}),
);
floorRing.rotation.x = -Math.PI / 2;
floorRing.position.y = FLOOR_Y + 0.01;
scene.add(floorRing);

// Post-proceso (render target con MSAA)
const composer = new EffectComposer(
	renderer,
	new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
		type: THREE.HalfFloatType,
		samples: 8,
	}),
);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
	new THREE.Vector2(window.innerWidth, window.innerHeight),
	params.bloomStrength,
	params.bloomRadius,
	params.bloomThreshold,
);
bloomPass.enabled = params.bloomStrength > 0;
composer.addPass(bloomPass);

const FinalShader = {
	uniforms: {
		tDiffuse: { value: null },
		uTime: { value: 0 },
		uAberration: { value: params.aberration },
	},
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`,
	fragmentShader: /* glsl */ `
		uniform sampler2D tDiffuse;
		uniform float uTime;
		uniform float uAberration;
		varying vec2 vUv;

		float random(vec2 st) {
			return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453);
		}

		void main() {
			vec2 dir = vUv - 0.5;
			float dist = length(dir);

			// aberracion cromatica radial
			float amt = uAberration * dist * dist * 8.0;
			vec3 color = vec3(
				texture2D(tDiffuse, vUv - dir * amt).r,
				texture2D(tDiffuse, vUv).g,
				texture2D(tDiffuse, vUv + dir * amt).b
			);

			// vineta + grano estatico (el animado estroboscopea si caen frames)
			color *= smoothstep(0.95, 0.35, dist);
			color += (random(vUv) - 0.5) * 0.006;

			gl_FragColor = vec4(color, 1.0);
		}
	`,
};
const finalPass = new ShaderPass(FinalShader);
composer.addPass(finalPass);
composer.addPass(new OutputPass());

// Interaccion carrusel
let theta = 0;
let velocity = 0;
let dragging = false;
let downX = 0;
let downY = 0;
let lastX = 0;
let state = "closed"; // closed | opening | open | closing
let openedCard = null;

const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

window.addEventListener("pointerdown", (e) => {
	downX = lastX = e.clientX;
	downY = e.clientY;
	if (state === "closed") {
		dragging = true;
		document.body.classList.add("dragging");
	}
});

window.addEventListener("pointermove", (e) => {
	pointer.set(
		(e.clientX / window.innerWidth) * 2 - 1,
		-(e.clientY / window.innerHeight) * 2 + 1,
	);
	if (dragging) {
		const delta = e.clientX - lastX;
		lastX = e.clientX;
		theta += delta * 0.006;
		velocity = delta * 0.36; // rad/s aprox
		lastInteract = clock.elapsedTime;
	}
});

window.addEventListener("pointerup", (e) => {
	dragging = false;
	document.body.classList.remove("dragging");
	const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
	if (moved > 6) return;

	if (state === "open") {
		closeCard();
	} else if (state === "closed") {
		const front = getFrontCard();
		raycaster.setFromCamera(pointer, camera);
		if (raycaster.intersectObject(front, false).length > 0) openCard(front);
	}
});

window.addEventListener("wheel", (e) => {
	if (state === "closed") velocity += e.deltaY * 0.0025;
});

window.addEventListener("keydown", (e) => {
	if (e.key === "Escape" && state === "open") closeCard();
});

let currentFront = null;

function getFrontCard() {
	let best = cards[0];
	let bestZ = -Infinity;
	for (const card of cards) {
		const z = Math.cos(card.userData.angle + theta);
		if (z > bestZ) {
			bestZ = z;
			best = card;
		}
	}
	if (currentFront && currentFront !== best) {
		const currentZ = Math.cos(currentFront.userData.angle + theta);
		if (bestZ - currentZ < 0.02) return currentFront;
	}
	currentFront = best;
	return best;
}

// Abrir / cerrar tarjeta
function openCard(card) {
	state = "opening";
	openedCard = card;
	velocity = 0;
	document.body.classList.remove("hover-gem");

	const thetaTarget =
		-card.userData.angle +
		Math.round((theta + card.userData.angle) / (Math.PI * 2)) * Math.PI * 2;

	const visH = 2 * OPEN_DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
	const visW = visH * camera.aspect;
	const targetSize = Math.min(visH * 0.8, visW * 0.8);
	const targetScale = targetSize / CARD_HEIGHT;

	const targetLocal = new THREE.Vector3(0, 0, camera.position.z - OPEN_DISTANCE)
		.applyAxisAngle(new THREE.Vector3(0, 1, 0), -thetaTarget);

	let rotTarget = -thetaTarget;
	rotTarget += Math.round((card.rotation.y - rotTarget) / (Math.PI * 2)) * Math.PI * 2;

	const tl = gsap.timeline({ onComplete: () => (state = "open") });
	tl.to({ t: theta }, {
		t: thetaTarget,
		duration: 0.9,
		ease: "power3.inOut",
		onUpdate() { theta = this.targets()[0].t; },
	}, 0);
	tl.to(card.position, {
		x: targetLocal.x, y: targetLocal.y, z: targetLocal.z,
		duration: 1.2, ease: "power3.inOut",
	}, 0.1);
	tl.to(card.rotation, {
		x: 0, y: rotTarget, z: 0,
		duration: 1.2, ease: "power3.inOut",
	}, 0.1);
	tl.to(card.scale, {
		x: targetScale, y: targetScale, z: 1,
		duration: 1.2, ease: "power3.inOut",
	}, 0.1);
	tl.to(card.material.uniforms.uOpen, {
		value: 1, duration: 0.9, ease: "power2.inOut",
	}, 0.5);
}

function closeCard() {
	const card = openedCard;
	state = "closing";
	const { basePos, angle } = card.userData;

	let rotBase = angle;
	rotBase += Math.round((card.rotation.y - rotBase) / (Math.PI * 2)) * Math.PI * 2;

	const tl = gsap.timeline({
		onComplete: () => {
			state = "closed";
			openedCard = null;
		},
	});
	tl.to(card.material.uniforms.uOpen, {
		value: 0, duration: 0.7, ease: "power2.inOut",
	}, 0);
	tl.to(card.position, {
		x: basePos.x, y: basePos.y, z: basePos.z,
		duration: 1.1, ease: "power3.inOut",
	}, 0.1);
	tl.to(card.rotation, { x: 0, y: rotBase, z: 0, duration: 1.1, ease: "power3.inOut" }, 0.1);
	tl.to(card.scale, { x: 1, y: 1, z: 1, duration: 1.1, ease: "power3.inOut" }, 0.1);
}

// GUI
const gui = new GUI();
gui.add(params, "bloomStrength", 0, 3).onChange((v) => {
	bloomPass.strength = v;
	bloomPass.enabled = v > 0;
});
gui.add(params, "bloomRadius", 0, 1.5).onChange((v) => (bloomPass.radius = v));
gui.add(params, "bloomThreshold", 0, 1).onChange((v) => (bloomPass.threshold = v));
gui.add(params, "holo", 0, 2).onChange((v) =>
	cards.forEach((c) => (c.material.uniforms.uHolo.value = v)));
gui.add(params, "facetScale", 2, 30, 1).onChange((v) =>
	cards.forEach((c) => (c.material.uniforms.uFacetScale.value = v)));
gui.add(params, "facetStrength", 0, 1.5).onChange((v) =>
	cards.forEach((c) => (c.material.uniforms.uFacetStrength.value = v)));
gui.add(params, "aberration", 0, 0.02).onChange((v) =>
	(finalPass.uniforms.uAberration.value = v));
gui.add(params, "floorReflect", 0, 1).onChange((v) =>
	(floorFade.material.uniforms.uStrength.value = v));
gui.add(params, "floorGlow", 0, 1.5).onChange((v) =>
	(floorRing.material.uniforms.uGlow.value = v));
gui.close();
gui.hide();

// Resize
window.addEventListener("resize", () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	fitCameraDistance();
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	composer.setSize(window.innerWidth, window.innerHeight);
	bloomPass.resolution.set(window.innerWidth, window.innerHeight);
	resizePetalsCanvas();
});

// Loop
const clock = new THREE.Clock();
let motionSmooth = 0;
let lastInteract = 0;
let idleSpin = 0;
let lastFrontIdx = -1;
const counterEl = document.querySelector(".counter .n");

window.addEventListener("wheel", () => (lastInteract = clock.elapsedTime));

function tick() {
	requestAnimationFrame(tick);
	const dt = Math.min(clock.getDelta(), 0.05);
	const t = clock.elapsedTime;

	// inercia del carrusel + giro automatico en reposo
	if (state === "closed" && !dragging) {
		theta += velocity * dt;
		velocity *= Math.exp(-2.2 * dt);

		const idle = t - lastInteract > 2.5 ? 1 : 0;
		idleSpin += (idle - idleSpin) * Math.min(1, dt * 1.2);
		theta += 0.08 * idleSpin * dt;
	}
	carousel.rotation.y = theta;

	// brillo por movimiento: solo giro del usuario (drag/rueda), no el automatico
	motionSmooth += (Math.min(1, Math.abs(velocity) * 0.7) - motionSmooth) * Math.min(1, dt * 4);

	const front = getFrontCard();

	// hover: un solo raycast por frame
	if (state === "closed" && !dragging) {
		raycaster.setFromCamera(pointer, camera);
		const hits = raycaster.intersectObjects(cards, false);
		if (hits.length > 0) lastInteract = t;
		document.body.classList.toggle(
			"hover-gem",
			hits.length > 0 && hits[0].object === front,
		);
	}

	// contador de imagen frontal
	const frontIdx = cards.indexOf(front);
	if (frontIdx !== lastFrontIdx) {
		lastFrontIdx = frontIdx;
		counterEl.textContent = String(frontIdx + 1).padStart(2, "0");
	}

	for (const card of cards) {
		const u = card.userData;
		card.material.uniforms.uTime.value = t + u.phase * 10;
		card.material.uniforms.uTheta.value = theta;
		card.material.uniforms.uMotion.value = motionSmooth;

		// foco de tarjeta frontal
		const targetFocus = card === front && state === "closed" ? 1 : 0;
		u.focus += (targetFocus - u.focus) * Math.min(1, dt * 5);
		card.material.uniforms.uFocus.value = u.focus;

		if (card === openedCard) continue;

		// estaticas; solo tilt suave hacia el puntero al enfocar
		card.position.y = 0;
		card.rotation.y = u.angle + pointerSmooth.x * 0.18 * u.focus;
		card.rotation.x = -pointerSmooth.y * 0.14 * u.focus;

		const s = 1 + 0.08 * u.focus;
		card.scale.setScalar(s);
	}

	// tilt sutil de la tarjeta abierta hacia el puntero
	if (openedCard && state === "open") {
		let rotY = -theta + pointer.x * 0.12;
		rotY += Math.round((openedCard.rotation.y - rotY) / (Math.PI * 2)) * Math.PI * 2;
		openedCard.rotation.y += (rotY - openedCard.rotation.y) * Math.min(1, dt * 4);
		openedCard.rotation.x += (-pointer.y * 0.1 - openedCard.rotation.x) * Math.min(1, dt * 4);
	}

	// puntero suavizado para la refraccion de los shaders
	pointerSmooth.x += (pointer.x - pointerSmooth.x) * Math.min(1, dt * 2.2);
	pointerSmooth.y += (pointer.y - pointerSmooth.y) * Math.min(1, dt * 2.2);

	finalPass.uniforms.uTime.value = t;

	composer.render();
}

tick();

// UI del diseño: miniaturas / flechas / explore (aditivo, no toca el carrusel)
const thumbEls = [...document.querySelectorAll(".thumb")];
const dashEls = [...document.querySelectorAll(".dashes i")];

function syncUI() {
	const idx = Number(counterEl.textContent) - 1;
	thumbEls.forEach((el) =>
		el.classList.toggle("active", Number(el.dataset.index) === idx));
	dashEls.forEach((el, i) => el.classList.toggle("active", i === idx));
}
new MutationObserver(syncUI).observe(counterEl, { childList: true });
syncUI();

let navTween = null;

function goToCard(index) {
	if (state !== "closed") return;
	velocity = 0;
	lastInteract = clock.elapsedTime;
	navTween?.kill();
	const angle = cards[(index + CARD_COUNT) % CARD_COUNT].userData.angle;
	const target =
		-angle + Math.round((theta + angle) / (Math.PI * 2)) * (Math.PI * 2);
	navTween = gsap.to({ t: theta }, {
		t: target,
		duration: 0.9,
		ease: "power3.inOut",
		onUpdate() { theta = this.targets()[0].t; },
	});
}

const stepCard = (dir) =>
	goToCard((cards.indexOf(getFrontCard()) + dir + CARD_COUNT) % CARD_COUNT);

document.querySelectorAll(".ui-prev").forEach((el) =>
	el.addEventListener("click", () => stepCard(-1)));
document.querySelectorAll(".ui-next").forEach((el) =>
	el.addEventListener("click", () => stepCard(1)));
thumbEls.forEach((el) =>
	el.addEventListener("click", () => goToCard(Number(el.dataset.index))));
document.querySelectorAll(".ui-open").forEach((el) =>
	el.addEventListener("click", () => {
		if (state === "closed") openCard(getFrontCard());
	}));

// que pulsar la UI no arranque el drag del carrusel
document.querySelectorAll(".thumb, .circle, .cta").forEach((el) =>
	el.addEventListener("pointerdown", (e) => e.stopPropagation()));

window.addEventListener("keydown", (e) => {
	if (e.key === "ArrowRight") stepCard(1);
	else if (e.key === "ArrowLeft") stepCard(-1);
});

// --- SISTEMA DE PÉTALOS: mismo efecto que en index.html / article.html ---
const petalCanvas = document.getElementById("petals-canvas");
const petalCtx = petalCanvas.getContext("2d");

function resizePetalsCanvas() {
	petalCanvas.width = window.innerWidth;
	petalCanvas.height = window.innerHeight;
}
resizePetalsCanvas();

const petalsArray = [];
const maxPetals = 30;

class Petal {
	constructor() {
		this.x = Math.random() * petalCanvas.width;
		this.y = Math.random() * -petalCanvas.height;
		this.size = Math.random() * 5 + 3;
		this.speedY = Math.random() * 0.7 + 0.3;
		this.speedX = Math.random() * 0.4 - 0.2;
		this.angle = Math.random() * 360;
		this.spin = Math.random() * 0.8 - 0.4;
		const colors = [
			"rgba(239, 68, 68, 0.25)",
			"rgba(249, 115, 22, 0.20)",
			"rgba(254, 205, 211, 0.25)",
		];
		this.color = colors[Math.floor(Math.random() * colors.length)];
	}
	update() {
		this.y += this.speedY;
		this.x += this.speedX + Math.sin(this.y / 40) * 0.25;
		this.angle += this.spin;
		if (this.y > petalCanvas.height + 10) {
			this.y = -10;
			this.x = Math.random() * petalCanvas.width;
		}
	}
	draw() {
		petalCtx.save();
		petalCtx.translate(this.x, this.y);
		petalCtx.rotate((this.angle * Math.PI) / 180);
		petalCtx.fillStyle = this.color;
		petalCtx.beginPath();
		petalCtx.ellipse(0, 0, this.size, this.size / 1.8, 0, 0, 2 * Math.PI);
		petalCtx.fill();
		petalCtx.restore();
	}
}

for (let i = 0; i < maxPetals; i++) {
	petalsArray.push(new Petal());
}

function animatePetals() {
	petalCtx.clearRect(0, 0, petalCanvas.width, petalCanvas.height);
	for (let i = 0; i < petalsArray.length; i++) {
		petalsArray[i].update();
		petalsArray[i].draw();
	}
	requestAnimationFrame(animatePetals);
}
animatePetals();
