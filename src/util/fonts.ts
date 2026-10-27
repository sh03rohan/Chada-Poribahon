/** Loads the self-hosted Bangla font and resolves once canvas text can use it. */
export const BANGLA_FONT = 'Hind Siliguri';

let promise: Promise<void> | null = null;

export function loadBanglaFont(): Promise<void> {
  if (promise) return promise;
  promise = (async () => {
    const faces = [
      new FontFace(BANGLA_FONT, 'url(/fonts/hind-siliguri-bengali-400-normal.woff2)', { weight: '400' }),
      new FontFace(BANGLA_FONT, 'url(/fonts/hind-siliguri-bengali-700-normal.woff2)', { weight: '700' }),
    ];
    await Promise.all(faces.map(async (f) => { await f.load(); document.fonts.add(f); }));
    // Make sure the shaping engine has the font ready for the strings we draw on canvas.
    await Promise.all([
      document.fonts.load(`700 100px "${BANGLA_FONT}"`, 'চাঁদা পরিবহন'),
      document.fonts.load(`400 40px "${BANGLA_FONT}"`, 'কুষ্টিয়া → ঢাকা'),
    ]);
    await document.fonts.ready;
  })();
  return promise;
}

/**
 * Sanity check that complex shaping (conjuncts + chandrabindu) rendered: compares the width of
 * "চাঁদা" vs "চাদা" (chandrabindu is a zero-advance mark, so widths are equal when shaped,
 * but a broken fallback draws a .notdef box which is wider). Returns true when shaping looks OK.
 */
export function verifyBanglaShaping(): boolean {
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return true;
  c.font = `700 80px "${BANGLA_FONT}"`;
  const withMark = c.measureText('চাঁদা').width;
  const without = c.measureText('চাদা').width;
  const conj = c.measureText('ষ্ট').width;   // conjunct should be narrower than two letters
  const sep = c.measureText('ষট').width;
  return Math.abs(withMark - without) < 6 && conj < sep;
}
