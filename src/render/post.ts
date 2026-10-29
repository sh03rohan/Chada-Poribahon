import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

/**
 * Post-processing stack, by quality tier:
 *   none  — direct render (low tier / phones)
 *   basic — tone map → bloom on display values (lamps, sun, headlights) → colour grade + vignette → SMAA
 *   full  — + ground-truth ambient occlusion (GTAO) before the bloom
 * The grade is deliberately gentle: a touch more saturation and contrast, a warm lift in the
 * shadows, a soft vignette — the look should stay "clean and bright", not filtered.
 */
export type PostLevel = 'none' | 'basic' | 'full';

const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, saturation: { value: 1.12 }, contrast: { value: 1.06 }, warmth: { value: 0.025 }, vignette: { value: 0.32 }, night: { value: 0 }, heat: { value: 0 }, time: { value: 0 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float saturation, contrast, warmth, vignette, night, heat, time; varying vec2 vUv;
    void main() {
      // heat haze: a faint ripple over the lower half of the frame at noon
      vec2 uv = vUv; float hz = heat * smoothstep(0.62, 0.25, vUv.y) * smoothstep(0.0, 0.25, vUv.y);
      uv.x += sin(vUv.y * 90.0 + time * 2.2) * 0.0016 * hz; uv.y += sin(vUv.x * 70.0 + time * 1.7) * 0.0010 * hz;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, saturation);
      c = (c - 0.5) * contrast + 0.5;
      c += vec3(warmth, warmth * 0.45, -warmth * 0.6) * (1.0 - l);        // warm lift in the shadows
      c = mix(c, c * vec3(0.92, 0.96, 1.06), night * 0.6);                 // cool cast at night
      float d = distance(vUv, vec2(0.5)) * 1.3;
      c *= 1.0 - vignette * smoothstep(0.55, 1.1, d);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class PostStack {
  readonly composer: EffectComposer;
  readonly level: PostLevel;
  private bloom: UnrealBloomPass | null = null;
  private gtao: GTAOPass | null = null;
  private grade: ShaderPass;
  private smaa: SMAAPass;
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, level: Exclude<PostLevel, 'none'>, w: number, h: number) {
    this.level = level;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    if (level === 'full') {
      this.gtao = new GTAOPass(scene, camera, w, h);
      this.gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1, thickness: 1, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      this.gtao.output = GTAOPass.OUTPUT.Default; this.gtao.blendIntensity = 0.85;
      this.composer.addPass(this.gtao);
    }
    // tone-map first: the procedural sky is HDR-bright, so the bloom has to look at display values
    this.composer.addPass(new OutputPass());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.14, 0.3, 0.94);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader); this.composer.addPass(this.grade);
    this.smaa = new SMAAPass(); this.composer.addPass(this.smaa);
  }
  setSize(w: number, h: number) { this.composer.setSize(w, h); }
  /** night / fog: lamps and headlights bloom more, the grade cools */
  setMood(night: boolean, fog: number, heat = 0, time = 0) {
    this.grade.uniforms.heat.value = this.level === 'full' ? heat : 0; this.grade.uniforms.time.value = time;
    if (this.bloom) { this.bloom.strength = night ? 0.6 : 0.14 + fog * 0.06; this.bloom.threshold = night ? 0.55 : 0.94; this.bloom.radius = night ? 0.5 : 0.3; }
    this.grade.uniforms.night.value = night ? 1 : 0;
  }
  render() { this.composer.render(); }
}
