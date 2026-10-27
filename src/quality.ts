import type { QualityTier } from './config.ts';

const KEY = 'cp-quality';

export function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 1100);
}

/** Heuristic tier detection. Users can override with the ⚙️ button (stored in localStorage) or ?quality=. */
export function detectQuality(): QualityTier {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'low' || q === 'medium' || q === 'high') return q;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
  } catch { /* private mode */ }

  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const mobile = isMobile();
  let score = 0;
  score += cores >= 8 ? 2 : cores >= 6 ? 1 : 0;
  score += mem >= 8 ? 2 : mem >= 4 ? 1 : 0;
  if (!mobile) score += 2;
  // Software renderers (SwiftShader) → low
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    const r = dbg ? String(gl!.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    if (/SwiftShader|llvmpipe|Software/i.test(r)) return 'low';
    if (/Mali-4|Mali-T|Adreno \(TM\) [345]/i.test(r)) score -= 2;
  } catch { /* ignore */ }
  if (score >= 5) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

export function saveQuality(t: QualityTier): void {
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
}

export function nextTier(t: QualityTier): QualityTier {
  return t === 'low' ? 'medium' : t === 'medium' ? 'high' : 'low';
}

export const TIER_LABEL: Record<QualityTier, string> = { low: 'কম', medium: 'মাঝারি', high: 'উচ্চ' };
